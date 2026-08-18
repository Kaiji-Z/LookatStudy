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
import { getProviderPreset, resolveModelContextWindow } from "./llm-presets.js";
import { getCustomProvider } from "../custom-provider-service.js";
import { getVisionOverride } from "./vision-bridge.js";
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
    contextWindow = resolveModelContextWindow(preset.models, model);
    visionCapable = supportsVision(preset, model);
  } else if (providerId.startsWith("custom-")) {
    // 自定义 provider:窗口来自 modelsJson 里该模型的 contextWindow(设置页可编辑;
    // OpenRouter 发现时自动带回 context_length,其余家 /models 不含窗口需手填)。
    // 查不到就 null —— 用量表诚实显示"未知",不做会误导占比的家族猜测。
    const cp = getCustomProvider(db, providerId);
    if (cp) {
      contextWindow = resolveModelContextWindow(cp.models, model);
    }
  }

  // v0.11 图像桥:主模型不支持看图但配了 vision 覆盖 → 图片放行,走"视觉模型转译→注入"桥。
  // visionBridgeModel 非空时渲染层在附件区提示"图片将由 X 转译"。
  const override = getVisionOverride(db);
  const bridged = !visionCapable && override !== null;

  return {
    systemTokens: estimateTokens(blocks.system),
    nodeTokens: estimateTokens(blocks.nodeContext),
    learnerTokens: estimateTokens(blocks.learnerSnapshot ?? ""),
    contextWindow,
    provider: providerId,
    model,
    visionCapable: visionCapable || override !== null,
    visionBridgeModel: bridged ? override!.model : null,
  };
}
