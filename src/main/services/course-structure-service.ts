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
    world: "study" | "practice";
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
  onProgress?: (msg: string) => void,
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
  const lessonInputs = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    preview: (l.content ?? "").slice(0, 300).replace(/\n/g, " ").trim(),
  }));

  // 分块:大课程（>40 课）分批调 LLM，每批 ≤40 课，防止 prompt 过大导致截断/幻觉
  const CHUNK_SIZE = 40;
  const allSections: StructureProposal["sections"] = [];
  const allSkipped: string[] = [];

  if (lessonInputs.length <= CHUNK_SIZE) {
    // 小课程:单次调用
    const prompt = buildStructurePrompt(
      course?.title ?? "(未知课程)", course?.description ?? "", lessonInputs,
    );
    const result = await generateText({ model: llm.languageModel, prompt });
    const proposal = parseStructureResult(result.text, lessons.map((l) => l.id));
    return proposal;
  }

  // 大课程:分块调用，每批独立分组，最后合并
  const courseTitle = course?.title ?? "(未知课程)";
  const courseDesc = course?.description ?? "";
  for (let i = 0; i < lessonInputs.length; i += CHUNK_SIZE) {
    const chunk = lessonInputs.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(lessonInputs.length / CHUNK_SIZE);
    onProgress?.(`AI 分析中（第 ${chunkNum}/${totalChunks} 批，${chunk.length} 课）…`);
    const prompt = buildStructurePrompt(
      `${courseTitle}（第 ${chunkNum}/${totalChunks} 部分）`, courseDesc, chunk,
    );
    const result = await generateText({ model: llm.languageModel, prompt });
    const proposal = parseStructureResult(result.text, chunk.map((l) => l.id));
    allSections.push(...proposal.sections);
    allSkipped.push(...proposal.skippedNodeIds);
  }

  return { sections: allSections, skippedNodeIds: allSkipped };
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
    const secWorld = sec.world ?? "study";
    db.insert(contentNodes)
      .values({
        id: sectionId,
        courseId,
        parentId: null,
        type: "section",
        title: sec.title,
        sourcePath: null,
        orderIdx: sectionOrder++,
        summary: sec.summary || null,
        world: secWorld,
      })
      .run();

    let lessonOrder = 0;
    for (const lessonId of validIds) {
      db.update(contentNodes)
        .set({ parentId: sectionId, orderIdx: lessonOrder++, world: secWorld })
        .where(eq(contentNodes.id, lessonId))
        .run();
      lessonCount++;
    }
  }

  // 删除 LLM 判 skip 的孤儿节点（不留幽灵——它们不属于任何 section，UI 不可见）
  for (const skipId of skippedSet) {
    db.delete(contentNodes).where(eq(contentNodes.id, skipId)).run();
  }

  // 进度同步:LLM 重排后,重置 progress 门控。
  // practice 节点:全部 available(实操自由探索,不受 BKT 门控)
  // study 节点:第一个 study section 的第一个 lesson = available,其余 locked
  const courseLessons = db.select().from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  // practice 节点 → available
  for (const lesson of courseLessons.filter((l) => (l.world ?? "study") === "practice")) {
    const existing = db.select().from(progressTable)
      .where(eq(progressTable.nodeId, lesson.id)).get();
    if (existing) {
      db.update(progressTable).set({ status: "available" })
        .where(eq(progressTable.nodeId, lesson.id)).run();
    } else {
      db.insert(progressTable).values({
        nodeId: lesson.id, status: "available", crownLevel: 0,
      }).run();
    }
  }

  // study 节点:第一个 study section 的第一个 lesson = available,其余 locked
  const firstStudySection = db.select().from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "section" && (n.world ?? "study") === "study")
    .sort((a, b) => a.orderIdx - b.orderIdx)[0];

  const firstStudyLessonId = firstStudySection
    ? db.select().from(contentNodes)
        .where(eq(contentNodes.parentId, firstStudySection.id))
        .all()
        .filter((n) => n.type === "lesson" && (n.world ?? "study") === "study")
        .sort((a, b) => a.orderIdx - b.orderIdx)[0]?.id
    : null;

  for (const lesson of courseLessons.filter((l) => (l.world ?? "study") === "study")) {
    const shouldBeAvailable = lesson.id === firstStudyLessonId;
    const existing = db.select().from(progressTable)
      .where(eq(progressTable.nodeId, lesson.id)).get();
    const status = shouldBeAvailable ? "available" : "locked";
    if (existing) {
      // 只改 locked/available,不改已 in_progress/mastered 的(用户已学过的保留)
      if (existing.status === "locked" || existing.status === "available") {
        db.update(progressTable).set({ status })
          .where(eq(progressTable.nodeId, lesson.id)).run();
      }
    } else {
      db.insert(progressTable).values({
        nodeId: lesson.id, status, crownLevel: 0,
      }).run();
    }
  }

  return {
    sectionCount: sectionOrder,
    lessonCount,
    skippedCount: skippedSet.size,
  };
}

