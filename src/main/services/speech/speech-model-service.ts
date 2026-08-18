/**
 * 语音模型下载/落盘管理器 —— IO 层,按 speech-plan 纯函数产出的计划搬运字节。
 *
 * 源策略(实测背景见 manifest 头注):
 *  1. ModelScope 逐文件(resolve 直 200,免解压,CN 快;断点续跑=逐文件粒度)
 *  2. GitHub Release 归档兜底:代理链下载 tar.bz2 → unbzip2-stream + tar-stream 流式解压
 *
 * 通用网络约定(与 repo-fetcher 同款):
 *  - SSL 严格先行,证书错误(本地拦截代理环境)才降级 rejectUnauthorized:false(公开模型字节,风险可控)
 *  - AbortSignal 即时撕断在飞请求;30s 空闲超时兜底挂死
 *  - 全部写盘走 .part → rename 原子化,意外中断不留半成品文件名
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { extract as tarExtract } from "tar-stream";

import type {
  SpeechDownloadProgress,
  SpeechModelEntry,
  SpeechModelId,
  SpeechModelStatus,
} from "@shared/speech-types";

import {
  archiveCandidateUrls,
  filterMissingFiles,
  modelscopeFileUrl,
  pickVariant,
  planModelscopeFiles,
  tarEntryDest,
  type ModelscopeListingFile,
  type PlannedFile,
} from "../pure/speech-plan";
import { httpsGet } from "../pure/repo-fetcher";
import { nativeRequire } from "./native-require";

const CERT_RETRY_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export interface EnsureSpeechModelHooks {
  onProgress?: (e: SpeechDownloadProgress) => void;
}

export type EnsureResult = { variant: string; source: string; alreadyReady?: boolean };

// ---------------------------------------------------------------------------
// 路径与状态
// ---------------------------------------------------------------------------

export function speechModelsRoot(dataDir: string): string {
  return path.join(dataDir, "speech-models");
}

export function speechModelDir(dataDir: string, id: SpeechModelId): string {
  return path.join(speechModelsRoot(dataDir), id);
}

/** 递归列出模型目录(跳过点文件):rel path → 字节数。变体判定与断点续跑共用。 */
export function listModelFiles(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) {
        try {
          out.set(child, fs.statSync(path.join(dir, child)).size);
        } catch {
          /* 竞态删除:当缺失处理 */
        }
      }
    }
  };
  walk("");
  return out;
}

export function readSpeechModelStatus(
  dataDir: string,
  entry: SpeechModelEntry,
): SpeechModelStatus {
  const files = listModelFiles(speechModelDir(dataDir, entry.id));
  const variant = pickVariant(entry, new Set(files.keys()));
  const totalBytes = files.get("model.onnx") ?? files.get("encoder-epoch-99-avg-1.int8.onnx") ?? entry.approxBytes;
  return variant
    ? { id: entry.id, state: "ready", progress: 1, downloadedBytes: totalBytes, totalBytes }
    : { id: entry.id, state: "absent", progress: 0, downloadedBytes: 0, totalBytes: entry.approxBytes };
}

export async function deleteSpeechModel(dataDir: string, id: SpeechModelId): Promise<void> {
  await fsp.rm(speechModelDir(dataDir, id), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 低层流式下载
// ---------------------------------------------------------------------------

interface StreamResp {
  status: number;
  stream: IncomingMessage;
  contentLength: number | null;
  location?: string;
}

function httpsStream(
  url: string,
  opts: { rejectUnauthorized?: boolean; signal?: AbortSignal },
): Promise<StreamResp> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error("aborted"));
    let settled = false;
    const req = https.get(url, {
      headers: { "User-Agent": "lookatstudy-speech" },
      rejectUnauthorized: opts.rejectUnauthorized ?? true,
      timeout: 30_000,
    }, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      resolve({
        status,
        stream: res,
        contentLength: res.headers["content-length"] ? Number(res.headers["content-length"]) : null,
        location: typeof loc === "string" ? loc : undefined,
      });
    });
    const deadline = setTimeout(() => {
      if (!settled) { settled = true; req.destroy(); reject(new Error("deadline")); }
    }, 60_000);
    const onAbort = () => { if (!settled) { settled = true; req.destroy(); reject(new Error("aborted")); } };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(e);
    });
    req.on("timeout", () => { if (!settled) { settled = true; req.destroy(); reject(new Error("timeout")); } });
  });
}

/** 带重定向跟随 + 证书降级重试的流式 GET(下载大文件用) */
async function httpsStreamFollow(
  url: string,
  signal: AbortSignal | undefined,
  depth = 0,
  lax = false,
): Promise<StreamResp> {
  if (depth > 5) throw new Error("too many redirects");
  let r: StreamResp;
  try {
    r = await httpsStream(url, { rejectUnauthorized: !lax, signal });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (!lax && CERT_RETRY_CODES.has(code)) return httpsStreamFollow(url, signal, depth, true);
    throw e;
  }
  if ([301, 302, 303, 307, 308].includes(r.status) && r.location) {
    r.stream.resume(); // 排空响应体再追下一跳
    return httpsStreamFollow(new URL(r.location, url).toString(), signal, depth + 1, lax);
  }
  return r;
}

