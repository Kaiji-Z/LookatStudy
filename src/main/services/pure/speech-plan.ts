/**
 * 语音模型下载的纯规划函数 —— 无 IO,verify 直测。
 *
 * 原则同 repo-fetcher:纯函数承载全部决策(过滤/路径安全/变体挑选/进度聚合),
 * IO 层(speech-model-service)只负责按计划搬运字节。
 */

import type {
  SpeechModelEntry,
  SpeechModelsManifest,
  SpeechSourceGithubArchive,
  SpeechSourceModelscope,
} from "@shared/speech-types";

// ---------------------------------------------------------------------------
// ModelScope 逐文件源
// ---------------------------------------------------------------------------

/** ModelScope files API 的条目形状(Recursive=true 列表) */
export interface ModelscopeListingFile {
  Path: string;
  Size: number;
  Type?: string;
}

export interface PlannedFile {
  path: string;
  bytes: number;
}

/**
 * 镜像文件列表 → 下载计划:include 白名单优先,否则全量减 exclude;
 * 恒定剔除目录条目与镜像杂项(.git/隐藏文件守护)。
 */
export function planModelscopeFiles(
  listing: ModelscopeListingFile[],
  source: SpeechSourceModelscope,
): PlannedFile[] {
  const include = source.include ? new Set(source.include) : null;
  const exclude = new Set(source.exclude ?? []);
  return listing
    .filter((f) => f.Type !== "tree")
    .filter((f) => !f.Path.endsWith("/"))
    .filter((f) => (include ? include.has(f.Path) : !exclude.has(f.Path)))
    .filter((f) => !f.Path.startsWith("."))
    .map((f) => ({ path: f.Path, bytes: f.Size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** ModelScope 逐文件下载 URL(resolve 直 200,无重定向) */
export function modelscopeFileUrl(repo: string, revision: string, path: string): string {
  return `https://modelscope.cn/models/${repo}/resolve/${revision}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** 已存在且字节数一致的文件跳过(断点续跑:逐文件粒度天然可续) */
export function filterMissingFiles(
  plan: PlannedFile[],
  existing: Map<string, number>,
): PlannedFile[] {
  return plan.filter((p) => existing.get(p.path) !== p.bytes);
}

// ---------------------------------------------------------------------------
// GitHub 归档源
// ---------------------------------------------------------------------------

/**
 * tar 条目名 → 目标相对路径;返回 null = 跳过该条目。
 * 安全红线:拒绝绝对路径/`..` 穿越/设备文件;stripTopDir 剥顶层目录;
 * 目录条目(以 / 结尾)与 pax 扩展头不产出文件。
 */
export function tarEntryDest(name: string, stripTopDir: boolean): string | null {
  if (name.startsWith("/") || name.includes("..")) return null;
  if (name.endsWith("/")) return null;
  // pax 扩展头(GNU tar 的 ./PaxHeaders.0/xxx 等)不是内容
  if (name.startsWith("./PaxHeaders") || name.startsWith("PaxHeaders")) return null;
  let rel = name;
  if (stripTopDir) {
    const idx = rel.indexOf("/");
    if (idx < 0) return null; // 顶层散文件(归档结构不符)不落
    rel = rel.slice(idx + 1);
    if (!rel) return null; // 顶层目录本身
  }
  if (!rel || rel.startsWith(".") || rel.startsWith("/")) return null;
  return rel;
}

/** 归档源候选 URL:直连 + 代理链(前缀拼接,顺序敏感) */
export function archiveCandidateUrls(source: SpeechSourceGithubArchive): string[] {
  return [source.url, ...source.proxies.map((p) => p + source.url)];
}

// ---------------------------------------------------------------------------
// 变体与就绪判定
// ---------------------------------------------------------------------------

/** 磁盘文件集合 → 就绪变体;偏好序 = variants 键序(如 int8 先于 fp32) */
export function pickVariant(entry: SpeechModelEntry, filesOnDisk: Set<string>): string | null {
  for (const [name, variant] of Object.entries(entry.variants)) {
    if (variant.files.every((f) => filesOnDisk.has(f))) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 清单校验与进度
// ---------------------------------------------------------------------------

/** 结构校验:返回错误列表(空=合法)。verify 闭环靠它抓回归。 */
export function validateSpeechManifest(m: SpeechModelsManifest): string[] {
  const errs: string[] = [];
  if (m.formatVersion !== 1) errs.push("formatVersion 必须为 1");
  if (!Array.isArray(m.models) || m.models.length === 0) {
    errs.push("models 非空");
    return errs;
  }
  const seen = new Set<string>();
  for (const e of m.models) {
    const tag = e.id ?? "(missing id)";
    if (seen.has(e.id)) errs.push(`${tag}: id 重复`);
    seen.add(e.id);
    if (!e.label) errs.push(`${tag}: 缺 label`);
    if (!["tts", "asr"].includes(e.scope)) errs.push(`${tag}: scope 非法`);
    if (e.sampleRate !== 16000 && e.sampleRate !== 24000) errs.push(`${tag}: sampleRate 非法`);
    if (!Array.isArray(e.sources) || e.sources.length === 0) {
      errs.push(`${tag}: 至少一个下载源`);
    } else {
      e.sources.forEach((s, i) => {
        if (s.kind === "modelscope-files") {
          if (!/^[^/\s]+\/[^/\s]+$/.test(s.repo)) errs.push(`${tag}: 源${i} repo 形如 ns/name`);
          if (!s.revision) errs.push(`${tag}: 源${i} 缺 revision`);
        } else if (s.kind === "github-archive") {
          if (!s.url.startsWith("https://")) errs.push(`${tag}: 源${i} url 须 https`);
          if (!Number.isFinite(s.sizeBytes) || s.sizeBytes <= 0) errs.push(`${tag}: 源${i} sizeBytes 非法`);
          if (!Array.isArray(s.proxies) || s.proxies.some((p) => !/^https:\/\/.+\/$/.test(p))) {
            errs.push(`${tag}: 源${i} proxies 须为 https 前缀(尾斜杠)`);
          }
        } else {
          errs.push(`${tag}: 源${i} kind 未知`);
        }
      });
    }
    const variants = Object.entries(e.variants ?? {});
    if (variants.length === 0) errs.push(`${tag}: 至少一个变体`);
    for (const [vn, v] of variants) {
      if (!v?.files?.length) errs.push(`${tag}: 变体 ${vn} 文件列表为空`);
      for (const f of v.files) {
        if (!f || f.startsWith("/") || f.includes("..")) errs.push(`${tag}: 变体 ${vn} 文件路径不安全: ${f}`);
      }
    }
  }
  return errs;
}

/** 多模型下载总进度:按 approxBytes 加权 */
export function computeOverallProgress(models: Array<{ progress: number; approxBytes: number }>): number {
  const totalW = models.reduce((s, m) => s + (m.approxBytes || 0), 0);
  if (totalW <= 0) return models.length > 0 ? models[0]!.progress : 0;
  return models.reduce((s, m) => s + Math.max(0, Math.min(1, m.progress)) * (m.approxBytes || 0), 0) / totalW;
}