/* ============================================================
 * well-organized 路径:只判 world 不重组章节。
 * 对已组织好目录结构的仓库(如 microsoft/AI-For-Beginners),
 * 保留 sectionKeyOf 算出的原始 section,只让 LLM 判每个 lesson 的 world。
 * ============================================================ */

/** LLM world 分类结果 */
export interface WorldClassification {
  nodeId: string;
  world: "study" | "practice" | "skip";
}

/**
 * LLM 只判 world(不重组章节)。适用于 well-organized 仓库。
 * 喂 lesson 列表(含 sourcePath 目录信息)给 LLM,让它判 study/practice/skip。
 */
export async function classifyWorldsOnly(
  db: Db,
  courseId: string,
  onProgress?: (msg: string) => void,
): Promise<WorldClassification[]> {
  const llm = resolveLlm(db);
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  const lessons = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  if (lessons.length === 0) return [];

  const inputs = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    sourcePath: l.sourcePath ?? "",
    preview: (l.content ?? "").slice(0, 200).replace(/\n/g, " ").trim(),
  }));

  // 分块(同 analyzeCourseStructure)
  const CHUNK_SIZE = 40;
  const allResults: WorldClassification[] = [];

  if (inputs.length <= CHUNK_SIZE) {
    onProgress?.(`AI 分类中（${inputs.length} 课）…`);
    const prompt = buildWorldOnlyPrompt(course?.title ?? "(未知课程)", inputs);
    const result = await generateText({ model: llm.languageModel, prompt });
    allResults.push(...parseWorldOnlyResult(result.text, lessons.map((l) => l.id)));
    return allResults;
  }

  for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
    const chunk = inputs.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(inputs.length / CHUNK_SIZE);
    onProgress?.(`AI 分类中（第 ${chunkNum}/${totalChunks} 批，${chunk.length} 课）…`);
    const prompt = buildWorldOnlyPrompt(course?.title ?? "(未知课程)", chunk);
    const result = await generateText({ model: llm.languageModel, prompt });
    allResults.push(...parseWorldOnlyResult(result.text, chunk.map((c) => c.id)));
  }

  return allResults;
}

/**
 * 应用 world 分类到 DB(不删 section、不改 parentId、不改 orderIdx)。
 * 只更新 lesson.world + section.world(按子节点多数派) + 删 skip 节点 + 重置 progress。
 */
