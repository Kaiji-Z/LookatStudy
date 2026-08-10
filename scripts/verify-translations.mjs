/**
 * verify-translations.mjs — 翻译服务 CRUD 测试。
 *
 * 测试 content_node_translations 表的 persist / read / 语言列表 功能。
 * 纯 DB 测试（内存 sql.js），不依赖 Electron / 网络。
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
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
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
const COURSE_ID = "test-trans-course";
sqljs.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES (?, '', 'test', 'Test', 1)", [COURSE_ID]);
const lessons = [
  { id: "l1", title: "Perceptron", sourcePath: "lessons/3-NeuralNetworks/03-Perceptron/README.md" },
  { id: "l2", title: "CNN", sourcePath: "lessons/4-ComputerVision/07-ConvNets/README.md" },
  { id: "l3", title: "RNN", sourcePath: "lessons/5-NLP/16-RNN/README.md" },
];
for (const l of lessons) {
  sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES (?, ?, 'lesson', ?, ?, 0)", [l.id, COURSE_ID, l.title, l.sourcePath]);
  sqljs.run("INSERT INTO progress (node_id, status, crown_level) VALUES (?, 'locked', 0)", [l.id]);
}

// ============================================================
test("T1 persistTranslations: 写入 2 个翻译", () => {
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "感知机", content: "# 感知机\n\n中文内容" }],
    ["lessons/4-ComputerVision/07-ConvNets/README.md", { title: "卷积神经网络", content: "# CNN\n\n中文内容" }],
    // l3 没有翻译 → 应跳过
  ]);
  const result = persistTranslations(db, COURSE_ID, "zh-CN", translations);
  assert.strictEqual(result.written, 2);
  assert.strictEqual(result.skipped, 1); // l3 没翻译
});

test("T2 getNodeTranslation: 读取中文翻译", () => {
  const trans = getNodeTranslation(db, "l1", "zh-CN");
  assert.ok(trans);
  assert.strictEqual(trans.title, "感知机");
  assert.ok(trans.content?.includes("中文内容"));
});

test("T3 getNodeTranslation: 无翻译返回 null", () => {
  const trans = getNodeTranslation(db, "l3", "zh-CN");
  assert.strictEqual(trans, null); // l3 没翻译
});

test("T4 getNodeTranslation: 不存在的语言返回 null", () => {
  const trans = getNodeTranslation(db, "l1", "ja");
  assert.strictEqual(trans, null);
});

test("T5 getCourseLanguages: 返回已存语言", () => {
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["zh-CN"]);
});

test("T6 persistTranslations: 幂等(重复写入更新不新增)", () => {
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "感知机（更新版）", content: "更新内容" }],
  ]);
  persistTranslations(db, COURSE_ID, "zh-CN", translations);
  const trans = getNodeTranslation(db, "l1", "zh-CN");
  assert.strictEqual(trans.title, "感知机（更新版）"); // 更新了
  // 语言列表不应多一个 zh-CN
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["zh-CN"]);
});

test("T7 persistTranslations: 加第二种语言", () => {
  const translations = new Map([
    ["lessons/3-NeuralNetworks/03-Perceptron/README.md", { title: "パーセプトロン", content: "日本語コンテンツ" }],
  ]);
  persistTranslations(db, COURSE_ID, "ja", translations);
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, ["ja", "zh-CN"]); // 排序后
});

test("T8 getCourseTitleTranslations: 标题映射", () => {
  const titles = getCourseTitleTranslations(db, COURSE_ID, "zh-CN");
  assert.strictEqual(titles.get("l1"), "感知机（更新版）");
  // l2 的翻译 content 是 "# CNN\n\n中文内容"，extractTranslatedTitle 取 H1 = "CNN"
  assert.strictEqual(titles.get("l2"), "CNN");
  assert.ok(!titles.has("l3")); // l3 无翻译
});

test("T9 FK 级联: 删课程 → 翻译也删", () => {
  // 先确认翻译存在
  assert.ok(getNodeTranslation(db, "l1", "zh-CN"));
  // 删课程
  sqljs.run("DELETE FROM courses WHERE id = ?", [COURSE_ID]);
  // 翻译应被级联删除
  const langs = getCourseLanguages(db, COURSE_ID);
  assert.deepStrictEqual(langs, []);
});

test("T10 persistTranslations: 空 Map 不崩", () => {
  // 重新建数据
  sqljs.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES (?, '', 'test2', 'Test2', 1)", [COURSE_ID + "2"]);
  sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES (?, ?, 'lesson', 'L', 'p.md', 0)", ["lx", COURSE_ID + "2"]);
  const result = persistTranslations(db, COURSE_ID + "2", "fr", new Map());
  assert.strictEqual(result.written, 0);
  assert.strictEqual(result.skipped, 1);
});

// ============================================================
console.log(`\n=== 翻译服务 CRUD: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
