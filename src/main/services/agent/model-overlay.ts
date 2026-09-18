/**
 * 预设 provider 的用户模型 overlay —— settings 表 model_overlay_json 键的结构化通道。
 *
 * 用户对预设 provider 的模型自定义(拉取发现勾选添加 / 手工直填 model id)落在这里;
 * 预设策展清单(llm-presets.ts)永不被改写 —— 服务端在 getProviderPresets 出口做
 * "策展 ∪ overlay.added"合并,ModelPicker/设置页/resolveProviderConfig 吃同一视图。
 *
 * 惯例照 learner_profile:get 宽松解析(坏 JSON → 空 overlay),set 先归一化再落库,
 * DB 里永远只存合法 JSON。纯函数(parseOverlay/normalizeOverlay/mergePresetModelList)
 * 与 db 读写分离,verify 直测纯函数。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { settings as settingsTable } from "../../db/schema.js";
import { PROVIDER_PRESETS, type ProviderPreset, type ModelOption } from "./llm-presets.js";
import type { ProviderModelInfo } from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

export const MODEL_OVERLAY_SETTING_KEY = "model_overlay_json";

/** 单个预设的 overlay。added = 用户追加的模型(策展清单之外);fetchedAt 仅记录。 */
export interface ModelOverlayEntry {
  added: ProviderModelInfo[];
  fetchedAt?: string;
}

/** 键 = 预设 id(仅已知预设;归一化时丢弃未知键,防垃圾堆积)。 */
export type ModelOverlay = Record<string, ModelOverlayEntry>;

/** 宽松解析:任何输入都返回可用 overlay(坏 JSON/坏形状 → 空)。 */
export function parseOverlay(raw: string | null | undefined): ModelOverlay {
  if (!raw) return {};
  try {
    return normalizeOverlay(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** 归一化:只保留已知预设键,条目字段逐项校验,坏值丢弃。上限防病态输入。 */
export function normalizeOverlay(input: unknown): ModelOverlay {
  const known = new Set(PROVIDER_PRESETS.map((p) => p.id));
  const out: ModelOverlay = {};
  if (!input || typeof input !== "object") return out;
  for (const [presetId, entry] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(presetId)) continue;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { added?: unknown; fetchedAt?: unknown };
    const added = normalizeOverlayModels(e.added);
    if (added.length === 0) continue; // 空条目不落库(删光 = 删键)
    out[presetId] = {
      added,
      ...(typeof e.fetchedAt === "string" && e.fetchedAt ? { fetchedAt: e.fetchedAt } : {}),
    };
  }
  return out;
}

/** 模型条目列表归一化(overlay 与 custom modelsJson 共用同一形状纪律)。 */
export function normalizeOverlayModels(input: unknown): ProviderModelInfo[] {
  if (!Array.isArray(input)) return [];
  const out: ProviderModelInfo[] = [];
  for (const item of input.slice(0, 200)) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (typeof m.id !== "string" || !m.id.trim()) continue;
    const id = m.id.trim().slice(0, 200);
    const label = typeof m.label === "string" && m.label.trim() ? m.label.trim().slice(0, 200) : id;
    const contextWindow = typeof m.contextWindow === "number" && Number.isFinite(m.contextWindow)
      ? Math.max(0, Math.round(m.contextWindow))
      : null;
    const capabilities = Array.isArray(m.capabilities)
      ? m.capabilities.filter((c): c is string => typeof c === "string" && /^[a-z-]{1,24}$/.test(c)).slice(0, 12)
      : undefined;
    const pricingRaw = m.pricing as { input?: unknown; output?: unknown } | undefined;
    const pricing =
      pricingRaw && typeof pricingRaw === "object" &&
      (typeof pricingRaw.input === "number" || typeof pricingRaw.output === "number")
        ? {
            input: typeof pricingRaw.input === "number" && Number.isFinite(pricingRaw.input) ? pricingRaw.input : null,
            output: typeof pricingRaw.output === "number" && Number.isFinite(pricingRaw.output) ? pricingRaw.output : null,
          }
        : undefined;
    out.push({
      id,
      label,
      contextWindow,
      ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(m.reasoning === true ? { reasoning: true } : {}),
      ...(m.free === true ? { free: true } : {}),
      ...(typeof m.status === "string" && m.status ? { status: m.status.slice(0, 24) } : {}),
    });
  }
  return out;
}

export function getOverlay(db: Db): ModelOverlay {
  const row = db.select().from(settingsTable).where(eq(settingsTable.key, MODEL_OVERLAY_SETTING_KEY)).get();
  return parseOverlay(row?.value ?? null);
}

/** 整体写入(归一化后;空 overlay 写空对象保持键存在感无意义,直接写 "{}")。 */
export function setOverlay(db: Db, overlay: ModelOverlay): void {
  const normalized = normalizeOverlay(overlay);
  const value = JSON.stringify(normalized);
  db.insert(settingsTable)
    .values({ key: MODEL_OVERLAY_SETTING_KEY, value, isSecret: false })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, isSecret: false } })
    .run();
}

/**
 * 纯合并:预设策展清单 ∪ overlay.added(策展在前保持原序,overlay 追加在后;
 * 同 id 大小写不敏感时策展胜,overlay 不重复出现)。
 */
export function mergePresetModelList(preset: ProviderPreset, overlayEntry: ModelOverlayEntry | undefined): ModelOption[] {
  const merged: ModelOption[] = [...preset.models];
  const seen = new Set(preset.models.map((m) => m.id.toLowerCase()));
  for (const m of overlayEntry?.added ?? []) {
    const key = m.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow,
      ...(m.capabilities ? { capabilities: m.capabilities } : {}),
      ...(m.pricing ? { pricing: m.pricing } : {}),
      ...(m.free !== undefined ? { free: m.free } : {}),
    });
  }
  return merged;
}
