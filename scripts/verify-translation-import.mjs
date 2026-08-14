/**
 * 翻译落库验证 —— executeImport 的显式配对（translationPairs）优先
 * + suffix 布局 resolver 对 .txt 双语对的路径解析。
 *
 * 背景 Bug: executeImport 收的 translationFiles 参数是死的（从不传给
 * fetchAndPersistTranslations），落库全靠 layout 猜路径；而 suffix resolver
 * 只认 md 系扩展 + 不剥原文自带的语言后缀 → xxx.en.txt 的翻译路径算成
 * xxx.en.zh-CN.md（不存在）→ 翻译表全空。
 *
 * 跑法: npx tsx scripts/verify-translation-import.mjs (也被 verify:core 调用)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { executeImport } from "../src/main/services/import-pipeline.ts";
import { LocalContentSource } from "../src/main/services/content-source.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });

function freshDb() {
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

const EN = "# Derivatives\n\nA derivative measures the rate of change.";
const ZH = "# 导数\n\n导数衡量函数在某一点的瞬时变化率。";

function makeSource() {
  const docsMap = new Map([
    ["calc/01.en.txt", EN],
    ["calc/01.zh-CN.txt", ZH],
  ]);
  return new LocalContentSource("X:/unused", docsMap); // 内容全在 docsMap，不碰磁盘
}

const structure = {
  courseTitle: "双语测试课",
  sections: [{
    title: "第一章", world: "study",
    lessons: [{ title: "第 1 课", file: "calc/01.en.txt", world: "study" }],
  }],
};

function readTranslations(sqljs) {
  return sqljs.exec("SELECT node_id, locale, title, content FROM content_node_translations");
}

// ── T1: 显式配对（translationPairs）优先落库 ──
{
  const { sqljs, db } = freshDb();
  await executeImport(db, structure, {
    source: makeSource(),
    repoUrl: null, repoName: "bilingual-test",
    langCode: "zh-CN",
    translationFiles: new Map([["zh-CN", ["calc/01.zh-CN.txt"]]]),
    translationPairs: new Map([["calc/01.en.txt", "calc/01.zh-CN.txt"]]),
    sourceLang: "en",
    translationLayout: "suffix",
    markDirty: () => {},
  });
  const rows = readTranslations(sqljs);
  assert.ok(rows.length === 1, `T1: 应有 1 行翻译, 实际 ${rows.length}`);
  const [nodeId, locale, title, content] = rows[0].values[0];
  assert.equal(locale, "zh-CN", "T1: locale=zh-CN");
  assert.equal(content, ZH, "T1: 内容是中文文件全文（显式配对命中）");
  assert.equal(title, "导数", `T1: 翻译标题取首个标题, got ${title}`);
  // 翻译行的 node_id 必须对应那个 lesson
  const lessonNode = sqljs.exec("SELECT id FROM content_nodes WHERE type='lesson'")[0].values[0][0];
  assert.equal(nodeId, lessonNode, "T1: 翻译挂在正确的 lesson 上");
  console.log("✓ T1 显式配对: translationPairs 命中 → 中文落 content_node_translations");
}

// ── T2: 无显式配对时 suffix resolver 对 .txt 双语对算对路径 ──
// calc/01.en.txt → calc/01.zh-CN.txt（剥原文 .en 后缀，不是 xxx.en.zh-CN.md）
{
  const { sqljs, db } = freshDb();
  await executeImport(db, structure, {
    source: makeSource(),
    repoUrl: null, repoName: "bilingual-test",
    langCode: "zh-CN",
    translationFiles: new Map([["zh-CN", []]]),
    translationPairs: null,
    sourceLang: "en",
    translationLayout: "suffix",
    markDirty: () => {},
  });
  const rows = readTranslations(sqljs);
  assert.ok(rows.length === 1, `T2: resolver 也应找到翻译, 实际 ${rows.length} 行`);
  assert.equal(rows[0].values[0][3], ZH, "T2: resolver 算对路径 → 中文内容");
  console.log("✓ T2 suffix resolver: .txt 双语对剥语言后缀算对路径");
}

// ── T3: 翻译文件不存在时静默跳过（不炸、课程仍落库）──
{
  const { sqljs, db } = freshDb();
  await executeImport(db, structure, {
    source: makeSource(),
    repoUrl: null, repoName: "bilingual-test",
    langCode: "zh-CN",
    translationFiles: new Map([["zh-CN", []]]),
    translationPairs: null,
    sourceLang: "en",
    translationLayout: "microsoft", // translations/zh-CN/calc/01.en.txt 不存在
    markDirty: () => {},
  });
  const rows = readTranslations(sqljs);
  assert.equal(rows.length, 0, "T3: 无翻译 → 0 行");
  const lessons = sqljs.exec("SELECT COUNT(*) FROM content_nodes WHERE type='lesson'")[0].values[0][0];
  assert.equal(lessons, 1, "T3: 课程本体不受影响");
  console.log("✓ T3 容错: 翻译缺失静默跳过, 课程本体完整");
}

console.log("\n=== ALL TRANSLATION IMPORT TESTS PASSED ✅ ===");
