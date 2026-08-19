/**
 * verify-speech-engine —— 语音引擎纯配置构建器 + 变体解析(不加载原生模块)。
 *
 * v0.13:ASR 换 Whisper 离线(zipformer 流式退役);T2/T3 断言 whisper 布局。
 *
 * 运行:tsx scripts/verify-speech-engine.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SPEECH_MODELS_MANIFEST } from "../src/main/services/speech/speech-model-manifest";
import {
  buildTtsConfig,
  buildWhisperConfig,
  resolveWhisperVariant,
  whisperPrefix,
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
console.log("T2 Whisper 配置:turbo/small 前缀 + int8/fp32 变体文件名 + 语言提示");
{
  const t8 = buildWhisperConfig("D:/m", "turbo", "int8");
  assert.equal(norm(t8.modelConfig.whisper.encoder), "D:/m/turbo-encoder.int8.onnx");
  assert.equal(norm(t8.modelConfig.whisper.decoder), "D:/m/turbo-decoder.int8.onnx");
  assert.equal(norm(t8.modelConfig.tokens), "D:/m/turbo-tokens.txt");
  assert.equal(t8.featConfig.sampleRate, 16000);
  assert.equal(t8.featConfig.featureDim, 80);
  assert.equal(t8.modelConfig.whisper.task, "transcribe");

  const s32 = buildWhisperConfig("D:/m", "small", "fp32", "zh");
  assert.equal(norm(s32.modelConfig.whisper.encoder), "D:/m/small-encoder.onnx", "fp32 无 .int8 后缀");
  assert.equal(s32.modelConfig.whisper.language, "zh", "语言提示透传");
  const noLang = buildWhisperConfig("D:/m", "turbo", "int8");
  assert.equal(noLang.modelConfig.whisper.language, undefined, "缺省语言=自动检测");

  assert.equal(whisperPrefix("asr-whisper-turbo"), "turbo");
  assert.equal(whisperPrefix("asr-whisper-small"), "small");
  ok("Whisper 配置正确");
}

// ---------------------------------------------------------------------------
console.log("T3 变体解析:磁盘现状 → int8 偏好(turbo 单变体 + small 双变体)");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-speech-engine-"));
  try {
    const turbo = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-whisper-turbo");
    const small = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-whisper-small");
    assert.equal(resolveWhisperVariant(tmp, turbo), null, "无文件 → null");

    const dir = path.join(tmp, "speech-models", small.id);
    fs.mkdirSync(dir, { recursive: true });
    // 先只放 fp32 全套
    for (const f of small.variants.fp32.files) fs.writeFileSync(path.join(dir, f), "x");
    assert.equal(resolveWhisperVariant(tmp, small), "fp32", "仅 fp32 → fp32");

    // 补齐 int8 → 偏好翻转到 int8
    for (const f of small.variants.int8.files) fs.writeFileSync(path.join(dir, f), "x");
    assert.equal(resolveWhisperVariant(tmp, small), "int8", "双全 → int8");

    // turbo 清单只有 int8 变体(镜像 int8-only)
    assert.deepEqual(Object.keys(turbo.variants), ["int8"], "turbo 单变体");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("变体解析正确");
}

console.log(`\nverify-speech-engine: ${passed} 组全绿 ✓`);
