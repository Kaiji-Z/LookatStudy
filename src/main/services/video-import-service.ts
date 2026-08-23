/**
 * 视频导入获取层 —— B站纯 JS 直连(wbi 签名 + DASH 音轨)与 yt-dlp 可选兜底。
 *
 * 路由策略(url-route 判 source):
 *   bilibili → 本服务直连(免登录,POC 实测:nav/view/playurl 全通)
 *     多分P 整季:URL 不带 ?p= → 导入全部分P(每P一段音轨,逐段转写后各成虚拟
 *     文档,Step4 按集分章);带 ?p=N → 只导该集。maxPages 上限防病态合集。
 *   youtube/抖音/其他视频站 → yt-dlp(用户自装;**字幕优先**:有 CC/自动字幕
 *   直接出文本零转写,无字幕才抓音轨转录)。未装 yt-dlp 抛带安装指引的错。
 * 网络层走注入 fetchFn(job-service 已挂取消 signal);yt-dlp 用 spawn + abort kill。
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { encWbi, getMixinKey, extractKeysFromNavUrl } from "./pure/bilibili-wbi.js";
import { downloadToBuffer } from "./pure/repo-fetcher.js";
import { parseSubtitleToText, pickSubtitleFile } from "./pure/subtitle-parse.js";

export type VideoFetchResult =
  | { source: "subtitle"; title: string; text: string }
  | { source: "audio"; title: string; bytes: Uint8Array; ext: string }
  /** 多分P整季:每P一段音轨(单P/显式 ?p=N 时仍返回 audio 形状,管线零改动) */
  | { source: "audio-multi"; title: string; parts: { title: string; bytes: Uint8Array; ext: string }[] };

const BILI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 LookatStudy/0.1",
  Referer: "https://www.bilibili.com/",
};

/** 从 B站 URL 提取 BV/av 号与分P(b23.tv 短链由 fetchFn 跟随重定向展开)。
 *  page=undefined 表示 URL 未带 ?p= —— 多分P 视频导入整季;带 ?p=N 只导该集。 */
export function parseBilibiliId(url: string): { bvid?: string; aid?: number; page?: number } | null {
  const u = url.match(/bilibili\.com\/(?:video\/)?(?:BV[a-zA-Z0-9]+|av\d+)/i) ? url : null;
  const m = u?.match(/(BV[a-zA-Z0-9]+|av(\d+))/i);
  if (!m) return null;
  const pm = url.match(/[?&]p=(\d+)/);
  return {
    bvid: m[1]!.toLowerCase().startsWith("bv") ? m[1] : undefined,
    aid: m[2] ? Number(m[2]) : undefined,
    page: pm ? Math.max(1, Number(pm[1])) : undefined,
  };
}

/** B站直连:view(cid/标题/分P列表) → wbi 签名 playurl(逐P) → 最低码率 DASH 音轨。
 *  单P 或显式 ?p=N 返回 audio;多分P且未指定页返回 audio-multi(maxPages 默认 200 封顶)。 */
export async function fetchBilibiliAudio(
  url: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  opts?: { maxPages?: number },
): Promise<VideoFetchResult> {
  onProgress?.("解析 B站视频信息…");
  let parsed = parseBilibiliId(url);
  if (!parsed) {
    // b23.tv 短链:跟随重定向拿真实地址(undici fetch 默认 follow)
    const r = await fetchFn(url, { signal, headers: BILI_HEADERS });
    parsed = parseBilibiliId(r.url || "");
    if (!parsed) throw new Error("无法从该链接解析出 B站视频号(短链展开失败或非视频页)");
  }
  const idParam = parsed.bvid ? `bvid=${parsed.bvid}` : `aid=${parsed.aid}`;

  type BiliJson = { code: number; message?: string; data?: Record<string, unknown> };
  const viewResp = (await (await fetchFn(`https://api.bilibili.com/x/web-interface/view?${idParam}`, { signal, headers: BILI_HEADERS })).json()) as BiliJson;
  if (viewResp.code !== 0) throw new Error(`B站视频信息获取失败: ${viewResp.message}`);
  const viewData = viewResp.data ?? {};
  const title = String(viewData.title ?? "B站视频");
  const pages = (viewData.pages ?? []) as { cid: number; page?: number; part?: string }[];
  const maxPages = Math.max(1, opts?.maxPages ?? 200);
  // 分P显示名:多P 时 "P{n} {分P标题}"(无分P标题用合集主标题),单P 即主标题
  const partName = (i: number) => `P${pages[i]?.page ?? i + 1} ${(pages[i]?.part ?? title).trim()}`.trim();

  // 目标分P:显式 ?p=N → 该集;未指定且多分P → 整季(≤maxPages);其余 → 唯一集
  let targets: { cid: number; name: string }[];
  if (parsed.page !== undefined) {
    const idx = pages.length > 0 ? Math.min(parsed.page, pages.length) - 1 : -1;
    targets = [{ cid: Number(idx >= 0 ? pages[idx]!.cid : viewData.cid ?? 0), name: pages.length > 1 ? partName(idx) : title }];
  } else if (pages.length > 1) {
    if (pages.length > maxPages) onProgress?.(`共 ${pages.length} 个分P,导入前 ${maxPages} 集(需要更多可用 ?p=N 分批导入)`);
    targets = pages.slice(0, maxPages).map((pg, i) => ({ cid: Number(pg.cid), name: partName(i) }));
  } else {
    targets = [{ cid: Number(viewData.cid ?? 0), name: title }];
  }

  // wbi 签名材料(nav 取 img/sub_key)整季共用一次
  const nav = (await (await fetchFn("https://api.bilibili.com/x/web-interface/nav", { signal, headers: BILI_HEADERS })).json()) as BiliJson;
  const wbiImg = ((nav.data ?? {}).wbi_img ?? {}) as { img_url: string; sub_url: string };
  const { imgKey, subKey } = extractKeysFromNavUrl(wbiImg.img_url, wbiImg.sub_url);
  const mixinKey = getMixinKey(imgKey, subKey);
  const idKey = parsed.bvid ? "bvid" : "aid";
  const idVal = parsed.bvid ?? parsed.aid ?? "";

  const parts: { title: string; bytes: Uint8Array; ext: string }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    onProgress?.(targets.length > 1 ? `下载音轨(${i + 1}/${targets.length}): ${t.name}…` : `下载音轨: ${t.name}…`);
    const query = encWbi({ [idKey]: idVal, cid: t.cid, fnval: 80, fnver: 0, qn: 16 }, mixinKey);
    const pu = (await (await fetchFn(`https://api.bilibili.com/x/player/playurl?${query}`, { signal, headers: BILI_HEADERS })).json()) as BiliJson;
    if (pu.code !== 0) throw new Error(`B站播放地址获取失败(${t.name}): ${pu.message}(可能需要登录或为付费内容)`);
    const dash = ((pu.data ?? {}).dash ?? {}) as { audio?: { id: number; bandwidth: number; baseUrl: string }[] };
    const auds = dash.audio ?? [];
    if (auds.length === 0) throw new Error(`B站未返回音轨(${t.name}:纯视频或版权限制)`);
    const pick = auds.slice().sort((a, b) => a.bandwidth - b.bandwidth)[0]!;
    const bytes = await downloadToBuffer(pick.baseUrl, fetchFn, { signal, maxBytes: 200 * 1024 * 1024, headers: BILI_HEADERS });
    parts.push({ title: t.name, bytes, ext: "m4a" });
    if (signal?.aborted) break;
  }
  if (parts.length === 0) throw new Error("没有下载到任何分P音轨");
  if (parts.length === 1) return { source: "audio", title, bytes: parts[0]!.bytes, ext: parts[0]!.ext };
  return { source: "audio-multi", title, parts };
}

