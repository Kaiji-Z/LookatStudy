/**
 * 仪表盘数据服务（M3）—— 掌握度热力图 + SRS 到期统计 + 本周活动。
 *
 * 数据来源：progress.mastery（M2 BKT）+ srs_items.due_at + streaks。
 * 这是 UI 仪表盘的"数据后端"，纯查询，DB 注入式可测。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq, lte } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  contentNodes,
  progress as progressTable,
  srsItems,
  streaks,
} from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

export interface SectionMastery {
  sectionId: string;
  sectionTitle: string;
  /** 该 section 下所有 lesson 的平均掌握度（0-1），无数据的 lesson 算 0 */
  avgMastery: number;
  /** 该 section 下 lesson 总数 */
  lessonCount: number;
  /** 已掌握（mastery>=0.7）的 lesson 数 */
  masteredCount: number;
}

export interface DashboardData {
  /** 按 section 聚合的掌握度（热力图数据） */
  sections: SectionMastery[];
  /** 今日 SRS 到期数 */
  dueToday: number;
  /** streak 状态 */
  currentStreak: number;
  freezeCount: number;
  /** 整体平均掌握度 */
  overallMastery: number;
}

/**
 * 读仪表盘全部数据。一次调用给 UI 用。
 */
export function getDashboard(
  db: Db,
  courseId: string,
  now: Date = new Date(),
): DashboardData {
  // 1. 该课程的 section + lesson + progress 一次拉
  const nodes = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all();
  const sections = nodes.filter((n) => n.type === "section");
  const progressRows = db.select().from(progressTable).all();

  const progressByNode = new Map<string, number>();
  for (const p of progressRows) {
    progressByNode.set(p.nodeId, p.mastery ?? 0);
  }

  const sectionAggs: SectionMastery[] = sections.map((sec) => {
    const lessons = nodes.filter((n) => n.parentId === sec.id && n.type === "lesson");
    const masteries = lessons.map((l) => progressByNode.get(l.id) ?? 0);
    const avg =
      masteries.length > 0
        ? masteries.reduce((a, b) => a + b, 0) / masteries.length
        : 0;
    const mastered = masteries.filter((m) => m >= 0.7).length;
    return {
      sectionId: sec.id,
      sectionTitle: sec.title,
      avgMastery: avg,
      lessonCount: lessons.length,
      masteredCount: mastered,
    };
  });

  // 2. SRS 到期
  const dueRows = db
    .select({ nodeId: srsItems.nodeId })
    .from(srsItems)
    .where(lte(srsItems.dueAt, now.toISOString()))
    .all();
  const dueToday = dueRows.length;

  // 3. streak
  const streakRow = db
    .select()
    .from(streaks)
    .where(eq(streaks.id, "singleton"))
    .get();

  // 4. 整体平均（各 section avgMastery 的平均）
  const overall =
    sectionAggs.length > 0
      ? sectionAggs.reduce((a, s) => a + s.avgMastery, 0) / sectionAggs.length
      : 0;

  return {
    sections: sectionAggs,
    dueToday,
    currentStreak: streakRow?.currentStreak ?? 0,
    freezeCount: streakRow?.freezeCount ?? 2,
    overallMastery: overall,
  };
}
