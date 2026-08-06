/**
 * LLM Provider 预设 —— 纯数据，零依赖（可被测试直接 import）。
 *
 * 协议：全部 openai-compatible（用 @ai-sdk/openai 的 createOpenAI 自定义 baseURL）。
 * 默认 GLM（智谱），用户可在 settings 改 active_provider + active_model 切到 OpenAI/Anthropic。
 *
 * 密钥边界（AGENTS.md "Architecture boundaries"）：API key 只在主进程读/用，
 * 渲染层只见"是否已配置"的布尔。本文件不读 key，只定义元数据。
 */

export interface ProviderPreset {
  id: string;
  label: string;
  /** openai-compatible base URL */
  baseUrl: string;
  /** 默认模型 id */
  defaultModel: string;
  /** settings 表里存 key 的字段名 */
  apiKeySetting: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "glm",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    apiKeySetting: "glm_api_key",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeySetting: "openai_api_key",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    apiKeySetting: "deepseek_api_key",
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
