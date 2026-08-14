/**
 * 仪表盘数据服务（M3）—— 掌握度热力图 + SRS 到期统计 + 本周活动。
 *
 * 数据来源：progress.mastery（M2 BKT）+ srs_items.due_at + streaks。
 * 这是 UI 仪表盘的"数据后端"，纯查询，DB 注入式可测。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq, lte } from "drizzle-orm";
import { MASTERED_MASTERY_THRESHOLD } from "@shared/types";
import * as schema from "../db/schema.js";
import {
  contentNodes,
  progress as progressTable,
  srsItems,
  streaks,
  frictionLog,
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
  /** P3.4 薄弱点:按 friction 次数排序的节点(排除 agent_error,上限 5) */
  frictionByNode: Array<{ nodeId: string; title: string; count: number }>;
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

  // 进度混合指标:不只看 mastery,而是按 status 给权重,让"点课"也能推进总进度条。
  //   mastered    → 1.0(满)
  //   in_progress → mastery(BKT 累积值,首次答题会从 pInit=0.5 起步)
  //   available   → 0.1(用户能看见这课了,算一点"发现"进度)
  //   locked/无行 → 0
  const progressByNode = new Map<string, { mastery: number; status: string }>();
  for (const p of progressRows) {
    progressByNode.set(p.nodeId, {
      mastery: p.mastery ?? 0,
      status: p.status ?? "locked",
    });
  };

  /** 把单节点进度行映射成 0-1 的"进度贡献"。 */
  const progressContribution = (nodeId: string): number => {
    const p = progressByNode.get(nodeId);
    if (!p) return 0;
    if (p.status === "mastered") return 1.0;
    if (p.status === "in_progress") return p.mastery;
    if (p.status === "available") return 0.1;
    return 0;
  };

  const sectionAggs: SectionMastery[] = sections.map((sec) => {
    const lessons = nodes.filter((n) => n.parentId === sec.id && n.type === "lesson");
    // avgMastery 仍报真实 BKT mastery(仪表盘的"掌握度"语义不变),
    // 但 overall 用 progressContribution(下方),让"点课"也能推进总进度条。
    const masteries = lessons.map((l) => progressByNode.get(l.id)?.mastery ?? 0);
    const avg =
      masteries.length > 0
        ? masteries.reduce((a, b) => a + b, 0) / masteries.length
        : 0;
    const mastered = masteries.filter((m) => m >= MASTERED_MASTERY_THRESHOLD).length;
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

  // 4. 整体进度 = 所有 lesson 的 progressContribution 的平均。
  //    用混合指标(非纯 mastery 平均):点课(available→in_progress)立刻推进总进度条,
  //    mastered 满分,in_progress 按 BKT mastery 累积。让用户感觉"每个动作都有反馈"。
  const allLessons = nodes.filter((n) => n.type === "lesson");
  const overall =
    allLessons.length > 0
      ? allLessons.reduce((sum, l) => sum + progressContribution(l.id), 0) / allLessons.length
      : 0;

  // P3.4 薄弱点:本课程节点上的人类 friction(confused/blocked/frustrated)计数,排除 agent_error。
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const frictionCount = new Map<string, number>();
  for (const f of db.select().from(frictionLog).all()) {
    if (f.category === "agent_error" || !f.nodeId || !nodeById.has(f.nodeId)) continue;
    frictionCount.set(f.nodeId, (frictionCount.get(f.nodeId) ?? 0) + 1);
  }
  const frictionByNode = [...frictionCount.entries()]
    .map(([nodeId, count]) => ({ nodeId, title: nodeById.get(nodeId)?.title ?? nodeId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    sections: sectionAggs,
    dueToday,
    currentStreak: streakRow?.currentStreak ?? 0,
    freezeCount: streakRow?.freezeCount ?? 2,
    overallMastery: overall,
    frictionByNode,
  };
}
