/**
 * ASR 三档解析(纯函数,verify 直测)—— settings map → 听写引擎档位。
 *
 * 档位:local(默认,Whisper 离线,自带标点)/ groq(whisper-large-v3-turbo,复用
 * LLM preset 的 groq_api_key —— 已配 Groq 学 LLM 的用户零配置)/ azure STT(BYO key)。
 * 语言提示由 UI locale 推导;推不出就交给模型自动检测。
 */

export type AsrEngineTier = "local" | "groq" | "azure";

export interface AsrTierConfig {
  engine: AsrEngineTier;
  groqKey: string | null;
  azureKey: string | null;
  azureRegion: string | null;
}

export const DEFAULT_ASR_ENGINE: AsrEngineTier = "local";

export function resolveAsrTier(settings: Record<string, string | null>): AsrTierConfig {
  const raw = settings.asr_engine;
  const engine: AsrEngineTier =
    raw === "groq" || raw === "azure" || raw === "local" ? raw : DEFAULT_ASR_ENGINE;
  return {
    engine,
    groqKey: settings.groq_api_key?.trim() || null,
    azureKey: settings.azure_stt_api_key?.trim() || null,
    azureRegion: settings.azure_stt_region?.trim() || null,
  };
}

/** UI locale → whisper language 提示;推不出返回 undefined(自动检测) */
export function localeToWhisperLang(locale: string | null | undefined): string | undefined {
  if (!locale) return undefined;
  const l = locale.toLowerCase();
  if (l.startsWith("zh")) return "zh";
  if (l.startsWith("en")) return "en";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("ko")) return "ko";
  return undefined;
}

/** UI locale → BCP-47(groq language / azure STT 参数) */
export function localeToBcp47(locale: string | null | undefined): string {
  if (!locale) return "zh-CN";
  const l = locale.toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("en")) return "en-US";
  if (l.startsWith("ja")) return "ja-JP";
  if (l.startsWith("ko")) return "ko-KR";
  return "zh-CN";
}

/** 云档配置完整性(local 返回 null;groq 只查 key;azure 查 key+region) */
export function asrCloudMissing(cfg: AsrTierConfig): "groq-key" | "azure-key" | "azure-region" | null {
  if (cfg.engine === "groq") return cfg.groqKey ? null : "groq-key";
  if (cfg.engine === "azure") {
    if (!cfg.azureKey) return "azure-key";
    if (!cfg.azureRegion) return "azure-region";
  }
  return null;
}
