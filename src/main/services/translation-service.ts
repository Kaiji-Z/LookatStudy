/**
 * 翻译服务 —— content_node_translations 表的 CRUD。
 *
 * 多语言课程设计:
 * - 原文课程正常导入（content_nodes）
 * - 翻译作为额外层拉取，存入 content_node_translations
 * - 进度/掌握度在 progress 表（共享），切语言不重置
 * - 切换语言时:title/content/summary 用翻译版（如有），否则回退原文
 *
 * 匹配原则:规则管确定性，LLM 管不确定
 * - 规则:精确路径匹配（sourcePath 的文件路径部分 === translations key）→ 直接写
 * - LLM:路径对不上的 → 给 LLM 看原文 lesson 列表 + 翻译文件标题，让它判对应关系
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { generateText } from "ai";
import * as schema from "../db/schema.js";
import { contentNodes, contentNodeTranslations } from "../db/schema.js";
import { resolveLlm } from "./agent/llm-client.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 批量写入翻译（导入时调）。
 * translations: Map<originalPath, { title, content }> —— key 是原文课程的文件路径。
 *
 * 匹配策略:
 * 1. 规则（高置信度）: 精确路径匹配 — node.sourcePath 的文件路径部分 === translations key
 * 2. LLM（不确定的）: 路径对不上的 lesson，给 LLM 做语义对齐
 *
 * 如果 LLM 不可用（无 API key），降级为不匹配（只写精确路径命中的）。
 */
export async function persistTranslations(
  db: Db,
  courseId: string,
  locale: string,
  translations: Map<string, { title: string; content: string }>,
): Promise<{ written: number; skipped: number; llmAligned: number }> {
  const nodes = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  // ── 第 1 步:规则精确路径匹配（高置信度）──
  // sourcePath 现在格式是 "文件路径#anchor"（course-generator 改后），取 # 前面做匹配
  const matched = new Map<string, { title: string; content: string }>(); // nodeId → translation
  const unmatchedNodes: typeof nodes = [];

  for (const node of nodes) {
    const sp = node.sourcePath ?? "";
    const filePath = sp.split("#")[0]; // 取文件路径部分
    const transEntry = translations.get(filePath);
    if (transEntry) {
      // 精确路径命中 → 规则确定
      matched.set(node.id, transEntry);
    } else {
      unmatchedNodes.push(node);
    }
  }

  // ── 第 2 步:LLM 语义对齐（不确定的）──
  let llmAligned = 0;
  if (unmatchedNodes.length > 0 && unmatchedNodes.length <= 100) {
    try {
      const llmResult = await alignTranslationsWithLlm(db, unmatchedNodes, translations);
      for (const [nodeId, transPath] of llmResult) {
        const trans = translations.get(transPath);
        if (trans) {
          matched.set(nodeId, trans);
          llmAligned++;
        }
      }
    } catch {
      // LLM 不可用或失败 → 只写规则匹配的
    }
  }

  // ── 第 3 步:写入 DB ──
  let written = 0;
  let skipped = 0;
  for (const node of nodes) {
    const transEntry = matched.get(node.id);
    if (!transEntry) {
      skipped++;
      continue;
    }

    const transTitle = extractTranslatedTitle(transEntry.content, transEntry.title, node.title);
    const existing = db
      .select()
      .from(contentNodeTranslations)
      .where(
        and(
          eq(contentNodeTranslations.nodeId, node.id),
          eq(contentNodeTranslations.locale, locale),
        ),
      )
      .get();

    if (existing) {
      db.update(contentNodeTranslations)
        .set({ title: transTitle, content: transEntry.content })
        .where(eq(contentNodeTranslations.id, existing.id))
        .run();
    } else {
      db.insert(contentNodeTranslations)
        .values({
          id: randomUUID(),
          nodeId: node.id,
          courseId,
          locale,
          title: transTitle,
          content: transEntry.content,
        })
        .run();
    }
    written++;
  }

  return { written, skipped, llmAligned };
}

/**
 * LLM 语义对齐:给 LLM 看未匹配的 lesson 列表 + 翻译文件列表，让它判断对应关系。
 *
 * 返回 Map<nodeId, translationPath>。
 */
