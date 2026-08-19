/**
 * 听写转录编排(v0.13 质量优先版)—— 渲染层录完整段 WAV,一次调用换全文。
 *
 * 路由:asr_engine 设置 → local(Whisper 离线,自带标点;turbo 优先,small 兜底)
 * / groq(whisper-large-v3-turbo,复用 LLM preset key)/ azure STT(BYO key)。
 * 流式会话(asrStart/asrFeed/asrStop)随 zipformer 一起退役:partial 换质量,用户拍板。
 *
 * 服务 db-free:settings 由 IPC 层注入。本地档串行化(turbo 解码吃满 CPU,
 * 并发两段只会互相拖慢);云端档天然并发安全。
 */

import type { SpeechModelEntry } from "@shared/speech-types";
import { decodeWavPcm16, resampleLinear } from "@shared/speech-wav";

import { SPEECH_MODELS_MANIFEST } from "./speech-model-manifest";
import { getWhisperRecognizer, isSpeechEngineLoadable } from "./speech-engine";
import { readSpeechModelStatus } from "./speech-model-service";
import { asrCloudMissing, localeToBcp47, localeToWhisperLang, resolveAsrTier } from "./asr-tiers";
import { azureSttTranscribe, groqTranscribe } from "./cloud-asr-client";

export type TranscribeFailReason =
  | "engine-unavailable"
  | "model-missing"
  | "groq-key-missing"
  | "azure-key-missing"
  | "azure-region-missing"
  | "bad-audio"
  | "asr-failed";

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: TranscribeFailReason; detail?: string };

/** 本地档用哪个 whisper 模型(turbo 就绪优先,其次 small;都不就绪 null) */
export function pickLocalWhisperEntry(dataDir: string): SpeechModelEntry | null {
  for (const id of ["asr-whisper-turbo", "asr-whisper-small"] as const) {
    const entry = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === id);
    if (entry && readSpeechModelStatus(dataDir, entry).state === "ready") return entry;
  }
  return null;
}

let localQueue: Promise<unknown> = Promise.resolve();

/** 串行化本地解码(CPU 密集,并发互拖) */
function runLocal<T>(fn: () => Promise<T>): Promise<T> {
  const next = localQueue.then(fn, fn);
  localQueue = next.catch(() => {});
  return next;
}

// whisper 的 zh 输出常为繁体(模型级行为);简体用户看着像 bug ——
// locale 以 zh 开头时用 opencc 归一成简体。懒建一次,失败静默回原文。
let toSimplified: ((s: string) => string) | null = null;
function normalizeChineseScript(text: string, locale?: string): string {
  if (!text || !locale || !locale.toLowerCase().startsWith("zh")) return text;
  try {
    if (toSimplified == null) {
      const OpenCC = require("opencc-js") as {
        Converter: (o: { from: string; to: string }) => (s: string) => string;
      };
      toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
    }
    return toSimplified(text);
  } catch {
    return text;
  }
}

export async function transcribeAudio(
  dataDir: string,
  settings: Record<string, string | null>,
  wavBytes: ArrayBuffer,
  locale?: string,
): Promise<TranscribeResult> {
  const cfg = resolveAsrTier(settings);

  if (cfg.engine === "groq" || cfg.engine === "azure") {
    const missing = asrCloudMissing(cfg);
    if (missing === "groq-key") return { ok: false, reason: "groq-key-missing" };
    if (missing === "azure-key") return { ok: false, reason: "azure-key-missing" };
    if (missing === "azure-region") return { ok: false, reason: "azure-region-missing" };
    try {
      const lang = localeToBcp47(locale);
      const text =
        cfg.engine === "groq"
          ? await groqTranscribe(cfg.groqKey!, wavBytes, lang)
          : await azureSttTranscribe(cfg.azureKey!, cfg.azureRegion!, wavBytes, lang);
      return { ok: true, text: normalizeChineseScript(text, locale) };
    } catch (e) {
      return { ok: false, reason: "asr-failed", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // local 档
  if (!isSpeechEngineLoadable()) return { ok: false, reason: "engine-unavailable" };
  const entry = pickLocalWhisperEntry(dataDir);
  if (!entry) return { ok: false, reason: "model-missing" };
  return runLocal(async () => {
    let samples: Float32Array;
    let sampleRate: number;
    try {
      const decoded = decodeWavPcm16(new Uint8Array(wavBytes));
      samples = decoded.samples;
      sampleRate = decoded.sampleRate;
    } catch (e) {
      return { ok: false as const, reason: "bad-audio" as const, detail: e instanceof Error ? e.message : String(e) };
    }
    if (samples.length === 0) return { ok: false as const, reason: "bad-audio" as const, detail: "empty samples" };
    if (sampleRate !== 16000) {
      samples = resampleLinear(samples, sampleRate / 16000);
    }
    try {
      const recognizer = await getWhisperRecognizer(dataDir, entry, localeToWhisperLang(locale));
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples });
      const result = await recognizer.decodeAsync(stream);
      return { ok: true as const, text: normalizeChineseScript((result.text ?? "").trim(), locale) };
    } catch (e) {
      return { ok: false as const, reason: "asr-failed" as const, detail: e instanceof Error ? e.message : String(e) };
    }
  });
}
