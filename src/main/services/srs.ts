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
import { eq, lte } from "drizzle-orm";
import type { ReviewQuality } from "@shared/types";
import { randomUUID } from "node:crypto";
// 纯算法抽出到 ./pure/sm2.ts，让测试可直接 import 真实源码（不走 DB/electron）
import { computeSm2 } from "./pure/sm2.js";

// re-export：业务代码（ipc）从 srs.ts 取 computeSm2，测试从 pure/sm2.ts 取——同一个函数
export { computeSm2 };

/**
 * 记录一次复习，更新 SM-2 状态
 */
export function recordReview(nodeId: string, quality: ReviewQuality): void {
  const db = getDb();
  const existing = db
    .select()
    .from(srsItems)
    .where(eq(srsItems.nodeId, nodeId))
    .get();

  const prev = existing
    ? {
        easeFactor: existing.easeFactor / 100,
        intervalDays: existing.intervalDays,
        repetitions: existing.repetitions,
      }
    : { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };

  const result = computeSm2(prev, quality);

  if (existing) {
    db.update(srsItems)
      .set({
        easeFactor: Math.round(result.easeFactor * 100),
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        dueAt: result.dueAt,
        lastReviewedAt: new Date().toISOString(),
      })
      .where(eq(srsItems.id, existing.id))
      .run();
  } else {
    db.insert(srsItems)
      .values({
        id: randomUUID(),
        nodeId,
        easeFactor: Math.round(result.easeFactor * 100),
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        dueAt: result.dueAt,
        lastReviewedAt: new Date().toISOString(),
      })
      .run();
  }
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
