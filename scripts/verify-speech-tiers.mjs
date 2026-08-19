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
  const b = t(new Array(10).fill(0.001));
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
  ok("静音状态机正确");
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

console.log(`\nverify-speech-tiers: ${passed} 组全绿 ✓`);
