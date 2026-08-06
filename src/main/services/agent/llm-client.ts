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
} from "./llm-presets.js";

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
 */
function buildLanguageModel(preset: ProviderPreset, apiKey: string, model: string): LanguageModel {
  switch (preset.protocol) {
    case "openai-compatible": {
      if (!preset.baseUrl) {
        throw new Error(`provider ${preset.id} 协议为 openai-compatible 但缺 baseUrl`);
      }
      const openai = createOpenAI({ baseURL: preset.baseUrl, apiKey });
      return openai.chat(model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(model);
    }
    default:
      throw new Error(`未知 protocol: ${(preset as { protocol: string }).protocol}`);
  }
}

/**
 * 解析当前激活 provider + 构造 LanguageModel。未配置 key 抛错。
 */
export function resolveLlm(db: Db): ResolvedLlm {
  const cfg = resolveProviderConfig(readSettingsMap(db));
  if (!cfg.ready || !cfg.provider || !cfg.apiKey || !cfg.model) {
    throw new Error(cfg.missing ?? "LLM provider 未就绪");
  }
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
    languageModel: buildLanguageModel(cfg.provider, cfg.apiKey, cfg.model),
  };
}

/**
 * 渲染层用：返回"当前 provider 是否就绪"（布尔，不含 key）。
 * 走 IPC 时渲染层只能看到这个布尔，符合密钥边界。
 */
export function isLlmReady(db: Db): {
  ready: boolean;
  provider?: string;
  model?: string;
  missing?: string;
} {
  const cfg = resolveProviderConfig(readSettingsMap(db));
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
 * 用 generateText 发 "ping" 一字请求，10s 超时。
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
  try {
    const result = await generateText({
      model: llm.languageModel,
      prompt: "ping",
      // 让 provider 自己算 token；maxOutputTokens 给个最小值省额度
    });
    const text = (result.text ?? "").trim().slice(0, 50);
    return {
      ok: true,
      detail: `连接成功（${llm.provider.label} · ${llm.model}${text ? ` · 回声: ${text}` : ""}）`,
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
