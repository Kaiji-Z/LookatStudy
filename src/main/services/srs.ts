/**
 * SM-2 间隔重复算法 —— Anki 同款，公开规范。
 *
 * 调研结论：v0.1 用 SM-2 而不是多邻国的 HLR（half-life regression），
 * 因为 HLR 需要海量用户数据才能拟合权重，SM-2 是 item-agnostic 的稳定替代。
 *
 * 算法参考：https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
 *
 * quality: 0-5（学习者自评或练习正确率映射）
 *   0-2: 答错，重置 repetitions=0，interval=1
 *   3: 勉强对，interval 不变
 *   4-5: 答对，推进 repetitions，interval 增长
 *
 * easeFactor: 1.3 ~ 3.0，初始 2.5
 *   存 DB 时乘 100 用整数（避免浮点）
 */
import { getDb, markDirty } from "../db/index.js";
import { srsItems } from "../db/schema.js";
import { lte } from "drizzle-orm";
import type { ReviewQuality } from "@shared/types";
// 纯算法抽出到 ./pure/sm2.ts，让测试可直接 import 真实源码（不走 DB/electron）
import { computeSm2 } from "./pure/sm2.js";
// P2: recordReviewDb 抽到 pure/(不触 electron),verify 脚本可直接 import 测 BKT↔SRS 闭环
import { recordReviewDb } from "./pure/srs-db.js";

// re-export：业务代码（ipc）从 srs.ts 取 computeSm2，测试从 pure/sm2.ts 取——同一个函数
export { computeSm2 };

/**
 * 记录一次复习，更新 SM-2 状态（进程级包装：用全局 db + markDirty）。
 * 真实逻辑在 ./pure/srs-db.ts 的 recordReviewDb（db 注入，headless 可测）。
 */
export function recordReview(nodeId: string, quality: ReviewQuality): void {
  recordReviewDb(getDb(), nodeId, quality);
  markDirty();
}

/**
 * 查询今天到期的复习项
 */
export function getDueReviewNodeIds(now: Date = new Date()): string[] {
  const db = getDb();
  const rows = db
    .select({ nodeId: srsItems.nodeId })
    .from(srsItems)
    .where(lte(srsItems.dueAt, now.toISOString()))
    .all();
  return rows.map((r: { nodeId: string }) => r.nodeId);
}

/**
 * v0.2: 查询所有 SRS 项的详细信息(供四象限分组)。
 * 返回每个复习项的 nodeId + intervalDays + repetitions + dueAt + 是否逾期。
 *
 * 四象限分组逻辑(渲染层做,这里只供数据):
 *   - overdue: dueAt <= now
 *   - short-term: intervalDays <= 7(近期巩固)
 *   - long-term: intervalDays > 7(长期记忆)
 *   - inactive: repetitions === 0(从未复习过,但有 srs 记录——通常不会出现)
 */
export interface SrsItemDetail {
  nodeId: string;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
  overdue: boolean;
}

export function getAllSrsItems(now: Date = new Date()): SrsItemDetail[] {
  const db = getDb();
  const nowIso = now.toISOString();
  const rows = db
    .select()
    .from(srsItems)
    .all();
  return rows.map((r) => ({
    nodeId: r.nodeId,
    intervalDays: r.intervalDays,
    repetitions: r.repetitions,
    dueAt: r.dueAt,
    overdue: r.dueAt <= nowIso,
  }));
}
