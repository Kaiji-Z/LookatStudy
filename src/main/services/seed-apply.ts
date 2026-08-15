/**
 * 种子课程灌入核心(db 注入式)。
 *
 * 从 seed.ts 抽离的原因:seed.ts 引 db/index.ts(内含 schema.sql?raw,tsx 解析不了),
 * verify 脚本无法 import 它;本模块只静态依赖 schema.ts,verify-seed-bilingual.mjs 可直测。
 *
 * 幂等:已存在且版本号 ≥ 目标 → 跳过。版本号 bump 触发重建(删旧 + 重灌)。
 * v11 起种子课程双语化:原文 zh-CN(content_nodes)+ 内置 en 翻译(content_node_translations,
 * 每条自带 locale)→ 地图标题卡的 🌐 切换器开箱即可演示。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { courses, contentNodes, contentNodeTranslations, progress } from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

/** JSON 顶层结构(与 build-guide-seed.mjs 导出格式对齐) */
export interface SeedData {
  version: number;
  courseId: string;
  course: {
    id: string;
    repoUrl: string | null;
    repoName: string;
    title: string;
    description: string | null;
    labType: "doc" | "code" | "notebook";
  };
  /** 原文语言(BCP-47),灌入时写 courses.source_lang */
  locale: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    type: "section" | "lesson" | "exam";
    title: string;
    sourcePath: string | null;
    orderIdx: number;
    content: string | null;
    summary: string | null;
    summaryEn: string | null;
  }>;
  progress: Array<{
    nodeId: string;
    status: "locked" | "available" | "in_progress" | "mastered";
    crownLevel: number;
  }>;
  /** 内置翻译,v11 起每条自带 locale(如 "en");nodeId 关联 content_nodes */
  translations: Array<{
    nodeId: string;
    locale: string;
    title: string;
    content: string | null;
  }>;
}

/**
 * 幂等灌入。同步、离线、瞬时。
 * 返回 { skipped: true } 表示已存在且版本匹配,本次未动库。
 */
export function applySeedData(db: Db, SEED_DATA: SeedData, SEED_VERSION: number): { skipped: boolean } {
  const COURSE_ID = SEED_DATA.courseId;

  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();

  // 幂等:已存在且版本号匹配 → 跳过
  if (existing && (existing.version ?? 1) >= SEED_VERSION) return { skipped: true };

  // 版本号旧或不存在 → 删除旧种子课程(含 content_nodes/progress 由 FK CASCADE,
  // 但 sql.js 的 FK 有时不稳,显式删更安全)
  // 兼容清理:旧版种子 id
  const LEGACY_SEED_IDS = ["seed-fde-roadmap", "seed-ai-for-beginners"];
  for (const oldId of LEGACY_SEED_IDS) {
    const oldRow = db.select().from(courses).where(eq(courses.id, oldId)).get();
    if (oldRow) {
      db.delete(contentNodeTranslations).where(eq(contentNodeTranslations.courseId, oldId)).run();
      db.delete(contentNodes).where(eq(contentNodes.courseId, oldId)).run();
      db.delete(courses).where(eq(courses.id, oldId)).run();
      console.error(`[lookatstudy] 清理旧种子课程: ${oldId}`);
    }
  }
  if (existing) {
    // 翻译表显式删:UNIQUE(node_id, locale) 下残留行会让重灌 UNIQUE 冲突,启动即崩
    db.delete(contentNodeTranslations).where(eq(contentNodeTranslations.courseId, COURSE_ID)).run();
    db.delete(contentNodes).where(eq(contentNodes.courseId, COURSE_ID)).run();
    db.delete(courses).where(eq(courses.id, COURSE_ID)).run();
  }

  // ── 灌入 course 行 ──
  // COURSE_ID 来自顶层 courseId 字段,作单一权威;course.id 应与之一致(JSON 校验)。
  const c = SEED_DATA.course;
  if (c.id !== COURSE_ID) {
    throw new Error(
      `seed-course.json 数据不一致:courseId="${COURSE_ID}" vs course.id="${c.id}"`,
    );
  }
  db.insert(courses)
    .values({
      id: COURSE_ID,
      repoUrl: c.repoUrl,
      repoName: c.repoName,
      title: c.title,
      description: c.description,
      version: SEED_VERSION,
      labType: c.labType,
      sourceLang: SEED_DATA.locale,
    })
    .run();

  // ── 灌入 content_nodes ──
  for (const n of SEED_DATA.nodes) {
    db.insert(contentNodes)
      .values({
        id: n.id,
        courseId: COURSE_ID,
        parentId: n.parentId,
        type: n.type,
        title: n.title,
        sourcePath: n.sourcePath,
        orderIdx: n.orderIdx,
        content: n.content,
        summary: n.summary,
        summaryEn: n.summaryEn ?? null,
      })
      .run();
  }

  // ── 灌入 初始 progress ──
  for (const p of SEED_DATA.progress) {
    db.insert(progress)
      .values({
        nodeId: p.nodeId,
        status: p.status,
        crownLevel: p.crownLevel,
      })
      .run();
  }

  // ── 灌入 内置翻译(v11 起) ──
  for (const t of SEED_DATA.translations) {
    const transId = `${t.nodeId}-${t.locale}`;
    db.insert(contentNodeTranslations)
      .values({
        id: transId,
        nodeId: t.nodeId,
        courseId: COURSE_ID,
        locale: t.locale,
        title: t.title,
        content: t.content,
      })
      .run();
  }

  const sectionCount = SEED_DATA.nodes.filter((n) => n.type === "section").length;
  const lessonCount = SEED_DATA.nodes.filter((n) => n.type === "lesson").length;
  const transLocales = [...new Set(SEED_DATA.translations.map((t) => t.locale))].join("/");
  console.error(
    `[lookatstudy] 种子课程就绪(内置): ${sectionCount} 章 / ${lessonCount} 课 / 原文 ${SEED_DATA.locale}` +
      (SEED_DATA.translations.length > 0 ? ` + 翻译 ${transLocales} ×${SEED_DATA.translations.length}` : ""),
  );
  return { skipped: false };
}
