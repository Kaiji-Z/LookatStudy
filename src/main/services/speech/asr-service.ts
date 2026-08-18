/**
 * ASR 流式识别会话 —— 单活动会话模型(renderer 麦克风 ↔ main 识别器)。
 *
 * 生命周期:asrStart(建流) → asrFeed×N(16kHz PCM 块,增量 decode) → asrStop(收尾取全文)。
 * 端点检测(isEndpoint)命中即把已确认文本累进 committed,并 reset 流 —— 避免
 * 转导解码器上下文无限增长(端点后历史对后续识别已无贡献)。
 * partial = committed + 当前流文本,每次 feed 后推事件。
 */

import type { OnlineRecognizer, OnlineStream } from "sherpa-onnx-node";

import { SPEECH_MODELS_MANIFEST } from "./speech-model-manifest";
import { getAsrEngine, isSpeechEngineLoadable } from "./speech-engine";
import { readSpeechModelStatus } from "./speech-model-service";

const ASR_ENTRY = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-zipformer")!;

interface AsrSession {
  recognizer: OnlineRecognizer;
  stream: OnlineStream;
  committed: string;
}

let session: AsrSession | null = null;

export type AsrStartResult = { ok: true } | { ok: false; reason: "model-missing" | string };

export function startAsrSession(dataDir: string): AsrStartResult {
  if (!isSpeechEngineLoadable()) return { ok: false, reason: "engine-unavailable" };
  if (readSpeechModelStatus(dataDir, ASR_ENTRY).state !== "ready") {
    return { ok: false, reason: "model-missing" };
  }
  try {
    if (session) abandonAsrSession();
    const recognizer = getAsrEngine(dataDir, ASR_ENTRY);
    session = { recognizer, stream: recognizer.createStream(), committed: "" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 喂 16kHz 单声道 PCM 块;返回当前 partial 文本(committed + 在流文本) */
export function feedAsrSamples(samples: Float32Array): string {
  if (!session || samples.length === 0) return partialAsrText();
  const { recognizer, stream } = session;
  stream.acceptWaveform({ sampleRate: 16000, samples });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  if (recognizer.isEndpoint(stream)) {
    session.committed += recognizer.getResult(stream).text;
    recognizer.reset(stream);
  }
  return partialAsrText();
}

export function partialAsrText(): string {
  if (!session) return "";
  return (session.committed + session.recognizer.getResult(session.stream).text).trim();
}

/** 收尾:flush 尾部音频 → 全文;会话结束 */
export function stopAsrSession(): string {
  if (!session) return "";
  const { recognizer, stream, committed } = session;
  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const final = (committed + recognizer.getResult(stream).text).trim();
  session = null;
  return final;
}

/** 丢弃会话(取消:不要结果) */
export function abandonAsrSession(): void {
  session = null;
}
