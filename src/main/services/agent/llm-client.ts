/**
 * LLM 客户端 —— 主进程侧，把 provider 预设 + key 变成 AI SDK 的 model 实例。
 *
 * 密钥在这里读取（settings 表），永不离开主进程。渲染层只见"是否配置"的布尔。
 * 用 @ai-sdk/openai 的 createOpenAI（openai-compatible），覆盖 GLM/OpenAI/DeepSeek。
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
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
 * 解析当前激活 provider + 构造 LanguageModel。未配置 key 抛错。
 */
export function resolveLlm(db: Db): ResolvedLlm {
  const cfg = resolveProviderConfig(readSettingsMap(db));
  if (!cfg.ready || !cfg.provider || !cfg.apiKey || !cfg.model) {
    throw new Error(cfg.missing ?? "LLM provider 未就绪");
  }
  // openai-compatible 客户端：自定义 baseURL + apiKey，用 .chat(model) 走 /chat/completions
  // （智谱 GLM / DeepSeek 都兼容这个端点；官方 OpenAI 也支持）
  const openai = createOpenAI({
    baseURL: cfg.provider.baseUrl,
    apiKey: cfg.apiKey,
  });
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
    languageModel: openai.chat(cfg.model),
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
