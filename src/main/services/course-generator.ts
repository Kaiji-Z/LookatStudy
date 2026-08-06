/**
 * Course Generator（M4 阶段 A）—— 把解析出的 ParsedCourse 落库成 courses + content_nodes。
 *
 * 阶段 B（按需讲解/出题生成）留到 agent 对话触发时做，不在本文件。
 *
 * 本函数是确定性的（不调 LLM）—— LLM 质量优化是上层可选项，dogfood 时加。
 * 这样 Course Generator 的核心可被纯 Node 测试覆盖（VERIFICATION §3.1）。
 *
 * DB 注入式。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { courses, contentNodes, progress as progressTable } from "../db/schema.js";
import { randomUUID } from "node:crypto";
import {
  parseMarkdownToCourse,
  detectLabType,
  type ParsedCourse,
  type LabType,
} from "./pure/markdown-course.js";

type Db = SQLJsDatabase<typeof schema>;

export interface GeneratedCourse {
  courseId: string;
  title: string;
  labType: LabType;
  sectionCount: number;
  lessonCount: number;
}

/**
 * 从 markdown 字符串生成课程并落库。
 *
 * @param db
 * @param md            README 等入口 markdown
 * @param repoUrl       源仓库 URL（可空）
 * @param repoName      仓库名（用作 course id 的一部分）
 * @param courseId      显式 id（可选，否则按 repoName 生成）
 * @returns 生成的课程摘要
 */
export function generateCourseFromMarkdown(
  db: Db,
  md: string,
  opts: { repoUrl?: string | null; repoName: string; courseId?: string },
): GeneratedCourse {
  const parsed = parseMarkdownToCourse(md);
  const labType = detectLabType(md);
  const courseId =
    opts.courseId ??
    `course-${opts.repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

  // 已存在则跳过（幂等，避免重复生成）
  const existing = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (existing) {
    // 返回现有课程的统计
    const tree = db
      .select()
      .from(contentNodes)
      .where(eq(contentNodes.courseId, courseId))
      .all();
    return {
      courseId,
      title: existing.title,
      labType: (existing.labType ?? "doc") as LabType,
      sectionCount: tree.filter((n) => n.type === "section").length,
      lessonCount: tree.filter((n) => n.type === "lesson").length,
    };
  }

  // 写 course
  db.insert(courses)
    .values({
      id: courseId,
      repoUrl: opts.repoUrl ?? null,
      repoName: opts.repoName,
      title: parsed.title,
      description: `Generated from ${opts.repoName}`,
      version: 1,
      labType,
    })
    .run();

  // 写 section + lesson + 初始 progress（第一个 lesson available）
  let sectionOrder = 0;
  let totalLessons = 0;
  let firstLessonId: string | null = null;

  for (const section of parsed.sections) {
    const sectionId = randomUUID();
    db.insert(contentNodes)
      .values({
        id: sectionId,
        courseId,
        parentId: null,
        type: "section",
        title: section.title,
        sourcePath: `README.md#${section.anchor}`,
        orderIdx: sectionOrder++,
      })
      .run();

    let lessonOrder = 0;
    for (const lesson of section.lessons) {
      const lessonId = randomUUID();
      const isFirstEver = firstLessonId === null;
      db.insert(contentNodes)
        .values({
          id: lessonId,
          courseId,
          parentId: sectionId,
          type: "lesson",
          title: lesson.title,
          sourcePath: `README.md#${lesson.anchor}`,
          orderIdx: lessonOrder++,
          content: lesson.body || null, // 写入正文供 RAG 检索（M3）
        })
        .run();

      db.insert(progressTable)
        .values({
          nodeId: lessonId,
          status: isFirstEver ? "available" : "locked",
          crownLevel: 0,
        })
        .run();

      if (isFirstEver) firstLessonId = lessonId;
      totalLessons++;
    }
  }

  return {
    courseId,
    title: parsed.title,
    labType,
    sectionCount: parsed.sections.length,
    lessonCount: totalLessons,
  };
}

/** 暴露解析器给外部（如 course generator UI 预览） */
export { parseMarkdownToCourse, detectLabType };
export type { ParsedCourse, LabType };
