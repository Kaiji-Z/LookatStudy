/**
 * Learner-Model 读投影 Phase 1.5 回归套件 —— VERIFICATION §5 step 1。
 *
 * buildLearnerSnapshot(db, nodeId, {includeMemory}) 把原本散落的三处注入
 * (mastery/status/strategy in nodeContext + buildFrictionContext + learnerMemory)
 * 收成一个"【学习者当前状态】"块。纯读投影(CQRS 思路),不存数据,不合并底层 store
 * (BKT/friction/memory 是不同数据类型,合并会降正交性)。
 *
 * includeMemory 显式传入(解耦 flag 读取机制——isFlagOn 读 app 的 getDb,测试用独立 db 测不了,
 * 故由 agent-engine 传 isFlagOn("memory_system") 的结果进来)。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { buildLearnerSnapshot } from "../src/main/services/learner-model-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { db: drizzle(sqljs, { schema }), sqljs };
}

// 建一条 FK 链:course → content_node,progress(node_id FK content_nodes),friction/memory 无 FK
function seed({ sqljs }, nodeId = "n1", mastery = 0.2, status = "in_progress") {
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','Course')`);
  sqljs.run(
    `INSERT INTO content_nodes (id, course_id, type, title) VALUES ('${nodeId}','c1','lesson','Node1')`,
  );
  sqljs.run(
    `INSERT INTO progress (node_id, status, mastery) VALUES ('${nodeId}','${status}',${mastery})`,
  );
}
function addFriction({ sqljs }, nodeId, summary) {
  sqljs.run(
    `INSERT INTO friction_log (id, node_id, category, summary) VALUES ('f${Math.random()}','${nodeId}','confused','${summary}')`,
  );
}
function addMemory({ sqljs }, category, summary, nodeId = null) {
  sqljs.run(
    `INSERT INTO memory (id, node_id, summary, category) VALUES ('m${Math.random()}',${nodeId ? `'${nodeId}'` : "NULL"},'${summary}','${category}')`,
  );
}

// ============================================================
// T1: 含 progress(mastery 0.2 → <0.4 档策略)+ friction + memory → 块含全部
// ============================================================
let env = await makeDb();
seed(env, "n1", 0.2, "in_progress");
addFriction(env, "n1", "基线条件反复卡");
addMemory(env, "global", "偏好类比讲解");
const snap = buildLearnerSnapshot(env.db, "n1", { includeMemory: true });
assert.ok(typeof snap === "string" && snap.length > 0, "T1: 有数据时返回非空块");
assert.ok(snap.includes("0.20"), "T1: 块含掌握度 0.20");
assert.ok(snap.includes("in_progress"), "T1: 块含进度状态");
assert.ok(snap.includes("提问检验"), "T1: mastery 0.2(<0.4档)→ 策略含'提问检验'");
assert.ok(snap.includes("基线条件反复卡"), "T1: 块含 friction 内容");
assert.ok(snap.includes("偏好类比讲解"), "T1: includeMemory=true → 块含 memory");
console.log("✓ T1 全要素进块:mastery + status + 策略 + friction + memory");

// ============================================================
// T2: includeMemory=false → 块含 mastery/friction,不含 memory
// ============================================================
const snapNoMem = buildLearnerSnapshot(env.db, "n1", { includeMemory: false });
assert.ok(snapNoMem.includes("0.20"), "T2: includeMemory=false 仍含 mastery");
assert.ok(snapNoMem.includes("基线条件反复卡"), "T2: includeMemory=false 仍含 friction");
assert.ok(!snapNoMem.includes("偏好类比讲解"), "T2: includeMemory=false → 不含 memory");
console.log("✓ T2 includeMemory=false:mastery/friction 在,memory 不在");

// ============================================================
// T3: 无 friction 无 memory → 块仍含 mastery+status+策略(friction/memory 段省略,不报错)
// ============================================================
let env2 = await makeDb();
seed(env2, "n2", 0.8, "mastered");
const snap2 = buildLearnerSnapshot(env2.db, "n2", { includeMemory: true });
assert.ok(snap2.includes("0.80"), "T3: mastery 0.8");
assert.ok(snap2.includes("费曼") || snap2.includes("综合应用"), "T3: mastery 0.8(≥0.7档)→ 策略含费曼/综合应用");
console.log("✓ T3 无 friction/memory 时块仍正常(只 mastery+策略)");

// ============================================================
// T4: mastery=null(从未评估)→ 策略走 null/<0.1 档,不崩
// ============================================================
let env3 = await makeDb();
seed(env3, "n3", null, "available");
// 上面 seed 用 null mastery —— 重写 progress 让 mastery 为 NULL
env3.sqljs.run(`UPDATE progress SET mastery = NULL WHERE node_id='n3'`);
const snap3 = buildLearnerSnapshot(env3.db, "n3");
assert.ok(snap3.includes("未知") || snap3.includes("刚开始学"), "T4: mastery null → '未知'/刚开始学策略");
console.log("✓ T4 mastery=null 不崩,走未评估策略档");

// ============================================================
// T5: 无 nodeId → null(没节点就没学习者状态块)
// ============================================================
assert.strictEqual(buildLearnerSnapshot(env.db, null), null, "T5: nodeId=null → null");
assert.strictEqual(buildLearnerSnapshot(env.db, undefined), null, "T5: nodeId=undefined → null");
console.log("✓ T5 无 nodeId → null");

// ============================================================
// T6: includeMemory 默认 undefined → 当作 false(memory 不进块,baseline 行为)
// ============================================================
const snapDefault = buildLearnerSnapshot(env.db, "n1");
assert.ok(!snapDefault.includes("偏好类比讲解"), "T6: 默认 includeMemory=undefined → memory 不进块");
console.log("✓ T6 includeMemory 默认 undefined=不注入 memory(baseline)");

console.log("\n=== ALL LEARNER-MODEL SNAPSHOT TESTS PASSED ✅ ===");
