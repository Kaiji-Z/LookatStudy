/**
 * live-test-edge-tts —— Edge 在线朗读真实合成(需网络,CI 不跑)。
 *
 * 门控:LIVE_SPEECH=1。不需要任何 key(edge 通道免费)。
 * 三音色各合成一句中英混合文本,断言非空 mp3(ID3/帧头嗅探)+ 首字节延时合理。
 *
 * 运行:LIVE_SPEECH=1 npx tsx scripts/live-test/live-test-edge-tts.mjs
 */

import assert from "node:assert/strict";

import { readApiKey } from "./_load-env.mjs"; // 不需要 key(edge 免费通道),导入仅为统一入口惯例
import { synthesizeEdgeMp3 } from "../../src/main/services/speech/edge-tts-client";

void readApiKey;

if (process.env.LIVE_SPEECH !== "1") {
  console.log("skip: 需要 LIVE_SPEECH=1(微软在线合成,免 key)");
  process.exit(0);
}

const voices = [
  { voice: "zh-CN-XiaoxiaoNeural", text: "你好，欢迎来到 LookatStudy，今天我们学习递归。", label: "晓晓(zh)" },
  { voice: "zh-CN-YunxiNeural", text: "第二句用男声试试，顺便混一点 English words。", label: "云希(zh)" },
  { voice: "en-US-AriaNeural", text: "This sentence checks the English neural voice path.", label: "Aria(en)" },
];

/** mp3 嗅探:ID3 头(ID3)或 MPEG 帧同步(0xFF Ex) */
function looksLikeMp3(buf) {
  if (buf.length < 4) return false;
  const head = buf.subarray(0, 3).toString("ascii");
  if (head === "ID3") return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

for (const v of voices) {
  const t0 = Date.now();
  const mp3 = await synthesizeEdgeMp3(v.text, { voice: v.voice, timeoutMs: 25_000 });
  const ms = Date.now() - t0;
  const kb = (mp3.length / 1024).toFixed(1);
  console.log(`[live] ${v.label}: ${kb}KB in ${ms}ms`);
  assert.ok(mp3.length > 2000, `${v.voice} 应合成出非空音频`);
  assert.ok(looksLikeMp3(mp3), `${v.voice} 输出应为 mp3 容器`);
  assert.ok(ms < 20_000, `${v.voice} 不应超时`);
}

// 语速换算走一遍真实通道(rate=+20%)
const fast = await synthesizeEdgeMp3("语速加快的句子。", { voice: "zh-CN-XiaoxiaoNeural", rate: "+20%" });
assert.ok(fast.length > 1000, "带 rate 的合成应成功");

console.log("\nLIVE-EDGE-TTS ALL PASS ✅");
process.exit(0);
