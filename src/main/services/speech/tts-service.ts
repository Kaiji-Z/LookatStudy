/**
 * TTS 朗读编排(v0.13 三档)—— 文本净化 → 句切分 → 逐句(缓存优先)合成 → 音频事件推送。
 *
 * 档位:edge(默认,在线)/ azure(BYO key,在线)/ local(kokoro 离线)。
 * edge 句级预取(播第 i 句时已在合成第 i+1 句,抵消每句 RTT);
 * edge 合成失败且 local 模型就绪 → 剩余句子自动落 local(fellBackTo 标记),
 * local 未就绪 → 结构化失败(edge-failed)。azure 是用户的显式选择,失败即报错不静默降级。
 *
 * 并发语义:同一时刻只有一场朗读;新开朗读先停旧的。取消语义:ttsStop 置停标志,
 * 句间检查;local 档合成中的句子靠 onChunk 返回 false 让原生侧提前终止
 * (edge/azure 的在飞请求无法取消,完成后丢弃)。
 *
 * 服务保持 db-free:settings 由 IPC 层注入(纯 map,verify 可直测)。
 */

import type {
  SpeechDownloadProgress,
  SpeechTtsAudioEvent,
  SpeechVisemeCue,
  SpeechTtsDoneEvent,
  SpeechTtsErrorEvent,
} from "@shared/speech-types";
import { speechSentencesOf } from "@shared/speech-text";
import { speakMathInSentence } from "@shared/math-speech";

import { SPEECH_MODELS_MANIFEST } from "./speech-model-manifest";
import { ensureSpeechModel, readSpeechModelStatus } from "./speech-model-service";
import {
  DEFAULT_TTS_SID,
  getTtsEngine,
  isSpeechEngineLoadable,
  synthesize,
} from "./speech-engine";
import {
  bufferToArrayBuffer,
  readCachedAudio,
  readCachedVisemeCues,
  ttsCacheKey,
  writeCachedAudio,
  writeCachedVisemeCues,
  type TtsAudioMime,
} from "./tts-cache";
import { buildVisemeCues } from "./viseme-script";
import { encodeWavPcm16 } from "./wav-codec";
import {
  azureTtsMissing,
  resolveTtsTier,
  speedToOpenaiSpeed,
  speedToRatePercent,
  type TtsEngineTier,
  type TtsTierConfig,
} from "./tts-tiers";
import { synthesizeEdgeMp3 } from "./edge-tts-client";
import { synthesizeAzureWav } from "./azure-tts-client";
import { synthesizeOpenaiTts } from "./openai-tts-client";

export type SpeechEmitter = (channel: string, payload: unknown) => void;

/** custom 朗读档的已解析配置(IPC 层查 custom_providers 行后注入;verify 也可注入) */
export interface CustomTtsConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  voice: string | null;
}

export type SpeakFailReason =
  | "engine-unavailable"
  | "model-missing"
  | "empty-text"
  | "azure-key-missing"
  | "azure-region-missing"
  | "edge-failed"
  | "custom-provider-missing";

export type SpeakResult =
  | { ok: true; sentences: number; engine: TtsEngineTier; fellBackTo?: "local" }
  | { ok: false; reason: SpeakFailReason };

const TTS_ENTRY = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "tts-kokoro")!;

interface ActiveSpeech {
  messageId: string;
  stopped: boolean;
}

let active: ActiveSpeech | null = null;

interface SynthOut {
  bytes: ArrayBuffer;
  mime: TtsAudioMime;
  sampleRate: number;
  /** v9 剧本口型 cue(edge 档词时序+拼音;其余档 undefined → 渲染层 DSP 兜底) */
  visemeCues?: SpeechVisemeCue[];
}

function localModelReady(dataDir: string): boolean {
  return isSpeechEngineLoadable() && readSpeechModelStatus(dataDir, TTS_ENTRY).state === "ready";
}

