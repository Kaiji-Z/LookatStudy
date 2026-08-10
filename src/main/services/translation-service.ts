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
 * translations: Map<originalPath, { title, content }> —— key 是原文课程的文件路径。
 *
 * 匹配策略（按优先级）:
 * 1. 精确路径匹配: translations key === node.sourcePath
 * 2. 路径前缀匹配: node.sourcePath 的 # 前缀（section dir）在 translations key 里出现
 * 3. 标题匹配: translations value.title === node.title（翻译版文件 H1 == 原文 lesson 标题）
 *
 * 策略 3 是主力——因为 buildCourseFromFiles 把文件内容拆成 lesson 后,
 * lesson 标题来自文件的 H3 或 H1,翻译版文件有同样的标题结构。
 */
export function persistTranslations(
  db: Db,
  courseId: string,
  locale: string,
  translations: Map<string, { title: string; content: string }>,
): { written: number; skipped: number } {
  // 取该课程所有 lesson 节点的 id + sourcePath + title + content
  const nodes = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, courseId))
    .all()
    .filter((n) => n.type === "lesson");

  // 构建翻译查找索引
  // 1. 按标题索引（主力）: Map<lowercaseTitle, translation>
  const titleIndex = new Map<string, { title: string; content: string }>();
  for (const [, trans] of translations) {
    // 从翻译版 content 里提取所有 H1/H2/H3 标题，建索引
    const headingMatches = trans.content.matchAll(/^#{1,3}\s+(.+)$/gm);
    for (const m of headingMatches) {
      const heading = m[1]!.trim().toLowerCase();
      if (!titleIndex.has(heading)) {
        titleIndex.set(heading, trans);
      }
    }
    // 也按 FetchedFile.title 建索引
    const fileTitle = trans.title.trim().toLowerCase();
    if (!titleIndex.has(fileTitle)) {
      titleIndex.set(fileTitle, trans);
    }
  }

  // 2. 按路径索引（辅助）: Map<originalPath, translation>
  const pathIndex = translations;

  let written = 0;
  let skipped = 0;

  for (const node of nodes) {
    const sp = node.sourcePath ?? "";
    const nodeTitle = node.title.trim().toLowerCase();

    // 尝试匹配
    let transEntry: { title: string; content: string } | null = null;

    // 策略 1: 精确路径
    transEntry = pathIndex.get(sp) ?? null;

    // 策略 2: 路径前缀（sourcePath 的 # 前缀在某个 translations key 里）
    if (!transEntry) {
      const sectionDir = sp.split("#")[0];
      for (const [origPath, trans] of pathIndex) {
        if (origPath.includes(sectionDir)) {
          transEntry = trans;
          break;
        }
      }
    }

    // 策略 3: 标题匹配
    if (!transEntry) {
      transEntry = titleIndex.get(nodeTitle) ?? null;
    }

    if (!transEntry) {
      skipped++;
      continue;
    }

    // 从翻译版 content 提取该 lesson 对应的正文片段
    // （翻译版文件可能包含多课内容，我们取整个文件作为翻译内容）
    const transTitle = extractTranslatedTitle(transEntry.content, transEntry.title, node.title);

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
      db.update(contentNodeTranslations)
        .set({
          title: transTitle,
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
          title: transTitle,
          content: transEntry.content,
        })
        .run();
    }
    written++;
  }

  return { written, skipped };
}

/**
 * 从翻译版 content 里提取对应原文 lesson 的标题。
 * 优先级:content 里的 H1 → FetchedFile.title（翻译版的链接文本）→ 原文标题兜底
 */
function extractTranslatedTitle(transContent: string, fileTitle: string, originalTitle: string): string {
  // 翻译版文件的第一个 H1
  const h1Match = transContent.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1]!.trim();
  // 翻译版的链接文本（FetchedFile.title）
  if (fileTitle && fileTitle.trim()) return fileTitle.trim();
  // 回退到原标题
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
