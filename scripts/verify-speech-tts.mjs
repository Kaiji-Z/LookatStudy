/**
 * verify-speech-tts —— WAV 编码器 + TTS 句级缓存纯函数。
 *
 * 运行:tsx scripts/verify-speech-tts.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { encodeWavPcm16 } from "../src/main/services/speech/wav-codec";
import {
  pickCacheEviction,
  readCachedWav,
  speechCacheDir,
  ttsCacheKey,
  writeCachedWav,
} from "../src/main/services/speech/tts-cache";

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

// ---------------------------------------------------------------------------
console.log("T1 WAV 头部字段(RIFF/PCM16/单声道)");
{
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWavPcm16(samples, 24000);
  const v = new DataView(wav);
  const ascii = (o, n) => Array.from(new Uint8Array(wav, o, n), (c) => String.fromCharCode(c)).join("");
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(v.getUint32(4, true), 36 + samples.length * 2);
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 1, "单声道");
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(28, true), 48000, "byte rate");
  assert.equal(v.getUint16(34, true), 16, "位深");
  assert.equal(ascii(36, 4), "data");
  assert.equal(v.getUint32(40, true), samples.length * 2);
  ok("44 字节头全对");
}

// ---------------------------------------------------------------------------
console.log("T2 量化:clamp + 幅值边界");
{
  const samples = new Float32Array([0, 0.25, -0.25, 2, -2]);
  const v = new DataView(encodeWavPcm16(samples, 16000));
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), Math.round(0.25 * 32767));
  assert.equal(v.getInt16(48, true), -Math.round(0.25 * 32767));
  assert.equal(v.getInt16(50, true), 32767, "+1 满幅");
  assert.equal(v.getInt16(52, true), -32767, "-1 满幅(不回绕)");
  ok("量化正确无回绕");
}

// ---------------------------------------------------------------------------
console.log("T3 缓存键:同文同参稳定 / 异文异键");
{
  const k1 = ttsCacheKey("你好。", 48, 1);
  const k1b = ttsCacheKey("你好。", 48, 1);
  const k2 = ttsCacheKey("你好。", 48, 1.2);
  const k3 = ttsCacheKey("再见。", 48, 1);
  assert.equal(k1, k1b);
  assert.notEqual(k1, k2, "速度不同键不同");
  assert.notEqual(k1, k3, "文本不同键不同");
  assert.ok(/^[0-9a-f]{64}$/.test(k1), "sha256 hex");
  ok("键推导正确");
}

// ---------------------------------------------------------------------------
console.log("T4 缓存读写 + 独立 ArrayBuffer 拷贝");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-tts-cache-"));
  try {
    const wav = encodeWavPcm16(new Float32Array([0.1, -0.1]), 24000);
    const key = ttsCacheKey("t", 48, 1);
    assert.equal(readCachedWav(tmp, key), null, "未写先读=null");
    await writeCachedWav(tmp, key, wav);
    const back = readCachedWav(tmp, key);
    assert.ok(back instanceof ArrayBuffer);
    assert.equal(back.byteLength, wav.byteLength);
    assert.deepEqual(Buffer.from(back), Buffer.from(wav));
    assert.notEqual(back, wav, "返回独立拷贝(不共享源 buffer)");
    assert.ok(fs.existsSync(path.join(speechCacheDir(tmp), `${key}.wav`)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("读写往返一致");
}

// ---------------------------------------------------------------------------
console.log("T5 LRU 淘汰:新→旧保留,超预算删最旧");
{
  const mk = (name, size, mtime) => ({ path: name, size, mtimeMs: mtime });
  // 全部在预算内
  assert.deepEqual(pickCacheEviction([mk("a", 10, 1), mk("b", 10, 2)], 100), []);
  // 总量超预算:最新 b 保,旧 a 删
  assert.deepEqual(pickCacheEviction([mk("a", 60, 1), mk("b", 60, 2)], 100), ["a"]);
  // 三个:保留最新一个
  // 返回序=遍历序(新→旧),删除无序义:集合比较
  assert.deepEqual(
    pickCacheEviction([mk("old", 40, 1), mk("mid", 40, 2), mk("new", 40, 3)], 50).sort(),
    ["mid", "old"],
  );
  // 单文件超预算:也删(不因唯一而豁免)
  assert.deepEqual(pickCacheEviction([mk("huge", 999, 1)], 10), ["huge"]);
  // 空集
  assert.deepEqual(pickCacheEviction([], 10), []);
  ok("淘汰序正确");
}

// ---------------------------------------------------------------------------
console.log("T6 线性降采样:48k → 16k");
{
  const { resampleLinear } = await import("../src/renderer/lib/useAsrInput.js");
  // 1kHz 正弦 @48k 采 48 点 → 16k 应 16 点
  const sin = new Float32Array(48);
  for (let i = 0; i < 48; i++) sin[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
  const out = resampleLinear(sin, 3);
  assert.equal(out.length, 16);
  // 采样点位置对齐:out[i] ≈ sin(2π·1000·i/16000)
  for (const i of [0, 4, 8]) {
    const expect = Math.sin((2 * Math.PI * 1000 * i) / 16000);
    assert.ok(Math.abs(out[i] - expect) < 0.05, `点${i} 插值误差过大`);
  }
  // 常数信号降采样不变
  const flat = new Float32Array(99).fill(0.5);
  const out2 = resampleLinear(flat, 3);
  assert.ok(out2.every((v) => v === 0.5), "常数信号插值后不变");
  // 边界:尾部不足一帧丢弃(不越界)
  assert.equal(resampleLinear(new Float32Array(2), 3).length, 0);
  ok("降采样正确");
}

console.log(`\nverify-speech-tts: ${passed} 组全绿 ✓`);
