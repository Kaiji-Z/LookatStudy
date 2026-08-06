/**
 * 课程结构化服务 —— 用 LLM 把导入的碎片节点重组成教学结构。
 *
 * 功能:
 *   1. analyzeCourseStructure: LLM 分析节点 → 教学分组（section/lesson/skip）
 *   2. generateLessonSummaries: LLM 为每个 section 生成中文摘要
 *
 * 安全：LLM 返回 JSON 后，我们验证所有 lessonId 在 DB 里真实存在才落库。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { generateText } from "ai";
import * as schema from "../db/schema.js";
import { contentNodes, courses } from "../db/schema.js";
import { resolveLlm } from "./agent/llm-client.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 为课程的每个 section 生成一句话中文摘要 + 前置依赖标记。
 * 需要 LLM key。
 */
export async function generateLessonSummaries(
  db: Db,
  courseId: string,
): Promise<{ sectionsUpdated: number }> {
  const llm = resolveLlm(db);
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) throw new Error(`课程不存在: ${courseId}`);

  // 取所有 section
  const sections = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "section")
    .sort((a, b) => a.orderIdx - b.orderIdx);

  let updated = 0;
  for (const section of sections) {
    // 取该 section 的所有 lesson 标题
    const lessons = db
      .select()
      .from(contentNodes)
      .all()
      .filter((n) => n.parentId === section.id && n.type === "lesson")
      .sort((a, b) => a.orderIdx - b.orderIdx);

    if (lessons.length === 0) continue;

    const lessonTitles = lessons.map((l) => `- ${l.title}`).join("\n");

    const prompt = `你是课程设计专家。请为以下章节生成一句话中文摘要和前置知识标记。

课程: ${course.title}
章节: ${section.title}
该章节的课时:
${lessonTitles}

严格返回 JSON，不要加 markdown 代码块标记:
{
  "summary": "这一章学什么（一句中文，30字以内）",
  "prerequisites": "学这章前应该先学什么（如果不需要前置知识就写'无'）"
}`;

    try {
      const result = await generateText({ model: llm.languageModel, prompt });
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);

      // 把摘要写入 section 的 content 字段
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const prereq = typeof parsed.prerequisites === "string" ? parsed.prerequisites : "";

      db.update(contentNodes)
        .set({ content: summary + (prereq && prereq !== "无" ? `\n\n📌 前置: ${prereq}` : "") })
        .where(eq(contentNodes.id, section.id))
        .run();
      updated++;
    } catch {
      // 单个 section 失败不影响其他
      console.error(`[generateLessonSummaries] section ${section.id} failed`);
    }
  }

  return { sectionsUpdated: updated };
}

/** LLM 返回的结构化结果（需验证后才落库） */
interface StructureProposal {
  sections: {
    title: string;
    summary: string;
    lessonIds: string[];
  }[];
  skippedNodeIds: string[];
}

/**
 * 用 LLM 分析课程节点，返回教学结构提议。
 * 不直接落库——返回提议让调用方验证后写。
 */
export async function analyzeCourseStructure(
  db: Db,
  courseId: string,
): Promise<StructureProposal> {
  const llm = resolveLlm(db);

  // 取课程所有 lesson 节点（section 节点不喂给 LLM，它会重新分组）
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  const lessons = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  if (lessons.length === 0) {
    throw new Error("课程没有任何课时节点，无法分析结构");
  }

  // 构造输入：每课 id + title + content 前 200 字摘要
  const lessonInputs = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    preview: (l.content ?? "").slice(0, 200).replace(/\n/g, " ").trim(),
  }));

  const prompt = buildStructurePrompt(
    course?.title ?? "(未知课程)",
    course?.description ?? "",
    lessonInputs,
  );

  const result = await generateText({
    model: llm.languageModel,
    prompt,
  });

  return parseStructureResult(result.text, lessons.map((l) => l.id));
}

/**
 * 把结构化提议落库：删除旧 section，按 LLM 分组重建 section + lesson 归属。
 */
