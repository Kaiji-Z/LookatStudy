/**
 * LLM 客户端 —— 主进程侧，把 provider 预设 + key 变成 AI SDK 的 model 实例。
 *
 * 密钥在这里读取（settings 表），永不离开主进程。渲染层只见"是否配置"的布尔。
 *
 * 三类协议:
 *   - openai-compatible: createOpenAI（自定义 baseURL），覆盖 GLM/OpenAI/DeepSeek
 *   - anthropic:         createAnthropic
 *   - google:            createGoogleGenerativeAI
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, type LanguageModel } from "ai";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { settings as settingsTable } from "../../db/schema.js";
import {
  resolveProviderConfig,
  getProviderPreset,
  type ProviderPreset,
  type ProviderProtocol,
} from "./llm-presets.js";
import { getCustomProviderRaw } from "../custom-provider-service.js";

type Db = SQLJsDatabase<typeof schema>;

/** 读 settings 表成 key→value 映射（主进程用） */
export function readSettingsMap(db: Db): Record<string, string | null> {
  const rows = db.select().from(settingsTable).all();
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export interface ResolvedLlm {
  provider: ProviderPreset;
  model: string;
  apiKey: string;
  /** AI SDK 的 LanguageModel，可直接喂给 streamText */
  languageModel: LanguageModel;
}

/**
 * 按 protocol 构造 LanguageModel。
 * 抽出来便于 testConnection 复用（验证时不走 streamText，用 generateText 发一条最小请求）。
 * 支持 openai-compatible（自定义 baseUrl）/ anthropic / google 三类协议。
 * fetchFn:可选 fetch 覆盖(v0.10 思考强度对 openai-compatible 第三方端点做请求体补丁用)。
 */
export function buildLanguageModel(
  protocol: ProviderProtocol,
  baseUrl: string | undefined,
  apiKey: string,
  model: string,
  fetchFn?: typeof fetch,
): LanguageModel {
  switch (protocol) {
    case "openai-compatible": {
      if (!baseUrl) {
        throw new Error(`openai-compatible 协议需要 baseUrl`);
      }
      const openai = createOpenAI({ baseURL: baseUrl, apiKey, ...(fetchFn ? { fetch: fetchFn } : {}) });
      return openai.chat(model);
    }
    case "anthropic": {
      // Anthropic 允许自定义 baseURL（覆盖官方端点，如代理）
      const opts: { apiKey: string; baseURL?: string; fetch?: typeof fetch } = { apiKey };
      if (baseUrl) opts.baseURL = baseUrl;
      if (fetchFn) opts.fetch = fetchFn;
      const anthropic = createAnthropic(opts);
      return anthropic(model);
    }
    case "google": {
      const opts: { apiKey: string; baseURL?: string; fetch?: typeof fetch } = { apiKey };
      if (baseUrl) opts.baseURL = baseUrl;
      if (fetchFn) opts.fetch = fetchFn;
      const google = createGoogleGenerativeAI(opts);
      return google(model);
    }
    default:
      throw new Error(`未知 protocol: ${String(protocol)}`);
  }
}

/**
 * 解析当前激活 provider + 构造 LanguageModel。未配置 key 抛错。
 *
 * 解析顺序：先查自定义 provider（id 以 "custom-" 开头），找不到再查预设。
 * 自定义 provider 的 apiKey/baseUrl 存在 custom_providers 表，不走 settings。
 */
export function resolveLlm(db: Db): ResolvedLlm {
  const settings = readSettingsMap(db);
  const activeProvider = settings.active_provider ?? "glm";

  // 自定义 provider 分支
  if (activeProvider.startsWith("custom-")) {
    const raw = getCustomProviderRaw(db, activeProvider);
    if (!raw) {
      throw new Error(`自定义 provider 不存在: ${activeProvider}（可能已被删除）`);
    }
    // 本地模型（Ollama 等）可以没 key：用占位符让 SDK 不报错
    const apiKey = raw.apiKey || "no-key-needed";
    const model = settings.active_model ?? raw.defaultModel;
    const protocol = raw.protocol as ProviderProtocol;
    return {
      provider: {
        id: raw.id,
        label: "(自定义)",
        protocol,
        baseUrl: raw.baseUrl,
        defaultModel: raw.defaultModel,
        models: [],
        apiKeySetting: "(custom)",
        keyUrl: "",
      },
      model,
      apiKey,
      languageModel: buildLanguageModel(protocol, raw.baseUrl, apiKey, model),
    };
  }

  // 预设 provider 分支
  const cfg = resolveProviderConfig(settings);
  if (!cfg.ready || !cfg.provider || !cfg.apiKey || !cfg.model) {
    throw new Error(cfg.missing ?? "LLM provider 未就绪");
  }
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
    languageModel: buildLanguageModel(
      cfg.provider.protocol,
      cfg.provider.baseUrl,
      cfg.apiKey,
      cfg.model,
    ),
  };
}

