/**
 * 语音引擎抽象 —— sherpa-onnx 原生引擎的懒加载持有者 + 纯配置构建器。
 *
 * 架构(M0 定案):两台引擎直接在 Electron 主进程内运行,不引入子进程。
 *  - TTS kokoro:OfflineTts.createAsync 非阻塞初始化;合成走 generateAsync,
 *    增量块经 onProgress 流出 —— 全部传 enableExternalBuffer:false(Electron 红线,
 *    见 sherpa-onnx-node.d.ts 头注)。
 *  - ASR whisper(v0.13,质量优先取代 zipformer 流式):OfflineRecognizer 整段
 *    recognize —— decodeAsync 非阻塞,结果 JSON 回流(不涉外部 buffer,天然免 ABI 坑)。
 *
 * 原生模块按 pdf-text.ts 同款模式函数内懒 require:tsx verify 只 import 纯构建器,
 * 不加载 .node 二进制;生产 Electron(CJS)在首次调用时才加载。
 */

import path from "node:path";

import type {
  OfflineTts,
  OfflineRecognizer,
  OfflineRecognizerConfig,
  OfflineTtsConfig,
} from "sherpa-onnx-node";
import type { SpeechModelEntry } from "@shared/speech-types";

import { pickVariant } from "../pure/speech-plan";
import { nativeRequire } from "./native-require";
import { listModelFiles, speechModelDir } from "./speech-model-service";

/** kokoro 双语女声(zh/en 实听可用;声音选择器留给后续版本) */
export const DEFAULT_TTS_SID = 48;
export const DEFAULT_TTS_SPEED = 1.0;

// ---------------------------------------------------------------------------
// 纯配置构建器(verify 直测)
// ---------------------------------------------------------------------------

export function buildTtsConfig(modelDir: string): OfflineTtsConfig {
  const p = (f: string) => path.join(modelDir, f);
  return {
    model: {
      kokoro: {
        model: p("model.onnx"),
        voices: p("voices.bin"),
        tokens: p("tokens.txt"),
        dataDir: p("espeak-ng-data"),
        // 双词表拼接是 sherpa kokoro 多语布局的硬要求(实测)
        lexicon: `${p("lexicon-us-en.txt")},${p("lexicon-zh.txt")}`,
        dictDir: p("dict"),
      },
      ruleFsts: [p("date-zh.fst"), p("number-zh.fst"), p("phone-zh.fst")].join(","),
      debug: false,
      numThreads: 4,
      provider: "cpu",
    },
    // 每句单独合成,首包延迟优先于吞吐
    maxNumSentences: 1,
  };
}

export type WhisperVariant = "int8" | "fp32";

/** whisper 模型文件名前缀(镜像布局:{prefix}-encoder.int8.onnx 等) */
export function whisperPrefix(entryId: string): "turbo" | "small" {
  return entryId === "asr-whisper-small" ? "small" : "turbo";
}

export function buildWhisperConfig(
  modelDir: string,
  prefix: string,
  variant: WhisperVariant,
  language?: string,
): OfflineRecognizerConfig {
  const p = (f: string) => path.join(modelDir, f);
  const suffix = variant === "int8" ? ".int8" : "";
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: p(`${prefix}-encoder${suffix}.onnx`),
        decoder: p(`${prefix}-decoder${suffix}.onnx`),
        ...(language ? { language } : {}),
        task: "transcribe",
      },
      tokens: p(`${prefix}-tokens.txt`),
      numThreads: 4,
      provider: "cpu",
      debug: false,
    },
  };
}

/** 从磁盘现状解析 Whisper 变体(int8 偏好;不就绪返回 null) */
export function resolveWhisperVariant(
  dataDir: string,
  entry: SpeechModelEntry,
): WhisperVariant | null {
  const variant = pickVariant(entry, new Set(listModelFiles(speechModelDir(dataDir, entry.id)).keys()));
  if (!variant) return null;
  return variant === "fp32" ? "fp32" : "int8";
}

// ---------------------------------------------------------------------------
// 引擎持有者(懒加载;Electron 主进程单例)
// ---------------------------------------------------------------------------

interface TtsHolder {
  dir: string;
  tts: OfflineTts;
}