export function applyWorldClassification(
  db: Db,
  courseId: string,
  classifications: WorldClassification[],
): { studyCount: number; practiceCount: number; skippedCount: number } {
  const validIds = new Set(
    db.select().from(contentNodes).where(eq(contentNodes.courseId, courseId)).all()
      .filter((n) => n.type === "lesson")
      .map((n) => n.id),
  );

  let studyCount = 0;
  let practiceCount = 0;
  let skippedCount = 0;

  for (const c of classifications) {
    if (!validIds.has(c.nodeId)) continue;
    if (c.world === "skip") {
      // 删真正噪声(translation/meta 等)
      db.delete(contentNodes).where(eq(contentNodes.id, c.nodeId)).run();
      skippedCount++;
    } else {
      db.update(contentNodes)
        .set({ world: c.world })
        .where(eq(contentNodes.id, c.nodeId))
        .run();
      if (c.world === "study") studyCount++;
      else practiceCount++;
    }
  }

  // 拆分 practice lesson 到独立的 practice section。
  // 微软仓库里 study README 和 practice notebook 在同一个目录(sectionKeyOf 归同一 section),
  // 但用户需要"学习世界"和"实操世界"分开显示。
  // 做法:遍历所有 section,如果有混合的 practice lesson,把它们移到一个新建的 practice section。
  const sections = db.select().from(contentNodes).where(eq(contentNodes.courseId, courseId)).all()
    .filter((n) => n.type === "section");

  // 收集所有需要拆出来的 practice lesson
  const orphanPractice: { lesson: typeof contentNodes.$inferSelect; fromSection: string }[] = [];
  for (const sec of sections) {
    const childLessons = db.select().from(contentNodes).where(eq(contentNodes.parentId, sec.id)).all()
      .filter((n) => n.type === "lesson");
    const practiceLessons = childLessons.filter((l) => l.world === "practice");
    const studyLessons = childLessons.filter((l) => (l.world ?? "study") === "study");

    if (practiceLessons.length > 0 && studyLessons.length > 0) {
      // 混合 section:practice lesson 标记为孤儿,稍后移走
      for (const pl of practiceLessons) {
        orphanPractice.push({ lesson: pl, fromSection: sec.title });
      }
    } else if (practiceLessons.length > 0 && studyLessons.length === 0) {
      // 纯 practice section:不需要拆
      db.update(contentNodes).set({ world: "practice" }).where(eq(contentNodes.id, sec.id)).run();
    } else {
      // 纯 study section
      db.update(contentNodes).set({ world: "study" }).where(eq(contentNodes.id, sec.id)).run();
    }
  }

  // 如果有孤儿 practice lesson,创建 practice section 并移入
  if (orphanPractice.length > 0) {
    const { randomUUID } = require("node:crypto") as { randomUUID: () => string };
    const maxOrder = Math.max(...sections.map((s) => s.orderIdx), 0);
    const practiceSectionId = randomUUID();
    db.insert(contentNodes).values({
      id: practiceSectionId,
      courseId,
      parentId: null,
      type: "section",
      title: "🔧 实操练习",
      sourcePath: null,
      orderIdx: maxOrder + 1,
      world: "practice",
      summary: null,
    }).run();

    let practiceOrder = 0;
    for (const { lesson } of orphanPractice) {
      db.update(contentNodes)
        .set({ parentId: practiceSectionId, orderIdx: practiceOrder++ })
        .where(eq(contentNodes.id, lesson.id))
        .run();
    }
  }

  // 重置 progress 门控(practice=available, study 第一课=available, 其余 locked)
  const courseLessons = db.select().from(contentNodes).where(eq(contentNodes.courseId, courseId)).all()
    .filter((n) => n.type === "lesson");

  // practice → available
  for (const lesson of courseLessons.filter((l) => l.world === "practice")) {
    const existing = db.select().from(progressTable).where(eq(progressTable.nodeId, lesson.id)).get();
    if (existing) {
      db.update(progressTable).set({ status: "available" }).where(eq(progressTable.nodeId, lesson.id)).run();
    } else {
      db.insert(progressTable).values({ nodeId: lesson.id, status: "available", crownLevel: 0 }).run();
    }
  }

  // study: 第一个 study section 的第一个 study lesson = available, 其余 locked
  const firstStudySection = sections
    .filter((s) => (s.world ?? "study") === "study")
    .sort((a, b) => a.orderIdx - b.orderIdx)[0];
  const firstStudyLessonId = firstStudySection
    ? db.select().from(contentNodes).where(eq(contentNodes.parentId, firstStudySection.id)).all()
        .filter((n) => n.type === "lesson" && (n.world ?? "study") === "study")
        .sort((a, b) => a.orderIdx - b.orderIdx)[0]?.id
    : null;

  for (const lesson of courseLessons.filter((l) => (l.world ?? "study") === "study")) {
    const shouldBeAvailable = lesson.id === firstStudyLessonId;
    const existing = db.select().from(progressTable).where(eq(progressTable.nodeId, lesson.id)).get();
    const status = shouldBeAvailable ? "available" : "locked";
    if (existing) {
      if (existing.status === "locked" || existing.status === "available") {
        db.update(progressTable).set({ status }).where(eq(progressTable.nodeId, lesson.id)).run();
      }
    } else {
      db.insert(progressTable).values({ nodeId: lesson.id, status, crownLevel: 0 }).run();
    }
  }

  return { studyCount, practiceCount, skippedCount };
}

