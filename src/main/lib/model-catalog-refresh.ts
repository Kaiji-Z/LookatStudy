/**
 * 模型目录尽力刷新(2026-09 模型管理升级;设计约束照抄 update-check.ts)。
 *
 * - 失败零打扰:离线/被墙/超时(8s)一律返回 null,绝不弹错 —— 快照已在包里,
 *   刷新只是让价格/上下文/新模型元数据更新鲜。
 * - 24h 结果缓存由 IPC handler 管(settings model_catalog_cache,读侧 getActiveCatalog
 *   永远有目录可用:缓存新者胜,否则快照)。
 * - 4.7MB 的 api.json 用 8s 超时偏紧,但这是"尽力"通道 —— 拉不完就下个 24h 再试。
 */
import {
  normalizeModelsDevApi,
  type ModelCatalog,
  type ModelsDevProvider,
} from "../services/agent/modelsdev-map.js";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const CATALOG_FETCH_TIMEOUT_MS = 8_000;
export const CATALOG_CACHE_TTL_MS = 24 * 3600 * 1000;

export type { ModelCatalog };

/** 拉取并归一化;任何失败(网络/超时/形状坏/映射全空)返回 null。fetchFn 可注入供测试。 */
export async function fetchModelCatalog(fetchFn: typeof fetch = fetch): Promise<ModelCatalog | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CATALOG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(MODELS_DEV_API_URL, { signal: ctrl.signal });
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, ModelsDevProvider>;
      const catalog = normalizeModelsDevApi(raw);
      // 质量闸:映射命中的家数过少视为坏响应(上游改形状/截断),不当目录用。
      if (Object.keys(catalog.providers).length < 8) return null;
      return catalog;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