interface WhisperHolder {
  key: string;
  recognizer: OfflineRecognizer;
}

let ttsHolder: TtsHolder | null = null;
let whisperHolder: WhisperHolder | null = null;

type SherpaModule = typeof import("sherpa-onnx-node");

let sherpaCache: SherpaModule | null = null;

/**
 * 平台能否加载原生引擎(Termux/bionic 等无预编译平台会 false)。
 * 结果缓存;false 时上层不应引导下载模型(下了也跑不动)。
 */
export function isSpeechEngineLoadable(): boolean {
  try {
    loadSherpa();
    return true;
  } catch {
    return false;
  }
}

function loadSherpa(): SherpaModule {
  if (sherpaCache) return sherpaCache;
  // 懒加载(pdf-text.ts 同款):verify 的 tsx 环境不会走到这里;live-test 走 nativeRequire 的 ESM 分支
  const mod = nativeRequire<SherpaModule>("sherpa-onnx-node");
  sherpaCache = mod;
  return mod;
}

/** 取 TTS 引擎;模型未就绪抛错(调用方先查状态) */
export async function getTtsEngine(dataDir: string): Promise<OfflineTts> {
  const dir = speechModelDir(dataDir, "tts-kokoro");
  if (ttsHolder?.dir === dir) return ttsHolder.tts;
  if (ttsHolder) ttsHolder.tts.release?.();
  const sherpa = loadSherpa();
  ttsHolder = { dir, tts: await sherpa.OfflineTts.createAsync(buildTtsConfig(dir)) };
  return ttsHolder.tts;
}

/** 取 Whisper 识别器(按 模型目录+语言 缓存);模型未就绪抛错(调用方先查状态) */
export async function getWhisperRecognizer(
  dataDir: string,
  entry: SpeechModelEntry,
  language?: string,
): Promise<OfflineRecognizer> {
  const dir = speechModelDir(dataDir, entry.id);
  const key = `${dir}|${language ?? ""}`;
  if (whisperHolder?.key === key) return whisperHolder.recognizer;
  if (whisperHolder) whisperHolder.recognizer.release?.();
  const variant = resolveWhisperVariant(dataDir, entry);
  if (!variant) throw new Error("asr model not ready");
  const sherpa = loadSherpa();
  const recognizer = await sherpa.OfflineRecognizer.createAsync(
    buildWhisperConfig(dir, whisperPrefix(entry.id), variant, language),
  );
  whisperHolder = { key, recognizer };
  return recognizer;
}

/** 模型目录变化(重下/删除)后失效缓存;app 退出时释放 */
export function invalidateSpeechEngines(): void {
  ttsHolder?.tts.release?.();
  ttsHolder = null;
  whisperHolder?.recognizer.release?.();
  whisperHolder = null;
}

// ---------------------------------------------------------------------------
// 合成入口 —— Electron 红线(enableExternalBuffer:false)唯一收口点
// ---------------------------------------------------------------------------

export interface TtsChunk {
  samples: Float32Array;
  sampleRate: number;
}

export interface SynthesizeOptions {
  sid?: number;
  speed?: number;
  /** 流式增量块(首包延迟优先);返回 false 可提前停止 */
  onChunk?: (c: TtsChunk) => boolean | void;
}

/**
 * 合成一段文本(调用方负责句级切分,见 shared/speech-text splitSentences)。
 * 返回完整音频;onChunk 在生成过程中增量推送(块拼接 = 最终结果)。
 */
export async function synthesize(
  tts: OfflineTts,
  text: string,
  opts: SynthesizeOptions = {},
): Promise<TtsChunk> {
  const sherpa = loadSherpa();
  const gc = new sherpa.GenerationConfig({
    sid: opts.sid ?? DEFAULT_TTS_SID,
    speed: opts.speed ?? DEFAULT_TTS_SPEED,
  });
  const audio = await tts.generateAsync({
    text,
    generationConfig: gc,
    enableExternalBuffer: false,
    onProgress: (info) => {
      const keep = opts.onChunk?.({ samples: info.samples, sampleRate: tts.sampleRate });
      return keep === false ? 0 : 1;
    },
  });
  return { samples: audio.samples, sampleRate: audio.sampleRate };
}
