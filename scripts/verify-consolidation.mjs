/**
 * Memory Consolidation 核心回归套件 —— VERIFICATION §5 step 1。
 *
 * Consolidation = 把原始数据(对话/friction/答题)固化成 memory(全三类)的机制。
 * 这是 agent `remember`(实时手动)的系统级兜底:不靠 agent 自觉,周期性/按需地从
 * 已有数据提炼记忆。覆盖 global/node/friction_pattern 全部(不只 friction)。
 *
 * 核心 consolidate(db, window, consolidateFn) 触发无关、纯函数:
 *   window = { courseId?, nodeId?, conversation[], frictionEntries[], answers[] }
 *   consolidateFn(window, existing) → { global?, node?, friction_pattern? }(已与 existing 合并)
 * 生产 defaultLlmConsolidate(llm) 一次 LLM 调用 extract+merge 全三类;测试用确定性 stub。
 *
 * memory 表 node_id/course_id 无 FK,故测试无需建 course/node FK 链。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { consolidate, getSlot } from "../src/main/services/memory-service.ts";

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

// 确定性 consolidateFn:从 window 提炼 + 与 existing 合并(模拟 LLM 的 extract+update)
const stubFn = async (win, existing) => {
  const out = {};
  if (win.conversation.some((m) => m.content.includes("用例子"))) out.global = "偏好例子";
  if (win.frictionEntries.some((f) => f.summary.includes("基线"))) out.node = "基线条件卡";
  if (win.frictionEntries.length >= 2) out.friction_pattern = "反复卡概念边界";
  // 合并:existing 有就追加(模拟不丢旧)
  for (const k of ["global", "node", "friction_pattern"]) {
    if (existing[k] && out[k]) out[k] = `${existing[k]} | ${out[k]}`;
    else if (existing[k] && !out[k]) out[k] = existing[k]; // 保留 existing(本次没新提炼也别丢)
  }
  return out;
};

// ============================================================
// T1: 一次 consolidate 从 window 写全三类(global/node/friction_pattern)
// ============================================================
let { db } = await makeDb();
const win = {
  courseId: "c1",
  nodeId: "n1",
  conversation: [{ role: "user", content: "用例子讲一下" }],
  frictionEntries: [
    { category: "confused", summary: "基线条件不懂" },
    { category: "blocked", summary: "状态机模糊" },
  ],
  answers: [],
};
const res = await consolidate(db, win, stubFn);
assert.ok(res.global, "T1: 返回 global");
assert.ok(res.node, "T1: 返回 node");
assert.ok(res.friction_pattern, "T1: 返回 friction_pattern");
assert.strictEqual(getSlot(db, "global").summary, "偏好例子", "T1: global 写入");
assert.strictEqual(getSlot(db, "node", "n1").summary, "基线条件卡", "T1: node 写入(nodeId=n1)");
assert.strictEqual(
  getSlot(db, "friction_pattern", undefined, "c1").summary,
  "反复卡概念边界",
  "T1: friction_pattern 写入(courseId=c1,课程隔离)",
);
console.log("✓ T1 一次 consolidate 写全三类(global+node+friction_pattern)");

// ============================================================
// T2: 再 consolidate 同窗口 → 与 existing 合并(不覆盖、不丢旧)
// ============================================================
await consolidate(db, win, stubFn);
assert.strictEqual(
  getSlot(db, "global").summary,
  "偏好例子 | 偏好例子",
  "T2: 第二次 consolidate 与 existing 合并",
);
console.log("✓ T2 consolidate 与 existing 合并(consolidateFn 收到 existing 并合并)");

// ============================================================
// T3: 不同课程窗口的 friction_pattern 不串(course 隔离仍成立)
// ============================================================
const winMath = {
  courseId: "cMath",
  nodeId: "n2",
  conversation: [],
  frictionEntries: [{ category: "confused", summary: "基线条件不懂" }, { category: "blocked", summary: "极限模糊" }],
  answers: [],
};
await consolidate(db, winMath, stubFn);
assert.ok(
  getSlot(db, "friction_pattern", undefined, "cMath").summary.includes("概念边界"),
  "T3: cMath 的 friction_pattern 独立写入",
);
assert.ok(
  !getSlot(db, "friction_pattern", undefined, "c1").summary.includes("极限"),
  "T3: c1 的 friction_pattern 不被 cMath 污染",
);
console.log("✓ T3 consolidation 尊重课程隔离");

// ============================================================
// T4: consolidateFn 返回空对象(无可提炼)→ 不写任何 memory,不报错
// ============================================================
let env2 = await makeDb();
const emptyFn = async () => ({});
const r = await consolidate(env2.db, { courseId: "c1", nodeId: "n1", conversation: [], frictionEntries: [], answers: [] }, emptyFn);
assert.ok(!r.global && !r.node && !r.friction_pattern, "T4: 空结果不写");
assert.strictEqual(getSlot(env2.db, "global"), null, "T4: 无 global 写入");
console.log("✓ T4 无可提炼时不写、不崩");

// ============================================================
// T5: 只返回部分类别(只 global)→ 只写 global,不碰 node/friction
// ============================================================
let env3 = await makeDb();
const partialFn = async () => ({ global: "只爱例子" });
await consolidate(env3.db, { courseId: "c1", nodeId: "n1", conversation: [], frictionEntries: [], answers: [] }, partialFn);
assert.strictEqual(getSlot(env3.db, "global").summary, "只爱例子", "T5: global 写入");
assert.strictEqual(getSlot(env3.db, "node", "n1"), null, "T5: node 未被碰(consolidateFn 没返回 node)");
console.log("✓ T5 部分类别返回:只写返回的,不碰其它");

console.log("\n=== ALL CONSOLIDATION TESTS PASSED ✅ ===");
