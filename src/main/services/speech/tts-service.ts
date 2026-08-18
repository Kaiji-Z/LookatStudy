/**
 * TTS 朗读编排 —— 文本净化 → 句切分 → 逐句(缓存优先)合成 → WAV 事件推送。
 *
 * 并发语义:同一时刻只有一场朗读;新开朗读先停旧的(旧场收到 stopped 的 done)。
 * 取消语义:ttsStop 置停标志 —— 句间检查标志,合成中的句子靠 onChunk 返回 false
 * 让原生侧提前终止(sherpa generateAsync 的进度回调返 0 = 停)。
 *
 * 模型门控:未就绪不合成,返回结构化 reason 让渲染层引导去设置页下载。
 */

import type {
  SpeechDownloadProgress,
  SpeechTtsAudioEvent,
  SpeechTtsDoneEvent,
  SpeechTtsErrorEvent,
} from "@shared/speech-types";
import { splitSentences, normalizeSpeechText } from "@shared/speech-text";

import { SPEECH_MODELS_MANIFEST } from "./speech-model-manifest";
import { ensureSpeechModel, readSpeechModelStatus } from "./speech-model-service";
import { DEFAULT_TTS_SID, DEFAULT_TTS_SPEED, getTtsEngine, isSpeechEngineLoadable, synthesize } from "./speech-engine";
import { readCachedWav, ttsCacheKey, writeCachedWav } from "./tts-cache";
import { encodeWavPcm16 } from "./wav-codec";

export type SpeechEmitter = (channel: string, payload: unknown) => void;

export type SpeakFailReason = "engine-unavailable" | "model-missing" | "empty-text";
export type SpeakResult = { ok: true; sentences: number } | { ok: false; reason: SpeakFailReason };

const TTS_ENTRY = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "tts-kokoro")!;

interface ActiveSpeech {
  messageId: string;
  stopped: boolean;
}

let active: ActiveSpeech | null = null;

/**
 * 朗读一段消息文本。messageId 随事件回传(渲染层靠它标记"正在朗读的气泡")。
 * 模型未下载 → {ok:false, reason:"model-missing"}(渲染层引导下载,不在这里拉起下载)。
 */
export async function speakMessage(
  emit: SpeechEmitter,
  dataDir: string,
  messageId: string,
  rawText: string,
): Promise<SpeakResult> {
  // 平台闸门(如 Termux/bionic 无预编译原生包):先于模型状态,避免误导下载
  if (!isSpeechEngineLoadable()) return { ok: false, reason: "engine-unavailable" };
  if (readSpeechModelStatus(dataDir, TTS_ENTRY).state !== "ready") {
    return { ok: false, reason: "model-missing" };
  }
  const { sentences } = splitSentences(normalizeSpeechText(rawText), { flush: true });
  if (sentences.length === 0) return { ok: false, reason: "empty-text" };

  // 新场开跑 = 旧场停(旧场循环看到 messageId 变更自行退场并发 stopped done)
  if (active) active.stopped = true;
  const mine: ActiveSpeech = { messageId, stopped: false };
  active = mine;

  try {
    const tts = await getTtsEngine(dataDir);
    for (let i = 0; i < sentences.length; i++) {
      if (mine.stopped || active !== mine) break;
      const sentence = sentences[i]!;
      const key = ttsCacheKey(sentence, DEFAULT_TTS_SID, DEFAULT_TTS_SPEED);
      let wav = readCachedWav(dataDir, key);
      if (!wav) {
        const audio = await synthesize(tts, sentence, {
          sid: DEFAULT_TTS_SID,
          speed: DEFAULT_TTS_SPEED,
          onChunk: () => !mine.stopped && active === mine,
        });
        if (mine.stopped || active !== mine) break;
        wav = encodeWavPcm16(audio.samples, audio.sampleRate);
        await writeCachedWav(dataDir, key, wav);
      }
      const payload: SpeechTtsAudioEvent = {
        messageId,
        sentenceIndex: i,
        sentenceTotal: sentences.length,
        wavBytes: wav,
        sampleRate: tts.sampleRate,
      };
      emit("speech:ttsAudio", payload);
    }
    const stopped = mine.stopped || active !== mine;
    if (active === mine) active = null;
    const done: SpeechTtsDoneEvent = { messageId, sentenceTotal: sentences.length, stopped };
    emit("speech:ttsDone", done);
    return { ok: true, sentences: sentences.length };
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