/** 单句合成(缓存优先)。engine 参数允许运行中降级(edge → local)。 */
async function synthSentence(
  dataDir: string,
  cfg: TtsTierConfig,
  engine: TtsEngineTier,
  sentence: string,
  opts: { sid: number; onChunk?: () => boolean; custom?: CustomTtsConfig },
): Promise<SynthOut> {
  const isMp3 = engine === "edge" || engine === "custom";
  const key = ttsCacheKey({
    engine: engine === "custom" ? (cfg.customProviderId ?? "custom") : engine,
    // custom 缓存键把模型并进 voice 段(同 provider 换模型/音色不串味)
    voice:
      engine === "local"
        ? `sid-${opts.sid}`
        : engine === "custom"
          ? `${opts.custom?.model ?? "?"}|${opts.custom?.voice ?? ""}`
          : cfg.voice,
    speed: cfg.speed,
    sentence,
  });
  const mime: TtsAudioMime = isMp3 ? "audio/mpeg" : "audio/wav";
  const cached = readCachedAudio(dataDir, key, mime);
  if (cached) {
    const cues = readCachedVisemeCues(dataDir, key);
    return { bytes: cached, mime, sampleRate: 24000, ...(cues ? { visemeCues: cues } : {}) };
  }

  if (engine === "edge") {
    const { mp3, wordCues } = await synthesizeEdgeMp3(sentence, {
      voice: cfg.voice,
      rate: speedToRatePercent(cfg.speed),
    });
    const bytes = bufferToArrayBuffer(mp3);
    await writeCachedAudio(dataDir, key, mime, bytes);
    // v9 剧本口型:词时序(引擎真值)+ 拼音声母 → 逐 viseme cue,随缓存落盘
    const visemeCues = buildVisemeCues(wordCues);
    if (visemeCues.length > 0) await writeCachedVisemeCues(dataDir, key, visemeCues);
    return { bytes, mime, sampleRate: 24000, ...(visemeCues.length > 0 ? { visemeCues } : {}) };
  }
  if (engine === "custom") {
    if (!opts.custom) throw new Error("custom tts provider not resolved");
    const mp3 = await synthesizeOpenaiTts({
      baseUrl: opts.custom.baseUrl,
      apiKey: opts.custom.apiKey,
      model: opts.custom.model,
      voice: opts.custom.voice ?? cfg.customVoice,
      text: sentence,
      speed: speedToOpenaiSpeed(cfg.speed),
    });
    const bytes = bufferToArrayBuffer(mp3);
    await writeCachedAudio(dataDir, key, mime, bytes);
    return { bytes, mime, sampleRate: 24000 };
  }
  if (engine === "azure") {
    const wav = await synthesizeAzureWav(sentence, {
      key: cfg.azureKey ?? "",
      region: cfg.azureRegion ?? "",
      voice: cfg.voice,
      rate: speedToRatePercent(cfg.speed),
    });
    const bytes = bufferToArrayBuffer(wav);
    await writeCachedAudio(dataDir, key, mime, bytes);
    return { bytes, mime, sampleRate: 24000 };
  }
  const tts = await getTtsEngine(dataDir);
  const audio = await synthesize(tts, sentence, { sid: opts.sid, speed: cfg.speed, onChunk: opts.onChunk });
  const bytes = encodeWavPcm16(audio.samples, audio.sampleRate);
  await writeCachedAudio(dataDir, key, mime, bytes);
  return { bytes, mime, sampleRate: audio.sampleRate };
}

/**
 * 朗读一段消息文本。messageId 随事件回传(渲染层靠它标记"正在朗读的气泡")。
 * local 档模型未下载 → {ok:false, reason:"model-missing"}(渲染层引导下载,不在这里拉起下载)。
 * deps 仅测试注入(降级链/合成 stub);生产缺省走真实实现。
 */
