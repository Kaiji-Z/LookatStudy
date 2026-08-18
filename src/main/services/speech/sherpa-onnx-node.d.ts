/**
 * sherpa-onnx-node 的最小类型 shim —— npm 包不带 .d.ts(types.js 只有运行时 JSDoc)。
 * 只声明 LookatStudy 用到的面;签名以 1.13.6 实测为准(M0 spike,
 * 见 dev-docs/DESIGN-PLAN-voice-v1.md"Electron ABI 破局")。
 *
 * Electron 红线:所有 原生→JS 的 Float32Array 传输必须带 enableExternalBuffer: false,
 * 否则 Electron 21+ 全进程形态抛 "External buffers are not allowed"。
 */

declare module "sherpa-onnx-node" {
  export interface KokoroModelConfig {
    model: string;
    voices: string;
    tokens: string;
    dataDir: string;
    lexicon: string;
    dictDir: string;
  }

  export interface OfflineTtsConfig {
    model: {
      kokoro: KokoroModelConfig;
      ruleFsts?: string;
      debug?: boolean;
      numThreads?: number;
      provider?: "cpu";
    };
    maxNumSentences?: number;
  }

  export class GenerationConfig {
    constructor(opts?: { sid?: number; speed?: number; silenceScale?: number });
  }

  export interface TtsGenerateOptions {
    text: string;
    generationConfig?: GenerationConfig;
    /** Electron 必须 false(见文件头) */
    enableExternalBuffer?: boolean;
    onProgress?: (info: { samples: Float32Array; progress: number }) => number | boolean | void;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export class OfflineTts {
    constructor(config: OfflineTtsConfig);
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generate(opts: TtsGenerateOptions): GeneratedAudio;
    generateAsync(opts: TtsGenerateOptions): Promise<GeneratedAudio>;
    release?(): void;
  }

  export interface OnlineRecognizerConfig {
    featConfig: {
      sampleRate: number;
      featureDim: number;
      rule1MinTrailingSilence?: number;
      rule2MinTrailingSilence?: number;
      rule3MinUtteranceLength?: number;
    };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads?: number;
      provider?: "cpu";
      debug?: boolean;
    };
    /** 内置 VAD 分段端点检测(默认 true) */
    endpointConfig?: { rule1?: number; rule2?: number; rule3?: number };
  }

  export interface OnlineRecognizerResult {
    text: string;
  }

  export class OnlineStream {
    acceptWaveform(opts: { sampleRate: number; samples: Float32Array }): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
    release?(): void;
  }
}
