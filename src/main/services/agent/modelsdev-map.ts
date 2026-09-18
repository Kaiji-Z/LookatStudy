/**
 * models.dev 供应商映射与归一化 —— 纯数据/纯函数,零 db/零 IO。
 *
 * models.dev 是社区维护的开放模型规格库(opencode 的底座),api.json 按 provider
 * 键组织,每模型带 limit(上下文/输出)/cost(每百万 USD)/reasoning/tool_call/
 * modalities/status 等字段。本文件负责:
 *   1. MODELS_DEV_PROVIDER_MAP:我们的预设 id → models.dev provider 键
 *      (以 baseUrl 精确对准,同家的 cn/global 端点各有其键,不能混);
 *   2. normalizeModelsDevApi:把原始 api.json 裁成 ModelCatalog —— 剥 description
 *      (快照体积大头)、模型键统一小写(与 resolveModelContextWindow 的大小写
 *      不敏感口径对齐)。
 *
 * 生成脚本(scripts/build-model-catalog.mjs,构建期快照)与运行时尽力刷新
 * (src/main/lib/model-catalog-refresh.ts,24h 缓存)共用本模块 —— 映射表只有
 * 这一份,两条供给链永不漂移。
 *
 * 无对应的预设(baidu/baichuan:models.dev 未收录)不进映射表,预设策展兜底,
 * 不影响任何既有行为 —— 目录只补元数据,不改可见性(见 model-catalog.ts)。
 */

/** models.dev api.json 里单个 provider 的原始形状(只声明我们消费的字段)。 */
export interface ModelsDevProvider {
  id?: string;
  name?: string;
  api?: string;
  models?: Record<string, ModelsDevRawModel>;
}

/** models.dev 单模型原始条目(只声明我们消费的字段,其余忽略)。 */
export interface ModelsDevRawModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  modalities?: { input?: string[]; output?: string[] };
  status?: string;
}

/**
 * 预设 id → models.dev provider 键。键名以 2026-09 实测 api.json 为准
 * (222 家 provider;同家的 cn/global 分键,按预设 baseUrl 对号)。
 */
export const MODELS_DEV_PROVIDER_MAP: Record<string, string> = {
  glm: "zhipuai", // open.bigmodel.cn/api/paas/v4
  "glm-codingplan": "zhipuai-coding-plan", // open.bigmodel.cn/api/coding/paas/v4
  deepseek: "deepseek", // api.deepseek.com
  kimi: "moonshotai-cn", // api.moonshot.cn/v1(global 是 moonshotai)
  qwen: "alibaba-cn", // dashscope.aliyuncs.com/compatible-mode/v1(intl 是 alibaba)
  siliconcloud: "siliconflow-cn", // api.siliconflow.cn/v1
  openrouter: "openrouter", // 聚合器:量大但目录只是查找表,不影响可见性
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  groq: "groq",
  together: "togetherai",
  mistral: "mistral",
  xai: "xai",
  volcano: "volcengine", // ark.cn-beijing.volces.com/api/v3
  minimax: "minimax-cn", // 近似对位(我方 api.minimax.chat 旧端点;仅按模型 id 精确命中才生效)
  // 无映射(保留预设策展兜底):baidu、baichuan —— models.dev 未收录
};

/**
 * 归一化后的目录条目(ModelCatalog.providers[presetId].models[小写 model id])。
 * 全字段可缺省 —— 目录是"填充层",没有的字段就是没有,不给假值。
 */
export interface CatalogModelEntry {
  /** models.dev 的显示名(与 id 相同时省略,省体积) */
  label?: string;
  contextWindow: number | null;
  outputLimit: number | null;
  /** 每百万 token USD(来自 models.dev cost) */
  pricing?: { input: number | null; output: number | null };
  reasoning: boolean;
  tools: boolean;
  /** 输入模态含 image */
  vision: boolean;
  /** active / beta / alpha / deprecated(deprecated 给选择器淡化提示) */
  status?: string;
}

export interface ModelCatalog {
  /** 快照/缓存生成时间(ISO) */
  fetchedAt: string;
  /** 键 = 预设 id(经 MODELS_DEV_PROVIDER_MAP 重写) */
  providers: Record<string, { models: Record<string, CatalogModelEntry> }>;
}

/** 任何输入都返回可用目录(缺 provider 静默跳过) —— 目录是增强层,永不抛。 */
export function normalizeModelsDevApi(raw: unknown, fetchedAt = new Date().toISOString()): ModelCatalog {
  const providers: ModelCatalog["providers"] = {};
  if (!raw || typeof raw !== "object") return { fetchedAt, providers };
  const src = raw as Record<string, ModelsDevProvider>;
  for (const [presetId, modelsDevKey] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
    const p = src[modelsDevKey];
    if (!p || typeof p !== "object" || !p.models) continue;
    const models: Record<string, CatalogModelEntry> = {};
    for (const entry of Object.values(p.models)) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) continue;
      const label =
        typeof entry.name === "string" && entry.name && entry.name !== entry.id ? entry.name : undefined;
      const cost = entry.cost;
      const pricing =
        cost && (typeof cost.input === "number" || typeof cost.output === "number")
          ? { input: typeof cost.input === "number" ? cost.input : null, output: typeof cost.output === "number" ? cost.output : null }
          : undefined;
      models[entry.id.toLowerCase()] = {
        ...(label !== undefined ? { label } : {}),
        contextWindow: typeof entry.limit?.context === "number" ? entry.limit.context : null,
        outputLimit: typeof entry.limit?.output === "number" ? entry.limit.output : null,
        ...(pricing !== undefined ? { pricing } : {}),
        reasoning: entry.reasoning === true,
        tools: entry.tool_call === true,
        vision: Array.isArray(entry.modalities?.input) && (entry.modalities?.input ?? []).includes("image"),
        ...(typeof entry.status === "string" && entry.status ? { status: entry.status } : {}),
      };
    }
    providers[presetId] = { models };
  }
  return { fetchedAt, providers };
}
