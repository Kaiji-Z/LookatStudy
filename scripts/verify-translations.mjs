/**
 * verify-translations.mjs — 翻译服务 CRUD 测试。
 *
 * 测试 content_node_translations 表的 persist / read / 语言列表 功能。
 * 纯 DB 测试（内存 sql.js），不依赖 Electron / 网络 / LLM。
 *
 * persistTranslations 现在是 async（可能调 LLM），测试里用 await。
 * 无 LLM key 时 LLM 对齐不触发，只测规则精确路径匹配。
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  persistTranslations,
  getNodeTranslation,
  getCourseLanguages,
  getCourseTitleTranslations,
} from "../src/main/services/translation-service.ts";

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
const sqljs = new SQL.Database();
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
sqljs.run("PRAGMA foreign_keys = ON;");
const db = drizzle(sqljs, { schema });

// ── 准备测试数据:1 课程 + 3 lesson 节点 ──
// sourcePath 现在格式是 "文件路径#anchor"（和 course-generator 一致）
const COURSE_ID = "test-trans-course";
sqljs.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES (?, '', 'test', 'Test', 1)", [COURSE_ID]);
const lessons = [
  { id: "l1", title: "Perceptron", sourcePath: "lessons/3-NeuralNetworks/03-Perceptron/README.md#perceptron" },
  { id: "l2", title: "CNN", sourcePath: "lessons/4-ComputerVision/07-ConvNets/README.md#cnn" },
  { id: "l3", title: "RNN", sourcePath: "lessons/5-NLP/16-RNN/README.md#rnn" },
];
for (const l of lessons) {
  sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES (?, ?, 'lesson', ?, ?, 0)", [l.id, COURSE_ID, l.title, l.sourcePath]);
  sqljs.run("INSERT INTO progress (node_id, status, crown_level) VALUES (?, 'locked', 0)", [l.id]);
}

// ============================================================
await test("T1 persistTranslations: 精确路径匹配写入 2 个翻译", async () => {
  // translations key 是文件路径（不含 #anchor）
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "感知机", content: "# 感知机\n\n中文内容" }],
    ["lessons/4-ComputerVision/07-ConvNets/README.md", { title: "卷积神经网络", content: "# CNN\n\n中文内容" }],
    // l3 没有翻译 → 应跳过
  ]);
  const result = await persistTranslations(db, COURSE_ID, "zh-CN", translations);
  assert.strictEqual(result.written, 2);
  assert.strictEqual(result.skipped, 1); // l3 没翻译
});

await test("T2 getNodeTranslation: 读取中文翻译", async () => {
  const trans = getNodeTranslation(db, "l1", "zh-CN");
  assert.ok(trans);
  assert.strictEqual(trans.title, "感知机"); // H1 = "# 感知机"
  assert.ok(trans.content?.includes("中文内容"));
});

await test("T3 getNodeTranslation: 无翻译返回 null", async () => {
  const trans = getNodeTranslation(db, "l3", "zh-CN");
  assert.strictEqual(trans, null);
});

await test("T4 getNodeTranslation: 不存在的语言返回 null", async () => {
  const trans = getNodeTranslation(db, "l1", "ja");
  assert.strictEqual(trans, null);
});

await test("T5 getCourseLanguages: 返回已存语言", async () => {
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["zh-CN"]);
});

await test("T6 persistTranslations: 幂等(重复写入更新不新增)", async () => {
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "感知机（更新版）", content: "更新内容" }],
  ]);
  await persistTranslations(db, COURSE_ID, "zh-CN", translations);
  const trans = getNodeTranslation(db, "l1", "zh-CN");
  assert.strictEqual(trans.title, "感知机（更新版）"); // 更新了
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["zh-CN"]); // 不多一个
});

await test("T7 persistTranslations: 加第二种语言", async () => {
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "パーセプトロン", content: "日本語コンテンツ" }],
  ]);
  await persistTranslations(db, COURSE_ID, "ja", translations);
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["ja", "zh-CN"]); // 排序后
});

await test("T8 getCourseTitleTranslations: 标题映射", async () => {
  const titles = getCourseTitleTranslations(db, COURSE_ID, "zh-CN");
  assert.strictEqual(titles.get("l1"), "感知机（更新版）");
  assert.strictEqual(titles.get("l2"), "CNN"); // H1 = "# CNN"
  assert.ok(!titles.has("l3"));
});

await test("T9 FK 级联: 删课程 → 翻译也删", async () => {
  assert.ok(getNodeTranslation(db, "l1", "zh-CN"));
  sqljs.run("DELETE FROM courses WHERE id = ?", [COURSE_ID]);
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, []);
});

await test("T10 persistTranslations: 空 Map 不崩", async () => {
  sqljs.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES (?, '', 'test2', 'Test2', 1)", [COURSE_ID + "2"]);
  sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES (?, ?, 'lesson', 'L', 'p.md#l', 0)", ["lx", COURSE_ID + "2"]);
  const result = await persistTranslations(db, COURSE_ID + "2", "fr", new Map());
  assert.strictEqual(result.written, 0);
  assert.strictEqual(result.skipped, 1);
});

// ============================================================
console.log(`\n=== 翻译服务 CRUD: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