/**
 * 解析多模态(vision)LLM。
 *
 * 策略:复用主模型 + 可选覆盖。
 *   1. 查 settings.vision_provider_override / vision_model_override
 *   2. 有覆盖 → 用覆盖的 provider + model 构造(自定义 provider 也可覆盖)
 *   3. 无覆盖 → 复用 resolveLlm()(主模型),检测 vision 能力
 *   4. 主模型不支持 vision → 抛友好错误(用户需在设置页配 vision 模型)
 *
 * 自定义 provider 默认视为支持 vision(无法可靠检测能力)。
 */
export function resolveVisionLlm(db: Db): ResolvedLlm {
  const settings = readSettingsMap(db);
  const visionProviderOverride = settings.vision_provider_override;
  const visionModelOverride = settings.vision_model_override;

  // 有覆盖 → 用覆盖的 provider + model
  if (visionProviderOverride && visionModelOverride) {
    // 自定义 provider 覆盖
    if (visionProviderOverride.startsWith("custom-")) {
      const raw = getCustomProviderRaw(db, visionProviderOverride);
      if (!raw) {
        throw new Error(`多模态覆盖的自定义 provider 不存在: ${visionProviderOverride}`);
      }
      const apiKey = raw.apiKey || "no-key-needed";
      const protocol = raw.protocol as ProviderProtocol;
      return {
        provider: {
          id: raw.id,
          label: "(自定义 vision)",
          protocol,
          baseUrl: raw.baseUrl,
          defaultModel: raw.defaultModel,
          models: [],
          apiKeySetting: "(custom)",
          keyUrl: "",
        },
        model: visionModelOverride,
        apiKey,
        languageModel: buildLanguageModel(protocol, raw.baseUrl, apiKey, visionModelOverride),
      };
    }
    // 预设 provider 覆盖:从预设表查 provider 配置
    const preset = getProviderPreset(visionProviderOverride);
    if (preset) {
      const apiKey = settings[preset.apiKeySetting];
      if (!apiKey) {
        throw new Error(`多模态覆盖 provider ${preset.label} 的 API key 未配置`);
      }
      return {
        provider: preset,
        model: visionModelOverride,
        apiKey,
        languageModel: buildLanguageModel(preset.protocol, preset.baseUrl, apiKey, visionModelOverride),
      };
    }
  }

  // 无覆盖 → 复用主模型
  const main = resolveLlm(db);

  // 自定义 provider:宽松处理(无法可靠检测,默认支持)
  if (main.provider.id.startsWith("custom-")) {
    return main;
  }

  // 预设 provider:检测 vision 能力
  if (!supportsVision(main.provider, main.model)) {
    throw new Error(
      `当前模型 ${main.model} 不支持看图(vision)。请在设置页的"多模态"区配置一个支持 vision 的模型(如 GLM-4V / GPT-4o / Claude / Gemini)。`,
    );
  }
  return main;
}

