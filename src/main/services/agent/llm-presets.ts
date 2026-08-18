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
  // ================================================================
  // Groq — 超快推理（LPU），免费额度
  // ================================================================
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B（均衡）", contextWindow: 128000, capabilities: ["chat", "tools"] },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant（极速）", contextWindow: 128000, capabilities: ["chat"], free: true },
      { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B（推理）", contextWindow: 128000, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "groq_api_key",
    keyUrl: "https://console.groq.com/keys",
    docsUrl: "https://docs.groq.com/",
    note: "超快推理 · 免费额度",
  },
  // ================================================================
  // Together AI — 开源模型托管
  // ================================================================
  {
    id: "together",
    label: "Together AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo", contextWindow: 128000, capabilities: ["chat", "tools"] },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen2.5 72B Turbo", contextWindow: 32768, capabilities: ["chat"] },
      { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", contextWindow: 128000, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "together_api_key",
    keyUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai/",
    note: "开源模型 · 海外",
  },
  // ================================================================
  // Mistral AI — 欧洲开源模型
  // ================================================================
  {
    id: "mistral",
    label: "Mistral AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large（旗舰）", contextWindow: 128000, capabilities: ["chat", "tools", "vision"] },
      { id: "mistral-small-latest", label: "Mistral Small（快/便宜）", contextWindow: 32000, capabilities: ["chat", "tools"] },
      { id: "codestral-latest", label: "Codestral（代码专用）", contextWindow: 256000, capabilities: ["chat"] },
    ],
    apiKeySetting: "mistral_api_key",
    keyUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai/",
    note: "欧洲 · 开源 · 海外",
  },
  // ================================================================
  // xAI Grok — Elon Musk 的 AI
  // ================================================================
  {
    id: "xai",
    label: "xAI Grok",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    models: [
      { id: "grok-3", label: "Grok 3（旗舰）", contextWindow: 131072, capabilities: ["chat", "reasoning", "tools", "vision"] },
      { id: "grok-3-mini", label: "Grok 3 Mini（快/便宜）", contextWindow: 131072, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "xai_api_key",
    keyUrl: "https://console.x.ai/",
    docsUrl: "https://docs.x.ai/",
    note: "海外 · 实时信息",
  },
  // ================================================================
  // 火山引擎豆包（字节跳动）
  // ================================================================
  {
    id: "volcano",
    label: "火山引擎豆包",
    protocol: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k",
    models: [
      { id: "doubao-1.5-pro-32k", label: "Doubao 1.5 Pro（旗舰）", contextWindow: 32000, capabilities: ["chat", "tools"] },
      { id: "doubao-1.5-lite-32k", label: "Doubao 1.5 Lite（快/便宜）", contextWindow: 32000, capabilities: ["chat"] },
      { id: "deepseek-r1-250120", label: "DeepSeek R1（火山版）", contextWindow: 64000, capabilities: ["chat", "reasoning"] },
    ],
    apiKeySetting: "volcano_api_key",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    docsUrl: "https://www.volcengine.com/docs/82379/",
    note: "国内 · 字节跳动",
  },
  // ================================================================
  // 百度文心一言（千帆 v2 OpenAI 兼容）
  // ================================================================
  {
    id: "baidu",
    label: "百度文心",
    protocol: "openai-compatible",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k-latest",
    models: [
      { id: "ernie-4.0-8k-latest", label: "ERNIE 4.0（旗舰）", contextWindow: 8000, capabilities: ["chat", "tools"] },
      { id: "ernie-3.5-8k-latest", label: "ERNIE 3.5（均衡）", contextWindow: 8000, capabilities: ["chat"] },
      { id: "ernie-speed-128k", label: "ERNIE Speed 128K（长上下文）", contextWindow: 128000, capabilities: ["chat"] },
    ],
    apiKeySetting: "baidu_api_key",
    keyUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    docsUrl: "https://cloud.baidu.com/doc/WENXINWORKSHOP/index",
    note: "国内 · 百度",
  },
  // ================================================================
  // MiniMax
  // ================================================================
  {
    id: "minimax",
    label: "MiniMax",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "abab6.5s-chat",
    models: [
      { id: "abab6.5s-chat", label: "abab6.5s（快/便宜）", contextWindow: 245760, capabilities: ["chat"] },
      { id: "abab6.5-chat", label: "abab6.5（旗舰）", contextWindow: 8192, capabilities: ["chat", "tools"] },
    ],
    apiKeySetting: "minimax_api_key",
    keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    docsUrl: "https://platform.minimaxi.com/document/",
    note: "国内 · 长上下文",
  },
  // ================================================================
  // 百川 Baichuan
  // ================================================================
  {
    id: "baichuan",
    label: "百川 Baichuan",
    protocol: "openai-compatible",
    baseUrl: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4-Turbo",
    models: [
      { id: "Baichuan4-Turbo", label: "Baichuan4 Turbo（快）", contextWindow: 32768, capabilities: ["chat", "tools"] },
      { id: "Baichuan4-Air", label: "Baichuan4 Air（便宜）", contextWindow: 32768, capabilities: ["chat"] },
    ],
    apiKeySetting: "baichuan_api_key",
    keyUrl: "https://platform.baichuan-ai.com/console/apikey",
    docsUrl: "https://platform.baichuan-ai.com/docs/api",
    note: "国内 · 百川智能",
  },
  // ================================================================
  // 阶跃星辰 StepFun
  // ================================================================
  {
    id: "stepfun",
    label: "阶跃星辰 StepFun",
    protocol: "openai-compatible",
    baseUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-2-16k",
    models: [
      { id: "step-2-16k", label: "Step 2 16K（旗舰）", contextWindow: 16384, capabilities: ["chat", "tools"] },
      { id: "step-1flash", label: "Step 1 Flash（快/免费）", contextWindow: 8192, capabilities: ["chat"], free: true },
    ],
    apiKeySetting: "stepfun_api_key",
    keyUrl: "https://platform.stepfun.com/interface-key",
    docsUrl: "https://platform.stepfun.com/docs",
    note: "国内 · 阶跃星辰",
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

/**
 * 从模型列表解析上下文窗口(预设与自定义 provider 共用同一口径)。
 * 大小写不敏感;查不到 → null(诚实"未知",不做家族猜测 —— 猜错的窗口
 * 会让用量表显示假占比)。
 */
export function resolveModelContextWindow(
  models: Array<{ id: string; contextWindow: number | null }> | undefined,
  model: string,
): number | null {
  if (!models || !model) return null;
  const entry = models.find((m) => m.id === model || m.id.toLowerCase() === model.toLowerCase());
  return entry?.contextWindow ?? null;
}
