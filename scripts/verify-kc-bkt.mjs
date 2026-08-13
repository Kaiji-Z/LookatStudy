/**
 * Per-Knowledge-Component BKT 无头验证。
 *
 * 验证核心不变量：
 *   - KC 定义可存取（JSON-in-TEXT）
 *   - per-KC BKT 更新独立运作（updateMastery 数学不变，粒度变 per-KC）
 *   - 聚合 mastery = min(各 KC)——最薄弱环节决定整体
 *   - 毕业门控：ALL KCs ≥ 0.9 才 auto-mastered（防假毕业）
 *   - 无 KCs 时回退单值 BKT（向后兼容）
 *
 * VERIFICATION §2.1: headless 形态 + 闭环测试（break source → test catches）。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  getKnowledgePoints,
  ensureKcRows,
  getKcMastery,
  updateKcMastery,
  computeAggregateMastery,
  floorAllKcMastery,
} from "../src/main/services/kc-service.ts";
import {
  createProposal,
  applyProposal,
} from "../src/main/services/proposal-service.ts";
import { getProgress } from "../src/main/services/progress-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 建真实 sql.js DB + schema
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

// 测试数据：1 课程 + 1 课节点（含 3 个知识组件）
const COURSE_ID = "kc-course";
const NODE_ID = "kc-node-1";
const KPS = [
  { title: "概念A", description: "理解核心定义" },
  { title: "概念B", description: "掌握应用场景" },
  { title: "概念C", description: "能分析边界情况" },
];
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES (?, 'r', 'T')`, [COURSE_ID]);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, knowledge_points) VALUES (?, ?, 'lesson', 'KC测试课', ?)`,
  [NODE_ID, COURSE_ID, JSON.stringify(KPS)],
);

// === T1: getKnowledgePoints 解析 JSON ===
const parsed = getKnowledgePoints(db, NODE_ID);
assert.strictEqual(parsed.length, 3, "T1: 应解析出 3 个 KC");
assert.strictEqual(parsed[0].title, "概念A", "T1: KC0 title 正确");
console.log(`✓ T1 getKnowledgePoints: 3 KCs 解析正确`);

// === T2: ensureKcRows 创建初始 mastery 行 ===
ensureKcRows(db, NODE_ID);
const rows = getKcMastery(db, NODE_ID);
assert.strictEqual(rows.length, 3, "T2: 应创建 3 个 KC mastery 行");
assert.ok(rows.every((r) => r.mastery === 0.5), "T2: 所有 KC 初始 mastery=0.5(pInit)");
assert.ok(rows.every((r) => r.testedCount === 0), "T2: 初始 testedCount=0");
console.log(`✓ T2 ensureKcRows: 3 行创建, mastery=0.5, testedCount=0`);

// 幂等：再调一次不重复创建
ensureKcRows(db, NODE_ID);
assert.strictEqual(getKcMastery(db, NODE_ID).length, 3, "T2b: 幂等——不重复创建");
console.log(`✓ T2b ensureKcRows 幂等`);

// === T3: updateKcMastery 更新单个 KC ===
// KC0 答对一次：prev=0.5, correct=true → BKT 后验应 > 0.5
const kc0New = updateKcMastery(db, NODE_ID, 0, true);
assert.ok(kc0New > 0.5, `T3: KC0 答对后 mastery 应 > 0.5, got ${kc0New}`);
// KC1 答错一次：prev=0.5, correct=false → BKT 后验应 < 0.5
const kc1New = updateKcMastery(db, NODE_ID, 1, false);
assert.ok(kc1New < 0.5, `T3: KC1 答错后 mastery 应 < 0.5, got ${kc1New}`);
// KC2 不动：仍 0.5
const allKcs = getKcMastery(db, NODE_ID);
assert.strictEqual(allKcs[2].mastery, 0.5, "T3: KC2 未被更新, mastery 仍 0.5");
// testedCount 增长
assert.strictEqual(allKcs[0].testedCount, 1, "T3: KC0 testedCount=1");
assert.strictEqual(allKcs[1].testedCount, 1, "T3: KC1 testedCount=1");
assert.strictEqual(allKcs[2].testedCount, 0, "T3: KC2 testedCount=0");
console.log(`✓ T3 updateKcMastery: KC0=${kc0New.toFixed(3)}(涨), KC1=${kc1New.toFixed(3)}(降), KC2=0.5(不动)`);

// === T4: computeAggregateMastery = min ===
const agg = computeAggregateMastery(db, NODE_ID);
const expectedMin = Math.min(kc0New, kc1New, 0.5);
assert.ok(Math.abs((agg ?? 0) - expectedMin) < 0.001, `T4: 聚合=min(KCs)=${agg?.toFixed(3)}, expected ${expectedMin.toFixed(3)}`);
console.log(`✓ T4 computeAggregateMastery: min(KCs)=${agg?.toFixed(3)}（最薄弱环节 KC1=${kc1New.toFixed(3)}）`);

// === T5: update_mastery proposal 带 kcIndex → 只更新该 KC ===
const kc0Before = getKcMastery(db, NODE_ID).find((r) => r.kcIndex === 0).mastery;
const prop = createProposal(db, {
  nodeId: NODE_ID,
  operations: [{ type: "update_mastery", nodeId: NODE_ID, correct: true, kcIndex: 0 }],
  rationale: "T5: KC0 答对",
});
applyProposal(db, prop.id);
const kcsAfter = getKcMastery(db, NODE_ID);
const kc0After = kcsAfter.find((r) => r.kcIndex === 0).mastery;
assert.ok(kc0After > kc0Before, `T5: KC0 proposal 后应涨 (${kc0Before.toFixed(3)} → ${kc0After.toFixed(3)})`);
// KC1, KC2 不受影响
const kc1After = kcsAfter.find((r) => r.kcIndex === 1).mastery;
const kc2After = kcsAfter.find((r) => r.kcIndex === 2).mastery;
assert.ok(Math.abs(kc1After - kc1New) < 0.001, "T5: KC1 未被 kcIndex=0 的 proposal 影响");
assert.strictEqual(kc2After, 0.5, "T5: KC2 未受影响");
// progress.mastery = min(各 KC)
const prog = getProgress(db, NODE_ID);
const expectedAgg = computeAggregateMastery(db, NODE_ID);
assert.ok(Math.abs((prog?.mastery ?? 0) - (expectedAgg ?? 0)) < 0.001, "T5: progress.mastery = min(KCs)");
console.log(`✓ T5 update_mastery(kcIndex=0): KC0 涨, KC1/KC2 不变, progress.mastery=${prog?.mastery?.toFixed(3)}`);

// === T6: 毕业门控——只有部分 KC 高不能毕业 ===
// 当前 KC2=0.5，远低于 0.9。即使把 KC0 刷到接近 1.0，聚合 mastery 被 KC2 拖低。
// 连续答对 KC0 多次
for (let i = 0; i < 10; i++) {
  updateKcMastery(db, NODE_ID, 0, true);
}
const kc0High = getKcMastery(db, NODE_ID).find((r) => r.kcIndex === 0).mastery;
assert.ok(kc0High > 0.9, `T6: KC0 刷到 >0.9 (${kc0High.toFixed(3)})`);
// 但聚合仍 < 0.9（被 KC1≈0.2 和 KC2=0.5 拖低）
const aggStill = computeAggregateMastery(db, NODE_ID);
assert.ok((aggStill ?? 1) < 0.9, `T6: 聚合 mastery 仍 <0.9 (${aggStill?.toFixed(3)}), 不能假毕业`);
// progress.status 不应是 mastered
const progT6 = getProgress(db, NODE_ID);
assert.notStrictEqual(progT6?.status, "mastered", "T6: KC0 高但 KC1/KC2 低 → 不应 mastered");
console.log(`✓ T6 防假毕业: KC0=${kc0High.toFixed(3)} 但聚合=${aggStill?.toFixed(3)} <0.9, status≠mastered`);

// === T7: 全部 KC 达标 → auto-mastered ===
// 把 KC1 和 KC2 也刷到 ≥ 0.9
for (let i = 0; i < 15; i++) updateKcMastery(db, NODE_ID, 1, true);
for (let i = 0; i < 15; i++) updateKcMastery(db, NODE_ID, 2, true);
const allHigh = getKcMastery(db, NODE_ID);
assert.ok(allHigh.every((r) => r.mastery > 0.9), `T7: 所有 KC > 0.9`);
// 再答对一次触发 auto-mastered
const prop7 = createProposal(db, {
  nodeId: NODE_ID,
  operations: [{ type: "update_mastery", nodeId: NODE_ID, correct: true, kcIndex: 0 }],
  rationale: "T7: 全 KC 达标",
});
applyProposal(db, prop7.id);
const progT7 = getProgress(db, NODE_ID);
assert.strictEqual(progT7?.status, "mastered", "T7: 全 KC ≥ 0.9 → auto-mastered");
assert.strictEqual(progT7?.crownLevel, 5, "T7: crownLevel=5");
console.log(`✓ T7 全 KC 达标: 所有 KC > 0.9 → auto-mastered, crown=5`);

// === T8: mark_mastered floors 所有 KC ===
// 先把 KC 降下来（新节点测试）
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, knowledge_points) VALUES (?, ?, 'lesson', 'KC测试课2', ?)`,
  ["kc-node-2", COURSE_ID, JSON.stringify(KPS)],
);
ensureKcRows(db, "kc-node-2");
// 所有 KC 初始 0.5，mark_mastered 应回填到 0.95
const prop8 = createProposal(db, {
  nodeId: "kc-node-2",
  operations: [{ type: "mark_mastered", nodeId: "kc-node-2" }],
  rationale: "T8: force-graduation",
});
applyProposal(db, prop8.id);
const kcsFloored = getKcMastery(db, "kc-node-2");
assert.ok(kcsFloored.every((r) => r.mastery >= 0.95), "T8: mark_mastered 后所有 KC ≥ 0.95");
console.log(`✓ T8 mark_mastered: 所有 KC floor 到 ≥ 0.95`);

// === T9: 无 KC 定义 → 回退单值 BKT ===
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, ?, 'lesson', '无KC课')`,
  ["kc-node-3", COURSE_ID],
);
const noKps = getKnowledgePoints(db, "kc-node-3");
assert.strictEqual(noKps.length, 0, "T9: 无 KC 定义的节点返回空数组");
const prop9 = createProposal(db, {
  nodeId: "kc-node-3",
  operations: [{ type: "update_mastery", nodeId: "kc-node-3", correct: true }],
  rationale: "T9: 单值回退",
});
applyProposal(db, prop9.id);
const progT9 = getProgress(db, "kc-node-3");
assert.ok((progT9?.mastery ?? 0) > 0.5, `T9: 无 KC → 单值 BKT 答 mastery > 0.5 (${progT9?.mastery?.toFixed(3)})`);
console.log(`✓ T9 向后兼容: 无 KC → 单值 BKT 正常工作, mastery=${progT9?.mastery?.toFixed(3)}`);

console.log("\n=== ALL PER-KC BKT TESTS PASSED ✅ ===");