export async function speakMessage(
  emit: SpeechEmitter,
  dataDir: string,
  settings: Record<string, string | null>,
  messageId: string,
  rawText: string,
  deps: {
    synth?: typeof synthSentence;
    localReady?: typeof localModelReady;
    /** custom 档的 provider 配置(IPC 层解析注入);engine=custom 且为 null = 行已删 */
    custom?: CustomTtsConfig | null;
  } = {},
): Promise<SpeakResult> {
  const cfg = resolveTtsTier(settings);
  const sid = parseSid(settings.tts_sid_local);
  const synth = deps.synth ?? synthSentence;
  const isLocalReady = deps.localReady ?? localModelReady;

  if (cfg.engine === "system") {
    // system 档=渲染层 speechSynthesis 自实现管线,正常路径根本不进本 IPC;
    // 这里的拒绝是防御(老缓存渲染层/异常调用),渲染层把 engine-unavailable
    // 映射为既有引导文案,不会静默无声。
    return { ok: false, reason: "engine-unavailable" };
  }
  if (cfg.engine === "local") {
    if (!isSpeechEngineLoadable()) return { ok: false, reason: "engine-unavailable" };
    if (readSpeechModelStatus(dataDir, TTS_ENTRY).state !== "ready") {
      return { ok: false, reason: "model-missing" };
    }
  } else if (cfg.engine === "azure") {
    const missing = azureTtsMissing(cfg);
    if (missing === "key") return { ok: false, reason: "azure-key-missing" };
    if (missing === "region") return { ok: false, reason: "azure-region-missing" };
  } else if (cfg.engine === "custom") {
    // 显式选择的自定义端点,失败不静默降级;行缺失给结构化引导
    if (!deps.custom) return { ok: false, reason: "custom-provider-missing" };
  }

  const sentences = speechSentencesOf(rawText);
  if (sentences.length === 0) return { ok: false, reason: "empty-text" };

  // 新场开跑 = 旧场停(旧场循环看到 messageId 变更自行退场并发 stopped done)
  if (active) active.stopped = true;
  const mine: ActiveSpeech = { messageId, stopped: false };
  active = mine;

  let engine: TtsEngineTier = cfg.engine;
  let fellBackTo: "local" | undefined;

  // 句级预取(深度 2):合成是缓存优先的 Promise,不预热的句子是 sync 命中
  const inflight = new Map<number, Promise<SynthOut>>();
  const ensure = (i: number): Promise<SynthOut> => {
    const running = inflight.get(i);
    if (running) return running;
    const sentence = sentences[i]!;
    // v0.19 公式口语化:只转换**喂给引擎**的文本;句事件(sentence)仍发原文,
    // karaoke 高亮/匹配层继续对齐 DOM 里的 TeX 源——念人话,亮原文。
    const p = synth(dataDir, cfg, engine, speakMathInSentence(sentence), {
      sid,
      onChunk: () => !mine.stopped && active === mine,
      custom: deps.custom ?? undefined,
    }).finally(() => inflight.delete(i));
    inflight.set(i, p);
    return p;
  };

  try {
    for (let i = 0; i < sentences.length; i++) {
      if (mine.stopped || active !== mine) break;
      let out: SynthOut;
      try {
        if (i + 1 < sentences.length) void ensure(i + 1).catch(() => {}); // 预热下一句(错误在 await 时统一处理)
        out = await ensure(i);
      } catch (e) {
        if (engine === "edge" && isLocalReady(dataDir)) {
          // edge 通道抖动 → 剩余句子(含当前句)落 local
          engine = "local";
          fellBackTo = "local";
          inflight.clear();
          out = await ensure(i);
        } else {
          throw e;
        }
      }
      if (mine.stopped || active !== mine) break;
      const payload: SpeechTtsAudioEvent = {
        messageId,
        sentenceIndex: i,
        sentenceTotal: sentences.length,
        // v11.4 该块原文随音频下发:渲染层 karaoke 直接高亮这段文字,不再复算句表
        sentence: sentences[i]!,
        wavBytes: out.bytes,
        sampleRate: out.sampleRate,
        mime: out.mime,
        ...(out.visemeCues ? { visemeCues: out.visemeCues } : {}),
      };
      emit("speech:ttsAudio", payload);
    }
    const stopped = mine.stopped || active !== mine;
    if (active === mine) active = null;
    const done: SpeechTtsDoneEvent = { messageId, sentenceTotal: sentences.length, stopped };
    emit("speech:ttsDone", done);
    return { ok: true, sentences: sentences.length, engine: cfg.engine, ...(fellBackTo ? { fellBackTo } : {}) };
  } catch (e) {
    if (active === mine) active = null;
    const errPayload: SpeechTtsErrorEvent = {
      messageId,
      message: e instanceof Error ? e.message : String(e),
    };
    emit("speech:ttsError", errPayload);
    throw e;
  }
}

function parseSid(raw: string | null | undefined): number {
  const v = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(v) && v >= 0 && v <= 200 ? v : DEFAULT_TTS_SID;
}

/** 停当前朗读(幂等;done 事件由朗读循环收尾时发) */
export function stopSpeaking(): void {
  if (active) active.stopped = true;
}

// ---------------------------------------------------------------------------
// 模型下载编排(设置页用)
// ---------------------------------------------------------------------------

const activeEnsures = new Map<string, Promise<void>>();

/**
 * 确保模型就绪(并发调用共享同一 Promise;进度经 speech:modelProgress 事件流出)。
 * 全源失败抛错(渲染层 toast);成功返回最新状态。
 */
export async function ensureSpeechModelEmitting(
  emit: SpeechEmitter,
  dataDir: string,
  modelId: string,
): Promise<void> {
  const entry = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === modelId);
  if (!entry) throw new Error(`未知语音模型: ${modelId}`);
  if (!isSpeechEngineLoadable()) throw new Error("engine-unavailable");
  const running = activeEnsures.get(modelId);
  if (running) return running;
  const p = (async () => {
    const onProgress = (e: SpeechDownloadProgress) => emit("speech:modelProgress", e);
    await ensureSpeechModel(dataDir, entry, { onProgress });
  })().finally(() => {
    activeEnsures.delete(modelId);
  });
  activeEnsures.set(modelId, p);
  return p;
}

export function speechModelsStatusSnapshot(dataDir: string) {
  return SPEECH_MODELS_MANIFEST.models.map((m) => readSpeechModelStatus(dataDir, m));
}
