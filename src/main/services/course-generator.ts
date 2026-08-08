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
  examCount: number;
}

/**
 * 给某 section 末尾插一个"章节考试"节点(关底 boss,可选)。
 * - type=exam, parentId=sectionId, orderIdx 排在所有课之后
 * - progress 行:status=available(考试总是可选,不受 mastery 门控),crownLevel=0(0 星=未考)
 * 幂等:同 section 已有 exam 节点则跳过(供 ensureExamNodesForExistingCourses 复用)。
 */
function insertExamNode(db: Db, courseId: string, sectionId: string, sectionTitle: string, orderIdx: number): string | null {
  // 幂等:同 section 已有 exam 节点则不重复建
  const existing = db.select().from(contentNodes).all().find(
    (n) => n.parentId === sectionId && n.type === "exam",
  );
  if (existing) return null;

  const examId = randomUUID();
  db.insert(contentNodes)
    .values({
      id: examId,
      courseId,
      parentId: sectionId,
      type: "exam",
      title: `${sectionTitle} · 章节测验`,
      orderIdx,
    })
    .run();
  db.insert(progressTable)
    .values({
      nodeId: examId,
      status: "available",
      crownLevel: 0,
    })
    .run();
  return examId;
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
      examCount: tree.filter((n) => n.type === "exam").length,
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
  let totalExams = 0;
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

    // 章节末尾:考试节点(可选关底 boss,正确率分档给 1-3 星)
    if (section.lessons.length > 0 && insertExamNode(db, courseId, sectionId, section.title, lessonOrder)) {
      totalExams++;
    }
  }

  return {
    courseId,
    title: parsed.title,
    labType,
    sectionCount: parsed.sections.length,
    lessonCount: totalLessons,
    examCount: totalExams,
  };
}

/** 暴露解析器给外部（如 course generator UI 预览） */
export { parseMarkdownToCourse, detectLabType };
export type { ParsedCourse, LabType };

/**
 * 从已构建好的 ParsedCourse（多文件合并）落库。
 *
 * 与 generateCourseFromMarkdown 的区别:sourcePath 用真实文件路径（而非硬编码 README.md），
 * 适用于全仓库导入场景。
 *
 * @param db
 * @param parsed       repo-fetcher.buildCourseFromFiles 构建好的 ParsedCourse
 * @param sourcePaths  每个 section 对应的源文件路径（可选，用于 sourcePath 字段）
 * @param opts         repoUrl / repoName / courseId
 */
export function generateCourseFromRepoFiles(
  db: Db,
  parsed: ParsedCourse,
  opts: { repoUrl?: string | null; repoName: string; courseId?: string },
): GeneratedCourse {
  const courseId =
    opts.courseId ??
    `course-${opts.repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

  // 已存在则跳过（幂等）
  const existing = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (existing) {
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
      examCount: tree.filter((n) => n.type === "exam").length,
    };
  }

  // 检测 labType：union 所有 section 的 body
  const allBody = parsed.sections
    .flatMap((s) => s.lessons.map((l) => l.body))
    .join("\n");
  const labType = detectLabType(allBody);

  // 写 course
  db.insert(courses)
    .values({
      id: courseId,
      repoUrl: opts.repoUrl ?? null,
      repoName: opts.repoName,
      title: parsed.title,
      description: `从 ${opts.repoName} 全仓库导入`,
      version: 1,
      labType,
    })
    .run();

  // 写 section + lesson + 初始 progress
  let sectionOrder = 0;
  let totalLessons = 0;
  let totalExams = 0;
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
        sourcePath: section.anchor ? `${section.anchor}` : null,
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
          sourcePath: lesson.anchor ? `${section.title}#${lesson.anchor}` : null,
          orderIdx: lessonOrder++,
          content: lesson.body || null,
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

    // 章节末尾:考试节点(可选关底 boss,正确率分档给 1-3 星)
    if (section.lessons.length > 0 && insertExamNode(db, courseId, sectionId, section.title, lessonOrder)) {
      totalExams++;
    }
  }

  return {
    courseId,
    title: parsed.title,
    labType,
    sectionCount: parsed.sections.length,
    lessonCount: totalLessons,
    examCount: totalExams,
  };
}

/**
 * 幂等补丁:给所有已存在课程里"没有 exam 节点的 section"补一个章节考试节点。
 * 用途:老库(本功能上线前导入的课程)迁移——新课程由 generateCourseFrom* 自动含 exam。
 * 在 app 启动时调一次(见 main/index.ts)。已含 exam 的 section 跳过(insertExamNode 幂等)。
 */
export function ensureExamNodesForExistingCourses(db: Db): { patched: number } {
  const sections = db.select().from(contentNodes).all().filter((n) => n.type === "section");
  let patched = 0;
  for (const sec of sections) {
    const hasLessons = db.select().from(contentNodes).all().some(
      (n) => n.parentId === sec.id && n.type === "lesson",
    );
    if (!hasLessons) continue;
    const children = db.select().from(contentNodes).all().filter((n) => n.parentId === sec.id);
    const maxOrder = children.reduce((m, n) => Math.max(m, n.orderIdx), -1);
    if (insertExamNode(db, sec.courseId, sec.id, sec.title, maxOrder + 1)) {
      patched++;
    }
  }
  return { patched };
}
