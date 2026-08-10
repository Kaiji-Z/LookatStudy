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
import { contentNodes, courses, progress as progressTable } from "../db/schema.js";
import { resolveLlm } from "./agent/llm-client.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 懒生成:为单个 lesson 节点实时生成 1-2 句中文摘要,缓存到 summary 字段。
 * 用于用户首次点节点时(getNodeSummary IPC 检测到 summary 为空时调)。
 * 已有 summary 的节点不会调本函数(幂等)。
 */
export async function generateLessonSummary(db: Db, nodeId: string): Promise<string | null> {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, nodeId)).get();
  if (!node || node.type !== "lesson") return null;
  // 已有摘要不重复生成
  if (node.summary) return node.summary;

  const llm = resolveLlm(db);
  const course = db.select().from(courses).where(eq(courses.id, node.courseId)).get();
  const content = node.content ?? "";
  if (content.trim().length < 20) return null; // 内容太短不生成

  const prompt = `你是课程设计专家。为以下课时生成 1-2 句中文摘要:这课学什么 + 核心要点,让学习者快速判断要不要学、学完能掌握什么。30-60 字。

课程: ${course?.title ?? "(未知)"}
课时: ${node.title}

课时内容(前 800 字):
${content.slice(0, 800)}

直接返回摘要文字,不要加 JSON、不要加 markdown 代码块标记、不要加"摘要:"前缀。`;

  const result = await generateText({ model: llm.languageModel, prompt });
  const summary = result.text.replace(/^```.*\n?/i, "").replace(/\s*```$/i, "").trim();
  if (!summary) return null;

  // 缓存到 DB
  db.update(contentNodes)
    .set({ summary })
    .where(eq(contentNodes.id, nodeId))
    .run();
  return summary;
}

/**
 * 为课程的每个 section 生成一句话中文摘要 + 前置依赖标记,
 * 并为每个 lesson 生成 1-2 句摘要(存 summary 字段,不覆盖 content)。
 * 需要 LLM key。
 */
