/**
 * verify-seed-bilingual.mjs — 种子课程双语化测试。
 *
 * 覆盖:
 * 1. seed-course.json 结构:每节/课/考试有 en 翻译,课的正文非空,引用/去重合法
 * 2. applySeedData 灌入:语言列表、翻译读取、courses.source_lang
 * 3. 幂等:同版本重跑跳过,行数不变
 * 4. 版本 bump 重建:用户已学状态(progress 变更 + 翻译行被污染)下重灌不崩、
 *    行数精确、污染内容被还原 —— 这是启动即崩(UNIQUE 冲突)的回归陷阱
 *
 * 纯 DB 测试(内存 sql.js),不依赖 Electron / 网络 / LLM。
 * seed-apply.ts 只静态依赖 schema.ts,可被 tsx 直接 import(seed.ts 不行,它引 db/index 的 ?raw)。
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/main/db/schema.ts";
import { applySeedData } from "../src/main/services/seed-apply.ts";
import {
  getCourseLanguages,
  getNodeTranslation,
} from "../src/main/services/translation-service.ts";
import { courses, contentNodes, contentNodeTranslations, progress } from "../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); failed++; }
}

// ── 初始化内存 DB ──
const wasmPath = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmPath, f) });

function freshDb() {
  const sqljs = new SQL.Database();
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  sqljs.run("PRAGMA foreign_keys = ON;");
  return drizzle(sqljs, { schema });
}

const seed = JSON.parse(readFileSync(join(ROOT, "src/main/assets/seed-course.json"), "utf8"));
const SEED_VERSION = 11; // 与 src/main/services/seed.ts 的 SEED_VERSION 对齐(bump 时同步改)

// ── 1) JSON 结构 ──

await test("JSON: 每个课时有 en 翻译且正文非空", () => {
  const lessons = seed.nodes.filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 18, `课时数异常: ${lessons.length}`);
  for (const n of lessons) {
    const t = seed.translations.find((x) => x.nodeId === n.id && x.locale === "en");
    assert.ok(t, `课时缺 en 翻译: ${n.id}`);
    assert.ok(typeof t.content === "string" && t.content.trim().length > 50, `en 正文过短: ${n.id}`);
    assert.ok(t.title && t.title.trim(), `en 标题缺失: ${n.id}`);
  }
});

await test("JSON: 每个章节/考试节点有 en 标题翻译", () => {
  const others = seed.nodes.filter((n) => n.type === "section" || n.type === "exam");
  assert.ok(others.length >= 12, `章节+考试数异常: ${others.length}`);
  for (const n of others) {
    const t = seed.translations.find((x) => x.nodeId === n.id && x.locale === "en");
    assert.ok(t && t.title && t.title.trim(), `缺 en 标题: ${n.id}`);
    assert.strictEqual(t.content, null, `节/考试翻译正文应为 null: ${n.id}`);
  }
});

await test("JSON: 翻译引用的 nodeId 全部存在且无重复 (nodeId, locale)", () => {
  const ids = new Set(seed.nodes.map((n) => n.id));
  const seen = new Set();
  for (const t of seed.translations) {
    assert.ok(ids.has(t.nodeId), `翻译引用不存在的节点: ${t.nodeId}`);
    const key = `${t.nodeId}|${t.locale}`;
    assert.ok(!seen.has(key), `翻译重复: ${key}`);
    seen.add(key);
  }
});

// ── 2) 灌入 ──

await test("applySeedData: 全新库灌入 → 语言列表 [en],source_lang=zh-CN", () => {
  const db = freshDb();
  const r = applySeedData(db, seed, SEED_VERSION);
  assert.deepStrictEqual(r, { skipped: false });
  const langs = getCourseLanguages(db, seed.courseId);
  assert.deepStrictEqual(langs, ["en"], `语言列表: ${JSON.stringify(langs)}`);
  const course = db.select().from(courses).where(eq(courses.id, seed.courseId)).get();
  assert.strictEqual(course.sourceLang, "zh-CN");
});

await test("applySeedData: 课时/章节/考试翻译可读且内容正确", () => {
  const db = freshDb();
  applySeedData(db, seed, SEED_VERSION);
  const les = getNodeTranslation(db, "guide-les-1-1", "en");
  assert.ok(les, "guide-les-1-1 en 翻译缺失");
  assert.strictEqual(les.title, "Welcome to LookatStudy");
  assert.ok(les.content.startsWith("# Welcome to LookatStudy"), "en 正文开头不符");
  // 原文未被翻译覆盖
  const origNode = db.select().from(contentNodes).where(eq(contentNodes.id, "guide-les-1-1")).get();
  assert.ok(origNode.content.startsWith("# 欢迎使用 LookatStudy"), "原文被覆盖");
  const sec = getNodeTranslation(db, "guide-sec-1", "en");
  assert.strictEqual(sec.title, "Quick Start");
  const exam = getNodeTranslation(db, "guide-exam-1", "en");
  assert.ok(exam.title.endsWith("Chapter Quiz"), `考试 en 标题: ${exam.title}`);
});

// ── 3) 幂等 ──

await test("applySeedData: 同版本重跑 → skipped 且行数不变", () => {
  const db = freshDb();
  applySeedData(db, seed, SEED_VERSION);
  const count = () => ({
    nodes: db.select().from(contentNodes).all().length,
    trans: db.select().from(contentNodeTranslations).all().length,
    prog: db.select().from(progress).all().length,
  });
  const before = count();
  const r2 = applySeedData(db, seed, SEED_VERSION);
  assert.deepStrictEqual(r2, { skipped: true });
  assert.deepStrictEqual(count(), before);
});

// ── 4) 版本 bump 重建(启动即崩回归陷阱) ──

await test("applySeedData: 版本 bump 在用户已学状态下重建,不崩且行数精确", () => {
  const db = freshDb();
  applySeedData(db, seed, SEED_VERSION);
  // 模拟用户已学:改 progress + 污染一条翻译行(旧版本残留内容)
  db.update(progress).set({ status: "in_progress", mastery: 0.7 })
    .where(eq(progress.nodeId, "guide-les-1-2")).run();
  db.update(contentNodeTranslations).set({ content: "# stale old content" })
    .where(eq(contentNodeTranslations.id, "guide-les-1-1-en")).run();
  // bump 版本重灌:不得抛 UNIQUE 冲突
  const r = applySeedData(db, seed, SEED_VERSION + 1);
  assert.deepStrictEqual(r, { skipped: false });
  const transRows = db.select().from(contentNodeTranslations).all();
  assert.strictEqual(transRows.length, seed.translations.length, `翻译行数: ${transRows.length}`);
  const nodesRows = db.select().from(contentNodes).all();
  assert.strictEqual(nodesRows.length, seed.nodes.length, `节点行数: ${nodesRows.length}`);
  const progRows = db.select().from(progress).all();
  assert.strictEqual(progRows.length, seed.progress.length, `进度行数: ${progRows.length}`);
  // 污染内容被还原
  const t = getNodeTranslation(db, "guide-les-1-1", "en");
  assert.ok(t.content.startsWith("# Welcome to LookatStudy"), `污染未还原: ${t.content.slice(0, 30)}`);
  // 用户进度按种子语义重置(重建 = 删旧重灌)
  const p = db.select().from(progress).where(eq(progress.nodeId, "guide-les-1-2")).get();
  assert.strictEqual(p.status, "locked", "重建后 progress 应为种子初始值");
});

// ── 汇总 ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
