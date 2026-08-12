/**
 * SRS DB 写入(db 注入,headless 可测)—— SM-2 状态落库。
 *
 * 从 srs.ts 抽出到 pure/ 的原因:srs.ts import 了 db/index.js(其 `import { app } from "electron"`
 * 让 tsx/纯 node 无法加载)。本文件只依赖 schema + drizzle + 纯算法 computeSm2,不触 electron,
 * verify-srs-bkt-loop.mjs 可直接 import 真实源码(VERIFICATION §3.1 红线:断言落在真实源码上)。
 *
 * P2 闭环(BKT 掌握度 ↔ SRS 复习调度)的 SRS 侧:答对推迟 dueAt,答错重置到 1 天后近期重练。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { randomUUID } from "node:crypto";
import * as schema from "../../db/schema.js";
import type { ReviewQuality } from "@shared/types";
import { computeSm2 } from "./sm2.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 记录一次复习,更新 SM-2 状态(db 注入)。
 * 与 srs.ts 的 recordReview(进程级,用全局 db + markDirty)同逻辑;本函数供 verify 脚本与
 * 任何持有 db 实例的调用方使用。
 */
export function recordReviewDb(db: Db, nodeId: string, quality: ReviewQuality): void {
  const existing = db
    .select()
    .from(schema.srsItems)
    .where(eq(schema.srsItems.nodeId, nodeId))
    .get();

  const prev = existing
    ? {
        easeFactor: existing.easeFactor / 100,
        intervalDays: existing.intervalDays,
        repetitions: existing.repetitions,
      }
    : { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };

  const result = computeSm2(prev, quality);
  const nowIso = new Date().toISOString();

  if (existing) {
    db.update(schema.srsItems)
      .set({
        easeFactor: Math.round(result.easeFactor * 100),
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        dueAt: result.dueAt,
        lastReviewedAt: nowIso,
      })
      .where(eq(schema.srsItems.id, existing.id))
      .run();
  } else {
    db.insert(schema.srsItems)
      .values({
        id: randomUUID(),
        nodeId,
        easeFactor: Math.round(result.easeFactor * 100),
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        dueAt: result.dueAt,
        lastReviewedAt: nowIso,
      })
      .run();
  }
}
