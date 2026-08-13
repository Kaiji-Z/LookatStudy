/**
 * Memory 系统 Phase 1 回归套件 —— VERIFICATION §5 SOP step 1（先写回归）。
 *
 * Memory = 学习者模型（定性层），补 BKT（定量）+ friction_log（原始事件）之缺。
 * 写侧：agent remember tool → 写时 LLM 合并（去重/解冲突）→ upsert 进 memory 表。
 * 读侧：getLearnerMemory → 拼成"学习者记忆"块注入 agent 上下文。
 *
 * 本套件用**注入式 merge 函数**测写逻辑（不依赖 LLM，确定性）：
 *   remember(db, input, merge) —— merge: async (existingSummary, incomingContent) => string
 *   生产由 agent-engine 传 defaultLlmMerge(llm)；测试传确定性 stub。
 *
 * 测源码非副本（VERIFICATION §3.1）：真实 sql.js DB + 真实 memory-service。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  remember,
  getSlot,
  getLearnerMemory,
} from "../src/main/services/memory-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
  sqljs.run(schemaSql);
  return { db: drizzle(sqljs, { schema }), sqljs };
}

// 确定性 merge：空槽 → 新内容；有内容 → old | new（模拟 LLM 合并的"不丢旧、并新"）
const detMerge = async (existing, incoming) =>
  existing ? `${existing} | ${incoming}` : incoming;

// ============================================================
// T1: 空槽 remember → 创建(global, nodeId=null)
// ============================================================
let { db } = await makeDb();
await remember(db, { category: "global", content: "偏好类比讲解" }, detMerge);
let g = getSlot(db, "global");
assert.ok(g, "T1: 空 global 槽 remember 后应存在");
assert.strictEqual(g.summary, "偏好类比讲解", "T1: 空槽 summary = 新内容");
assert.strictEqual(g.nodeId, null, "T1: global 槽 nodeId=null");
console.log("✓ T1 空槽 remember 创建 global");

// ============================================================
// T2: 同槽再 remember → 合并(不覆盖、不新增行)
// ============================================================
await remember(db, { category: "global", content: "节奏快可一次推两层" }, detMerge);
g = getSlot(db, "global");
assert.strictEqual(g.summary, "偏好类比讲解 | 节奏快可一次推两层", "T2: 同槽 remember 应合并");
console.log("✓ T2 同槽 remember 合并(merge 被调用,旧内容保留)");

// ============================================================
// T3: global 槽仍只有 1 行(upsert,非堆叠)
// ============================================================
const globalCount = db
  .select()
  .from(schema.memory)
  .all().filter((r) => r.category === "global").length;
assert.strictEqual(globalCount, 1, "T3: 同槽 upsert,global 仍 1 行");
console.log("✓ T3 upsert-by-slot:同槽不堆叠");

// ============================================================
// T4: node 作用域独立于 global(nodeId 隔离)
// ============================================================
await remember(db, { category: "node", content: "基线条件反复卡", nodeId: "n1" }, detMerge);
const n1 = getSlot(db, "node", "n1");
assert.ok(n1, "T4: node n1 槽存在");
assert.strictEqual(n1.summary, "基线条件反复卡", "T4: node 槽内容正确");
assert.strictEqual(n1.nodeId, "n1", "T4: node 槽 nodeId=n1");
// global 不受影响
assert.strictEqual(getSlot(db, "global").summary, "偏好类比讲解 | 节奏快可一次推两层", "T4: 写 node 不污染 global");
// 不同 node 独立
await remember(db, { category: "node", content: "状态机概念模糊", nodeId: "n2" }, detMerge);
assert.strictEqual(getSlot(db, "node", "n2").summary, "状态机概念模糊", "T4: n2 独立于 n1");
console.log("✓ T4 node 作用域隔离(global/不同 node 互不污染)");

// ============================================================
// T5: friction_pattern 槽(global 作用域,nodeId=null,可多条)
// ============================================================
await remember(
  db,
  { category: "friction_pattern", content: "凡涉及'状态'的概念都要画图才懂" },
  detMerge,
);
const fp = getSlot(db, "friction_pattern");
assert.ok(fp, "T5: friction_pattern 槽存在");
console.log("✓ T5 friction_pattern 可写");

// ============================================================
// T6: getLearnerMemory(db, nodeId) 格式化块——含 global + 该 node + pattern
// ============================================================
const block = getLearnerMemory(db, "n1");
assert.ok(typeof block === "string" && block.length > 0, "T6: 有数据时返回非空字符串");
assert.ok(block.includes("偏好类比讲解"), "T6: 块含 global 记忆");
assert.ok(block.includes("基线条件反复卡"), "T6: 块含当前 node n1 记忆");
assert.ok(block.includes("状态"), "T6: 块含 friction_pattern");
console.log("✓ T6 getLearnerMemory(db,n1):global + node + pattern 都进块");

// ============================================================
// T7: getLearnerMemory 不传 nodeId → global + pattern,不含别 node 的记忆
// ============================================================
const blockNoNode = getLearnerMemory(db);
assert.ok(blockNoNode.includes("偏好类比讲解"), "T7: 无 nodeId 仍含 global");
assert.ok(!blockNoNode.includes("基线条件反复卡"), "T7: 无 nodeId 不含 node n1 的记忆(节点级不全局注入)");
assert.ok(!blockNoNode.includes("状态机概念模糊"), "T7: 无 nodeId 不含 node n2");
console.log("✓ T7 getLearnerMemory():无 nodeId 只 global+pattern,node 级不全局注入");

// ============================================================
// T8: 空 DB → getLearnerMemory 返回 null(等价"无记忆",agent 不注入该块)
// ============================================================
const fresh = await makeDb();
assert.strictEqual(getLearnerMemory(fresh.db, "n1"), null, "T8: 空 DB 返回 null");
assert.strictEqual(getLearnerMemory(fresh.db), null, "T8: 空 DB 无 nodeId 也 null");
console.log("✓ T8 空 DB → null(零记忆时不注入,新用户无副作用)");

// ============================================================
// T9: remember 返回 {ok, summary}(merge 结果回传,agent 可确认)
// ============================================================
const res = await remember(fresh.db, { category: "global", content: "目标:转行前端" }, detMerge);
assert.ok(res.ok === true, "T9: remember 返回 ok:true");
assert.strictEqual(res.summary, "目标:转行前端", "T9: 返回合并后 summary");
console.log("✓ T9 remember 返回值:{ok, summary}");

// ============================================================
// T10-T12: friction_pattern 按课程隔离(方案2);global 仍跨课程
// ============================================================
const c = await makeDb();
// 不同课程的 friction_pattern 各自独立槽位
await remember(c.db, { category: "friction_pattern", content: "混淆参数和变量" }, detMerge, "courseReact");
await remember(c.db, { category: "friction_pattern", content: "极限定义搞不清" }, detMerge, "courseMath");

const reactPat = getSlot(c.db, "friction_pattern", undefined, "courseReact");
const mathPat = getSlot(c.db, "friction_pattern", undefined, "courseMath");
assert.ok(reactPat && reactPat.summary.includes("参数"), "T10: courseReact 的 pattern 在");
assert.ok(mathPat && mathPat.summary.includes("极限"), "T10: courseMath 的 pattern 在");
assert.ok(!reactPat.summary.includes("极限"), "T10: courseReact 槽不被 courseMath 污染");
const fpRows = c.db.select().from(schema.memory).all().filter((r) => r.category === "friction_pattern");
assert.strictEqual(fpRows.length, 2, "T10: 两个课程各一个 friction_pattern 槽(不合并)");
console.log("✓ T10 friction_pattern 按课程隔离:不同课程各自独立槽位");

// T11: getLearnerMemory(db, nodeId, courseId) 按 course 过滤 friction_pattern
const blockReact = getLearnerMemory(c.db, undefined, "courseReact");
assert.ok(blockReact.includes("参数"), "T11: courseReact 块含其 pattern");
assert.ok(!blockReact.includes("极限"), "T11: courseReact 块不含 courseMath 的 pattern(不串味)");
console.log("✓ T11 getLearnerMemory 按 course 过滤:不串味");

// T12: global 仍跨课程(courseMath 块也含 global,因 global 无 course 作用域)
await remember(c.db, { category: "global", content: "吃类比讲解" }, detMerge);
const blockMath = getLearnerMemory(c.db, undefined, "courseMath");
assert.ok(blockMath.includes("吃类比"), "T12: global 跨课程,courseMath 块也含 global(风格不分课程)");
assert.ok(blockMath.includes("极限"), "T12: courseMath 块含自己的 friction_pattern");
console.log("✓ T12 global 仍跨课程(风格/偏好不分课程)");

console.log("\n=== ALL MEMORY SYSTEM TESTS PASSED ✅ ===");