/**
 * 检测某 provider + model 是否支持 vision。
 * 规则:预设的 models 列表里该 model 的 capabilities 含 "vision" → 支持。
 * 找不到 model 条目时宽松返回 true(新模型可能还没登记 capabilities)。
 */
export function supportsVision(provider: ProviderPreset, model: string): boolean {
  const modelEntry = provider.models.find(
    (m) => m.id === model || m.id.toLowerCase() === model.toLowerCase(),
  );
  if (!modelEntry) return true; // 宽松:没登记的模型默认支持(防误拦新模型)
  return (modelEntry.capabilities ?? []).includes("vision");
}

/**
 * 渲染层用：返回"当前 provider 是否就绪"（布尔，不含 key）。
 * 走 IPC 时渲染层只能看到这个布尔，符合密钥边界。
 * 自定义 provider：只要表里有行就 ready（本地模型可以没 key）。
 */
export function isLlmReady(db: Db): {
  ready: boolean;
  provider?: string;
  model?: string;
  missing?: string;
} {
  const settings = readSettingsMap(db);
  const activeProvider = settings.active_provider ?? "glm";

  if (activeProvider.startsWith("custom-")) {
    const raw = getCustomProviderRaw(db, activeProvider);
    if (!raw) {
      return { ready: false, provider: activeProvider, missing: `自定义 provider 不存在: ${activeProvider}` };
    }
    return {
      ready: true,
      provider: raw.id,
      model: settings.active_model ?? raw.defaultModel,
    };
  }

  const cfg = resolveProviderConfig(settings);
  return {
    ready: cfg.ready,
    provider: cfg.provider?.id,
    model: cfg.model,
    missing: cfg.missing,
  };
}

/**
 * 测试连接 —— 发一条最小请求验证 key + model + 网络是否通。
 *
 * 用户在 Settings 页保存 key 后可点"测试连接"，避免"配了 key 但直到发消息才发现是坏的"。
 * 用 generateText 发 "ping" 一字请求。
 *
 * @returns ok=true 时附 model 回声；ok=false 时附可读的中文错误分类
 */
export async function testLlmConnection(
  db: Db,
): Promise<{ ok: boolean; detail: string; errorKind?: LlmErrorKind }> {
  let llm: ResolvedLlm;
  try {
    llm = resolveLlm(db);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), errorKind: "not-configured" };
  }
  return testLlmDirect(
    llm.provider.protocol,
    llm.provider.baseUrl,
    llm.apiKey,
    llm.model,
    llm.provider.label,
  );
}

/**
 * 测试自定义 provider 配置（不保存，临时验证）。
 * 给 Settings 页"添加自定义 provider"时的"测试"按钮用。
 */
export async function testCustomProvider(input: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  label: string;
}): Promise<{
  ok: boolean;
  detail: string;
  models?: { id: string; label: string; contextWindow: null }[];
  errorKind?: LlmErrorKind;
}> {
  const apiKey = input.apiKey || "no-key-needed";
  const result = await testLlmDirect(
    input.protocol,
    input.baseUrl,
    apiKey,
    input.defaultModel,
    input.label,
  );
  return result;
}

/** 内部：直接用 protocol/baseUrl/key/model 发 ping 请求 */
async function testLlmDirect(
  protocol: ProviderProtocol,
  baseUrl: string | undefined,
  apiKey: string,
  model: string,
  label: string,
): Promise<{ ok: boolean; detail: string; errorKind?: LlmErrorKind }> {
  try {
    const languageModel = buildLanguageModel(protocol, baseUrl, apiKey, model);
    const result = await generateText({
      model: languageModel,
      prompt: "ping",
    });
    const text = (result.text ?? "").trim().slice(0, 50);
    return {
      ok: true,
      detail: `连接成功（${label} · ${model}${text ? ` · 回声: ${text}` : ""}）`,
    };
  } catch (e) {
    const classified = classifyLlmError(e);
    return { ok: false, detail: classified.detail, errorKind: classified.kind };
  }
}

