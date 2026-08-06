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
 */
function buildLanguageModel(
  protocol: ProviderProtocol,
  baseUrl: string | undefined,
  apiKey: string,
  model: string,
): LanguageModel {
  switch (protocol) {
    case "openai-compatible": {
      if (!baseUrl) {
        throw new Error(`openai-compatible 协议需要 baseUrl`);
      }
      const openai = createOpenAI({ baseURL: baseUrl, apiKey });
      return openai.chat(model);
    }
    case "anthropic": {
      // Anthropic 允许自定义 baseURL（覆盖官方端点，如代理）
      const opts: { apiKey: string; baseURL?: string } = { apiKey };
      if (baseUrl) opts.baseURL = baseUrl;
      const anthropic = createAnthropic(opts);
      return anthropic(model);
    }
    case "google": {
      const opts: { apiKey: string; baseURL?: string } = { apiKey };
      if (baseUrl) opts.baseURL = baseUrl;
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
