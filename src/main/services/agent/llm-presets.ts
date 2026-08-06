/**
 * LLM Provider 预设 —— 纯数据，零依赖（可被测试直接 import）。
 *
 * 三类协议:
 *   - openai-compatible（用 @ai-sdk/openai 的 createOpenAI 自定义 baseURL）
 *     覆盖: GLM / OpenAI / DeepSeek / Ollama / 任意 OpenAI 兼容端点
 *   - anthropic-native（用 @ai-sdk/anthropic 的 createAnthropic）
 *     覆盖: Claude 系列
 *   - google-native（用 @ai-sdk/google 的 createGoogleGenerativeAI）
 *     覆盖: Gemini 系列
 *
 * 默认 GLM（智谱）。用户可在 settings 改 active_provider + active_model。
 *
 * 密钥边界（AGENTS.md "Architecture boundaries"）：API key 只在主进程读/用，
 * 渲染层只见"是否已配置"的布尔。本文件不读 key，只定义元数据。
 */

export type ProviderProtocol = "openai-compatible" | "anthropic" | "google";

export interface ModelOption {
  /** 模型 id，传给 SDK */
  id: string;
  /** 显示名 */
  label: string;
  /** 上下文窗口（tokens），用于 UI 提示。null 表示未知 */
  contextWindow: number | null;
}

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /** openai-compatible 协议才用。anthropic/google 走各自 SDK 的默认端点 */
  baseUrl?: string;
  /** 默认模型 id */
  defaultModel: string;
  /** 可选模型列表（给 UI 做 model picker） */
  models: ModelOption[];
  /** settings 表里存 key 的字段名 */
  apiKeySetting: string;
  /** key 获取地址（给 UI "去这里申请" 链接） */
  keyUrl: string;
  /** 备注（给 UI 显示，如"国内推荐"） */
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "glm",
    label: "智谱 GLM",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: [
      { id: "glm-4-flash", label: "GLM-4-Flash（免费/快）", contextWindow: 128000 },
      { id: "glm-4-air", label: "GLM-4-Air（轻量）", contextWindow: 128000 },
      { id: "glm-4-airx", label: "GLM-4-AirX（极速）", contextWindow: 128000 },
      { id: "glm-4-plus", label: "GLM-4-Plus（旗舰）", contextWindow: 128000 },
      { id: "glm-4-long", label: "GLM-4-Long（长上下文）", contextWindow: 1000000 },
    ],
    apiKeySetting: "glm_api_key",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "国内推荐 · 价格低 · 免费额度",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", label: "DeepSeek-V3（对话）", contextWindow: 64000 },
      { id: "deepseek-reasoner", label: "DeepSeek-R1（推理）", contextWindow: 64000 },
    ],
    apiKeySetting: "deepseek_api_key",
    keyUrl: "https://platform.deepseek.com/api_keys",
    note: "国内 · 推理强",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini（便宜）", contextWindow: 128000 },
      { id: "gpt-4o", label: "GPT-4o（旗舰）", contextWindow: 128000 },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", contextWindow: 1000000 },
      { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1000000 },
      { id: "o4-mini", label: "o4-mini（推理）", contextWindow: 200000 },
    ],
    apiKeySetting: "openai_api_key",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "需海外网络",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    protocol: "anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    models: [
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku（快/便宜）", contextWindow: 200000 },
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet（均衡）", contextWindow: 200000 },
      { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet（旗舰）", contextWindow: 200000 },
    ],
    apiKeySetting: "anthropic_api_key",
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "需海外网络 · 长上下文",
  },
  {
    id: "google",
    label: "Google Gemini",
    protocol: "google",
    defaultModel: "gemini-1.5-flash",
    models: [
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash（快/便宜）", contextWindow: 1000000 },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro（强）", contextWindow: 2000000 },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", contextWindow: 1000000 },
    ],
    apiKeySetting: "google_api_key",
    keyUrl: "https://aistudio.google.com/app/apikey",
    note: "需海外网络 · 超长上下文",
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * 解析"当前激活的 provider + model + key 是否就绪"。
 *
 * @param settings  settings 表的 key→value 映射（调用方传入，避免本文件依赖 DB）
 * @returns ready=true 时含 provider/model/apiKey；ready=false 时含 missing 字段说明
 */
export function resolveProviderConfig(settings: {
  active_provider?: string | null;
  active_model?: string | null;
  [key: string]: string | null | undefined;
}): {
  ready: boolean;
  provider?: ProviderPreset;
  model?: string;
  apiKey?: string;
  missing?: string;
} {
  const providerId = settings.active_provider ?? "glm";
  const preset = getProviderPreset(providerId);
  if (!preset) {
    return { ready: false, missing: `未知 provider: ${providerId}` };
  }
  const apiKey = settings[preset.apiKeySetting];
  if (!apiKey) {
    return {
      ready: false,
      provider: preset,
      missing: `未配置 ${preset.apiKeySetting}（${preset.label} 的 API key）`,
    };
  }
  const model = settings.active_model ?? preset.defaultModel;
  return { ready: true, provider: preset, model, apiKey };
}
