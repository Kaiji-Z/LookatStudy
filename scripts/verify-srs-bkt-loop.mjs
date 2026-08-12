/**
 * BKT↔SRS 闭环验证(learning-experience Phase 2)。
 *
 * 核心不变量:一次答题观测应同时更新 BKT 掌握度(progress.mastery)与 SRS 调度(srs_items),
 * 且答对→复习推迟、答错→复习提前(重置到 1 天,近期重练)。即 desirable difficulty 的接线闭环。
 *
 * 修复前:BKT 与 SM-2 解耦——唯一耦合点是"毕业时 recordReview(node,5)",答错既不回写
 * 掌握度、也不重排复习。本测试守的是 Phase 2 新接线(IPC proposal:apply / quiz:recordAnswer
 * / srs:record 三处)所依赖的两个 db 注入原语:recordReviewDb(SRS 侧)与 applyProposal(BKT 侧)。
 *
 * 直接 import 真实源码(VERIFICATION §3.1 红线:断言落在真实源码,不是副本)。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/main/db/schema.ts";
import { recordReviewDb } from "../src/main/services/pure/srs-db.ts";
import { createProposal, applyProposal } from "../src/main/services/proposal-service.ts";
import { getProgress } from "../src/main/services/progress-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('right','c1','lesson','L-right')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('wrong','c1','lesson','L-wrong')`);
  return { db: drizzle(sqljs, { schema }), sqljs };
}

function getSrsItem(db, nodeId) {
  return db.select().from(schema.srsItems).where(eq(schema.srsItems.nodeId, nodeId)).get();
}

// === T1: 答对 → BKT mastery 升 + SRS 写入(repetitions=1, interval=1 首次) ===
const { db } = await makeDb();
applyProposal(
  db,
  createProposal(db, {
    nodeId: "right",
    operations: [{ type: "update_mastery", nodeId: "right", correct: true }],
  }).id,
);
recordReviewDb(db, "right", 5); // IPC 把 correct 映射为 quality 5
const rightProg = getProgress(db, "right");
const rightSrs = getSrsItem(db, "right");
assert.ok(rightProg && rightProg.mastery != null && rightProg.mastery > 0.5, `T1: 答对 mastery 应 >0.5, 实际 ${rightProg?.mastery}`);
assert.ok(rightSrs, "T1: 答对应写入 srs_items");
assert.strictEqual(rightSrs.repetitions, 1, `T1: 答对 repetitions 应=1, 实际 ${rightSrs?.repetitions}`);
assert.strictEqual(rightSrs.intervalDays, 1, `T1: 首次答对 interval 应=1, 实际 ${rightSrs?.intervalDays}`);
console.log(`✓ T1 答对闭环: mastery=${rightProg.mastery.toFixed(3)}, interval=${rightSrs.intervalDays}d, reps=${rightSrs.repetitions}`);

// === T2: 答错 → BKT mastery 更低 + SRS 重置(repetitions=0, interval=1) ===
applyProposal(
  db,
  createProposal(db, {
    nodeId: "wrong",
    operations: [{ type: "update_mastery", nodeId: "wrong", correct: false }],
  }).id,
);
recordReviewDb(db, "wrong", 2); // IPC 把 wrong 映射为 quality 2
const wrongProg = getProgress(db, "wrong");
const wrongSrs = getSrsItem(db, "wrong");
assert.ok(wrongProg && wrongProg.mastery != null, "T2: 答错应仍有 mastery 值");
assert.ok(wrongProg.mastery < rightProg.mastery, `T2: 答错 mastery(${wrongProg.mastery.toFixed(3)}) 应 < 答对(${rightProg.mastery.toFixed(3)})`);
assert.strictEqual(wrongSrs.repetitions, 0, `T2: 答错 repetitions 应重置为 0, 实际 ${wrongSrs?.repetitions}`);
assert.strictEqual(wrongSrs.intervalDays, 1, `T2: 答错 interval 应重置为 1, 实际 ${wrongSrs?.intervalDays}`);
console.log(`✓ T2 答错闭环: mastery=${wrongProg.mastery.toFixed(3)}, interval=${wrongSrs.intervalDays}d, reps=${wrongSrs.repetitions}(重置)`);

// === T3: 耦合核心 —— 再次答对 right,interval 增长到 6;wrong 仍卡在 1。
//     证明"掌握度积累 → 复习推迟;遗忘 → 近期重练"。这就是闭环的意义。 ===
recordReviewDb(db, "right", 5); // 第二次答对
const rightSrs2 = getSrsItem(db, "right");
assert.strictEqual(rightSrs2.repetitions, 2, `T3: 二次答对 reps=2, 实际 ${rightSrs2?.repetitions}`);
assert.strictEqual(rightSrs2.intervalDays, 6, `T3: 二次答对 interval 应=6, 实际 ${rightSrs2?.intervalDays}`);
assert.ok(
  new Date(wrongSrs.dueAt) < new Date(rightSrs2.dueAt),
  `T3: 遗忘 dueAt(${wrongSrs.dueAt}) 应早于 积累 dueAt(${rightSrs2.dueAt})`,
);
console.log(`✓ T3 闭环耦合: 答对 interval 1→6d(推迟); 答错 卡在 1d(近期重练)。dueAt: 遗忘早于积累`);

// === T4: 反向闭环(自评复习 → 回写 BKT):模拟 srs:record 路径。
//     SRS 先写,然后 quality≤2 触发 update_mastery(correct=false)。两模型都应更新。 ===
const { db: db2 } = await makeDb();
recordReviewDb(db2, "wrong", 2);
applyProposal(
  db2,
  createProposal(db2, {
    nodeId: "wrong",
    operations: [{ type: "update_mastery", nodeId: "wrong", correct: false }],
  }).id,
);
assert.ok(getSrsItem(db2, "wrong"), "T4: 反向路径 SRS 已写");
assert.ok(getProgress(db2, "wrong")?.mastery != null, "T4: 反向路径 BKT 已写");
console.log(`✓ T4 反向闭环(复习→BKT): SRS + BKT 同时更新(自评复习结果反馈进掌握度)`);

console.log("\n=== ALL BKT↔SRS LOOP TESTS PASSED ✅ ===");
