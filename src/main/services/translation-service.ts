/**
 * 翻译服务 —— content_node_translations 表的 CRUD。
 *
 * 多语言课程设计:
 * - 原文课程正常导入（content_nodes）
 * - 翻译作为额外层拉取，存入 content_node_translations
 * - 进度/掌握度在 progress 表（共享），切语言不重置
 * - 切换语言时:title/content/summary 用翻译版（如有），否则回退原文
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes, contentNodeTranslations } from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 批量写入翻译（导入时调）。
 * translations: Map<sourcePath, { title, content }> —— key 是原文课程的文件路径。
 * 用 sourcePath 匹配 content_nodes 的 sourcePath 来关联 node_id。
 */
export function persistTranslations(
  db: Db,
  courseId: string,
  locale: string,
  translations: Map<string, { title: string; content: string }>,
): { written: number; skipped: number } {
  // 取该课程所有 lesson 节点的 id + sourcePath
  const nodes = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  let written = 0;
  let skipped = 0;

  for (const node of nodes) {
    // sourcePath 格式如 "Section Title#lesson-anchor"，取 # 前面部分做匹配
    // 或者直接用整个 sourcePath 匹配
    // 实际上 sourcePath 可能是 "README.md#anchor" 或 "lessons/.../README.md"
    // 翻译 Map 的 key 是文件路径（如 "lessons/3-NN/03-Perceptron/README.md"）
    // 尝试精确匹配 + 前缀匹配
    const sp = node.sourcePath ?? "";
    const transEntry =
      translations.get(sp) ??
      translations.get(sp.split("#")[0] ?? sp) ??
      // 尝试用 title 模糊匹配（翻译版 title 可能和原文不同）
      null;

    if (!transEntry) {
      skipped++;
      continue;
    }

    // 检查是否已有翻译行（幂等）
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
      // 更新
      db.update(contentNodeTranslations)
        .set({
          title: transEntry.title,
          content: transEntry.content,
        })
        .where(eq(contentNodeTranslations.id, existing.id))
        .run();
    } else {
      db.insert(contentNodeTranslations)
        .values({
          id: randomUUID(),
          nodeId: node.id,
          courseId,
          locale,
          title: transEntry.title,
          content: transEntry.content,
        })
        .run();
    }
    written++;
  }

  return { written, skipped };
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
