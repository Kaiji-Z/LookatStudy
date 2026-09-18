/**
 * 模型目录 —— 元数据供给链的合并中枢。
 *
 * 三层来源,合并原则「填充不覆盖,目录只补元数据不改可见性」:
 *   L3 用户声明(overlay 添加的预设模型 / custom modelsJson 条目) —— 最权威
 *   L2 目录(运行时刷新缓存 settings.model_catalog_cache,新者胜;
 *      否则构建期快照 src/main/assets/model-catalog.json,离线常备)
 *   L1 预设策展(llm-presets.ts,手工核证,verify 套件钉死) —— 策展值永远胜目录
 *
 * 合并语义细节:
 *   - contextWindow/pricing: user > 策展 > 目录 > null(目录只填 null,绝不改策展值
 *     —— supportsVision 口径与 verify-context-usage 钉的窗口值都不能被社区数据翻案);
 *   - capabilities: 有策展条目时策展即真相(手工核证过);无策展时用户声明次之,
 *     再从目录布尔推导(tools/reasoning/vision);
 *   - 快照缺失 = 空目录优雅降级(目录是增强层,永不阻塞启动,与 seed 不同)。
 *
 * 两个收口接线:llm-client.resolveActiveContextWindow(用量表+历史预算)与
 * ipc getProviderPresets(渲染层统一视图)都吃本模块,单一真源防漂移。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { settings as settingsTable } from "../../db/schema.js";
import { getProviderPreset, type ModelOption, type ProviderPreset } from "./llm-presets.js";
import { getOverlay, mergePresetModelList, type ModelOverlayEntry } from "./model-overlay.js";
import { getCustomProvider } from "../custom-provider-service.js";
import type { CatalogModelEntry, ModelCatalog } from "./modelsdev-map.js";
import type { ModelMetaView, ProviderModelInfo } from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

export const MODEL_CATALOG_CACHE_KEY = "model_catalog_cache";
export type { CatalogModelEntry, ModelCatalog };

/* ---------- 快照加载(多候选 walker,seed.ts 同款;缺失=空目录,不抛) ---------- */

let snapshotCache: ModelCatalog | undefined;

export function loadSnapshotCatalog(): ModelCatalog {
  if (snapshotCache !== undefined) return snapshotCache;
  const fileName = "model-catalog.json";
  // 候选按本文件位置(services/agent/,比 seed.ts 深一层)校准:
  //  - 便携束:与 server.cjs 并排;打包后:vite emit 进 <outdir>/main/assets/
  //  - tsx 直跑(verify):src/main/services/agent → 上两级到 src/main/assets
  //  - dev vite 构建:dist-electron/main → 上两级到项目根再进 src/main/assets
  const candidates = [
    join(__dirname, fileName),
    join(__dirname, "..", "..", "assets", fileName),
    join(__dirname, "..", "..", "src", "main", "assets", fileName),
    join(__dirname, "assets", fileName),
  ];
  let lastErr: unknown = null;
  for (const p of candidates) {
    try {
      const parsed = coerceCatalog(JSON.parse(readFileSync(p, "utf8")));
      if (parsed) {
        snapshotCache = parsed;
        return parsed;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  // ESM __dirname 兜底(主进程是 CJS,但有 tsx 直跑场景)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const parsed = coerceCatalog(
      JSON.parse(readFileSync(join(here, "..", "..", "assets", fileName), "utf8")),
    );
    if (parsed) {
      snapshotCache = parsed;
      return parsed;
    }
  } catch {
    // fallthrough
  }
  // 目录是增强层:文件缺失/损坏一律空目录降级,不阻塞任何功能。
  console.warn(`[model-catalog] 快照未找到或不可解析(候选: ${candidates.join("; ")}) — 以空目录运行。lastErr=${String(lastErr)}`);
  snapshotCache = { fetchedAt: "", providers: {} };
  return snapshotCache;
}

/** 轻校验:形状对就当目录用(刷新链路存的已是 normalizeModelsDevApi 的产物)。 */
function coerceCatalog(v: unknown): ModelCatalog | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<ModelCatalog>;
  if (!c.providers || typeof c.providers !== "object") return null;
  return { fetchedAt: typeof c.fetchedAt === "string" ? c.fetchedAt : "", providers: c.providers };
}

/** 当前生效目录:刷新缓存(新者胜)> 快照。读侧不做 TTL —— 过期缓存仍优于旧快照。 */
export function getActiveCatalog(db: Db): ModelCatalog {
  const snapshot = loadSnapshotCatalog();
  try {
    const row = db.select().from(settingsTable).where(eq(settingsTable.key, MODEL_CATALOG_CACHE_KEY)).get();
    if (row?.value) {
      const parsed = JSON.parse(row.value) as { payload?: unknown };
      const cached = coerceCatalog(parsed?.payload);
      if (cached && cached.fetchedAt && (!snapshot.fetchedAt || cached.fetchedAt > snapshot.fetchedAt)) {
        return cached;
      }
    }
  } catch {
    /* 坏缓存当无 */
  }
  return snapshot;
}

/* ---------- 目录查找 ---------- */

const lower = (s: string) => s.toLowerCase();

/** 预设作用域查找(键为小写 model id)。 */
export function catalogEntryFor(catalog: ModelCatalog, presetId: string, modelId: string): CatalogModelEntry | null {
  return catalog.providers[presetId]?.models[lower(modelId)] ?? null;
}

