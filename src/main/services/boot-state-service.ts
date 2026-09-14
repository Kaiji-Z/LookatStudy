/**
 * Boot State 聚合服务 —— 一次 DB 读侧往返,凑齐 computeBootGuide 的全部输入。
 *
 * 设计(v0.36 boot-guide 迭代, SPEC .goal/SPEC.md §2.1):
 *   - 渲染层开屏只需一次 `boot:getState` 调用,不六路往返;
 *   - db 注入式(与 learner-model-service 同哲学):verify 可用内存 sql.js 直测,
 *     本文件与 import 链不得触达 db/index(?raw 链);
 *   - streak/srs 不 import 各自服务(它们持有全局 getDb),直接查表,
 *     日期约定与 pure/streak-transition 一致(本地日期 YYYY-MM-DD);
 *   - 只读,零写库。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { and, eq, isNull, lte, desc } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  settings as settingsTable,
  courses as coursesTable,
  contentNodes,
  progress as progressTable,
  srsItems,
  streaks as streaksTable,
  examAttempts,
} from "../db/schema.js";
import { isLlmReady } from "./agent/llm-client.js";
import { getDashboard } from "./dashboard-service.js";
import { parseProfileJson, hasProfileContent } from "@shared/learner-profile";
import type { BootStateResult } from "@shared/boot-guide";

type Db = SQLJsDatabase<typeof schema>;

function localDateStr(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 距本地午夜的小时数(向上取整,最少 1 —— "火焰还有 N 小时")。 */
function hoursUntilMidnight(now: Date): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 3600000));
}

/**
 * 聚合开屏输入。now 注入(测试确定性);只读不写。
 */
