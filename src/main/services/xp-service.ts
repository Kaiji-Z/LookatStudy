/**
 * XP（经验值）系统 —— 追踪学习者的每日学习量。
 *
 * 设计:
 *   - 答对一题 +10 XP，答错 +1 XP（鼓励尝试）
 *   - 完成一课 +50 XP（mark_mastered 提议被应用时）
 *   - 每日目标从 settings.daily_goal_xp 读取（默认 30）
 *   - 今日 XP 存在 settings 表（key: daily_xp_YYYY-MM-DD），每天自动重置
 *
 * 纯函数 + DB 注入，可被 verify 脚本覆盖。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { settings as settingsTable } from "../db/schema.js";
import { emitStateChange } from "../lib/state-emitter.js";

type Db = SQLJsDatabase<typeof schema>;

const XP_CORRECT = 10;
const XP_WRONG = 1;
const XP_MASTERED = 50;
const DEFAULT_DAILY_GOAL = 30;

/** 获取今天的日期 key (YYYY-MM-DD) */
function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** settings 表里存今日 XP 的 key */
function dailyXpKey(now: Date = new Date()): string {
  return `daily_xp_${todayKey(now)}`;
}

/**
 * 增加今日 XP（练习答题 / 掌握课时时调用）。
 * 自动处理跨天重置（如果 settings 里的日期 key 不是今天，从 0 开始）。
 */
export function addXp(db: Db, amount: number, now: Date = new Date()): number {
  // 防御: 不允许负数 XP（防篡改）
  const safeAmount = Math.max(0, amount);
  const key = dailyXpKey(now);
  const row = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .get();
  const current = row ? parseInt(row.value ?? "0", 10) : 0;
  const next = current + safeAmount;

  if (row) {
    db.update(settingsTable)
      .set({ value: String(next) })
      .where(eq(settingsTable.key, key))
      .run();
  } else {
    db.insert(settingsTable)
      .values({ key, value: String(next), isSecret: false })
      .run();
  }

  // Phase 0: 通知 renderer XP 变化(重拉能量条 + 触发庆祝)。所有 XP 来源都经此。
  emitStateChange("xp");
  return next;
}

/** 答对一题的 XP */
export function addXpCorrect(db: Db): number {
  return addXp(db, XP_CORRECT);
}

/** 答错一题的 XP（鼓励尝试） */
export function addXpWrong(db: Db): number {
  return addXp(db, XP_WRONG);
}

/** 掌握一课的 XP */
export function addXpMastered(db: Db): number {
  return addXp(db, XP_MASTERED);
}

/**
 * 获取今日 XP 状态。
 * 返回 { todayXp, dailyGoal, achieved }。
 */
export function getXpStatus(db: Db, now: Date = new Date()): {
  todayXp: number;
  dailyGoal: number;
  achieved: boolean;
  pct: number;
} {
  const key = dailyXpKey(now);
  const xpRow = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .get();
  const parsedXp = xpRow ? parseInt(xpRow.value ?? "0", 10) : 0;
  const todayXp = Number.isNaN(parsedXp) ? 0 : parsedXp;

  const goalRow = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "daily_goal_xp"))
    .get();
  const parsedGoal = goalRow ? parseInt(goalRow.value ?? String(DEFAULT_DAILY_GOAL), 10) : DEFAULT_DAILY_GOAL;
  const dailyGoal = Number.isNaN(parsedGoal) || parsedGoal < 1 ? DEFAULT_DAILY_GOAL : parsedGoal;

  return {
    todayXp,
    dailyGoal,
    achieved: todayXp >= dailyGoal,
    pct: dailyGoal > 0 ? Math.min(100, Math.round((todayXp / dailyGoal) * 100)) : 0,
  };
}

/** 清理过期的 daily_xp_* 条目（保留最近 7 天，防 settings 表膨胀） */
export function cleanupOldXp(db: Db, now: Date = new Date()): number {
  const allKeys = db
    .select()
    .from(settingsTable)
    .all()
    .filter((r) => r.key.startsWith("daily_xp_"));

  let deleted = 0;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = dailyXpKey(cutoff);

  for (const row of allKeys) {
    const dateStr = row.key.replace("daily_xp_", "");
    if (dateStr < cutoffStr) {
      db.delete(settingsTable).where(eq(settingsTable.key, row.key)).run();
      deleted++;
    }
  }
  return deleted;
}

export { XP_CORRECT, XP_WRONG, XP_MASTERED, DEFAULT_DAILY_GOAL };
