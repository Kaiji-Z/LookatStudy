/**
 * 预设 overlay 的纯操作(主进程 model-overlay 服务与渲染层共用,单一实现防漂移)。
 *
 * 渲染层流程:getModelOverlay() → addToOverlay()/removeFromOverlay() 纯变换 →
 * setModelOverlay() 整体写回 —— 服务端 setOverlay 仍过归一化闸门(已知预设键、
 * 字段校验),客户端算错也写不进垃圾。
 */
import type { ModelOverlay, ProviderModelInfo } from "./types.js";

/** 向某预设追加模型(overlay 内按 id 大小写不敏感去重;与策展清单的去重由
 *  mergePresetModelList 在合并出口做,overlay 里留着同 id 条目无害且不显示)。 */
export function addToOverlay(
  overlay: ModelOverlay,
  presetId: string,
  models: ProviderModelInfo[],
  fetchedAt = new Date().toISOString(),
): ModelOverlay {
  const existing = overlay[presetId]?.added ?? [];
  const existingIds = new Set(existing.map((m) => m.id.toLowerCase()));
  const added = [...existing];
  for (const m of models) {
    if (!m.id) continue;
    const key = m.id.toLowerCase();
    if (existingIds.has(key)) continue;
    existingIds.add(key);
    added.push(m);
  }
  return { ...overlay, [presetId]: { added, fetchedAt } };
}

/** 从某预设的 overlay 删除一个模型(删光则移除键)。 */
export function removeFromOverlay(overlay: ModelOverlay, presetId: string, modelId: string): ModelOverlay {
  const entry = overlay[presetId];
  if (!entry) return overlay;
  const added = entry.added.filter((m) => m.id.toLowerCase() !== modelId.toLowerCase());
  if (added.length === entry.added.length) return overlay;
  const next = { ...overlay };
  if (added.length === 0) delete next[presetId];
  else next[presetId] = { ...entry, added };
  return next;
}
