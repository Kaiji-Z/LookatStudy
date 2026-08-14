/**
 * 导入取消 + 落库原子性验证。
 *
 * 背景：导入改后台任务后需要可取消，且"取消/中途失败不能留下半成品课程"——
 * 课程行必须在全部正文拉取完成后才写库（同步段落内完成），取消发生在拉取阶段
 * 时零写库；写库后意外出错时清理已写行。
 *
 * 跑法: npx tsx scripts/verify-import-cancel.mjs (也被 verify:core 调用)
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

const structure = {
  courseTitle: "取消测试课",
  sections: [{
    title: "第一章", world: "study",
    lessons: [
      { title: "课时 1", file: "a.md", world: "study" },
      { title: "课时 2", file: "b.md", world: "study" },
    ],
  }],
};

function counts(sqljs) {
  return {
    courses: sqljs.exec("SELECT COUNT(*) FROM courses")[0].values[0][0],
    nodes: sqljs.exec("SELECT COUNT(*) FROM content_nodes")[0].values[0][0],
    progress: sqljs.exec("SELECT COUNT(*) FROM progress")[0].values[0][0],
  };
}

const baseOpts = {
  source: new LocalContentSource("X:/unused", new Map([
    ["a.md", "# A\n\n内容 A 足够长。"],
    ["b.md", "# B\n\n内容 B 足够长。"],
  ])),
  repoUrl: null, repoName: "cancel-test",
  langCode: null, translationFiles: null,
  sourceLang: "en", markDirty: () => {},
};

// ── T1: 拉取阶段取消 → 抛"已取消" + 零写库（无半成品课程）──
{
  const { sqljs, db } = freshDb();
  let fetched = 0;
  const countingSource = {
    ...baseOpts.source,
    getFile: async (p) => { fetched++; return baseOpts.source.getFile(p); },
  };
  let threw = null;
  try {
    await executeImport(db, structure, {
      ...baseOpts,
      source: countingSource,
      shouldAbort: () => fetched >= 1, // 拉完第 1 个文件后请求取消
    });
  } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert.ok(threw !== null, "T1: 取消必须抛错");
  assert.match(threw, /取消/, `T1: 错误信息应含'取消', 实际: ${threw}`);
  const c = counts(sqljs);
  assert.equal(c.courses, 0, `T1: 取消后 courses 应为 0, 实际 ${c.courses}`);
  assert.equal(c.nodes, 0, `T1: 取消后 content_nodes 应为 0, 实际 ${c.nodes}`);
  assert.equal(c.progress, 0, "T1: 取消后 progress 应为 0");
  assert.ok(fetched >= 1 && fetched <= 2, `T1: 取消发生在拉取阶段(已拉 ${fetched})`);
  console.log("✓ T1 拉取阶段取消: 抛错 + courses/nodes/progress 零残留");
}

// ── T2: shouldAbort 恒 false → 正常导入（防"永远取消"的回归）──
{
  const { sqljs, db } = freshDb();
  const result = await executeImport(db, structure, {
    ...baseOpts, shouldAbort: () => false,
  });
  const c = counts(sqljs);
  assert.equal(c.courses, 1, "T2: 正常导入 1 课程");
  assert.equal(result.verification.stats.lessons, 2, "T2: 2 课");
  console.log("✓ T2 不取消: 正常导入（课程 + 2 课）");
}

// ── T3: 开跑前就取消 → 立即抛错零写库 ──
{
  const { sqljs, db } = freshDb();
  let threw = false;
  try {
    await executeImport(db, structure, { ...baseOpts, shouldAbort: () => true });
  } catch { threw = true; }
  assert.ok(threw, "T3: 立即取消应抛错");
  const c = counts(sqljs);
  assert.equal(c.courses + c.nodes + c.progress, 0, "T3: 零写库");
  console.log("✓ T3 立即取消: 抛错 + 零写库");
}

console.log("\n=== ALL IMPORT CANCEL TESTS PASSED ✅ ===");
