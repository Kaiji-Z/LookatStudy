/**
 * verify-speech-tiers —— v0.13 语音三档(TTS edge/azure/local + ASR local/groq/azure)。
 *
 * 纯函数层:档位解析/语速换算/azure SSML 构造/URL 构造/locale 推导/静音检测状态机/
 * WAV 解码;编排层:speakMessage 的 edge→local 降级链(经 deps 注入 stub 合成)。
 *
 * 运行:tsx scripts/verify-speech-tiers.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  azureTtsMissing,
  clampSpeed,
  resolveTtsTier,
  speedToRatePercent,
  DEFAULT_EDGE_VOICE,
} from "../src/main/services/speech/tts-tiers";
import { buildAzureSsml, azureTtsUrl, escapeXml } from "../src/main/services/speech/azure-tts-client";
import { azureSttUrl, groqTranscribeUrl } from "../src/main/services/speech/cloud-asr-client";
import {
  asrCloudMissing,
  localeToBcp47,
  localeToWhisperLang,
  resolveAsrTier,
} from "../src/main/services/speech/asr-tiers";
import { createSilenceDetector } from "../src/renderer/lib/silence-detector";
import { trimSilenceEdges } from "../src/renderer/lib/audio-trim";
import { speedToOpenaiSpeed } from "../src/main/services/speech/tts-tiers";
import { openaiTtsUrl } from "../src/main/services/speech/openai-tts-client";
import { openaiTranscribeUrl } from "../src/main/services/speech/cloud-asr-client";
import { pickLocalWhisperEntry, transcribeAudio } from "../src/main/services/speech/asr-service";
import { SPEECH_MODELS_MANIFEST } from "../src/main/services/speech/speech-model-manifest";
import { decodeWavPcm16, encodeWavPcm16 as encodeWavPcm16Ref } from "../shared/speech-wav.ts";
import { speakMessage } from "../src/main/services/speech/tts-service";

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

// ---------------------------------------------------------------------------
console.log("T1 TTS 档位解析:默认 edge / 非法值回退 / 各档音色与 azure 完整性");
{
  const d = resolveTtsTier({});
  assert.equal(d.engine, "edge", "缺省=edge");
  assert.equal(d.voice, DEFAULT_EDGE_VOICE);
  assert.equal(d.speed, 1.0);

  assert.equal(resolveTtsTier({ tts_engine: "bogus" }).engine, "edge", "非法值回退默认");
  assert.equal(resolveTtsTier({ tts_engine: "azure" }).engine, "azure");
  assert.equal(resolveTtsTier({ tts_engine: "local" }).engine, "local");

  const az = resolveTtsTier({ tts_engine: "azure", azure_tts_voice: "zh-CN-YunxiNeural" });
  assert.equal(az.voice, "zh-CN-YunxiNeural", "azure 档用 azure_tts_voice");
  assert.equal(azureTtsMissing(az), "key", "缺 key 结构化暴露");
  assert.equal(azureTtsMissing({ ...az, azureKey: "k" }), "region", "key 齐 → 查 region");
  assert.equal(azureTtsMissing({ ...az, azureKey: "k", azureRegion: "eastus" }), null, "双齐 → null");
  assert.equal(azureTtsMissing(resolveTtsTier({ tts_engine: "azure", azure_tts_api_key: "k" })), "region", "缺 region");
  assert.equal(azureTtsMissing(resolveTtsTier({ tts_engine: "edge" })), null, "非 azure 档恒 null");

  assert.equal(resolveTtsTier({ tts_speed: "1.25" }).speed, 1.25);
  assert.equal(resolveTtsTier({ tts_speed: "9" }).speed, 2.0, "上限 clamp");
  assert.equal(resolveTtsTier({ tts_speed: "0.1" }).speed, 0.5, "下限 clamp");
  assert.equal(resolveTtsTier({ tts_speed: "abc" }).speed, 1.0, "垃圾值回默认");
  assert.equal(clampSpeed(null), 1.0);
  ok("档位解析正确");
}

// ---------------------------------------------------------------------------
console.log("T2 语速换算 + azure SSML 构造 + URL");
{
  assert.equal(speedToRatePercent(1), "+0%");
  assert.equal(speedToRatePercent(1.1), "+10%");
  assert.equal(speedToRatePercent(0.85), "-15%");
  assert.equal(speedToRatePercent(2.0), "+100%");

  const plain = buildAzureSsml("你好。", "zh-CN-XiaoxiaoNeural");
  assert.ok(plain.includes('<voice name="zh-CN-XiaoxiaoNeural">你好。</voice>'));
  assert.ok(!plain.includes("prosody"), "常速不加 prosody");

  const fast = buildAzureSsml("你好。", "zh-CN-XiaoxiaoNeural", "+20%");
  assert.ok(fast.includes('<prosody rate="+20%">你好。</prosody>'));

  const evil = buildAzureSsml('<script>&"', "v");
  assert.ok(!evil.includes("<script>"), "XML 转义生效");
  assert.equal(escapeXml('&<>"\''), "&amp;&lt;&gt;&quot;&apos;");

  assert.equal(azureTtsUrl("eastus"), "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
  ok("SSML/URL 构造正确");
}

// ---------------------------------------------------------------------------
console.log("T3 ASR 档位解析:默认 local / groq 复用 LLM key / locale 推导");
{
  const d = resolveAsrTier({});
  assert.equal(d.engine, "local");
  assert.equal(asrCloudMissing(d), null, "local 档无云凭据要求");

  const g = resolveAsrTier({ asr_engine: "groq" });
  assert.equal(asrCloudMissing(g), "groq-key");
  assert.equal(asrCloudMissing(resolveAsrTier({ asr_engine: "groq", groq_api_key: "gsk_x" })), null, "groq 复用 LLM preset key");

  const a = resolveAsrTier({ asr_engine: "azure" });
  assert.equal(asrCloudMissing(a), "azure-key");
  assert.equal(asrCloudMissing({ ...a, azureKey: "k" }), "azure-region", "key 齐 → 查 region");
  assert.equal(asrCloudMissing({ ...a, azureKey: "k", azureRegion: "eastus" }), null, "双齐 → null");

  assert.equal(localeToWhisperLang("zh-CN"), "zh");
  assert.equal(localeToWhisperLang("en"), "en");
  assert.equal(localeToWhisperLang("ja-JP"), "ja");
  assert.equal(localeToWhisperLang(null), undefined, "空=自动检测");
  assert.equal(localeToWhisperLang("fr"), undefined, "未映射语种=自动检测");
  assert.equal(localeToBcp47("zh-CN"), "zh-CN");
  assert.equal(localeToBcp47("en"), "en-US");
  assert.equal(localeToBcp47(undefined), "zh-CN", "缺省中文");

  assert.equal(groqTranscribeUrl(), "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(
    azureSttUrl("eastus", "zh-CN"),
    "https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=simple",
  );
  ok("ASR 档位解析正确");
}

// ---------------------------------------------------------------------------
console.log("T4 静音检测状态机:说话后静音触发 / 未说话不触发 / 上限兜底 / 可关");
{
  const t = (rmsArr, opts = {}) => {
    const det = createSilenceDetector({ minSpeechMs: 100, silenceMs: 500, ...opts });
    let ts = 0;
    const out = [];
    for (const r of rmsArr) {
      ts += 100;
      out.push(det.feed(r, ts));
    }
    return out;
  };
  // 说话 3 帧后静音:静音从 ts=500 起算,500ms 后(ts=900,第 9 帧)触发
  const a = t([0.001, 0.05, 0.05, 0.05, 0.001, 0.001, 0.001, 0.001, 0.001]);
  assert.equal(a[7], "listening", "静音未满 400ms 不触发");
  assert.equal(a[8], "auto-stop", "静音计满 500ms 触发");
  // 一直安静(没说过话):不触发(等用户开口)
  const b = t(Array.from({ length: 10 }, () => 0.001));
  assert.ok(b.every((v) => v === "listening"), "没说过话不自动停");
  // 一声碰撞(<minSpeech)后静音:不触发
  const c = t([0.001, 0.06, 0.001, 0.001, 0.001, 0.001]);
  assert.ok(c.every((v) => v === "listening"), "单帧碰撞不算说过话");
  // autoStop 关:恒 listening
  const e = t([0.05, 0.05, 0.001, 0.001, 0.001, 0.001], { autoStop: false });
  assert.ok(e.every((v) => v === "listening"), "autoStop=false 全程 listening");
  // maxMs 上限:即使没说话也到点即停(防无限录)
  const det = createSilenceDetector({ maxMs: 300, autoStop: true });
  assert.equal(det.feed(0.001, 0), "listening");
  assert.equal(det.feed(0.001, 350), "auto-stop", "硬上限触发");
  // hadSpeech(v0.14 无入声守卫):说过话 true / 纯静音 false / 单帧碰撞 false;
  // autoStop=false 也要能回答(守卫不依赖自动停设置)
  const h1 = createSilenceDetector({ minSpeechMs: 100 });
  h1.feed(0.05, 0); h1.feed(0.05, 100); h1.feed(0.001, 200);
  assert.equal(h1.hadSpeech(), true, "累计有声 ≥ minSpeech → 说过话");
  const h2 = createSilenceDetector({ minSpeechMs: 100 });
  h2.feed(0.001, 0); h2.feed(0.001, 100); h2.feed(0.001, 200);
  assert.equal(h2.hadSpeech(), false, "纯静音 → 没说过话");
  const h3 = createSilenceDetector({ minSpeechMs: 100 });
  h3.feed(0.06, 0); h3.feed(0.001, 100); h3.feed(0.001, 200);
  assert.equal(h3.hadSpeech(), false, "单帧碰撞不算说过话");
  const h4 = createSilenceDetector({ minSpeechMs: 100, autoStop: false });
  h4.feed(0.05, 0); h4.feed(0.05, 100);
  assert.equal(h4.hadSpeech(), true, "autoStop=false 语音统计照常");
  ok("静音状态机正确");
}

// ---------------------------------------------------------------------------
console.log("T4b 首尾静音裁剪:裁头尾 / 留中段 / 全静音守卫 / 失配防御");
{
  const chunk = (v) => new Float32Array([v, v, v, v]);
  // 头 2 块 + 尾 1 块低于阈值,中段有声:只裁头尾
  const rms = [0.001, 0.002, 0.3, 0.4, 0.5, 0.002];
  const kept = trimSilenceEdges(rms.map(chunk), rms);
  assert.equal(kept.length, 3, "头 2 尾 1 被裁,中段 3 块保留");
  assert.ok(Math.abs(kept[0][0] - 0.3) < 1e-6, "首块是有声块");
  assert.ok(Math.abs(kept[kept.length - 1][0] - 0.5) < 1e-6, "末块是有声块");
  // 全有声:一块不裁
  const allVocal = [0.3, 0.4, 0.5];
  assert.equal(trimSilenceEdges(allVocal.map(chunk), allVocal).length, 3, "全有声不裁");
  // 全静音:守卫至少留 1 块(不返回空音频)
  const allSilent = [0.001, 0.002, 0.001];
  assert.equal(trimSilenceEdges(allSilent.map(chunk), allSilent).length, 1, "全静音留 1 块守卫");
  // 单块:永远保留
  assert.equal(trimSilenceEdges([chunk(0.001)], [0.001]).length, 1, "单块不裁");
  // rms 与块数失配:原样返回(宁多喂不丢音频)
  const mismatch = trimSilenceEdges([chunk(0.3), chunk(0.4)], [0.3]);
  assert.equal(mismatch.length, 2, "失配防御原样返回");
  // 空输入
  assert.equal(trimSilenceEdges([], []).length, 0, "空输入空返回");
  // 自定义阈值
  const rms2 = [0.02, 0.3, 0.02];
  assert.equal(trimSilenceEdges(rms2.map(chunk), rms2, { threshold: 0.05 }).length, 1, "更高阈值收紧裁剪");
  ok("首尾静音裁剪正确");
}

// ---------------------------------------------------------------------------
console.log("T5 WAV 解码:往返一致 / 拒收非 16-bit 单声道");
{
  const samples = new Float32Array([0, 0.25, -0.25, 0.9]);
  const wav = encodeWavPcm16Ref(samples, 16000);
  const back = decodeWavPcm16(wav);
  assert.equal(back.sampleRate, 16000);
  assert.equal(back.samples.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(back.samples[i] - samples[i]) < 0.001, `样本 ${i} 往返误差`);
  }
  // 伪造成立体声(fmt ch=2):拒收
  const v = new DataView(wav);
  v.setUint16(22, 2, true);
  assert.throws(() => decodeWavPcm16(wav), /unsupported wav layout/, "非单声道拒收");
  assert.throws(() => decodeWavPcm16(new ArrayBuffer(10)), /not a RIFF/, "非 RIFF 拒收");
  ok("解码守门正确");
}

// ---------------------------------------------------------------------------
console.log("T6 speakMessage 降级链:edge 失败 → local 接管(stub 注入)");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-speech-tiers-"));
  try {
    const events = [];
    const emit = (ch, p) => events.push({ ch, p });
    const calls = [];
    const wavStub = new ArrayBuffer(44);
    const mkSynth = () => {
      let failed = false;
      return async (_dir, cfg, engine, sentence) => {
        calls.push({ engine, sentence });
        if (engine === "edge" && !failed && sentence.startsWith("第一句")) {
          failed = true;
          throw new Error("ECONNRESET (simulated)");
        }
        return { bytes: wavStub, mime: engine === "edge" ? "audio/mpeg" : "audio/wav", sampleRate: 24000 };
      };
    };
    const r = await speakMessage(
      emit,
      tmp,
      { tts_engine: "edge" },
      "m1",
      "第一句。第二句。第三句。",
      { synth: mkSynth(), localReady: () => true },
    );
    assert.ok(r.ok, "降级后整体成功");
    assert.equal(r.fellBackTo, "local");
    assert.equal(r.engine, "edge", "engine 上报初始档");
    const engines = calls.map((c) => c.engine);
    assert.equal(engines[0], "edge", "首句先试 edge");
    // 预取深度 2:失败暴露前最多还有一个 edge 在飞(结果被丢弃重排)
    assert.ok(engines.indexOf("local") >= 1 && engines.lastIndexOf("edge") <= 1, "至多 2 次 edge 尝试");
    assert.ok(engines.slice(2).every((e) => e === "local"), "降级后全部走 local");
    const audioEvents = events.filter((e) => e.ch === "speech:ttsAudio");
    assert.equal(audioEvents.length, 3, "三句音频全推出");
    assert.equal(audioEvents[0].p.mime, "audio/wav", "首句 edge 失败后重合成 → local wav");
    ok("edge→local 降级链");

    // local 未就绪 → 整体失败(抛错 + ttsError 事件)
    const events2 = [];
    let threw = false;
    try {
      await speakMessage(
        (ch, p) => events2.push({ ch, p }),
        tmp,
        { tts_engine: "edge" },
        "m2",
        "第一句。第二句。",
        { synth: mkSynth(), localReady: () => false },
      );
    } catch {
      threw = true;
    }
    assert.ok(threw, "无兜底时抛错");
    assert.ok(events2.some((e) => e.ch === "speech:ttsError"), "ttsError 事件已发");
    ok("无兜底即报错");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
console.log("T7 v0.15 自定义语音档:tier 解析 / OpenAI 端点 URL / 语速映射 / custom 行缺失");
{
  const tc = resolveTtsTier({ tts_engine: "custom-ab12" });
  assert.equal(tc.engine, "custom");
  assert.equal(tc.customProviderId, "custom-ab12");
  assert.equal(tc.customVoice, null, "未配音色=null");
  const tc2 = resolveTtsTier({ tts_engine: "custom-ab12", tts_custom_voice: " alloy " });
  assert.equal(tc2.customVoice, "alloy", "音色 trim");
  assert.equal(resolveTtsTier({ tts_engine: "azure" }).engine, "azure", "旧库 azure 仍解析");
  assert.equal(resolveTtsTier({ tts_engine: "edge" }).engine, "edge", "缺省 edge");
  assert.equal(resolveTtsTier({ tts_engine: "custom-" }).engine, "custom", "裸 custom- 也按 custom 走(行缺失由 provider-missing 守卫)");

  const ac = resolveAsrTier({ asr_engine: "custom-cd34" });
  assert.equal(ac.engine, "custom");
  assert.equal(ac.customProviderId, "custom-cd34");
  assert.equal(resolveAsrTier({ asr_engine: "groq" }).engine, "groq", "旧库 groq 仍解析");
  assert.equal(resolveAsrTier({ asr_engine: "local" }).engine, "local");

  assert.equal(openaiTtsUrl("https://x.example/v1/"), "https://x.example/v1/audio/speech", "尾斜杠容忍");
  assert.equal(openaiTranscribeUrl("https://x.example/v1"), "https://x.example/v1/audio/transcriptions");
  assert.equal(speedToOpenaiSpeed(0.8), "slow");
  assert.equal(speedToOpenaiSpeed(1.0), "normal");
  assert.equal(speedToOpenaiSpeed(1.5), "fast");

  // custom 行缺失 → 结构化失败(不静默降级)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-speech-custom-"));
  try {
    const rMiss = await speakMessage(
      () => {},
      tmp,
      { tts_engine: "custom-gone" },
      "m1",
      "你好。",
      { custom: null },
    );
    assert.ok(!rMiss.ok && rMiss.reason === "custom-provider-missing", "TTS custom 行缺失给结构化失败");
    const rAsr = await transcribeAudio(tmp, { asr_engine: "custom-gone" }, new ArrayBuffer(44), "zh-CN", null);
    assert.ok(!rAsr.ok && rAsr.reason === "custom-provider-missing", "ASR custom 行缺失给结构化失败");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("custom 档解析与缺失守卫");
}

// ---------------------------------------------------------------------------
console.log("T7b pickLocalWhisperEntry:asr_local_model 优先 / 未就绪回退 turbo / 全无 null");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-pick-"));
  const mkReady = (id) => {
    const entry = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === id);
    const dir = path.join(tmp, "speech-models", id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of entry.variants.int8.files) fs.writeFileSync(path.join(dir, f), "x");
  };
  try {
    assert.equal(pickLocalWhisperEntry(tmp), null, "空目录 → null");
    mkReady("asr-whisper-small");
    assert.equal(pickLocalWhisperEntry(tmp).id, "asr-whisper-small", "只有 small → small");
    assert.equal(
      pickLocalWhisperEntry(tmp, { asr_local_model: "asr-whisper-small" }).id,
      "asr-whisper-small",
      "显式选 small 且就绪 → small",
    );
    mkReady("asr-whisper-turbo");
    assert.equal(pickLocalWhisperEntry(tmp).id, "asr-whisper-turbo", "双就绪无设置 → turbo 优先");
    assert.equal(
      pickLocalWhisperEntry(tmp, { asr_local_model: "asr-whisper-small" }).id,
      "asr-whisper-small",
      "双就绪显式选 small → small",
    );
    // 所选未就绪(只装 turbo,选 small)→ 回退 turbo
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "ls-pick2-"));
    try {
      const dir = path.join(tmp2, "speech-models", "asr-whisper-turbo");
      fs.mkdirSync(dir, { recursive: true });
      for (const f of SPEECH_MODELS_MANIFEST.models
        .find((m) => m.id === "asr-whisper-turbo")
        .variants.int8.files) fs.writeFileSync(path.join(dir, f), "x");
      assert.equal(
        pickLocalWhisperEntry(tmp2, { asr_local_model: "asr-whisper-small" }).id,
        "asr-whisper-turbo",
        "所选未就绪 → 回退 turbo",
      );
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("whisper 模型选择");
}

console.log(`\nverify-speech-tiers: ${passed} 组全绿 ✓`);
