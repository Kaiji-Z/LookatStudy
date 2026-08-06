/**
 * 学习记录导出服务 —— 生成进度报告/学习证书。
 *
 * 格式:
 *   - JSON: 结构化数据（机器可读，可导入其他工具）
 *   - Markdown: 人类可读的学习证书（可分享）
 *
 * 含: 课程名/已掌握课时数/平均掌握度/连续天数/总XP/章节明细
 *
 * 纯函数 + DB 注入，可被 verify 脚本覆盖。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import {
  courses,
  contentNodes,
  progress as progressTable,
  settings as settingsTable,
} from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

export interface ExportData {
  courseTitle: string;
  courseDescription: string | null;
  repoName: string;
  exportedAt: string;
  totalLessons: number;
  masteredLessons: number;
  inProgressLessons: number;
  avgMastery: number;
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  sections: {
    title: string;
    lessons: { title: string; mastery: number | null; status: string }[];
  }[];
}

/**
 * 从 DB 收集导出数据。
 */
export function collectExportData(db: Db, courseId: string): ExportData | null {
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  const allNodes = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all();

  const sections = allNodes
    .filter((n) => n.type === "section")
    .sort((a, b) => a.orderIdx - b.orderIdx);

  const lessons = allNodes.filter((n) => n.type === "lesson");

  // 收集 progress
  const progressMap: Record<string, { mastery: number | null; status: string }> = {};
  for (const l of lessons) {
    const p = db.select().from(progressTable).where(eq(progressTable.nodeId, l.id)).get();
    progressMap[l.id] = {
      mastery: p?.mastery ?? null,
      status: p?.status ?? "locked",
    };
  }

  const masteredLessons = lessons.filter((l) => progressMap[l.id]?.status === "mastered").length;
  const inProgressLessons = lessons.filter(
    (l) => progressMap[l.id]?.status === "in_progress" || progressMap[l.id]?.status === "available",
  ).length;
  const masteryValues = lessons
    .map((l) => progressMap[l.id]?.mastery)
    .filter((m): m is number => m !== null && m !== undefined);
  const avgMastery = masteryValues.length > 0
    ? masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length
    : 0;

  // streak
  const streakRow = db.select().from(schema.streaks).get();
  const currentStreak = streakRow?.currentStreak ?? 0;
  const longestStreak = streakRow?.longestStreak ?? 0;

  // total XP (所有 daily_xp_* 条目之和)
  const xpRows = db
    .select()
    .from(settingsTable)
    .all()
    .filter((r) => r.key.startsWith("daily_xp_"));
  const totalXp = xpRows.reduce((sum, r) => sum + (parseInt(r.value ?? "0", 10) || 0), 0);

  // sections with lessons
  const sectionDetails = sections.map((s) => {
    const sectionLessons = allNodes
      .filter((n) => n.parentId === s.id && n.type === "lesson")
      .sort((a, b) => a.orderIdx - b.orderIdx)
      .map((l) => ({
        title: l.title,
        mastery: progressMap[l.id]?.mastery ?? null,
        status: progressMap[l.id]?.status ?? "locked",
      }));
    return { title: s.title, lessons: sectionLessons };
  });

  return {
    courseTitle: course.title,
    courseDescription: course.description,
    repoName: course.repoName,
    exportedAt: new Date().toISOString(),
    totalLessons: lessons.length,
    masteredLessons,
    inProgressLessons,
    avgMastery,
    currentStreak,
    longestStreak,
    totalXp,
    sections: sectionDetails,
  };
}

/**
 * 生成 JSON 格式的导出。
 */
export function exportJson(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * 生成 Markdown 格式的学习证书（可读、可分享）。
 */
export function exportMarkdown(data: ExportData): string {
  const masteryPct = Math.round(data.avgMastery * 100);
  const completionPct = data.totalLessons > 0
    ? Math.round((data.masteredLessons / data.totalLessons) * 100)
    : 0;

  const lines: string[] = [
    `# 🎓 LookatStudy 学习报告`,
    ``,
    `**课程**: ${data.courseTitle}`,
    data.courseDescription ? `**描述**: ${data.courseDescription}` : ``,
    `**来源**: ${data.repoName}`,
    `**导出时间**: ${new Date(data.exportedAt).toLocaleString("zh-CN")}`,
    ``,
    `---`,
    ``,
    `## 📊 学习成果`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 课程完成度 | ${completionPct}% (${data.masteredLessons}/${data.totalLessons} 课时已掌握) |`,
    `| 平均掌握度 | ${masteryPct}% |`,
    `| 连续学习天数 | ${data.currentStreak} 天（最长 ${data.longestStreak} 天） |`,
    `| 累计 XP | ${data.totalXp} |`,
    ``,
    `---`,
    ``,
    `## 📚 章节明细`,
    ``,
  ];

  for (const section of data.sections) {
    lines.push(`### ${section.title}`);
    lines.push(``);
    for (const lesson of section.lessons) {
      const icon = lesson.status === "mastered" ? "👑" :
        lesson.status === "in_progress" ? "📘" :
        lesson.status === "available" ? "⭐" : "🔒";
      const masteryStr = lesson.mastery !== null ? ` (${Math.round(lesson.mastery * 100)}%)` : "";
      lines.push(`- ${icon} ${lesson.title}${masteryStr}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`*由 LookatStudy 生成 · Local-first AI Learning Platform*`);

  return lines.join("\n");
}
