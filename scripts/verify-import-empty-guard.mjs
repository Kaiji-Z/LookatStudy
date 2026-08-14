/**
 * 导入管线"空课程守卫"回归测试。
 *
 * 背景Bug: 本地导入一个全是 .txt/.html/.pdf 的文件夹时, 文件分类/结构设计返回空,
 * executeImport 仍然先插了一条 courses 行再循环空 sections, 结果落库一个"空课程"
 * (零 content_nodes), 验证器只打印不抛错, 用户看到的就是空课程。
 *
 * 本测试锁定 Layer B 守卫: structure.sections 为空(零课时)时 executeImport 必须抛错,
 * 且不留 courses 残行; 非空结构仍正常落库。
 *
 * 跑法: npx tsx scripts/verify-import-empty-guard.mjs (也被 verify:core 调用)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { executeImport } from "../src/main/services/import-pipeline.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });

/** 建一个全新内存 DB (schema.sql 是唯一真相)。 */
function freshDb() {
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

/** 最小 ContentSource 桩: 任意文件返回固定 markdown, 无图。 */
const stubSource = {
  getFile: async (_path) => "# Lesson\n\nhello world",
  getImageDataUrl: async (_path) => null,
  getImageFallbackUrl: (_path) => null,
};

const baseOpts = {
  source: stubSource,
  repoUrl: null,
  repoName: "test-repo",
  langCode: null,
  translationFiles: null,
  sourceLang: "en",
  markDirty: () => {},
};

// ── 1. 空结构必须抛错, 且不留课程残行 ──
{
  const { sqljs, db } = freshDb();
  const emptyStructure = { courseTitle: "", sections: [] };
  let threw = false;
  let errMsg = "";
  try {
    await executeImport(db, emptyStructure, baseOpts);
  } catch (e) {
    threw = true;
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert.equal(threw, true, "空结构(零课时)必须抛错, 而不是落库空课程");
  assert.ok(/课时|lesson|empty|空/i.test(errMsg), `错误信息应说明原因, 实际: ${errMsg}`);

  const courseCount = sqljs.exec("SELECT COUNT(*) FROM courses")[0].values[0][0];
  assert.equal(courseCount, 0, "空结构时不应插入任何 courses 行(不留残行)");
  const nodeCount = sqljs.exec("SELECT COUNT(*) FROM content_nodes")[0].values[0][0];
  assert.equal(nodeCount, 0, "空结构时不应插入任何 content_nodes");
  console.log("✓ 空结构 → 抛错 + 零残行(课程/节点)");
}

// ── 2. 空标题但有课时: courseTitle 回退到 repoName, 正常落库 ──
{
  const { sqljs, db } = freshDb();
  const structureNoTitle = {
    courseTitle: "",
    sections: [
      { title: "第一章", world: "study", lessons: [
        { title: "课时 1", file: "a.md", world: "study" },
      ] },
    ],
  };
  const result = await executeImport(db, structureNoTitle, baseOpts);
  assert.equal(result.title, "test-repo", "空 courseTitle 应回退为 repoName");

  const courseCount = sqljs.exec("SELECT COUNT(*) FROM courses")[0].values[0][0];
  assert.equal(courseCount, 1, "非空结构应插入 1 条课程");
  const lessonCount = sqljs.exec("SELECT COUNT(*) FROM content_nodes WHERE type='lesson'")[0].values[0][0];
  assert.equal(lessonCount, 1, "应有 1 个 lesson");
  const sectionCount = sqljs.exec("SELECT COUNT(*) FROM content_nodes WHERE type='section'")[0].values[0][0];
  assert.equal(sectionCount, 1, "应有 1 个 section");
  console.log("✓ 非空结构 → 正常落库(课程/section/lesson 各 1), 空标题回退 repoName");
}

console.log("\n=== import-empty-guard 测试通过 ✅ ===");
