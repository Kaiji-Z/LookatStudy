/**
 * context-usage —— agent:getContextUsage 的实现:给输入框上下文表算"固定开销"。
 *
 * 调 assembleContextBlocks(与 runAgentTurn 实发同一真源)取 system/课文/学习者
 * 三块的真实字符串,用启发式估算 token;再查活动模型的上下文窗口与看图能力。
 * 渲染层拿去后本地叠加对话历史 + 草稿的估算 → 完整表。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type { ContextUsageInfo } from "@shared/types";
import { estimateTokens } from "@shared/token-estimate";
import * as schema from "../../db/schema.js";
import { readSettingsMap, supportsVision } from "./llm-client.js";
import { getProviderPreset } from "./llm-presets.js";
import { assembleContextBlocks } from "./agent-engine.js";

type Db = SQLJsDatabase<typeof schema>;

/** nodeId 不存在 → null(渲染层隐藏表);否则返回三块开销 + 模型窗口/能力。 */
export function getContextUsage(db: Db, nodeId: string, locale?: string | null): ContextUsageInfo | null {
  const blocks = assembleContextBlocks(db, nodeId, locale);
  if (!blocks.node) return null;

  const settings = readSettingsMap(db);
  const providerId = settings.active_provider ?? "glm";
  const preset = getProviderPreset(providerId);
  const model = settings.active_model ?? preset?.defaultModel ?? "";

  let contextWindow: number | null = null;
  let visionCapable = true; // 宽松:未知模型默认支持(与 supportsVision 的口径一致)
  if (preset) {
    const entry = preset.models.find(
      (m) => m.id === model || m.id.toLowerCase() === model.toLowerCase(),
    );
    contextWindow = entry?.contextWindow ?? null;
    visionCapable = supportsVision(preset, model);
  }
  // 自定义 provider:models 列表在渲染层由 listCustomProviders 提供;
  // 这里 modelsJson 不参与解析 —— 窗口未知(null 只显示用量),vision 宽松 true。

  return {
    systemTokens: estimateTokens(blocks.system),
    nodeTokens: estimateTokens(blocks.nodeContext),
    learnerTokens: estimateTokens(blocks.learnerSnapshot ?? ""),
    contextWindow,
    provider: providerId,
    model,
    visionCapable,
  };
}
