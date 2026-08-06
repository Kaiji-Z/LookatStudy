/**
 * 打卡 / Streak 逻辑 —— DB 读写层。
 *
 * 纯状态机逻辑在 ./pure/streak-transition.ts（零依赖，可被测试直接 import）。
 * 本文件 re-export 那个纯函数 + 负责把它应用到 SQLite。
 *
 * 多邻国调研结论：
 * - streak（连续天数）是最强的留存杠杆
 * - Streak Freeze（冻结）让流失率降 21%，每个用户初始送 2 次
 * - 对编程学习，打卡不该惩罚"深度工作日"，所以我们的门槛比多邻国宽松：
 *   任何一次"标记节点 attempted"或"完成一次复习"都算今日打卡
 */
import { getDb, markDirty } from "../db/index.js";
import { streaks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Streak } from "@shared/types";
import {
  computeStreakTransition as computeStreakTransitionPure,
  type StreakState,
} from "./pure/streak-transition.js";

// re-export 纯函数，让 ipc/index.ts 等业务代码用同一入口
export { computeStreakTransitionPure as computeStreakTransition };

export function getStreak(): Streak {
  const db = getDb();
  const row = db.select().from(streaks).where(eq(streaks.id, "singleton")).get();
  if (!row) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: null,
      freezeCount: 2,
    };
  }
  return mapRow(row);
}

/**
 * 今日打卡。幂等：同一天多次调用只计一次。
 *
 * 纯逻辑走 computeStreakTransition（离线可测）；本函数只负责读写 DB。
 */
export function touchStreakToday(now: Date = new Date()): Streak {
  const db = getDb();
  const row = db.select().from(streaks).where(eq(streaks.id, "singleton")).get();
  if (!row) {
    throw new Error("Streak singleton not initialized");
  }

  const current: Streak = mapRow(row);
  const next = computeStreakTransitionPure(current satisfies StreakState, now);

  // 同日幂等：无变化就不写库
  if (
    next.currentStreak === current.currentStreak &&
    next.lastActiveDate === current.lastActiveDate &&
    next.freezeCount === current.freezeCount &&
    next.longestStreak === current.longestStreak
  ) {
    return next;
  }

  db.update(streaks)
    .set({
      currentStreak: next.currentStreak,
      longestStreak: next.longestStreak,
      lastActiveDate: next.lastActiveDate,
      freezeCount: next.freezeCount,
    })
    .where(eq(streaks.id, "singleton"))
    .run();
  markDirty();

  return next;
}

function mapRow(row: {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  freezeCount: number;
}): Streak {
  return {
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    lastActiveDate: row.lastActiveDate,
    freezeCount: row.freezeCount,
  };
}
