/**
 * TTS 三档解析(纯函数,verify 直测)—— settings map → 引擎档位配置。
 *
 * 档位:edge(默认,微软在线,免费无 key)/ azure(BYO key,官方通道)/ local(kokoro 离线)。
 * 语义 speed 是统一的多倍率(1.0=常速);edge 需要转成 SSML 百分比("+10%"),
 * kokoro 直接吃多倍率。
 */

export type TtsEngineTier = "edge" | "azure" | "local";

export interface TtsTierConfig {
  engine: TtsEngineTier;
  /** edge/azure 音色名;local 的 sid 另由 tts_sid_local 提供 */
  voice: string;
  /** 统一语速多倍率 */
  speed: number;
  /** azure 专属 */
  azureKey: string | null;
  azureRegion: string | null;
}

export const DEFAULT_TTS_ENGINE: TtsEngineTier = "edge";
export const DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural";
export const DEFAULT_AZURE_TTS_VOICE = "zh-CN-XiaoxiaoNeural";
export const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
export const AZURE_TTS_OUTPUT_FORMAT = "riff-24khz-16bit-mono-pcm";

/** 精选 Edge 音色(产品级中文 + 常用英文;全列表几百个,不做) */
export const EDGE_VOICES: ReadonlyArray<{ id: string; label: string; lang: "zh" | "en" }> = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓(女·普通话)", lang: "zh" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊(女·普通话)", lang: "zh" },
  { id: "zh-CN-YunxiNeural", label: "云希(男·普通话)", lang: "zh" },
  { id: "zh-CN-YunyangNeural", label: "云扬(男·新闻)", lang: "zh" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北(女·东北)", lang: "zh" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮(女·陕西)", lang: "zh" },
  { id: "en-US-AriaNeural", label: "Aria(女·英语)", lang: "en" },
  { id: "en-US-GuyNeural", label: "Guy(男·英语)", lang: "en" },
  { id: "en-US-JennyNeural", label: "Jenny(女·英语)", lang: "en" },
];

/** kokoro 本地音色(sid 与 sherpa 声学包对齐;zh/en 双语) */
export const LOCAL_TTS_SIDS: ReadonlyArray<{ sid: number; label: string }> = [
  { sid: 45, label: "zf_xiaobei(女)" },
  { sid: 46, label: "zf_xiaoni(女)" },
  { sid: 47, label: "zf_xiaoxiao(女)" },
  { sid: 48, label: "zf_xiaoyi(女·默认)" },
  { sid: 49, label: "zm_yunjian(男)" },
  { sid: 50, label: "zm_yunxi(男)" },
  { sid: 51, label: "zm_yunxia(男)" },
  { sid: 52, label: "zm_yunyang(男)" },
];

const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;

export function clampSpeed(raw: string | null | undefined): number {
  const v = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
}

/** 多倍率 → edge/azure SSML rate 百分比串("+10%"/"-5%"/"+0%") */
export function speedToRatePercent(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export function resolveTtsTier(settings: Record<string, string | null>): TtsTierConfig {
  const engineRaw = settings.tts_engine;
  const engine: TtsEngineTier =
    engineRaw === "azure" || engineRaw === "local" || engineRaw === "edge" ? engineRaw : DEFAULT_TTS_ENGINE;
  const voice =
    engine === "azure"
      ? settings.azure_tts_voice?.trim() || DEFAULT_AZURE_TTS_VOICE
      : settings.tts_voice_edge?.trim() || DEFAULT_EDGE_VOICE;
  return {
    engine,
    voice,
    speed: clampSpeed(settings.tts_speed),
    azureKey: settings.azure_tts_api_key?.trim() || null,
    azureRegion: settings.azure_tts_region?.trim() || null,
  };
}

/** azure 档配置完整性(缺 key/region → 结构化失败,UI 引导) */
export function azureTtsMissing(cfg: TtsTierConfig): "key" | "region" | null {
  if (cfg.engine !== "azure") return null;
  if (!cfg.azureKey) return "key";
  if (!cfg.azureRegion) return "region";
  return null;
}