export function gatherBootState(db: Db, now: Date = new Date()): BootStateResult {
  const nowISO = now.toISOString();
  const today = localDateStr(now);

  /* settings 一次拉全(boot 相关键量小,避免逐键往返) */
  const settingRows = db.select().from(settingsTable).all();
  const settings = new Map(settingRows.map((r) => [r.key, r.value]));

  const profile = parseProfileJson(settings.get("learner_profile") ?? null);
  const bootDone = settings.get("boot_done") === "1";
  const keyPromptCount = Number(settings.get("key_prompt_count") ?? "0") || 0;

  /* key 就绪 */
  const hasKey = isLlmReady(db).ready;

  /* 课程在场 */
  const courses = db.select().from(coursesTable).all();
  const hasCourses = courses.length > 0;

  /* 上次会话(settings last_session = {"courseId","nodeId"};课程已删→优雅回落) */
  let lastSession: BootStateResult["lastSession"] = null;
  const targets: BootStateResult["targets"] = {
    resume: null,
    frictionNodeId: null,
    nearMasteryNodeId: null,
    examNodeId: null,
  };
  let lastCourseId: string | null = null;
  try {
    const raw = settings.get("last_session");
    if (raw) {
      const parsed = JSON.parse(raw) as { courseId?: string; nodeId?: string | null };
      const course = parsed.courseId ? courses.find((c) => c.id === parsed.courseId) : undefined;
      if (course) {
        lastCourseId = course.id;
        const node =
          parsed.nodeId && parsed.nodeId !== "section-root"
            ? db.select().from(contentNodes).where(eq(contentNodes.id, parsed.nodeId)).get()
            : undefined;
        lastSession = { courseTitle: course.title, nodeTitle: node?.title ?? null };
        targets.resume = { courseId: course.id, nodeId: node?.id ?? null };
      }
    }
  } catch {
    /* 坏 JSON → 无上次会话,boot 引导照常 */
  }

  /* SRS 到期数(与 srs.getDueReviewNodeIds 同判据: due_at <= now ISO) */
  const dueRows = db
    .select({ nodeId: srsItems.nodeId })
    .from(srsItems)
    .where(lte(srsItems.dueAt, nowISO))
    .all();
  const dueCount = dueRows.length;

  /* streak(streaks singleton;日期约定同 pure/streak-transition) */
  const streakRow = db.select().from(streaksTable).where(eq(streaksTable.id, "singleton")).get();
  const lastActiveDate = streakRow?.lastActiveDate ?? null;
  const currentStreak = streakRow?.currentStreak ?? 0;
  const todayDone = lastActiveDate === today;
  // atRisk:今天未续且确有火可灭(有进行中的 streak)。freeze 有余量时不告急
  // —— 冻结正是为这种情况设计的,不消耗用户的紧迫感。
  const atRisk = !todayDone && currentStreak > 0 && (streakRow?.freezeCount ?? 0) <= 0;
  const streak = { todayDone, atRisk, hoursLeft: atRisk ? hoursUntilMidnight(now) : 0 };

  /* 卡点回访(最近课程 dashboard 的 frictionByNode[0]) */
  let topFrictionNodeTitle: string | null = null;
  if (lastCourseId) {
    const dash = getDashboard(db, lastCourseId, now);
    const top = dash.frictionByNode?.[0];
    if (top && top.count > 0) {
      topFrictionNodeTitle = top.title;
      targets.frictionNodeId = top.nodeId;
    }
  }

  /* 快毕业(最近课程 mastery ∈ [0.7, 0.9) 且未 mastered,取 orderIdx 最小) */
  let nearMasteryNodeTitle: string | null = null;
  if (lastCourseId) {
    const nodes = db
      .select({ id: contentNodes.id, title: contentNodes.title, orderIdx: contentNodes.orderIdx, mastery: progressTable.mastery, status: progressTable.status })
      .from(contentNodes)
      .leftJoin(progressTable, eq(progressTable.nodeId, contentNodes.id))
      .where(and(eq(contentNodes.courseId, lastCourseId), eq(contentNodes.type, "lesson")))
      .all()
      .filter((n) => n.mastery != null && n.mastery >= 0.7 && n.mastery < 0.9 && n.status !== "mastered")
      .sort((a, b) => (a.orderIdx ?? 0) - (b.orderIdx ?? 0));
    if (nodes.length > 0) {
      nearMasteryNodeTitle = nodes[0].title;
      targets.nearMasteryNodeId = nodes[0].id;
    }
  }

  /* 考试中断(exam_attempts 未结且未终止的最新一条;节点课程须仍在) */
  let suspendedExamNodeTitle: string | null = null;
  const examRow = db
    .select({ nodeId: examAttempts.examNodeId, startedAt: examAttempts.startedAt })
    .from(examAttempts)
    .where(and(isNull(examAttempts.finishedAt), eq(examAttempts.terminated, false)))
    .orderBy(desc(examAttempts.startedAt))
    .limit(1)
    .get();
  if (examRow) {
    const node = db.select().from(contentNodes).where(eq(contentNodes.id, examRow.nodeId)).get();
    if (node) {
      const courseStillThere = courses.some((c) => c.id === node.courseId);
      if (courseStillThere) {
        suspendedExamNodeTitle = node.title;
        targets.examNodeId = node.id;
      }
    }
  }

  /* 隔天回归(lastActiveDate 存在且早于今天) */
  const returningAfterDays = lastActiveDate != null && lastActiveDate < today;

  /* 右栏「学习回顾」:总 XP(settings total_xp,与 xp-service 同键) + 已掌握课数 + streak 天 */
  const totalXpRaw = settings.get("total_xp");
  const totalXp = Number.isFinite(Number(totalXpRaw)) ? Math.max(0, parseInt(totalXpRaw ?? "0", 10) || 0) : 0;
  const masteredCount = db
    .select({ nodeId: progressTable.nodeId })
    .from(progressTable)
    .where(eq(progressTable.status, "mastered"))
    .all().length;

  return {
    recap: { totalXp, masteredCount, streakDays: currentStreak },
    hasKey,
    bootDone,
    wizardStep: 0, // 渲染层持有步进,每步喂回;聚合端只给初值 0
    keyPromptDismissed: keyPromptCount >= 2,
    profileFilled: profile ? hasProfileContent(profile) : false,
    name: profile?.name ?? null,
    hasCourses,
    lastSession,
    dueCount,
    streak,
    topFrictionNodeTitle,
    nearMasteryNodeTitle,
    suspendedExamNodeTitle,
    returningAfterDays,
    targets,
  };
}
