/**
 * mastery-cap —— AI 观测封顶纯函数(2026-09-13 审计后续 · IP3)。
 *
 * 信任模型:update_mastery 提议的"答题观测"可能来自 AI 对话里的判定(用户口头回答,
 * AI 认为对/错),不是人手点选项的确定性判分。纯 AI 观测不该单方面把学习者推到
 * 毕业(≥0.9 自动 mastered + 皇冠 + XP)——那是"防假毕业"的红线(floorAllKcMastery
 * 同款语义的温和版)。一旦节点有过**人工观测**(quiz 产物点选/exercise 提交判分),
 * 封顶解除:人参与过的节点,BKT 按真实观测累积。
 *
 * 纯函数零依赖,verify 直测;读写标记的 db 侧在 services/human-observation.ts。
 */
import { MASTERED_MASTERY_THRESHOLD } from "@shared/types";

/** 纯 AI 观测(无人工观测标记)下,单次/累计掌握度写入的封顶值。 */
export const AI_MASTERY_CAP = 0.85;

/** 人工观测标记的 settings key(按节点)。 */
export function humanObsKey(nodeId: string): string {
  return `human_obs:${nodeId}`;
}

/**
 * 封顶:有人工观测 → 原值;无 → min(原值, AI_MASTERY_CAP)。
 * prev(当前已存值)参与封顶线:已存值高于封顶(legacy 库在功能上线前的累积)时
 * 只许持平不许回撤——封顶抑制新膨胀,不没收历史。
 */
export function capMasteryValue(value: number, hasHumanObs: boolean, prev?: number): number {
  if (hasHumanObs) return value;
  const ceiling = prev !== undefined ? Math.max(AI_MASTERY_CAP, prev) : AI_MASTERY_CAP;
  return Math.min(value, ceiling);
}

/** 设计不变量:封顶必须低于毕业阈值,否则形同虚设(verify 守)。 */
export function capBelowGraduation(): boolean {
  return AI_MASTERY_CAP < MASTERED_MASTERY_THRESHOLD;
}