export function applyCourseStructure(
  db: Db,
  courseId: string,
  proposal: StructureProposal,
): { sectionCount: number; lessonCount: number; skippedCount: number } {
  // 先删旧 section（lesson 保留，只改 parentId / orderIdx）
  const oldSections = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "section");
  for (const s of oldSections) {
    db.delete(contentNodes).where(eq(contentNodes.id, s.id)).run();
  }

  // 把所有 lesson 的 parentId 先清空
  const allLessons = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");
  for (const l of allLessons) {
    db.update(contentNodes)
      .set({ parentId: null, orderIdx: 0 })
      .where(eq(contentNodes.id, l.id))
      .run();
  }

  const { randomUUID } = require("node:crypto") as { randomUUID: () => string };
  const validLessonIds = new Set(allLessons.map((l) => l.id));
  const skippedSet = new Set(
    proposal.skippedNodeIds.filter((id) => validLessonIds.has(id)),
  );

  let sectionOrder = 0;
  let lessonCount = 0;

  for (const sec of proposal.sections) {
    // 验证 section 里的 lessonId 都合法
    const validIds = sec.lessonIds.filter((id) => validLessonIds.has(id));
    if (validIds.length === 0) continue; // 空 section 跳过

    const sectionId = randomUUID();
    db.insert(contentNodes)
      .values({
        id: sectionId,
        courseId,
        parentId: null,
        type: "section",
        title: sec.title,
        sourcePath: null,
        orderIdx: sectionOrder++,
        content: sec.summary || null, // section 摘要存 content 字段
      })
      .run();

    let lessonOrder = 0;
    for (const lessonId of validIds) {
      db.update(contentNodes)
        .set({ parentId: sectionId, orderIdx: lessonOrder++ })
        .where(eq(contentNodes.id, lessonId))
        .run();
      lessonCount++;
    }
  }

  return {
    sectionCount: sectionOrder,
    lessonCount,
    skippedCount: skippedSet.size,
  };
}

/* ---------- 内部工具 ---------- */

function buildStructurePrompt(
  courseTitle: string,
  courseDescription: string,
  lessons: { id: string; title: string; preview: string }[],
): string {
  const lessonList = lessons
    .map((l) => `  { "id": "${l.id}", "title": "${l.title}", "preview": "${l.preview.slice(0, 150)}" }`)
    .join(",\n");

  return `你是课程设计专家。下面是「${courseTitle}」这个学习仓库导入后的原始课时列表。
${courseDescription ? `课程描述: ${courseDescription}\n` : ""}
请把这些课时重新组织成合理的教学结构。

规则:
1. 识别 3-10 个大主题作为 section（不要太多碎章节）
2. 把相关的 lesson 归到对应 section 下
3. lab/练习/翻译类的节点在 skippedNodeIds 里标出（不归入任何 section）
4. section 按学习难度排序（基础→进阶）
5. 每个 section 有一句中文摘要（说清这章学什么）
6. lessonId 必须用我给你的原始 id，不要编造新 id

课时列表:
[
${lessonList}
]

严格返回以下 JSON 格式，不要加 markdown 代码块标记，不要解释:
{
  "sections": [
    {
      "title": "章节标题（中文）",
      "summary": "这章学什么（一句话中文）",
      "lessonIds": ["id1", "id2"]
    }
  ],
  "skippedNodeIds": ["id3", "id4"]
}`;
}

function parseStructureResult(
  raw: string,
  validIds: string[],
): StructureProposal {
  // 剥 markdown 代码块包裹
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let obj: { sections?: unknown; skippedNodeIds?: unknown };
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `LLM 返回的 JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!Array.isArray(obj.sections)) {
    throw new Error("LLM 返回缺少 sections 数组");
  }

  const validSet = new Set(validIds);

  const sections = (obj.sections as Array<Record<string, unknown>>)
    .map((s) => ({
      title: typeof s.title === "string" ? s.title : "(未命名章节)",
      summary: typeof s.summary === "string" ? s.summary : "",
      lessonIds: Array.isArray(s.lessonIds)
        ? (s.lessonIds as string[]).filter((id) => validSet.has(id))
        : [],
    }))
    .filter((s) => s.lessonIds.length > 0);

  const skippedNodeIds = Array.isArray(obj.skippedNodeIds)
    ? (obj.skippedNodeIds as string[]).filter((id) => validSet.has(id))
    : [];

  return { sections, skippedNodeIds };
}
