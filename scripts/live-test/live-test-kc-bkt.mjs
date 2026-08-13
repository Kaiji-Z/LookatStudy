/**
 * Live test: Per-KC BKT KC 提取 + 答题归因。
 *
 * 验证全链路:
 *   1. LLM 从真实课程内容提取知识组件(KC) → 写入 knowledge_points JSON
 *   2. ensureKcRows 初始化 per-KC mastery
 *   3. 带 kcIndex 的 update_mastery proposal → per-KC BKT 更新
 *   4. 聚合 mastery = min(KCs) → progress.mastery 正确反映最薄弱环节
 *
 * 需要 API key（Z_AI_API_KEY 或 ZHIPU_API_KEY），gate 失败则 skip。
 */
import "./_load-env.mjs";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { generateLessonSummaries } from "../../src/main/services/course-structure-service.ts";
import { getKnowledgePoints, ensureKcRows, getKcMastery, computeAggregateMastery } from "../../src/main/services/kc-service.ts";
import { createProposal, applyProposal } from "../../src/main/services/proposal-service.ts";
import { readApiKey } from "./_load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const apiKey = readApiKey();
if (!apiKey) {
  console.log("⚠ 无 API key,跳过 KC BKT live test");
  process.exit(0);
}
console.log(`✓ API key loaded (${apiKey.slice(0, 8)}...)`);

// 建真实 sql.js DB + schema
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

// 插入 LLM 设置:用 .env 的 Z.AI 端点(custom provider 方式)
const zaiBaseUrl = process.env.Z_AI_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
const zaiModel = process.env.Z_AI_MODEL || "glm-4-flash";
sqljs.run(
  `INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES ('custom-test', 'ZAI Test', 'openai-compatible', ?, ?, ?)`,
  [zaiBaseUrl, apiKey, zaiModel],
);
sqljs.run(`INSERT INTO settings (key, value, is_secret) VALUES ('active_provider', 'custom-test', 0)`);
sqljs.run(`INSERT INTO settings (key, value, is_secret) VALUES ('active_model', ?, 0)`, [zaiModel]);

// 插入测试课程 + 章节 + 课程内容(真实的梯度下降教学文本)
const COURSE_ID = "kc-live-test";
const SECTION_ID = "kc-sec";
const LESSON_ID = "kc-lesson";
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES (?, 'test', 'KC Live Test')`, [COURSE_ID]);
sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, ?, 'section', '深度学习基础')`, [SECTION_ID, COURSE_ID]);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, parent_id, type, title, content) VALUES (?, ?, ?, 'lesson', '梯度下降', ?)`,
  [LESSON_ID, COURSE_ID, SECTION_ID, `# 梯度下降

梯度下降是一种迭代优化算法,用于寻找函数的最小值。在机器学习中,我们用它最小化损失函数。

## 什么是梯度
梯度是一个向量,指向函数值增长最快的方向。在多维空间中,梯度是各偏导数组成的向量。
负梯度方向就是函数值下降最快的方向——这就是"梯度下降"名字的由来。

## 学习率
学习率(learning rate)控制每步走多大。学习率太大,会在最小值附近来回震荡甚至发散;
学习率太小,收敛极慢,需要大量迭代。常见策略是从较大值开始,逐渐衰减。

## 收敛判断
当梯度接近零(变化很小),或达到最大迭代次数时,算法停止。
也可以监控损失值的变化——连续若干轮变化小于阈值时判定收敛。

## 批量梯度下降 vs 随机梯度下降
批量梯度下降(BGD)每步用全部数据,稳定但慢。随机梯度下降(SGD)每步用一个样本,
快但有噪声。小批量(mini-batch)是折中:用一小批数据,兼顾速度和稳定性。`],
);

console.log("\n=== T1: LLM KC 提取 ===");
console.log("调用 generateLessonSummaries (真实 LLM)...");

try {
  const result = await generateLessonSummaries(db, COURSE_ID);
  console.log(`  sections=${result.sectionsUpdated}, lessons=${result.lessonsUpdated}`);
} catch (e) {
  console.error("  generateLessonSummaries 失败:", e.message);
  process.exit(1);
}

const kps = getKnowledgePoints(db, LESSON_ID);
assert.ok(kps.length >= 2, `T1: 应提取 ≥2 个 KC, got ${kps.length}`);
assert.ok(kps.length <= 7, `T1: KC 数量 ≤7, got ${kps.length}`);
console.log(`✓ T1: 提取了 ${kps.length} 个 KC:`);
kps.forEach((kp, i) => console.log(`     ${i}. ${kp.title} — ${kp.description.slice(0, 40)}`));

// === T2: ensureKcRows 初始化 ===
ensureKcRows(db, LESSON_ID);
const rows = getKcMastery(db, LESSON_ID);
assert.strictEqual(rows.length, kps.length, "T2: KC mastery 行数 = KC 数");
console.log(`✓ T2: ${rows.length} 个 KC mastery 行初始化 (mastery=0.5)`);

// === T3: 带 kcIndex 的 update_mastery → 只更新该 KC ===
// 找第一个 KC,答对一次
const kc0Title = kps[0].title;
console.log(`\n=== T3: 答对 KC"${kc0Title}" ===`);
const prop = createProposal(db, {
  nodeId: LESSON_ID,
  operations: [{ type: "update_mastery", nodeId: LESSON_ID, correct: true, kcIndex: 0 }],
  rationale: `T3: KC"${kc0Title}"答对`,
});
applyProposal(db, prop.id);
const afterKcs = getKcMastery(db, LESSON_ID);
assert.ok(afterKcs[0].mastery > 0.5, `T3: KC0 mastery 应涨 (${afterKcs[0].mastery.toFixed(3)})`);
assert.ok(afterKcs.slice(1).every((r) => r.mastery === 0.5), "T3: 其他 KC 不变");
console.log(`✓ T3: KC0=${afterKcs[0].mastery.toFixed(3)}(涨), 其余=0.5(不变)`);

// === T4: 聚合 mastery = min(KCs) ===
const agg = computeAggregateMastery(db, LESSON_ID);
const expectedMin = Math.min(...afterKcs.map((r) => r.mastery));
assert.ok(Math.abs((agg ?? 0) - expectedMin) < 0.001, `T4: 聚合=min=${agg?.toFixed(3)}`);
console.log(`✓ T4: 聚合 mastery=${agg?.toFixed(3)} = min(各 KC)（最薄弱环节）`);

// === T5: 连续答对同一 KC 不影响毕业(其他 KC 仍低) ===
console.log(`\n=== T5: 连续答对 KC0 多次,验证不假毕业 ===`);
for (let i = 0; i < 8; i++) {
  const p = createProposal(db, {
    nodeId: LESSON_ID,
    operations: [{ type: "update_mastery", nodeId: LESSON_ID, correct: true, kcIndex: 0 }],
    rationale: "T5: 刷 KC0",
  });
  applyProposal(db, p.id);
}
const kc0High = getKcMastery(db, LESSON_ID)[0].mastery;
const aggStill = computeAggregateMastery(db, LESSON_ID);
assert.ok(kc0High > 0.9, `T5: KC0 刷到 >0.9 (${kc0High.toFixed(3)})`);
assert.ok((aggStill ?? 1) < 0.9, `T5: 聚合仍 <0.9 (${aggStill?.toFixed(3)}) — 其他 KC 拖低`);
console.log(`✓ T5: KC0=${kc0High.toFixed(3)} 但聚合=${aggStill?.toFixed(3)} <0.9 → 不毕业（防假毕业）`);

console.log("\n=== ALL KC BKT LIVE TESTS PASSED ✅ ===");