/** 跨 provider 全局精确查找(小写全等;仅供 custom provider 的发现回填,不做家族猜测)。 */
export function catalogEntryGlobal(catalog: ModelCatalog, modelId: string): CatalogModelEntry | null {
  const key = lower(modelId);
  for (const p of Object.values(catalog.providers)) {
    const hit = p.models[key];
    if (hit) return hit;
  }
  return null;
}

/* ---------- 三层合并(纯函数,verify 直测) ---------- */

export interface ModelMetaInput {
  /** 用户声明条目(overlay 添加的预设模型 / custom modelsJson 条目) */
  user?: ProviderModelInfo | null;
  /** 预设策展条目(存在即真相:capabilities/上下文/价格不被目录翻案) */
  preset?: ModelOption | null;
  /** 目录条目(填充层) */
  catalog?: CatalogModelEntry | null;
}

export function mergeModelMeta(input: ModelMetaInput): ModelMetaView {
  const { user, preset, catalog } = input;
  const contextWindow = user?.contextWindow ?? preset?.contextWindow ?? catalog?.contextWindow ?? null;
  const pricing = user?.pricing ?? preset?.pricing ?? catalog?.pricing ?? null;

  let capabilities: string[] | null = null;
  if (preset) {
    capabilities = preset.capabilities ?? null;
  } else if (user?.capabilities && user.capabilities.length > 0) {
    capabilities = user.capabilities;
  } else {
    const caps = ["chat"];
    if (catalog?.tools) caps.push("tools");
    if (catalog?.reasoning || user?.reasoning) caps.push("reasoning");
    if (catalog?.vision) caps.push("vision");
    capabilities = caps;
  }

  const reasoning = preset
    ? preset.capabilities?.includes("reasoning") ?? null
    : user?.reasoning ?? catalog?.reasoning ?? null;
  const free =
    preset?.free ??
    user?.free ??
    (pricing !== null && pricing.input === 0 && pricing.output === 0 ? true : null);
  const status = catalog?.status ?? user?.status ?? null;
  const source = user ? "user" : preset ? "preset" : catalog ? "catalog" : "none";

  return { contextWindow, pricing, capabilities, reasoning, free, status, source };
}

/* ---------- db 感知解析(收口接线用) ---------- */

const findByModelId = <T extends { id: string }>(models: T[], modelId: string): T | null =>
  models.find((m) => m.id === modelId || lower(m.id) === lower(modelId)) ?? null;

/**
 * 解析任意 provider+model 的合并元数据;全未知 → null(诚实未知)。
 * custom provider:modelsJson 条目为用户声明层,目录做全局精确回填;
 * 预设:策展 ∪ overlay 条目为声明层,目录按预设作用域回填。
 */
export function resolveModelMeta(db: Db, providerId: string, modelId: string): ModelMetaView | null {
  if (!providerId || !modelId) return null;
  const catalog = getActiveCatalog(db);

  if (providerId.startsWith("custom-")) {
    const cp = getCustomProvider(db, providerId);
    const user = cp ? findByModelId(cp.models, modelId) : null;
    const meta = mergeModelMeta({ user, catalog: catalogEntryGlobal(catalog, modelId) });
    return meta.source === "none" ? null : meta;
  }

  const preset = getProviderPreset(providerId);
  if (!preset) return null;
  const curated = findByModelId(preset.models, modelId);
  const overlayEntry = getOverlay(db)[providerId];
  const user = curated ? null : overlayEntry ? findByModelId(overlayEntry.added, modelId) : null;
  const meta = mergeModelMeta({ user, preset: curated, catalog: catalogEntryFor(catalog, providerId, modelId) });
  return meta.source === "none" ? null : meta;
}

/**
 * 预设的生效模型列表(策展 ∪ overlay,目录填元数据) —— getProviderPresets 出口的
 * 服务端统一视图,渲染层零合并逻辑。
 */
export function effectivePresetModels(db: Db, preset: ProviderPreset): ProviderModelInfo[] {
  const catalog = getActiveCatalog(db);
  const overlayEntry: ModelOverlayEntry | undefined = getOverlay(db)[preset.id];
  const merged = mergePresetModelList(preset, overlayEntry);
  return merged.map((entry) => {
    const curated = findByModelId(preset.models, entry.id) !== null;
    const user = curated ? null : overlayEntry ? findByModelId(overlayEntry.added, entry.id) : null;
    const meta = mergeModelMeta({
      user,
      preset: curated ? entry : null,
      catalog: catalogEntryFor(catalog, preset.id, entry.id),
    });
    return {
      id: entry.id,
      label: entry.label,
      contextWindow: meta.contextWindow,
      ...(meta.capabilities ? { capabilities: meta.capabilities } : {}),
      ...(meta.pricing ? { pricing: meta.pricing } : {}),
      ...(meta.reasoning !== null ? { reasoning: meta.reasoning } : {}),
      ...(meta.free !== null ? { free: meta.free } : {}),
      ...(meta.status ? { status: meta.status } : {}),
    };
  });
}

/** 预设 + overlay 合成完整 ProviderPreset(resolveLlm/context-usage 的 supportsVision 查表用)。 */
export function presetWithOverlay(db: Db, preset: ProviderPreset): ProviderPreset {
  const overlayEntry = getOverlay(db)[preset.id];
  if (!overlayEntry || overlayEntry.added.length === 0) return preset;
  return { ...preset, models: mergePresetModelList(preset, overlayEntry) };
}