/* ---------- well-organized 路径内部工具 ---------- */

function buildWorldOnlyPrompt(
  courseTitle: string,
  lessons: { id: string; title: string; sourcePath: string; preview: string }[],
): string {
  const lessonList = lessons
    .map((l) => `  { "id": "${l.id}", "title": "${l.title}", "sourcePath": "${l.sourcePath.slice(0, 80)}", "preview": "${l.preview.slice(0, 150)}" }`)
    .join(",\n");

  return `你是课程内容分类专家。下面是「${courseTitle}」这个学习仓库的课时文件列表。
这个仓库的**目录结构已经决定了章节**(你不要重组),你只需判断每个文件的 world 分类。

分类标准:
- **study**: 讲解正文(概念讲解、理论、教程、文档) → 学习世界主线
- **practice**: notebook 代码、配套练习、lab、示例代码 → 实操世界
- **skip**: 真正的噪声(仓库元数据、翻译副本、纯环境配置 setup/install)

提示:
- sourcePath 里的文件扩展名(.ipynb/.py → 可能 practice,.md → 可能 study)
- 路径含 /lab/ /exercise/ → 大概率 practice
- 但这些只是提示,最终由你根据 title + preview 内容判断

文件列表:
[
${lessonList}
]

严格返回以下 JSON 格式,不要加 markdown 代码块标记:
[
  { "nodeId": "id1", "world": "study" },
  { "nodeId": "id2", "world": "practice" },
  { "nodeId": "id3", "world": "skip" }
]`;
}

function parseWorldOnlyResult(raw: string, validIds: string[]): WorldClassification[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM world 分类 JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!Array.isArray(arr)) {
    throw new Error("LLM world 分类返回的不是数组");
  }

  const validSet = new Set(validIds);
  return (arr as Array<Record<string, unknown>>)
    .map((item) => ({
      nodeId: typeof item.nodeId === "string" ? item.nodeId : "",
      world: item.world === "practice" ? "practice" as const
           : item.world === "skip" ? "skip" as const
           : "study" as const,
    }))
    .filter((c) => validSet.has(c.nodeId));
}

/* ---------- 原路径内部工具 ---------- */

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
这些文件来自仓库的自动扫描，可能包含讲解正文、notebook 代码、练习、示例、环境设置等。

这个课程分**两个世界**:
- **study（学习世界）**: 概念讲解、理论、教程正文 —— 用户的主线学习路径
- **practice（实操世界）**: notebook 代码、配套练习、示例代码 —— 用户学完某课想动手时的资源

请完成以下任务:
1. 判断每个文件属于哪个世界，或应该跳过:
   - **study**: 有教学价值的讲解正文（概念讲解、教程、实战指导）
   - **practice**: notebook 代码、配套练习/作业、示例代码（用户动手探索的资源）
   - **skip**: 真正的噪声 —— 仓库元数据、翻译副本、纯环境配置(setup/install)、空导航页
2. 把 study 文件分成 3-10 个 section（学习难度排序:基础→进阶）
3. 把 practice 文件按"对应学习章节"或"类型"分成 section（挂 practice 世界）
4. skip 的文件放进 skippedNodeIds
5. 每个 section 有一句中文摘要 + 标明 world
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
      "world": "study",
      "lessonIds": ["id1", "id2"]
    },
    {
      "title": "实操练习标题",
      "summary": "这些练习对应哪些课程",
      "world": "practice",
      "lessonIds": ["id3"]
    }
  ],
  "skippedNodeIds": ["id4", "id5"]`;
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
      world: s.world === "practice" ? "practice" as const : "study" as const,
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
