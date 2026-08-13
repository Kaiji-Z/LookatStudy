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
import { consolidate, getSlot, gatherConsolidationWindow, getConsolidationWatermark, setConsolidationWatermark } from "../src/main/services/memory-service.ts";

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

// ============================================================
// T6-T8: gatherConsolidationWindow 从真实表采 + 端到端
// ============================================================
let envG = await makeDb();
// FK 链:course → content_node;thread → course;chat_messages → thread;friction_log.node_id 无 FK
envG.sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('gc','r','GCourse')`);
envG.sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('gn','gc','lesson','GNode')`);
envG.sqljs.run(`INSERT INTO threads (id, course_id, status, title) VALUES ('gt','gc','active','T')`);
envG.sqljs.run(`INSERT INTO chat_messages (id, thread_id, role, content) VALUES ('m1','gt','user','用例子讲一下递归')`);
envG.sqljs.run(`INSERT INTO chat_messages (id, thread_id, role, content) VALUES ('m2','gt','assistant','好的,用斐波那契')`);
envG.sqljs.run(`INSERT INTO friction_log (id, node_id, category, summary) VALUES ('fg1','gn','confused','基线条件不懂')`);
envG.sqljs.run(`INSERT INTO friction_log (id, node_id, category, summary) VALUES ('fg2','gn','blocked','返回值搞混')`);

// T6: gather 采到 conversation
const winG = gatherConsolidationWindow(envG.db, { courseId: "gc" });
assert.ok(winG.conversation.length === 2, `T6: gather 采到 2 条消息,实际 ${winG.conversation.length}`);
assert.ok(winG.conversation.some((m) => m.content.includes("用例子")), "T6: conversation 含用户消息");
console.log("✓ T6 gatherConsolidationWindow 采到 thread 消息");

// T7: gather 采到 friction(课程的节点)
assert.ok(winG.frictionEntries.length === 2, `T7: gather 采到 2 条 friction,实际 ${winG.frictionEntries.length}`);
assert.ok(winG.frictionEntries.some((f) => f.summary.includes("基线")), "T7: friction 含基线条件");
console.log("✓ T7 gatherConsolidationWindow 采到课程的 friction");

// T8: 端到端 gather → consolidate → memory 写入
await consolidate(envG.db, winG, stubFn);
assert.ok(
  getSlot(envG.db, "global")?.summary.includes("偏好例子"),
  "T8: 端到端后 global 从对话提炼出'偏好例子'",
);
assert.ok(
  getSlot(envG.db, "friction_pattern", undefined, "gc")?.summary.includes("概念边界"),
  "T8: 端到端后 friction_pattern 固化(课程隔离 gc)",
);
console.log("✓ T8 端到端 gather→consolidate:memory 从真实数据固化");

// ============================================================
// T9-T11: watermark 增量采集(只采 since 之后的新数据)
// ============================================================
let envW = await makeDb();
envW.sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('gc2','r','GC2')`);
envW.sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('gn2','gc2','lesson','N')`);
envW.sqljs.run(`INSERT INTO threads (id, course_id, status) VALUES ('gt2','gc2','active')`);
envW.sqljs.run(`INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ('mold','gt2','user','旧消息','2026-08-14 09:00:00')`);
envW.sqljs.run(`INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ('mnew','gt2','user','新消息','2026-08-14 11:00:00')`);
envW.sqljs.run(`INSERT INTO friction_log (id, node_id, category, summary, created_at) VALUES ('fold','gn2','confused','旧卡点','2026-08-14 09:00:00')`);
envW.sqljs.run(`INSERT INTO friction_log (id, node_id, category, summary, created_at) VALUES ('fnew','gn2','blocked','新卡点','2026-08-14 11:00:00')`);

// T9: gather since 过滤消息(只采水位之后的)
const winSince = gatherConsolidationWindow(envW.db, { courseId: "gc2", since: "2026-08-14 10:00:00" });
assert.strictEqual(winSince.conversation.length, 1, "T9: since 过滤后只 1 条消息");
assert.ok(winSince.conversation[0].content === "新消息", "T9: 保留水位之后的新消息");
console.log("✓ T9 gather since 过滤消息(只采增量)");

// T10: gather since 过滤 friction
assert.strictEqual(winSince.frictionEntries.length, 1, "T10: since 过滤后只 1 条 friction");
assert.ok(winSince.frictionEntries[0].summary === "新卡点", "T10: 保留水位之后的新 friction");
console.log("✓ T10 gather since 过滤 friction");

// T11: watermark round-trip(首次 null,set 后可读)
assert.strictEqual(getConsolidationWatermark(envW.db, "gc2"), null, "T11: 首次水位 null");
const ts = setConsolidationWatermark(envW.db, "gc2");
assert.ok(typeof ts === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts), "T11: 水位是 YYYY-MM-DD HH:MM:SS 格式");
assert.strictEqual(getConsolidationWatermark(envW.db, "gc2"), ts, "T11: set 后可读回");
// 再 set → 推进(upsert,不堆叠)
setConsolidationWatermark(envW.db, "gc2");
const rows = envW.db.select().from(schema.settings).all().filter((r) => r.key === "consolidate_watermark:gc2");
assert.strictEqual(rows.length, 1, "T11: 同课程 watermark 只 1 行(upsert 不堆叠)");
console.log("✓ T11 watermark get/set round-trip + upsert 不堆叠");

console.log("\n=== ALL CONSOLIDATION TESTS PASSED ✅ ===");
