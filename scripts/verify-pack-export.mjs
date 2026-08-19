/**
 * 新源课程包验证 —— url/text/epub/audio 的 plan(带 docCache)序列化→解析→
 * {kind:"plan"} 重建:接收方零网络零 LLM 零转写。folder 不可导出的守卫做
 * 源码级断言(exportPack handler 在 IPC 层,verify 不起 Electron)。
 * 跑法: npx tsx scripts/verify-pack-export.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { eq } from "drizzle-orm";
import { contentNodes } from "../src/main/db/schema.ts";
import { runSmartImport } from "../src/main/services/import-job-service.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";
import { serializePlan, parsePlan } from "../src/main/services/pure/import-plan.ts";

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");
const freshDb = () => {
  const sqljs = new SQL.Database();
  sqljs.run(schemaSql);
  return drizzle(sqljs, { schema });
};

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

await test("T1 text 源课程包 round-trip:serialize→parse→零网络重建(reused)", async () => {
  const storeA = createPlanStore(mkdtempSync(join(tmpdir(), "ls-pack-a-")));
  const text = Array.from({ length: 500 }, (_, i) => `第${i}条学习心得,内容完整有标点。`).join("\n\n");
  const r1 = await runSmartImport({ kind: "text", name: "心得合集", text }, {
    db: freshDb(), store: storeA, markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
  });
  const plan = storeA.load(r1.planId);
  assert.ok(plan.docCache, "docCache 在快照里");

  // 导出→解析→全新环境导入(模拟接收方)
  const packJson = serializePlan(plan);
  const parsed = parsePlan(packJson);
  assert.ok(parsed, "包可解析");
  assert.equal(parsed.kind, "text");
  const db2 = freshDb();
  const storeB = createPlanStore(mkdtempSync(join(tmpdir(), "ls-pack-b-")));
  storeB.save(parsed);
  const r2 = await runSmartImport({ kind: "plan", plan: parsed }, {
    db: db2, store: storeB, markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
  });
  assert.equal(r2.reused, true, "结构零 AI 复用");
  const lessons = db2.select().from(contentNodes).where(eq(contentNodes.courseId, r2.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 2, "课程重建成功(多课)");
});

await test("T2 exportPack 守卫(源码级):folder 拒绝,新 kind 放行", () => {
  const src = readFileSync(new URL("../src/main/ipc/index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('if (plan.kind === "folder") {\n      throw new Error("本地文件夹导入的课程不支持导出课程包'), "folder 仍被拒绝");
  assert.ok(!src.includes('plan.kind !== "github" || !plan.github'), "github-only 限制已移除");
  assert.ok(src.includes("docCache 让包自包含"), "新源命名分支存在");
});

await test("T3 packable 判定(源码级):folder 之外均可导", () => {
  const src = readFileSync(new URL("../src/main/ipc/index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('planKind !== "folder"'), "packable 按 kind!=\"folder\" 判定");
});

console.log(`\n${passed} passed`);