async function alignTranslationsWithLlm(
  db: Db,
  unmatchedNodes: Array<{ id: string; title: string; content: string | null }>,
  translations: Map<string, { title: string; content: string }>,
): Promise<Map<string, string>> {
  const llm = resolveLlm(db);

  // 原文 lesson 列表
  const lessonList = unmatchedNodes.map((n) => ({
    id: n.id,
    title: n.title,
    preview: (n.content ?? "").slice(0, 100).replace(/\n/g, " ").trim(),
  }));

  // 翻译文件列表（path + 所有标题）
  const transList = Array.from(translations.entries()).map(([path, t]) => {
    const headings = (t.content.match(/^#{1,3}\s+(.+)$/gm) || [])
      .map((h) => h.replace(/^#{1,3}\s+/, "").trim())
      .slice(0, 5);
    return { path, title: t.title, headings };
  });

  const prompt = `你是一个翻译对齐专家。下面是课程的原始课时列表和翻译文件列表。
请判断每个原始课时对应哪个翻译文件（通过标题和内容的语义相似度）。

原始课时:
${JSON.stringify(lessonList, null, 2)}

翻译文件:
${JSON.stringify(transList, null, 2)}

请返回 JSON 数组，每项是 { "lessonId": "原文课时id", "translationPath": "翻译文件path" }。
如果某个课时没有对应的翻译文件，不要包含它。
不要加 markdown 代码块标记。`;

  const result = await generateText({ model: llm.languageModel, prompt });
  const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const arr = JSON.parse(cleaned) as Array<{ lessonId: string; translationPath: string }>;
  const validLessonIds = new Set(unmatchedNodes.map((n) => n.id));
  const validPaths = new Set(translations.keys());
  const resultMap = new Map<string, string>();

  for (const item of arr) {
    if (
      typeof item.lessonId === "string" &&
      typeof item.translationPath === "string" &&
      validLessonIds.has(item.lessonId) &&
      validPaths.has(item.translationPath)
    ) {
      resultMap.set(item.lessonId, item.translationPath);
    }
  }

  return resultMap;
}

/**
 * 从翻译版 content 里提取对应原文 lesson 的标题。
 * 优先级:content 里的 H1 → FetchedFile.title → 原文标题兜底
 */
function extractTranslatedTitle(transContent: string, fileTitle: string, originalTitle: string): string {
  const h1Match = transContent.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1]!.trim();
  if (fileTitle && fileTitle.trim()) return fileTitle.trim();
  return originalTitle;
}

/**
 * 读取单节点的翻译。
 */
export function getNodeTranslation(
  db: Db,
  nodeId: string,
  locale: string,
): { title: string; content: string | null; summary: string | null } | null {
  const row = db
    .select()
    .from(contentNodeTranslations)
    .where(
      and(
        eq(contentNodeTranslations.nodeId, nodeId),
        eq(contentNodeTranslations.locale, locale),
      ),
    )
    .get();
  if (!row) return null;
  return { title: row.title, content: row.content, summary: row.summary };
}

/**
 * 获取课程所有可用翻译语言。
 */
export function getCourseLanguages(db: Db, courseId: string): string[] {
  const rows = db
    .select({ locale: contentNodeTranslations.locale })
    .from(contentNodeTranslations)
    .where(eq(contentNodeTranslations.courseId, courseId))
    .all();
  return [...new Set(rows.map((r) => r.locale))].sort();
}

/**
 * 获取课程的翻译标题映射（用于 getCourseTree 带 locale）。
 * 返回 Map<nodeId, translatedTitle>。
 */
export function getCourseTitleTranslations(
  db: Db,
  courseId: string,
  locale: string,
): Map<string, string> {
  const rows = db
    .select({ nodeId: contentNodeTranslations.nodeId, title: contentNodeTranslations.title })
    .from(contentNodeTranslations)
    .where(
      and(
        eq(contentNodeTranslations.courseId, courseId),
        eq(contentNodeTranslations.locale, locale),
      ),
    )
    .all();
  return new Map(rows.map((r) => [r.nodeId, r.title]));
}
