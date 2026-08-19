/**
 * Edge TTS 客户端 —— node-edge-tts(微软 Edge 朗读通道,免费无 key,MIT)。
 *
 * 输出 mp3(24kHz 48kbit mono);lib 的 API 是"合成到文件",这里包一层临时文件
 * → 读回 bytes → 删除。KaijiBot 同款用法已在生产验证。
 *
 * Windows 坑(实测):Node ≥17 默认 DNS 顺序(verbatim)会拿到该端点连不稳的
 * 地址,WebSocket 握手直接 ECONNRESET;ipv4first 修复。幂等,进程内只生效一次。
 */

import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EdgeTTS } from "node-edge-tts";

import { EDGE_TTS_OUTPUT_FORMAT } from "./tts-tiers";

let dnsTuned = false;
function tuneDnsOnce(): void {
  if (dnsTuned) return;
  dnsTuned = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* 老版本 Node 无此 API:按默认行为走 */
  }
}

export interface EdgeSynthOptions {
  voice: string;
  /** SSML rate 百分比("+10%"/"-5%"),见 speedToRatePercent */
  rate?: string;
  timeoutMs?: number;
}

/** 合成一段文本 → mp3 Buffer。失败抛错(调用方决定 fallback)。 */
export async function synthesizeEdgeMp3(text: string, opts: EdgeSynthOptions): Promise<Buffer> {
  tuneDnsOnce();
  const tmp = path.join(os.tmpdir(), `lookatstudy-edge-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  try {
    const tts = new EdgeTTS({
      voice: opts.voice,
      outputFormat: EDGE_TTS_OUTPUT_FORMAT,
      rate: opts.rate,
      timeout: opts.timeoutMs ?? 20_000,
    });
    await tts.ttsPromise(text, tmp);
    const buf = fs.readFileSync(tmp);
    if (buf.length === 0) throw new Error("edge tts produced empty audio");
    return buf;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 清理失败无碍 */
    }
  }
}
