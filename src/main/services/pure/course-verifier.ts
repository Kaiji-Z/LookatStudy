/**
 * 课程完整性验证 —— Step 5d。
 * 纯函数，检查落库后的课程数据是否完整无错误。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { eq } from "drizzle-orm";

type Db = SQLJsDatabase<typeof schema>;

export interface VerificationResult {
  ok: boolean;
  issues: string[];
  stats: {
    sections: number;
    lessons: number;
    practiceLessons: number;
    studyLessons: number;
    lessonsWithContent: number;
    lessonsWithImages: number;
  };
}

/**
 * 验证课程数据完整性。
 * 检查: section 非空、lesson 有正文、parentId 不悬空、至少一个 study available。
 */
export function verifyCourseIntegrity(db: Db, courseId: string): VerificationResult {
  const issues: string[] = [];
  const nodes = db.select().from(schema.contentNodes)
    .where(eq(schema.contentNodes.courseId, courseId)).all();

  const sections = nodes.filter((n) => n.type === "section");
  const lessons = nodes.filter((n) => n.type === "lesson");
  const sectionIds = new Set(sections.map((s) => s.id));

  // 1. 每个 section 至少 1 个 lesson
  for (const sec of sections) {
    const childCount = lessons.filter((l) => l.parentId === sec.id).length;
    if (childCount === 0) {
      issues.push(`section "${sec.title}" 没有任何 lesson`);
    }
  }

  // 2. 每个 lesson 的 parentId 指向存在的 section
  for (const lesson of lessons) {
    if (!lesson.parentId || !sectionIds.has(lesson.parentId)) {
      issues.push(`lesson "${lesson.title}" 的 parentId 悬空 (不指向任何 section)`);
    }
  }

  // 3. study lesson 至少有正文
  let lessonsWithContent = 0;
  for (const lesson of lessons) {
    if ((lesson.world ?? "study") === "study" && (!lesson.content || lesson.content.length < 20)) {
      issues.push(`study lesson "${lesson.title}" 正文为空或过短`);
    }
    if (lesson.content && lesson.content.length > 20) lessonsWithContent++;
  }

  // 4. base64 图片统计
  const lessonsWithImages = lessons.filter((l) =>
    l.content?.includes("data:image/"),
  ).length;

  // 5. 至少一个 study lesson
  const studyLessons = lessons.filter((l) => (l.world ?? "study") === "study");
  if (studyLessons.length === 0) {
    issues.push("课程没有任何 study 世界的 lesson");
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      sections: sections.length,
      lessons: lessons.length,
      practiceLessons: lessons.filter((l) => l.world === "practice").length,
      studyLessons: studyLessons.length,
      lessonsWithContent,
      lessonsWithImages,
    },
  };
}