/** LLM 错误分类（给 UI 不同 UX） */
export type LlmErrorKind =
  | "auth" // 401/403 key 无效
  | "rate-limit" // 429
  | "network" // DNS/超时/连接拒绝
  | "not-configured" // 没配 key
  | "unknown";

/** 把原始异常分类成可读错误 */
export function classifyLlmError(e: unknown): {
  kind: LlmErrorKind;
  detail: string;
} {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();

  // 401 / 403 / invalid api key / unauthorized
  if (
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg) ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication") ||
    lower.includes("permission_denied")
  ) {
    return {
      kind: "auth",
      detail: `API key 无效或权限不足（401/403）。请检查 key 是否正确、是否过期。`,
    };
  }

  // 429 / rate limit / quota
  if (
    /\b429\b/.test(msg) ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("too many requests")
  ) {
    return {
      kind: "rate-limit",
      detail: `请求太频繁或额度用完（429）。请稍后再试，或检查账号余额。`,
    };
  }

  // 网络类: ENOTFOUND / ECONNREFUSED / ETIMEDOUT / fetch failed / network
  if (
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("getaddrinfo") ||
    lower.includes("socket hang up")
  ) {
    return {
      kind: "network",
      detail: `网络错误：无法连接到 ${lower.includes("enotfound") ? "（DNS 解析失败，检查网络/代理）" : "服务端"}。`,
    };
  }

  return { kind: "unknown", detail: msg };
}

/**
 * OpenRouter 模型自动发现 —— 公开 API，无需 key。
 *
 * 调 GET https://openrouter.ai/api/v1/models 获取所有可用模型列表。
 * 拉取完整字段: context/pricing/capabilities/modality（忠于 OpenRouter API schema）。
 * 用户在 Settings 页点"🔄 刷新模型列表"时调用。
 */
export async function fetchOpenRouterModels(
  limit = 50,
): Promise<{
  ok: boolean;
  models?: {
    id: string;
    label: string;
    contextWindow: number | null;
    pricing?: { input: number | null; output: number | null };
    capabilities?: string[];
    inputModalities?: string[];
  }[];
  error?: string;
}> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const d = (await r.json()) as {
      data: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[] };
        supported_parameters?: string[];
      }>;
    };
    const models = (d.data || [])
      .slice(0, limit)
      .map((m) => {
        // 解析 pricing（OpenRouter 返回的是 per-token USD 字符串，转成 per-million）
        let pricing: { input: number | null; output: number | null } | undefined;
        if (m.pricing) {
          const input = m.pricing.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : null;
          const output = m.pricing.completion ? parseFloat(m.pricing.completion) * 1_000_000 : null;
          if (input !== null || output !== null) {
            pricing = { input, output };
          }
        }
        // 解析 capabilities
        const caps: string[] = ["chat"];
        if (m.supported_parameters?.includes("tools")) caps.push("tools");
        if (m.supported_parameters?.includes("reasoning")) caps.push("reasoning");
        if (m.architecture?.input_modalities?.includes("image")) caps.push("vision");

        return {
          id: m.id,
          label: m.name || m.id,
          contextWindow: m.context_length ?? null,
          pricing,
          capabilities: caps,
          inputModalities: m.architecture?.input_modalities,
        };
      });
    return { ok: true, models };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Provider 直连模型发现 —— 用用户已配的 key 拉取该 provider 的 /v1/models。
 *
 * 适用于: 用户配了某个 provider 的 key，想看该 provider 有哪些可用模型。
 * OpenAI/DeepSeek/Kimi/Qwen 等都支持 GET /v1/models（OpenAI 兼容标准）。
 */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
): Promise<{
  ok: boolean;
  models?: { id: string; label: string }[];
  error?: string;
}> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const d = (await r.json()) as {
      data?: Array<{ id: string }>;
      models?: Array<{ id: string }>;
    };
    const list = d.data || d.models || [];
    return {
      ok: true,
      models: list.map((m) => ({ id: m.id, label: m.id })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