export async function generateLessonSummaries(
  db: Db,
  courseId: string,
): Promise<{ sectionsUpdated: number; lessonsUpdated: number }> {
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

  let sectionsUpdated = 0;
  let lessonsUpdated = 0;
  for (const section of sections) {
    // 取该 section 的所有 lesson
    const lessons = db
      .select()
      .from(contentNodes)
      .all()
      .filter((n) => n.parentId === section.id && n.type === "lesson")
      .sort((a, b) => a.orderIdx - b.orderIdx);

    if (lessons.length === 0) continue;

    // ── Section 摘要(用 lesson 标题列表)──
    const lessonTitles = lessons.map((l) => `- ${l.title}`).join("\n");
    const sectionPrompt = `你是课程设计专家。请为以下章节生成一句话中文摘要和前置知识标记。

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
      const result = await generateText({ model: llm.languageModel, prompt: sectionPrompt });
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const prereq = typeof parsed.prerequisites === "string" ? parsed.prerequisites : "";
      // 写 summary 字段(不再覆盖 content 原文)
      const sectionSummary = summary + (prereq && prereq !== "无" ? `\n\n📌 前置: ${prereq}` : "");
      db.update(contentNodes)
        .set({ summary: sectionSummary })
        .where(eq(contentNodes.id, section.id))
        .run();
      sectionsUpdated++;
    } catch {
      console.error(`[generateLessonSummaries] section ${section.id} failed`);
    }

    // ── Lesson 摘要(批量:每批 5 个 lesson,基于 content 正文)──
    const BATCH_SIZE = 5;
    for (let i = 0; i < lessons.length; i += BATCH_SIZE) {
      const batch = lessons.slice(i, i + BATCH_SIZE);
      const lessonInputs = batch
        .map((l, idx) => `${idx + 1}. [${l.id}] ${l.title}\n${(l.content ?? "").slice(0, 300).replace(/\n/g, " ").trim()}`)
        .join("\n\n");

      const lessonPrompt = `你是课程设计专家。为以下每个课时生成 1-2 句中文摘要(这课学什么 + 核心要点),用户据此快速判断要不要学。

课程: ${course.title}
章节: ${section.title}

课时:
${lessonInputs}

严格返回 JSON 数组,不要加 markdown 代码块标记,每项 id 必须和上面一致:
[
  { "id": "${batch[0]!.id}", "summary": "1-2 句中文摘要" }
]`;

      try {
        const result = await generateText({ model: llm.languageModel, prompt: lessonPrompt });
        const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const arr = JSON.parse(cleaned) as Array<{ id: string; summary: string }>;
        for (const item of arr) {
          if (typeof item.id === "string" && typeof item.summary === "string" && item.summary.trim()) {
            // 验证 id 在本批次(防 LLM 编 id)
            if (batch.some((b) => b.id === item.id)) {
              db.update(contentNodes)
                .set({ summary: item.summary.trim() })
                .where(eq(contentNodes.id, item.id))
                .run();
              lessonsUpdated++;
            }
          }
        }
      } catch {
        console.error(`[generateLessonSummaries] lesson batch ${i} failed`);
      }
    }
  }

  return { sectionsUpdated, lessonsUpdated };
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

  // 构造输入：每课 id + title + content 前 300 字摘要
  // 不再预判 [lesson]/[uncertain] 标签——所有节点统一标 [file]，
  // LLM 对每个节点都有 keep/skip 裁量权（规则不做预决策）
  const lessonInputs = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    preview: (l.content ?? "").slice(0, 300).replace(/\n/g, " ").trim(),
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
        summary: sec.summary || null, // section 摘要存 summary 字段(不覆盖 content)
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

  // 删除 LLM 判 skip 的孤儿节点（不留幽灵——它们不属于任何 section，UI 不可见）
  for (const skipId of skippedSet) {
    db.delete(contentNodes).where(eq(contentNodes.id, skipId)).run();
  }

  // 进度同步:LLM 重排后,确保第一个 lesson 是 available（用户能开始学）
  // 策略:找 LLM 排序的第一个 lesson（第一个 section 的 orderIdx=0 的 lesson），
  // 如果它不是 available，且当前没有其他 available 的 lesson，把它设为 available。
  const firstSection = db.select().from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "section")
    .sort((a, b) => a.orderIdx - b.orderIdx)[0];
  if (firstSection) {
    const firstLesson = db.select().from(contentNodes)
      .where(eq(contentNodes.parentId, firstSection.id))
      .all()
      .filter((n) => n.type === "lesson")
      .sort((a, b) => a.orderIdx - b.orderIdx)[0];
    if (firstLesson) {
      // 检查当前是否有任何 available 的 lesson
      const hasAvailable = db.select().from(progressTable)
        .all()
      .filter((p) => p.status === "available").length > 0;
      if (!hasAvailable) {
        db.update(progressTable)
          .set({ status: "available" })
          .where(eq(progressTable.nodeId, firstLesson.id))
          .run();
      }
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
    .map((l) => `  { "id": "${l.id}", "title": "${l.title}", "preview": "${l.preview.slice(0, 200)}" }`)
    .join(",\n");

  return `你是课程设计专家。下面是「${courseTitle}」这个学习仓库导入后的原始文件列表。
${courseDescription ? `课程描述: ${courseDescription}\n` : ""}
这些文件来自仓库的自动扫描，可能混入非课时内容（notebook 代码、练习、示例、README 介绍页、元数据等）。

请完成以下任务:
1. 判断每个文件是否是真正的课时正文（keep）还是非课时内容（skip）
   - keep: 有教学价值的讲解正文（概念讲解、教程、实战指导）
   - skip: 纯代码 notebook 无讲解、配套练习/作业、仓库元数据、导航页、翻译副本
2. 把所有 keep 的文件分成 3-10 个 section（不要太多碎章节）
3. 把 skip 的文件放进 skippedNodeIds
4. section 按学习难度排序（基础→进阶）
5. 每个 section 有一句中文摘要（说清这章学什么）
6. lessonId 必须用我给你的原始 id，不要编造新 id

文件列表:
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
  "skippedNodeIds": ["id3", "id4"]`;
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

  let obj: { sections?: unknown; skippedNodeIds?: unknown; classified?: unknown };
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

  // 收集 skipped: 显式 skippedNodeIds
  const skippedSet = new Set<string>();
  if (Array.isArray(obj.skippedNodeIds)) {
    for (const id of obj.skippedNodeIds as string[]) {
      if (validSet.has(id)) skippedSet.add(id);
    }
  }
  // 兼容: 如果 LLM 仍返回 classified.skip（旧格式），也收集
  if (obj.classified && typeof obj.classified === "object") {
    const classified = obj.classified as { skip?: unknown };
    if (Array.isArray(classified.skip)) {
      for (const id of classified.skip as string[]) {
        if (validSet.has(id)) skippedSet.add(id);
      }
    }
  }

  return { sections, skippedNodeIds: Array.from(skippedSet) };
}
