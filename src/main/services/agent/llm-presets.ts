/**
 * LLM Provider 预设 —— 纯数据，零依赖。
 *
 * 数据来源: 2026-08 各 provider 官方文档 + OpenRouter API 验证。
 *
 * GLM 特殊处理: 智谱有 3 个不同端点（标准/CodingPlan/Anthropic兼容），
 * 每个端点是独立的 provider 预设（因为 baseUrl 和 key 可能不同）。
 *
 * ModelOption 扩展字段（忠于 LobeChat + OpenRouter schema）:
 *   - pricing: 输入/输出价格（每百万 token，USD）
 *   - capabilities: chat/reasoning/tools/vision
 *   - inputModalities: text/image/audio
 */

export type ProviderProtocol = "openai-compatible" | "anthropic" | "google";

export interface ModelPricing {
  /** 每百万 token 输入价格（USD），null=未知 */
  input: number | null;
  /** 每百万 token 输出价格（USD），null=未知 */
  output: number | null;
}

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: number | null;
  free?: boolean;
  capabilities?: string[];
  inputModalities?: string[];
  pricing?: ModelPricing;
}

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl?: string;
  defaultModel: string;
  models: ModelOption[];
  apiKeySetting: string;
  keyUrl: string;
  docsUrl?: string;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ================================================================
  // 智谱 GLM — 标准按量计费端点
  // ================================================================
  {
    id: "glm",
    label: "智谱 GLM（标准 API）",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: [
      { id: "glm-4-flash", label: "GLM-4-Flash（免费）", contextWindow: 128000, free: true, capabilities: ["chat"], pricing: { input: 0, output: 0 } },
      { id: "glm-5.2", label: "GLM-5.2（旗舰 · 1M上下文）", contextWindow: 1000000, capabilities: ["chat", "reasoning", "tools"], pricing: { input: 0.5, output: 1.5 } },
      { id: "glm-4.7", label: "GLM-4.7（均衡）", contextWindow: 200000, capabilities: ["chat", "tools"], pricing: { input: 0.14, output: 0.28 } },
      { id: "glm-4.7-flash", label: "GLM-4.7-Flash（免费）", contextWindow: 200000, free: true, capabilities: ["chat"], pricing: { input: 0, output: 0 } },
      { id: "glm-4.6", label: "GLM-4.6（编码/推理强）", contextWindow: 200000, capabilities: ["chat", "reasoning", "tools"], pricing: { input: 0.28, output: 0.84 } },
      { id: "glm-4-long", label: "GLM-4-Long（1M超长上下文）", contextWindow: 1000000, capabilities: ["chat"], pricing: { input: 0.07, output: 0.14 } },
    ],
    apiKeySetting: "glm_api_key",
    keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    docsUrl: "https://docs.bigmodel.cn/",
    note: "国内推荐 · 按量计费 · 有免费额度",
  },
  // ================================================================
  // 智谱 GLM — CodingPlan 订阅端点（性价比最高，限制 CodingPlan key）
  // ================================================================
  {
    id: "glm-codingplan",
    label: "智谱 GLM（CodingPlan 订阅）",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    defaultModel: "glm-5.2",
    models: [
      { id: "glm-5.2", label: "GLM-5.2（旗舰）", contextWindow: 1000000, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-4.6", label: "GLM-4.6（编码强）", contextWindow: 200000, capabilities: ["chat", "reasoning", "tools"] },
    ],
    apiKeySetting: "glm_codingplan_key",
    keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    docsUrl: "https://docs.bigmodel.cn/cn/coding-plan/quick-start",
    note: "🚀 CodingPlan 订阅 · 性价比最高 · 需 CodingPlan key",
  },
  // ================================================================
  // DeepSeek — 当前模型 v4，旧模型 deepseek-chat 即将退役
  // ================================================================
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash（当前推荐）", contextWindow: 64000, capabilities: ["chat", "tools"], pricing: { input: 0.14, output: 0.28 } },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro（旗舰）", contextWindow: 64000, capabilities: ["chat", "reasoning", "tools"] },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner（R1 推理 · 即将退役）", contextWindow: 64000, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "deepseek_api_key",
    keyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/",
    note: "国内 · 推理能力强",
  },
  // ================================================================
  // Moonshot Kimi — 超长上下文
  // ================================================================
  {
    id: "kimi",
    label: "Moonshot Kimi",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
    models: [
      { id: "kimi-k3", label: "Kimi K3（1M 上下文）", contextWindow: 1000000, capabilities: ["chat", "tools"] },
    ],
    apiKeySetting: "kimi_api_key",
    keyUrl: "https://platform.kimi.com/console/api-keys",
    docsUrl: "https://platform.kimi.com/docs/",
    note: "国内 · 超长上下文",
  },
  // ================================================================
  // 通义千问 Qwen（阿里云百炼）
  // ================================================================
  {
    id: "qwen",
    label: "通义千问 Qwen",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: [
      { id: "qwen-max", label: "Qwen Max（旗舰）", contextWindow: 32000, capabilities: ["chat", "tools"] },
      { id: "qwen-plus", label: "Qwen Plus（均衡）", contextWindow: 131072, capabilities: ["chat", "tools"] },
      { id: "qwen-turbo", label: "Qwen Turbo（快/便宜）", contextWindow: 1000000, capabilities: ["chat"] },
    ],
    apiKeySetting: "qwen_api_key",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    note: "国内 · 阿里云百炼",
  },
  // ================================================================
  // SiliconCloud 硅基流动（聚合平台，一个 key 访问多个开源模型）
  // ================================================================
  {
    id: "siliconcloud",
    label: "SiliconCloud 硅基流动",
    protocol: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek-V3", contextWindow: 64000 },
      { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5-72B", contextWindow: 131072 },
    ],
    apiKeySetting: "siliconcloud_api_key",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    docsUrl: "https://docs.siliconflow.cn/",
    note: "聚合平台 · 一个 key 访问多个开源模型",
  },
  // ================================================================
  // OpenRouter（国际聚合，自动发现模型）
  // ================================================================
  {
    id: "openrouter",
    label: "OpenRouter（国际聚合）",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "z-ai/glm-5.2",
    models: [
      { id: "z-ai/glm-5.2", label: "GLM-5.2", contextWindow: 1000000, capabilities: ["chat", "reasoning"] },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", contextWindow: 200000, capabilities: ["chat", "tools", "vision"] },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", contextWindow: 128000, capabilities: ["chat", "tools", "vision"] },
      { id: "google/gemini-flash-1.5", label: "Gemini Flash 1.5", contextWindow: 1000000, capabilities: ["chat", "vision"] },
    ],
    apiKeySetting: "openrouter_api_key",
    keyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    note: "国际聚合 · 覆盖所有主流模型 · 需海外网络",
  },
  // ================================================================
  // OpenAI
  // ================================================================
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini（便宜）", contextWindow: 128000, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.15, output: 0.6 } },
      { id: "gpt-4o", label: "GPT-4o（旗舰）", contextWindow: 128000, capabilities: ["chat", "tools", "vision"], pricing: { input: 2.5, output: 10 } },
      { id: "o4-mini", label: "o4-mini（推理）", contextWindow: 200000, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "openai_api_key",
    keyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    note: "需海外网络",
  },
  // ================================================================
  // Anthropic Claude
  // ================================================================
  {
    id: "anthropic",
    label: "Anthropic Claude",
    protocol: "anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    models: [
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku（快/便宜）", contextWindow: 200000, capabilities: ["chat", "tools"], pricing: { input: 0.8, output: 4 } },
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet（均衡）", contextWindow: 200000, capabilities: ["chat", "tools", "vision"], pricing: { input: 3, output: 15 } },
    ],
    apiKeySetting: "anthropic_api_key",
    keyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.anthropic.com/",
    note: "需海外网络 · 长上下文",
  },
  // ================================================================
  // Google Gemini
  // ================================================================
  {
    id: "google",
    label: "Google Gemini",
    protocol: "google",
    defaultModel: "gemini-1.5-flash",
    models: [
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash（快/便宜）", contextWindow: 1000000, capabilities: ["chat", "vision"], pricing: { input: 0.075, output: 0.3 } },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro（强）", contextWindow: 2000000, capabilities: ["chat", "vision"], pricing: { input: 1.25, output: 5 } },
    ],
    apiKeySetting: "google_api_key",
    keyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/docs",
    note: "需海外网络 · 超长上下文",
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * 解析"当前激活的 provider + model + key 是否就绪"。
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