function streamToFile(
  resp: StreamResp,
  dest: string,
  opts: { onBytes?: (n: number) => void; signal?: AbortSignal },
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, written: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      opts.signal?.removeEventListener("abort", onAbort);
      ws.destroy();
      if (err) {
        fs.rm(dest, { force: true }, () => reject(err));
      } else {
        resolve(written);
      }
    };
    const ws = fs.createWriteStream(dest);
    let written = 0;
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new Error("idle-timeout"), written), 30_000);
    };
    let idle = setTimeout(() => finish(new Error("idle-timeout"), written), 30_000);
    const onAbort = () => finish(new Error("aborted"), written);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    resp.stream.on("data", (d: Buffer) => {
      written += d.length;
      opts.onBytes?.(d.length);
      armIdle();
      ws.write(d);
    });
    resp.stream.on("end", () => ws.end(() => finish(null, written)));
    resp.stream.on("error", (e) => finish(e, written));
    ws.on("error", (e) => finish(e, written));
  });
}

/** 单文件下载:.part 原子落盘 + 尺寸校验(expectBytes 已知时) */
async function downloadFile(
  url: string,
  dest: string,
  opts: { expectBytes?: number; onBytes?: (n: number) => void; signal?: AbortSignal } = {},
): Promise<number> {
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true }); // 嵌套路径(dict/、espeak-ng-data/)先建父目录
  const resp = await httpsStreamFollow(url, opts.signal);
  if (resp.status !== 200) {
    resp.stream.resume();
    throw new Error(`HTTP ${resp.status}`);
  }
  const written = await streamToFile(resp, part, opts);
  if (opts.expectBytes !== undefined && written !== opts.expectBytes) {
    await fsp.rm(part, { force: true });
    throw new Error(`size mismatch: got ${written} expect ${opts.expectBytes}`);
  }
  await fsp.rename(part, dest);
  return written;
}

// ---------------------------------------------------------------------------
// 源 1:ModelScope 逐文件
// ---------------------------------------------------------------------------

async function fetchModelscopeListing(
  repo: string,
  revision: string,
  signal?: AbortSignal,
): Promise<ModelscopeListingFile[]> {
  const url = `https://modelscope.cn/api/v1/models/${repo}/repo/files?Recursive=true&Revision=${encodeURIComponent(revision)}`;
  // 列表 JSON 数百 KB 上限:两档尝试(严格证书 → 降级),与 repo-fetcher 同款理由
  let r = await httpsGet(url, { deadlineMs: 60_000, signal });
  if (!r.ok) r = await httpsGet(url, { rejectUnauthorized: false, deadlineMs: 60_000, signal });
  if (!r.ok || !r.body) throw new Error(`listing HTTP ${r.status ?? r.error}`);
  const data = JSON.parse(r.body) as { Data?: { Files?: ModelscopeListingFile[] } };
  const files = data.Data?.Files;
  if (!files || files.length === 0) throw new Error("listing empty");
  return files;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const my = items[idx++]!;
      await fn(my);
    }
  });
  await Promise.all(workers);
}

