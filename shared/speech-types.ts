/**
 * 语音能力(本地 TTS/ASR)的类型契约 —— shared 层,主进程与渲染层共用。
 *
 * 模型不随应用分发,用户首次启用语音时从镜像源下载到
 * `userData/speech-models/{modelId}/`(local-first:无云端、离线推理)。
 */

export type SpeechModelId = "tts-kokoro" | "asr-whisper-turbo" | "asr-whisper-small";

export type SpeechEngineKind = "kokoro" | "whisper";

/** 模型下载源之一:ModelScope 逐文件镜像(免解压,CN 友好) */
export interface SpeechSourceModelscope {
  kind: "modelscope-files";
  repo: string;
  revision: string;
  /** 只下载这些文件(缺省=全部,配合 exclude) */
  include?: string[];
  /** 跳过这些根文件(镜像仓库的杂项) */
  exclude?: string[];
}

/** 模型下载源之一:GitHub Release 归档(tar.bz2,经代理链下载后流式解压) */
export interface SpeechSourceGithubArchive {
  kind: "github-archive";
  url: string;
  /** 归档字节数(进度条分母;校验以内容长度为准) */
  sizeBytes: number;
  /** 剥掉归档内顶层目录(sherpa 归档都是 {dirname}/xxx 布局) */
  stripTopDir: boolean;
  /** 代理前缀链,直连失败时按序回退(拼接方式:proxy + url) */
  proxies: string[];
}

export type SpeechModelSource = SpeechSourceModelscope | SpeechSourceGithubArchive;

/** 一个模型可有多个文件变体(如 ASR 的 int8/fp32),任一完整即可用 */
export interface SpeechModelVariant {
  files: string[];
}

export interface SpeechModelEntry {
  id: SpeechModelId;
  scope: "tts" | "asr";
  engine: SpeechEngineKind;
  label: string;
  license: string;
  licenseUrl: string;
  /** 引擎输入/输出采样率(TTS 合成=24000,ASR 输入=16000) */
  sampleRate: number;
  /** 进度条权重用的近似总字节数 */
  approxBytes: number;
  sources: SpeechModelSource[];
  /** 变体表:键序即偏好序(先 int8 后 fp32) */
  variants: Record<string, SpeechModelVariant>;
}

export interface SpeechModelsManifest {
  formatVersion: 1;
  models: SpeechModelEntry[];
}

export type SpeechModelState =
  | "absent"
  | "downloading"
  | "ready"
  | "error";

export interface SpeechModelStatus {
  id: SpeechModelId;
  state: SpeechModelState;
  /** 0..1;absent/ready 时为 0/1 */
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  /** 正在使用的源描述(如 "modelscope" / "github-archive") */
  source?: string;
  /** 当前正在下载的文件名(逐文件源) */
  currentFile?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// 下载/朗读事件载荷(main → renderer)
// ---------------------------------------------------------------------------

/** speech:modelProgress 事件体 */
export interface SpeechDownloadProgress {
  id: SpeechModelId;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  source?: string;
  currentFile?: string;
}

/** speech:ttsAudio 事件体:一个句子的完整音频(v0.13 起三档引擎 —— wav=local/azure,mp3=edge) */
export interface SpeechTtsAudioEvent {
  messageId: string;
  sentenceIndex: number;
  sentenceTotal: number;
  wavBytes: ArrayBuffer;
  sampleRate: number;
  /** v0.13:音频容器(edge=audio/mpeg;缺省视为 audio/wav 兼容 v0.12) */
  mime?: "audio/wav" | "audio/mpeg";
}

/** speech:ttsDone 事件体 */
export interface SpeechTtsDoneEvent {
  messageId: string;
  sentenceTotal: number;
  stopped: boolean;
}

/** speech:ttsError 事件体 */
export interface SpeechTtsErrorEvent {
  messageId: string;
  message: string;
}
