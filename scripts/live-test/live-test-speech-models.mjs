/**
 * live-test-speech-models —— 语音模型真实下载 + 引擎回环(需网络,CI 不跑)。
 *
 * 门控:LIVE_SPEECH=1 才执行。本测试不需要 LLM key(纯模型下载 + 本地推理)。
 * 首跑从 ModelScope 真实下载(~600MB)到缓存目录,之后 ensure 幂等秒回;
 * 再跑 TTS 合成→ASR 识别回环,产出 verdict 报告。
 *
 * 运行:LIVE_SPEECH=1 npx tsx scripts/live-test/live-test-speech-models.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readApiKey } from "./_load-env.mjs"; // 不需要 LLM key(纯模型下载+本地推理),导入仅为统一入口惯例
import { SPEECH_MODELS_MANIFEST } from "../../src/main/services/speech/speech-model-manifest";
import { ensureSpeechModel, readSpeechModelStatus } from "../../src/main/services/speech/speech-model-service";
import { getAsrEngine, getTtsEngine, synthesize } from "../../src/main/services/speech/speech-engine";
import { normalizeSpeechText, splitSentences } from "../../shared/speech-text";

if (process.env.LIVE_SPEECH !== "1") {
  console.log("skip: 需要 LIVE_SPEECH=1(真实下载 ~600MB + 本地推理)");
  process.exit(0);
}

const dataDir = path.join(os.tmpdir(), "ls-speech-live");
fs.mkdirSync(dataDir, { recursive: true });
console.log(`[live] dataDir=${dataDir}`);

// ---------------------------------------------------------------------------
// Step 1:两模型就绪(真实下载,幂等)
// ---------------------------------------------------------------------------
for (const entry of SPEECH_MODELS_MANIFEST.models) {
  const t0 = Date.now();
  let lastPct = -1;
  const r = await ensureSpeechModel(dataDir, entry, {
    onProgress: (e) => {
      const pct = Math.floor(e.progress * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        console.log(`  [${entry.id}] ${pct}% ${(e.downloadedBytes / 1e6).toFixed(0)}/${(e.totalBytes / 1e6).toFixed(0)}MB via ${e.source ?? "?"} ${e.currentFile ?? ""}`);
      }
    },
  });
  const st = readSpeechModelStatus(dataDir, entry);
  console.log(`[live] ${entry.id}: variant=${r.variant} source=${r.source}${r.alreadyReady ? "(cached)" : ""} ${((Date.now() - t0) / 1000).toFixed(1)}s state=${st.state}`);
  assert.equal(st.state, "ready", `${entry.id} 应就绪`);
}

// 幂等复跑:零网络
{
  const t0 = Date.now();
  const r = await ensureSpeechModel(dataDir, SPEECH_MODELS_MANIFEST.models[0]);
  assert.ok(r.alreadyReady, "复跑应直返 cache");
  console.log(`[live] 幂等复跑 ${Date.now() - t0}ms ✓`);
}

// ---------------------------------------------------------------------------
// Step 2:TTS 合成(流式块)+ 文本管线
// ---------------------------------------------------------------------------
const raw = "## 递归\n函数调用自身的技巧称为**递归**。例如 `fact(n) = n * fact(n-1)`。\n\n理解它之后，编程会变得轻松许多。";
const clean = normalizeSpeechText(raw);
console.log(`[live] normalizeSpeechText: ${JSON.stringify(clean)}`);
assert.ok(!clean.includes("**") && !clean.includes("##"), "markdown 应净化");
assert.ok(!clean.includes("fact(n)"), "行内代码应剔除");
const { sentences } = splitSentences(clean, { flush: true });
console.log(`[live] splitSentences: ${JSON.stringify(sentences)}`);
assert.ok(sentences.length >= 3, "至少切出 3 句");

const tts = await getTtsEngine(dataDir);
let totalSamples = 0;
const sampleRate = tts.sampleRate;
for (const s of sentences.slice(0, 2)) {
  const t0 = Date.now();
  let chunks = 0;
  const audio = await synthesize(tts, s, { onChunk: () => { chunks++; } });
  const dur = audio.samples.length / audio.sampleRate;
  const rtf = ((Date.now() - t0) / 1000) / dur;
  console.log(`[live] TTS "${s.slice(0, 12)}…" dur=${dur.toFixed(2)}s rtf=${rtf.toFixed(2)} chunks=${chunks}`);
  totalSamples += audio.samples.length;
}
assert.ok(totalSamples > sampleRate, "应合成出至少 1 秒音频");

// ---------------------------------------------------------------------------
// Step 3:ASR 回环(24k→16k 抽取降采样,live 冒烟足够)
// ---------------------------------------------------------------------------
const asrEntry = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-zipformer");
const recognizer = getAsrEngine(dataDir, asrEntry);
const stream = recognizer.createStream();
// 用 TTS 首句产物
const a0 = await synthesize(tts, sentences[0]);
const ratio = a0.sampleRate / 16000;
const pcm16 = new Float32Array(Math.floor(a0.samples.length / ratio));
for (let i = 0; i < pcm16.length; i++) pcm16[i] = a0.samples[Math.floor(i * ratio)];
const chunkSz = 16000 * 0.3;
let text = "";
for (let i = 0; i < pcm16.length; i += chunkSz) {
  stream.acceptWaveform({ sampleRate: 16000, samples: pcm16.subarray(i, i + chunkSz) });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  if (recognizer.isEndpoint(stream)) { recognizer.reset(stream); }
}
stream.inputFinished();
while (recognizer.isReady(stream)) recognizer.decode(stream);
text = recognizer.getResult(stream).text;
console.log(`[live] ASR roundtrip: ${JSON.stringify(text)}`);
assert.ok(text.length > 0, "ASR 应产出非空文本");

console.log("\nLIVE-SPEECH-MODELS ALL PASS ✅");
process.exit(0);
