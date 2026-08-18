/**
 * verify-speech-engine —— 语音引擎纯配置构建器 + 变体解析(不加载原生模块)。
 *
 * 运行:tsx scripts/verify-speech-engine.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SPEECH_MODELS_MANIFEST } from "../src/main/services/speech/speech-model-manifest";
import {
  buildAsrConfig,
  buildTtsConfig,
  resolveAsrVariant,
} from "../src/main/services/speech/speech-engine";

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

const norm = (p) => p.replaceAll("\\", "/");

// ---------------------------------------------------------------------------
console.log("T1 TTS 配置:kokoro 布局 + 双词表拼接 + 单句模式");
{
  const cfg = buildTtsConfig("C:/data/speech-models/tts-kokoro");
  const m = cfg.model.kokoro;
  assert.equal(norm(m.model), "C:/data/speech-models/tts-kokoro/model.onnx");
  assert.equal(norm(m.voices), "C:/data/speech-models/tts-kokoro/voices.bin");
  assert.equal(norm(m.dataDir), "C:/data/speech-models/tts-kokoro/espeak-ng-data");
  assert.equal(norm(m.dictDir), "C:/data/speech-models/tts-kokoro/dict");
  assert.equal(
    norm(m.lexicon),
    "C:/data/speech-models/tts-kokoro/lexicon-us-en.txt,C:/data/speech-models/tts-kokoro/lexicon-zh.txt",
    "lexicon 逗号拼接(us-en 在前,实测序)",
  );
  assert.ok((cfg.model.ruleFsts || "").includes("number-zh.fst"), "ruleFsts 三件齐");
  assert.ok(!(cfg.model.ruleFsts || "").includes(",,"), "ruleFsts 无空段");
  assert.equal(cfg.maxNumSentences, 1, "单句合成(首包延迟优先)");
  assert.equal(cfg.model.numThreads, 4);
  ok("TTS 配置正确");
}

// ---------------------------------------------------------------------------
console.log("T2 ASR 配置:int8/fp32 变体文件名");
{
  const int8 = buildAsrConfig("D:/m", "int8");
  assert.equal(norm(int8.modelConfig.transducer.encoder), "D:/m/encoder-epoch-99-avg-1.int8.onnx");
  assert.equal(norm(int8.modelConfig.transducer.decoder), "D:/m/decoder-epoch-99-avg-1.int8.onnx");
  assert.equal(norm(int8.modelConfig.transducer.joiner), "D:/m/joiner-epoch-99-avg-1.int8.onnx");
  assert.equal(norm(int8.modelConfig.tokens), "D:/m/tokens.txt");
  assert.equal(int8.featConfig.sampleRate, 16000);
  assert.equal(int8.featConfig.featureDim, 80);

  const fp32 = buildAsrConfig("D:/m", "fp32");
  assert.equal(norm(fp32.modelConfig.transducer.encoder), "D:/m/encoder-epoch-99-avg-1.onnx", "fp32 无 .int8 后缀");
  ok("ASR 变体配置正确");
}

// ---------------------------------------------------------------------------
console.log("T3 变体解析:磁盘现状 → int8 偏好");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-speech-engine-"));
  try {
    const asr = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-zipformer");
    assert.equal(resolveAsrVariant(tmp, asr), null, "无文件 → null");

    const dir = path.join(tmp, "speech-models", asr.id);
    fs.mkdirSync(dir, { recursive: true });
    // 先只放 fp32 全套
    for (const f of asr.variants.fp32.files) fs.writeFileSync(path.join(dir, f), "x");
    assert.equal(resolveAsrVariant(tmp, asr), "fp32", "仅 fp32 → fp32");

    // 补齐 int8 → 偏好翻转到 int8
    for (const f of asr.variants.int8.files) fs.writeFileSync(path.join(dir, f), "x");
    assert.equal(resolveAsrVariant(tmp, asr), "int8", "双全 → int8");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("变体解析正确");
}

console.log(`\nverify-speech-engine: ${passed} 组全绿 ✓`);
