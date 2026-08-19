/**
 * 视频导入获取层 —— B站纯 JS 直连(wbi 签名 + DASH 音轨)与 yt-dlp 可选兜底。
 *
 * 路由策略(url-route 判 source):
 *   bilibili → 本服务直连(免登录,POC 实测:nav/view/playurl 全通)
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
import { parseSubtitleToText } from "./pure/subtitle-parse.js";

export type VideoFetchResult =
  | { source: "subtitle"; title: string; text: string }
  | { source: "audio"; title: string; bytes: Uint8Array; ext: string };

const BILI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 LookatStudy/0.1",
  Referer: "https://www.bilibili.com/",
};

/** 从 B站 URL 提取 BV/av 号与分P(b23.tv 短链由 fetchFn 跟随重定向展开)。 */
export function parseBilibiliId(url: string): { bvid?: string; aid?: number; page: number } | null {
  const u = url.match(/bilibili\.com\/(?:video\/)?(?:BV[a-zA-Z0-9]+|av\d+)/i) ? url : null;
  const m = u?.match(/(BV[a-zA-Z0-9]+|av(\d+))/i);
  if (!m) return null;
  const pm = url.match(/[?&]p=(\d+)/);
  return {
    bvid: m[1]!.toLowerCase().startsWith("bv") ? m[1] : undefined,
    aid: m[2] ? Number(m[2]) : undefined,
    page: pm ? Math.max(1, Number(pm[1])) : 1,
  };
}

/** B站直连:view(cid/标题/分P) → wbi 签名 playurl → 最低码率 DASH 音轨字节。 */
export async function fetchBilibiliAudio(
  url: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
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
  const pages = (viewData.pages ?? []) as { cid: number }[];
  const page = pages.length > 0 ? pages[Math.min(parsed.page, pages.length) - 1] : null;
  const cid = Number(page?.cid ?? viewData.cid ?? 0);

  onProgress?.(`下载音轨: ${title}${pages.length > 1 ? `(P${parsed.page})` : ""}…`);
  const nav = (await (await fetchFn("https://api.bilibili.com/x/web-interface/nav", { signal, headers: BILI_HEADERS })).json()) as BiliJson;
  const wbiImg = ((nav.data ?? {}).wbi_img ?? {}) as { img_url: string; sub_url: string };
  const { imgKey, subKey } = extractKeysFromNavUrl(wbiImg.img_url, wbiImg.sub_url);
  const idKey = parsed.bvid ? "bvid" : "aid";
  const idVal = parsed.bvid ?? parsed.aid ?? "";
  const query = encWbi({ [idKey]: idVal, cid, fnval: 80, fnver: 0, qn: 16 }, getMixinKey(imgKey, subKey));
  const pu = (await (await fetchFn(`https://api.bilibili.com/x/player/playurl?${query}`, { signal, headers: BILI_HEADERS })).json()) as BiliJson;
  if (pu.code !== 0) throw new Error(`B站播放地址获取失败: ${pu.message}(可能需要登录或为付费内容)`);
  const dash = ((pu.data ?? {}).dash ?? {}) as { audio?: { id: number; bandwidth: number; baseUrl: string }[] };
  const auds = dash.audio ?? [];
  if (auds.length === 0) throw new Error("B站未返回音轨(纯视频或版权限制)");
  const pick = auds.slice().sort((a, b) => a.bandwidth - b.bandwidth)[0]!;
  const bytes = await downloadToBuffer(pick.baseUrl, fetchFn, { signal, maxBytes: 200 * 1024 * 1024, headers: BILI_HEADERS });
  return { source: "audio", title, bytes, ext: "m4a" };
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
    const subFile = readdirSync(workDir).find((f) => /^sub\..*\.(vtt|srt)$/i.test(f));
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
    const audioFile = readdirSync(workDir).find((f) => /^audio\./.test(f));
    if (!audioFile) throw new Error("yt-dlp 未产出音频文件");
    const ext = audioFile.split(".").pop() ?? "m4a";
    return { source: "audio", title, bytes: new Uint8Array(readFileSync(join(workDir, audioFile))), ext };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
