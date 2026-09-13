/**
 * verify-mastery-cap —— AI 观测封顶(2026-09-13 审计后续 · IP3)。
 *
 *   T1  纯函数:capMasteryValue 封顶/解封/单调不回撤;humanObsKey;cap<毕业阈值
 *   T2  行为(真 sql.js):无标记节点连发 update_mastery 提案 ×10 → mastery 封顶
 *       0.85、status 永不 mastered(KC 路径 + 单值回退路径双测)
 *   T3  行为:markHumanObservation 置位后 → 同样提案可跨 0.9 毕业
 *   T4  行为:KC 行存值本身被封顶(不是只压聚合)——解封后从真实值续涨无跳变
 *   T5  行为:legacy 高值(无标记、已存 0.92)→ 后续提案持平不回撤(封顶不没收)
 *   T6  源级:两条人工判分路径置位标记(quiz:recordAnswer / exercise-service)
 *   T7  源级:proposal-service 消费 cap(kcCap + 聚合单调封顶);本套件注册 verify:core
 *
 * 运行:npx tsx scripts/verify-mastery-cap.mjs(真 sql.js,零 Electron)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  AI_MASTERY_CAP,
  capMasteryValue,
  humanObsKey,
  capBelowGraduation,
} from "../src/main/services/pure/mastery-cap.ts";
import {
  hasHumanObservation,
  markHumanObservation,
} from "../src/main/services/human-observation.ts";
import {
  createProposal,
  applyProposal,
} from "../src/main/services/proposal-service.ts";
import { getProgress } from "../src/main/services/progress-service.ts";
import { getKcMastery } from "../src/main/services/kc-service.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(read("src/main/db/schema.sql"));
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  return { db: drizzle(sqljs, { schema }), sqljs };
}

const applyMastery = (db, nodeId, n, correct = true) => {
  for (let i = 0; i < n; i++) {
    const p = createProposal(db, {
      nodeId,
      operations: [{ type: "update_mastery", nodeId, correct }],
      rationale: "test",
    });
    applyProposal(db, p.id);
  }
};

/* T1 纯函数 */
assert.ok(capBelowGraduation(), "T1: AI_MASTERY_CAP 必须低于毕业阈值");
assert.equal(capMasteryValue(0.99, false), AI_MASTERY_CAP, "T1: 无标记封顶");
assert.equal(capMasteryValue(0.99, true), 0.99, "T1: 有标记原值");
assert.equal(capMasteryValue(0.7, false), 0.7, "T1: 低于封顶不动");
assert.equal(capMasteryValue(0.99, false, 0.92), 0.92, "T1: legacy 高值持平不回撤");
assert.equal(capMasteryValue(0.99, false, 0.5), AI_MASTERY_CAP, "T1: prev 低于封顶按封顶");
assert.equal(humanObsKey("n1"), "human_obs:n1", "T1: 标记 key 形状");
console.log(`✓ T1 纯函数: 封顶/解封/单调/key`);

/* T2 行为:KC 路径封顶 */
{
  const { db, sqljs } = await makeDb();
  sqljs.run(
    `INSERT INTO content_nodes (id, course_id, type, title, knowledge_points) VALUES ('kc1','c1','lesson','L',?)`,
    [JSON.stringify([{ title: "A" }, { title: "B" }])],
  );
  applyMastery(db, "kc1", 10);
  const prog = getProgress(db, "kc1");
  assert.ok(prog && prog.mastery != null, "T2: 应有进度行");
  assert.ok(prog.mastery <= AI_MASTERY_CAP + 1e-9, `T2: KC 路径聚合封顶, 实际 ${prog.mastery}`);
  assert.notStrictEqual(prog.status, "mastered", "T2: 纯 AI 观测不得毕业");
  const kcs = getKcMastery(db, "kc1");
  assert.ok(kcs.every((r) => r.mastery <= AI_MASTERY_CAP + 1e-9), `T2: KC 行存值本身封顶 [${kcs.map((r) => r.mastery.toFixed(3))}]`);
  console.log(`✓ T2 KC 路径: 聚合=${prog.mastery.toFixed(3)} ≤ ${AI_MASTERY_CAP}, KC 行全封顶, 不毕业`);

  /* T3 解封后可毕业 */
  assert.equal(hasHumanObservation(db, "kc1"), false, "T3: 前置无标记");
  markHumanObservation(db, "kc1");
  assert.equal(hasHumanObservation(db, "kc1"), true, "T3: 置位可读回");
  applyMastery(db, "kc1", 10);
  const prog3 = getProgress(db, "kc1");
  assert.strictEqual(prog3.status, "mastered", "T3: 解封后应可毕业");
  assert.ok(prog3.mastery >= 0.9, `T3: 毕业后 mastery≥0.9, 实际 ${prog3.mastery}`);
  console.log(`✓ T3 解封: 人工观测置位 → mastery=${prog3.mastery.toFixed(3)} → mastered`);
}

/* T2b/T4:单值回退路径封顶 + 解封 */
{
  const { db, sqljs } = await makeDb();
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('fb1','c1','lesson','L')`);
  applyMastery(db, "fb1", 10);
  const prog = getProgress(db, "fb1");
  assert.ok(prog.mastery <= AI_MASTERY_CAP + 1e-9, `T2b: 单值回退路径封顶, 实际 ${prog.mastery}`);
  assert.notStrictEqual(prog.status, "mastered", "T2b: 不得毕业");
  markHumanObservation(db, "fb1");
  applyMastery(db, "fb1", 10);
  const prog2 = getProgress(db, "fb1");
  assert.strictEqual(prog2.status, "mastered", "T4: 单值路径解封后可毕业");
  console.log(`✓ T2b/T4 单值回退路径: 封顶 ${prog.mastery.toFixed(3)} → 解封毕业 ${prog2.mastery.toFixed(3)}`);
}

/* T5 legacy 高值不没收 */
{
  const { db, sqljs } = await makeDb();
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('lg1','c1','lesson','L')`);
  // 模拟功能上线前的历史库:progress 已有 0.92(无标记)
  sqljs.run(
    `INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('lg1','in_progress',0,0.92)`,
  );
  applyMastery(db, "lg1", 3);
  const prog = getProgress(db, "lg1");
  assert.ok(prog.mastery >= 0.92 - 1e-9, `T5: legacy 0.92 不得被拖低, 实际 ${prog.mastery}`);
  console.log(`✓ T5 legacy 不没收: 0.92 → ${prog.mastery.toFixed(3)}(持平或更高)`);
}

/* T6/T7 源级接线 */
const ipcIdx = read("src/main/ipc/index.ts");
const exSvc = read("src/main/services/exercise-service.ts");
const propSvc = read("src/main/services/proposal-service.ts");
assert.ok(
  ipcIdx.includes("markHumanObservation(getDb(), nodeId)") &&
    ipcIdx.indexOf("markHumanObservation(getDb(), nodeId)") < ipcIdx.indexOf('handle("quiz:recordAnswer"') + 1200,
  "T6: quiz:recordAnswer 判分前置位标记",
);
assert.ok(exSvc.includes("markHumanObservation(db, ex.nodeId)"), "T6: exercise 判分前置位标记");
assert.ok(propSvc.includes("AI_MASTERY_CAP") && propSvc.includes("capMasteryValue"), "T7: proposal-service 消费封顶");
const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts["verify:core"].includes("verify-mastery-cap"), "T7: 已注册 verify:core");
console.log(`✓ T6/T7 源级: quiz/exercise 置位 + proposal 消费 + 注册`);

console.log("\n=== ALL MASTERY-CAP TESTS PASSED ✅ ===");
