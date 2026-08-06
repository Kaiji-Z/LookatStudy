/**
 * 自定义 Provider 服务 —— 用户自建 LLM 端点的 CRUD。
 *
 * 解决预设无法穷举的问题：智谱有 CodingPlan CN/Global + 标准 API CN/Global 四个端点，
 * 任何 provider 都可能有区域端点、计划端点、自建代理。用户自己加 provider + baseUrl + model。
 *
 * 合并逻辑：resolveProviderConfig 先查预设（PROVIDER_PRESETS），找不到再查自定义。
 * 自定义 provider 的 id 形如 "custom-xxx"，与预设 id（glm/openai/...）天然不冲突。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { customProviders } from "../db/schema.js";
import type {
  CustomProvider,
  CustomProviderInput,
  ProviderModelInfo,
} from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

/** 把 DB 行转成 ApiExpose 契约的 CustomProvider（apiKey 只暴露 hasApiKey 布尔） */
function rowToCustomProvider(row: typeof customProviders.$inferSelect): CustomProvider {
  let models: ProviderModelInfo[] = [];
  try {
    if (row.modelsJson) {
      models = JSON.parse(row.modelsJson) as ProviderModelInfo[];
    }
  } catch {
    /* 忽略坏 JSON */
  }
  // 如果 modelsJson 空，用 defaultModel 凑一个
  if (models.length === 0) {
    models = [{ id: row.defaultModel, label: row.defaultModel, contextWindow: null }];
  }
  return {
    id: row.id,
    label: row.label,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    models,
    hasApiKey: !!row.apiKey,
    createdAt: row.createdAt,
  };
}

export function listCustomProviders(db: Db): CustomProvider[] {
  return db.select().from(customProviders).all().map(rowToCustomProvider);
}

export function getCustomProvider(db: Db, id: string): CustomProvider | null {
  const row = db.select().from(customProviders).where(eq(customProviders.id, id)).get();
  return row ? rowToCustomProvider(row) : null;
}

export function createCustomProvider(
  db: Db,
  input: CustomProviderInput,
): CustomProvider {
  const { randomUUID } = require("node:crypto") as { randomUUID: () => string };
  const id = `custom-${randomUUID().slice(0, 8)}`;
  const modelsJson = input.models ? JSON.stringify(input.models) : null;
  db.insert(customProviders)
    .values({
      id,
      label: input.label,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey ?? null,
      defaultModel: input.defaultModel,
      modelsJson,
    })
    .run();
  const row = db.select().from(customProviders).where(eq(customProviders.id, id)).get()!;
  return rowToCustomProvider(row);
}

export function updateCustomProvider(
  db: Db,
  id: string,
  input: Partial<CustomProviderInput>,
): CustomProvider {
  const existing = db.select().from(customProviders).where(eq(customProviders.id, id)).get();
  if (!existing) throw new Error(`自定义 provider 不存在: ${id}`);
  const patch: Partial<typeof customProviders.$inferInsert> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.protocol !== undefined) patch.protocol = input.protocol;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  if (input.apiKey !== undefined) patch.apiKey = input.apiKey || null;
  if (input.defaultModel !== undefined) patch.defaultModel = input.defaultModel;
  if (input.models !== undefined) patch.modelsJson = JSON.stringify(input.models);
  db.update(customProviders).set(patch).where(eq(customProviders.id, id)).run();
  const row = db.select().from(customProviders).where(eq(customProviders.id, id)).get()!;
  return rowToCustomProvider(row);
}

export function deleteCustomProvider(db: Db, id: string): void {
  db.delete(customProviders).where(eq(customProviders.id, id)).run();
}

/**
 * 取自定义 provider 的完整配置（含 apiKey 明文，给 llm-client 用，不暴露给渲染层）。
 */
export function getCustomProviderRaw(
  db: Db,
  id: string,
): { id: string; protocol: string; baseUrl: string; apiKey: string | null; defaultModel: string } | null {
  const row = db.select().from(customProviders).where(eq(customProviders.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    defaultModel: row.defaultModel,
  };
}
