/**
 * TTS 句级磁盘缓存 —— {dataDir}/speech-cache/{sha256}.wav,LRU 200MB。
 *
 * 键 = sha256(sid|speed|sentence):同一句重读零合成(秒回);M2 消息朗读的
 * 二次点击、同课文反复带读都吃这个缓存。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const SPEECH_CACHE_LIMIT_BYTES = 200 * 1024 * 1024;

export function speechCacheDir(dataDir: string): string {
  return path.join(dataDir, "speech-cache");
}

export function ttsCacheKey(sentence: string, sid: number, speed: number): string {
  return crypto.createHash("sha256").update(`${sid}|${speed}|${sentence}`).digest("hex");
}

export interface CacheFileMeta {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * LRU 淘汰纯函数:按 mtime 新→旧保留,超出预算的最旧文件列表应删。
 * verify 直测(空集/恰好预算/单文件超预算)。
 */
export function pickCacheEviction(files: CacheFileMeta[], budgetBytes: number): string[] {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs); // 新→旧
  let used = 0;
  const evict: string[] = [];
  for (const f of sorted) {
    used += f.size;
    if (used > budgetBytes) evict.push(f.path);
  }
  return evict;
}

export function readCachedWav(dataDir: string, key: string): ArrayBuffer | null {
  try {
    const buf = fs.readFileSync(path.join(speechCacheDir(dataDir), `${key}.wav`));
    // Buffer → 独立 ArrayBuffer(避免 IPC 序列化共享池整段克隆的坑)
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return ab;
  } catch {
    return null;
  }
}

export async function writeCachedWav(dataDir: string, key: string, wav: ArrayBuffer): Promise<void> {
  const dir = speechCacheDir(dataDir);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${key}.wav`), Buffer.from(wav));
  await trimSpeechCache(dataDir);
}

async function trimSpeechCache(dataDir: string): Promise<void> {
  const dir = speechCacheDir(dataDir);
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const metas: CacheFileMeta[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".wav")) continue;
    try {
      const st = await fsp.stat(path.join(dir, e.name));
      metas.push({ path: path.join(dir, e.name), size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* 竞态:跳过 */
    }
  }
  await Promise.all(
    pickCacheEviction(metas, SPEECH_CACHE_LIMIT_BYTES).map((p) => fsp.rm(p, { force: true }).catch(() => {})),
  );
}