async function downloadFromModelscope(
  dir: string,
  entry: SpeechModelEntry,
  source: Extract<SpeechModelEntry["sources"][number], { kind: "modelscope-files" }>,
  hooks: EnsureSpeechModelHooks,
  signal?: AbortSignal,
): Promise<string> {
  const listing = await fetchModelscopeListing(source.repo, source.revision, signal);
  const planAll = planModelscopeFiles(listing, source);
  if (planAll.length === 0) throw new Error("plan empty");
  const existing = listModelFiles(dir);
  const todo = filterMissingFiles(planAll, existing);
  const totalBytes = planAll.reduce((s, f) => s + f.bytes, 0);
  const doneBytes = totalBytes - todo.reduce((s, f) => s + f.bytes, 0);
  // 每文件独立分账:并发安全,失败重试回零,不重复计数
  const partial = new Map<string, number>();
  const emit = (currentFile?: string) => {
    let partialSum = 0;
    for (const v of partial.values()) partialSum += v;
    hooks.onProgress?.({
      id: entry.id,
      downloadedBytes: doneBytes + partialSum,
      totalBytes,
      progress: totalBytes > 0 ? Math.min(0.999, (doneBytes + partialSum) / totalBytes) : 0,
      source: "modelscope",
      currentFile,
    });
  };
  const perFile = async (f: PlannedFile) => {
    const url = modelscopeFileUrl(source.repo, source.revision, f.path);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      partial.set(f.path, 0);
      try {
        await downloadFile(url, path.join(dir, f.path), {
          expectBytes: f.bytes,
          signal,
          onBytes: (n) => {
            partial.set(f.path, (partial.get(f.path) ?? 0) + n);
            emit(f.path);
          },
        });
        partial.set(f.path, f.bytes);
        emit(f.path);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        partial.set(f.path, 0);
        if (signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (lastErr) {
      partial.delete(f.path);
      throw lastErr;
    }
  };
  await runPool(todo, 4, perFile);
  return "modelscope";
}

// ---------------------------------------------------------------------------
// 源 2:GitHub 归档(代理链 + 流式解压)
// ---------------------------------------------------------------------------

function extractTarBz2(archive: string, dir: string, stripTopDir: boolean, signal?: AbortSignal): Promise<void> {
  // 可调用 CJS 模块(tsc 无 esModuleInterop):nativeRequire 兼容 tsx/ESM
  const unbzip2 = nativeRequire<() => NodeJS.ReadWriteStream>("unbzip2-stream");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const extract = tarExtract();
    extract.on("entry", (header: import("tar-stream").Headers, stream: NodeJS.ReadableStream, next: () => void) => {
      const rel = tarEntryDest(header.name, stripTopDir);
      if (!rel) {
        stream.resume();
        return next();
      }
      const dest = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const ws = fs.createWriteStream(dest);
      stream.pipe(ws);
      ws.on("finish", next);
      ws.on("error", (e) => finish(e as Error));
    });
    extract.on("finish", () => finish(null));
    extract.on("error", (e) => finish(e as Error));
    const rs = fs.createReadStream(archive);
    const bz = unbzip2();
    rs.on("error", (e) => finish(e as Error));
    bz.on("error", (e) => finish(e as Error));
    const onAbort = () => {
      rs.destroy();
      finish(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    rs.pipe(bz).pipe(extract);
  });
}

async function downloadFromGithubArchive(
  dir: string,
  entry: SpeechModelEntry,
  source: Extract<SpeechModelEntry["sources"][number], { kind: "github-archive" }>,
  hooks: EnsureSpeechModelHooks,
  signal?: AbortSignal,
): Promise<string> {
  const archivePath = path.join(dir, ".download.tar.bz2");
  let lastErr: unknown;
  for (const url of archiveCandidateUrls(source)) {
    try {
      let acc = 0;
      await downloadFile(url, archivePath, {
        signal,
        onBytes: (n) => {
          acc += n;
          hooks.onProgress?.({
            id: entry.id,
            downloadedBytes: acc,
            totalBytes: source.sizeBytes,
            progress: Math.min(0.999, acc / source.sizeBytes),
            source: "github-archive",
          });
        },
      });
      // bz2 魔数校验,防代理返回 HTML 错误页
      const fh = await fsp.open(archivePath, "r");
      const magic = Buffer.alloc(3);
      await fh.read(magic, 0, 3, 0);
      await fh.close();
      if (magic.toString("latin1") !== "BZh") throw new Error("not a bz2 archive");
      await extractTarBz2(archivePath, dir, source.stripTopDir, signal);
      await fsp.rm(archivePath, { force: true });
      return "github-archive";
    } catch (e) {
      lastErr = e;
      await fsp.rm(archivePath, { force: true }).catch(() => {});
      if (signal?.aborted) throw e;
      // 下一候选(代理链)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all candidates failed");
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

/**
 * 确保模型就绪:已就绪直返;否则按源序尝试(ModelScope → GitHub 归档),全败抛最后错误。
 * 成功后写 .ready.json 标记(审计用;就绪判定本身以文件存在为准)。
 */
export async function ensureSpeechModel(
  dataDir: string,
  entry: SpeechModelEntry,
  hooks: EnsureSpeechModelHooks = {},
  signal?: AbortSignal,
): Promise<EnsureResult> {
  const dir = speechModelDir(dataDir, entry.id);
  await fsp.mkdir(dir, { recursive: true });

  const already = pickVariant(entry, new Set(listModelFiles(dir).keys()));
  if (already) return { variant: already, source: "cache", alreadyReady: true };

  let lastErr: unknown;
  for (const source of entry.sources) {
    try {
      let used: string;
      if (source.kind === "modelscope-files") {
        used = await downloadFromModelscope(dir, entry, source, hooks, signal);
      } else {
        used = await downloadFromGithubArchive(dir, entry, source, hooks, signal);
      }
      const variant = pickVariant(entry, new Set(listModelFiles(dir).keys()));
      if (!variant) throw new Error(`${used} 下载完成但变体文件不齐`);
      hooks.onProgress?.({ id: entry.id, downloadedBytes: entry.approxBytes, totalBytes: entry.approxBytes, progress: 1, source: used });
      await fsp.writeFile(
        path.join(dir, ".ready.json"),
        JSON.stringify({ id: entry.id, variant, source: used, completedAt: new Date().toISOString() }, null, 2),
      );
      return { variant, source: used };
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      // 下一源兜底
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("speech model download failed");
}
