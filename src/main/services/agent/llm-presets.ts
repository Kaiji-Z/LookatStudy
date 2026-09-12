/**
 * LLM Provider 预设 —— 纯数据，零依赖。
 *
 * 数据来源(2026-09-12 全量刷新):
 *   - z.ai coding /models 实测(真 key,GLM 全系以端点返回为准);
 *   - OpenRouter /models 公开端点实测(445 型:OpenAI/Anthropic/Google/DeepSeek/
 *     Kimi/Qwen/MiniMax/xAI/Mistral 的 id·上下文·价格·输入模态取自实时返回);
 *   - 火山方舟/阶跃/百度千帆/Groq/Together 按官方文档(低置信处已注明);
 *   - Baichuan 无新资料,维持旧条目。
 * 价格单位:每百万 token USD;contextWindow=null 诚实未知(用量表显示未知)。
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
  // 智谱 GLM — 标准按量计费端点(模型清单 = z.ai /models 实测 + 常驻免费档)
  // ================================================================
  {
    id: "glm",
    label: "智谱 GLM（标准 API）",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.3-flash",
    models: [
      { id: "glm-5.3", label: "GLM-5.3（旗舰 · 1.3M上下文）", contextWindow: 1310720, capabilities: ["chat", "reasoning", "tools"], pricing: { input: 1.4, output: 4.4 } },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash（快速 · 支持看图）", contextWindow: 1310720, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.15, output: 0.5 } },
      { id: "glm-5.2", label: "GLM-5.2（上代旗舰 · 1M上下文）", contextWindow: 1000000, capabilities: ["chat", "reasoning", "tools"], pricing: { input: 0.5, output: 1.5 } },
      { id: "glm-5", label: "GLM-5（通用）", contextWindow: null, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-5-turbo", label: "GLM-5-Turbo（极速）", contextWindow: null, capabilities: ["chat", "tools"] },
      { id: "glm-4.7", label: "GLM-4.7（均衡）", contextWindow: 200000, capabilities: ["chat", "tools"], pricing: { input: 0.14, output: 0.28 } },
      { id: "glm-4.5-air", label: "GLM-4.5-Air（轻量便宜）", contextWindow: null, capabilities: ["chat", "tools"] },
      { id: "glm-4-flash", label: "GLM-4-Flash（免费）", contextWindow: 128000, free: true, capabilities: ["chat"], pricing: { input: 0, output: 0 } },
    ],
    apiKeySetting: "glm_api_key",
    keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    docsUrl: "https://docs.bigmodel.cn/",
    note: "国内推荐 · 按量计费 · 有免费额度",
  },
  // ================================================================
  // 智谱 GLM — CodingPlan 订阅端点（性价比最高;清单 = coding /models 实测）
  // ================================================================
  {
    id: "glm-codingplan",
    label: "智谱 GLM（CodingPlan 订阅）",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    defaultModel: "glm-5.3",
    models: [
      { id: "glm-5.3", label: "GLM-5.3（旗舰）", contextWindow: 1310720, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash（快速 · 支持看图）", contextWindow: 1310720, capabilities: ["chat", "tools", "vision"] },
      { id: "glm-5.2", label: "GLM-5.2（上代旗舰）", contextWindow: 1000000, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-5", label: "GLM-5（通用）", contextWindow: null, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-5-turbo", label: "GLM-5-Turbo（极速）", contextWindow: null, capabilities: ["chat", "tools"] },
      { id: "glm-4.7", label: "GLM-4.7（均衡）", contextWindow: 200000, capabilities: ["chat", "tools"] },
      { id: "glm-4.6", label: "GLM-4.6（编码强）", contextWindow: 200000, capabilities: ["chat", "reasoning", "tools"] },
      { id: "glm-4.5-air", label: "GLM-4.5-Air（轻量便宜）", contextWindow: null, capabilities: ["chat", "tools"] },
    ],
    apiKeySetting: "glm_codingplan_key",
    keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    docsUrl: "https://docs.bigmodel.cn/cn/coding-plan/quick-start",
    note: "🚀 CodingPlan 订阅 · 性价比最高 · 需 CodingPlan key",
  },
  // ================================================================
  // DeepSeek — V4 世代;thinking 参数(none/low/high/max,默认开=high);
  // 旧 deepseek-chat/deepseek-reasoner 模型名 2026-07 已退役(官方迁移公告)
  // ================================================================
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4.1-flash",
    models: [
      { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash（推荐 · 1M上下文 · 支持看图）", contextWindow: 1048576, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.15, output: 0.6 } },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro（旗舰 · 1M上下文）", contextWindow: 1048576, capabilities: ["chat", "reasoning", "tools"], pricing: { input: 0.84, output: 1.68 } },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash（上代快档）", contextWindow: 64000, capabilities: ["chat", "tools"], pricing: { input: 0.14, output: 0.28 } },
    ],
    apiKeySetting: "deepseek_api_key",
    keyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/",
    note: "国内 · 推理强 · V4.1 Flash 支持看图",
  },
  // ================================================================
  // Moonshot Kimi — k3 旗舰(1M·看图),k2.5/k2.6 混合思考(默认开)
  // ================================================================
  {
    id: "kimi",
    label: "Moonshot Kimi",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
    models: [
      { id: "kimi-k3", label: "Kimi K3（旗舰 · 1M上下文 · 看图）", contextWindow: 1048576, capabilities: ["chat", "tools", "vision"], pricing: { input: 2.3, output: 11.55 } },
      { id: "kimi-k2.6", label: "Kimi K2.6（混合思考 · 看图）", contextWindow: 262144, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.95, output: 4.0 } },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code（代码）", contextWindow: 262144, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.71, output: 3.5 } },
    ],
    apiKeySetting: "kimi_api_key",
    keyUrl: "https://platform.kimi.com/console/api-keys",
    docsUrl: "https://platform.kimi.com/docs/",
    note: "国内 · 超长上下文",
  },
  // ================================================================
  // 通义千问 Qwen（阿里云百炼）— qwen3.5 世代(全系多模态)
  // ================================================================
  {
    id: "qwen",
    label: "通义千问 Qwen",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.5-plus",
    models: [
      { id: "qwen3.5-plus", label: "Qwen3.5 Plus（均衡 · 1M上下文 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.3, output: 1.8 } },
      { id: "qwen3.5-flash", label: "Qwen3.5 Flash（快/便宜 · 1M上下文 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.07, output: 0.26 } },
      { id: "qwen3.5-122b-a10b", label: "Qwen3.5 122B-A10B（开源旗舰托管）", contextWindow: 262144, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.26, output: 2.08 } },
    ],
    apiKeySetting: "qwen_api_key",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    note: "国内 · 阿里云百炼",
  },
  // ================================================================
  // SiliconCloud 硅基流动（聚合平台;模型名随上游滚动,以控制台列表为准）
  // ================================================================
  {
    id: "siliconcloud",
    label: "SiliconCloud 硅基流动",
    protocol: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V4.1",
    models: [
      { id: "deepseek-ai/DeepSeek-V4.1", label: "DeepSeek V4.1", contextWindow: 1048576, capabilities: ["chat", "tools"] },
      { id: "Qwen/Qwen3.5-122B-A10B", label: "Qwen3.5 122B-A10B", contextWindow: 262144, capabilities: ["chat", "tools"] },
    ],
    apiKeySetting: "siliconcloud_api_key",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    docsUrl: "https://docs.siliconflow.cn/",
    note: "聚合平台 · 模型随上游滚动,以控制台列表为准",
  },
  // ================================================================
  // OpenRouter（国际聚合,应用内另有全量自动发现;此为常驻精选）
  // ================================================================
  {
    id: "openrouter",
    label: "OpenRouter（国际聚合）",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "z-ai/glm-5.3-flash",
    models: [
      { id: "z-ai/glm-5.3-flash", label: "GLM-5.3-Flash（便宜 · 看图）", contextWindow: 1310720, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.15, output: 0.5 } },
      { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna（便宜 · 看图）", contextWindow: 1050000, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.2, output: 1.2 } },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5（均衡 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 2.0, output: 10.0 } },
      { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash（快 · 看图）", contextWindow: 1048576, capabilities: ["chat", "vision"], pricing: { input: 0.75, output: 3.75 } },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash（便宜 · 看图）", contextWindow: 1048576, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.15, output: 0.6 } },
    ],
    apiKeySetting: "openrouter_api_key",
    keyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    note: "国际聚合 · 应用内可发现全部 400+ 模型 · 需海外网络",
  },
  // ================================================================
  // OpenAI — GPT-5.6 世代(id/价格/模态取自 OpenRouter 实时返回)
  // ================================================================
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna（便宜 · 看图）", contextWindow: 1050000, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.2, output: 1.2 } },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（均衡）", contextWindow: 1050000, capabilities: ["chat", "tools", "vision"], pricing: { input: 2.0, output: 10.0 } },
      { id: "gpt-5.6-terra-pro", label: "GPT-5.6 Terra Pro（旗舰）", contextWindow: 1050000, capabilities: ["chat", "reasoning", "tools", "vision"], pricing: { input: 2.0, output: 12.0 } },
    ],
    apiKeySetting: "openai_api_key",
    keyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    note: "需海外网络",
  },
  // ================================================================
  // Anthropic Claude — 5 世代(fable 5.1 旗舰/opus 5/sonnet 5;1M 上下文)
  // ================================================================
  {
    id: "anthropic",
    label: "Anthropic Claude",
    protocol: "anthropic",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5（均衡 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 2.0, output: 10.0 } },
      { id: "claude-opus-5", label: "Claude Opus 5（强 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 5.0, output: 25.0 } },
      { id: "claude-fable-5.1", label: "Claude Fable 5.1（旗舰 · 看图）", contextWindow: 1000000, capabilities: ["chat", "tools", "vision"], pricing: { input: 10.0, output: 50.0 } },
    ],
    apiKeySetting: "anthropic_api_key",
    keyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.anthropic.com/",
    note: "需海外网络 · 1M 长上下文",
  },
  // ================================================================
  // Google Gemini — 3.8/3.7 Flash(1M 上下文全模态;Pro 未见于 /models 返回)
  // ================================================================
  {
    id: "google",
    label: "Google Gemini",
    protocol: "google",
    defaultModel: "gemini-3.8-flash",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash（快 · 看图）", contextWindow: 1048576, capabilities: ["chat", "vision"], pricing: { input: 0.75, output: 3.75 } },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash（上代）", contextWindow: 1048576, capabilities: ["chat", "vision"], pricing: { input: 0.75, output: 3.75 } },
    ],
    apiKeySetting: "google_api_key",
    keyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/docs",
    note: "需海外网络 · 超长上下文",
  },
  // ================================================================
  // Groq — Llama 4 世代(LPU 极速;官方模型列表)
  // ================================================================
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct",
    models: [
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick（均衡 · 看图）", contextWindow: null, capabilities: ["chat", "tools", "vision"] },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout（快 · 看图）", contextWindow: null, capabilities: ["chat", "vision"] },
    ],
    apiKeySetting: "groq_api_key",
    keyUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs/models",
    note: "超快推理 · 免费额度",
  },
  // ================================================================
  // Together AI — 开源模型托管(Llama 4 官方命名;低置信,以控制台为准)
  // ================================================================
  {
    id: "together",
    label: "Together AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    models: [
      { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", label: "Llama 4 Scout", contextWindow: null, capabilities: ["chat", "vision"] },
      { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct", label: "Llama 4 Maverick", contextWindow: null, capabilities: ["chat", "vision"] },
    ],
    apiKeySetting: "together_api_key",
    keyUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai/",
    note: "开源模型 · 海外 · 命名以控制台为准",
  },
  // ================================================================
  // Mistral AI — 2512/2603 世代(id/价格/模态取自 OpenRouter 返回)
  // ================================================================
  {
    id: "mistral",
    label: "Mistral AI",
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-medium-3-5",
    models: [
      { id: "mistral-medium-3-5", label: "Mistral Medium 3.5（均衡 · 看图）", contextWindow: 262144, capabilities: ["chat", "tools", "vision"], pricing: { input: 1.5, output: 7.5 } },
      { id: "mistral-large-2512", label: "Mistral Large 2512（大杯便宜）", contextWindow: 262144, capabilities: ["chat", "tools", "vision"], pricing: { input: 0.5, output: 1.5 } },
      { id: "mistral-small-2603", label: "Mistral Small 2603（快/便宜 · 看图）", contextWindow: 262144, capabilities: ["chat", "vision"], pricing: { input: 0.15, output: 0.6 } },
    ],
    apiKeySetting: "mistral_api_key",
    keyUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai/",
    note: "欧洲 · 海外",
  },
  // ================================================================
  // xAI Grok — 4.x 世代(4.3/4.5/4.6 认 reasoning_effort;裸 grok-4 传参报错已避开)
  // ================================================================
  {
    id: "xai",
    label: "xAI Grok",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    models: [
      { id: "grok-4.6", label: "Grok 4.6（旗舰 · 看图）", contextWindow: 500000, capabilities: ["chat", "reasoning", "tools", "vision"], pricing: { input: 2.0, output: 6.0 } },
      { id: "grok-4.3", label: "Grok 4.3（1M上下文 · 性价比）", contextWindow: 1000000, capabilities: ["chat", "reasoning", "tools", "vision"], pricing: { input: 1.25, output: 2.5 } },
      { id: "grok-4.20", label: "Grok 4.20（2M超长上下文）", contextWindow: 2000000, capabilities: ["chat", "reasoning", "tools", "vision"], pricing: { input: 1.25, output: 2.5 } },
    ],
    apiKeySetting: "xai_api_key",
    keyUrl: "https://console.x.ai/",
    docsUrl: "https://docs.x.ai/",
    note: "海外 · 实时信息",
  },
  // ================================================================
  // 火山引擎豆包 — Seed 世代(深度思考默认开;thinking.type+reasoning_effort 方言)
  // ================================================================
  {
    id: "volcano",
    label: "火山引擎豆包",
    protocol: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-pro-260215",
    models: [
      { id: "doubao-seed-2-0-pro-260215", label: "Doubao Seed 2.0 Pro（旗舰 · 深度思考）", contextWindow: null, capabilities: ["chat", "reasoning", "tools"] },
    ],
    apiKeySetting: "volcano_api_key",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    docsUrl: "https://www.volcengine.com/docs/82379/1330310",
    note: "国内 · 字节 · 完整模型 id 见方舟控制台",
  },
  // ================================================================
  // 百度文心（千帆 v2 OpenAI 兼容）— ERNIE 5.0 全模态世代
  // ================================================================
  {
    id: "baidu",
    label: "百度文心",
    protocol: "openai-compatible",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-5.0",
    models: [
      { id: "ernie-5.0", label: "ERNIE 5.0（旗舰 · 全模态看图）", contextWindow: null, capabilities: ["chat", "tools", "vision"] },
    ],
    apiKeySetting: "baidu_api_key",
    keyUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    docsUrl: "https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j",
    note: "国内 · 百度 · 更多模型见千帆模型列表",
  },
  // ================================================================
  // MiniMax — M2 世代(交错思考常开,官方 API 无禁用开关)
  // ================================================================
  {
    id: "minimax",
    label: "MiniMax",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-M2.7",
    models: [
      { id: "MiniMax-M2.7", label: "MiniMax M2.7（当前世代 · 思考常开）", contextWindow: 204800, capabilities: ["chat", "tools"], pricing: { input: 0.3, output: 1.2 } },
    ],
    apiKeySetting: "minimax_api_key",
    keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    docsUrl: "https://platform.minimax.io/docs/",
    note: "国内 · 思考常开(官方无思考开关)",
  },
  // ================================================================
  // 百川 Baichuan（无 2026-09 新资料,维持旧条目;以控制台为准）
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
    note: "国内 · 百川智能 · 待核(以控制台为准)",
  },
  // ================================================================
  // 阶跃星辰 StepFun — Step 3.7 世代(多模态推理,默认关思考,enable_thinking 方言)
  // ================================================================
  {
    id: "stepfun",
    label: "阶跃星辰 StepFun",
    protocol: "openai-compatible",
    baseUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-3.7-flash",
    models: [
      { id: "step-3.7-flash", label: "Step 3.7 Flash（旗舰 · 多模态推理 · 看图）", contextWindow: null, capabilities: ["chat", "reasoning", "tools", "vision"] },
      { id: "step-3.5-flash", label: "Step 3.5 Flash（上代）", contextWindow: null, capabilities: ["chat", "reasoning", "tools", "vision"] },
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