let ytdlpCache: string | null | undefined;
/** PATH 探测 yt-dlp(结果缓存;null = 未安装)。 */
export function ytDlpPath(): string | null {
  if (ytdlpCache !== undefined) return ytdlpCache;
  const cmd = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  try {
    const r = spawnSync(cmd, ["--version"], { timeout: 8000, encoding: "utf8" });
    ytdlpCache = r.status === 0 ? cmd : null;
  } catch {
    ytdlpCache = null;
  }
  return ytdlpCache;
}

export const YT_DLP_GUIDE = "未检测到 yt-dlp。安装方式任选:Windows 用 winget install yt-dlp.yt-dlp(或 scoop install yt-dlp);macOS 用 brew install yt-dlp;Linux 用 pipx install yt-dlp。装好后重试本链接。";

function runYtDlp(args: string[], signal?: AbortSignal): { code: number; stdout: string } {
  const cmd = ytDlpPath()!;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => { signal?.removeEventListener("abort", onAbort); reject(e); });
    child.on("close", (code) => { signal?.removeEventListener("abort", onAbort); resolve({ code: code ?? -1, stdout: out }); });
  }) as never;
}

/** yt-dlp 路径:字幕优先(零转写),无字幕抓 bestaudio 落盘。 */
export async function fetchViaYtDlp(
  url: string,
  dataDir: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<VideoFetchResult> {
  if (!ytDlpPath()) throw new Error(YT_DLP_GUIDE);
  const workDir = join(dataDir, "video-tmp", createHash("sha1").update(url).digest("hex").slice(0, 12));
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  try {
    // 标题
    const t = await runYtDlp(["--print", "title", "--no-warnings", url], signal);
    const title = t.stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? url;

    // 字幕优先:CC + 自动字幕(zh/en),只要到任一就零转写
    onProgress?.(`获取字幕(${title})…`);
    await runYtDlp([
      "--skip-download", "--write-subs", "--write-auto-subs",
      "--sub-langs", "zh-Hans,zh-CN,zh,en,-live_chat", "--sub-format", "vtt/srt/best",
      "-o", join(workDir, "sub.%(ext)s"), "--no-warnings", url,
    ], signal);
    // 多语言文件按中文优先级挑(readdir 字母序会让 en 压过 zh-Hans)
    const subFile = pickSubtitleFile(readdirSync(workDir));
    if (subFile) {
      const text = parseSubtitleToText(readFileSync(join(workDir, subFile), "utf8"));
      if (text.length > 50) {
        onProgress?.("已有字幕,直接成文(零转写)…");
        return { source: "subtitle", title, text };
      }
    }

    // 无字幕:抓 bestaudio
    onProgress?.(`无字幕,下载音轨(${title})…`);
    const dl = await runYtDlp(["-f", "bestaudio", "-o", join(workDir, "audio.%(ext)s"), "--no-warnings", url], signal);
    if (dl.code !== 0) throw new Error(`yt-dlp 下载失败: ${dl.stdout.slice(-300)}`);
    const audioFile = readdirSync(workDir).find((f) => f.startsWith("audio."));
    if (!audioFile) throw new Error("yt-dlp 未产出音频文件");
    const ext = audioFile.split(".").pop() ?? "m4a";
    return { source: "audio", title, bytes: new Uint8Array(readFileSync(join(workDir, audioFile))), ext };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
