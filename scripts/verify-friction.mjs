/**
 * Friction(卡点)上下文验证(learning-experience Phase 3)。
 *
 * 核心不变量:
 *   - 用户主动上报的卡点(confused/blocked/frustrated)应进入 agent system prompt。
 *   - 系统级 agent_error 不应注入(那是程序问题,不是学习者主观卡点)。
 *   - 卡点按节点隔离 + 上限 5 条(防 prompt 膨胀)。
 *
 * 直接 import 真实源码(pure/friction-context.ts,db 注入,不触 electron)。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { insertFrictionDb, buildFrictionContext } from "../src/main/services/pure/friction-context.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('n1','c1','lesson','L1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('n2','c1','lesson','L2')`);
  return { db: drizzle(sqljs, { schema }), sqljs };
}

const { db } = await makeDb();

// === T1: 无卡点 → 空串(不污染 prompt) ===
assert.strictEqual(buildFrictionContext(db, "n1"), "", "T1: 无卡点应返回空串");
console.log(`✓ T1 无卡点 → 空串(不污染 prompt)`);

// === T2: 写一条 confused → 注入含中文标签 + 描述 ===
insertFrictionDb(db, "n1", "confused", "不懂 BKT 的 slip 和 guess 区别");
const ctx2 = buildFrictionContext(db, "n1");
assert.ok(ctx2.includes("糊涂"), `T2: 应含"糊涂"标签, 实际: ${ctx2}`);
assert.ok(ctx2.includes("slip 和 guess"), `T2: 应含描述, 实际: ${ctx2}`);
console.log(`✓ T2 写 confused → 注入: "${ctx2.replace(/\n/g, " | ")}"`);

// === T3: agent_error 不被注入(系统级,非学习者主观卡点) ===
insertFrictionDb(db, "n1", "agent_error", "active_skill xyz 不在 skills 表里");
const ctx3 = buildFrictionContext(db, "n1");
assert.ok(!ctx3.includes("xyz"), `T3: agent_error 不应被注入, 实际: ${ctx3}`);
assert.ok(ctx3.includes("糊涂"), "T3: 人类卡点仍在");
console.log(`✓ T3 agent_error 被排除(只注入人类卡点)`);

// === T4: 节点隔离 — n1 的卡点不出现在 n2 ===
assert.strictEqual(buildFrictionContext(db, "n2"), "", "T4: n2 应无卡点(与 n1 隔离)");
console.log(`✓ T4 节点隔离: n1 卡点不泄漏到 n2`);

// === T5: 上限 5 条(防 prompt 膨胀) ===
for (let i = 0; i < 5; i++) insertFrictionDb(db, "n1", "confused", `extra-${i}`);
const ctx5 = buildFrictionContext(db, "n1");
assert.ok(/共 5 条/.test(ctx5), `T5: 应上限 5 条, 实际首行: ${ctx5.split("\n")[0]}`);
console.log(`✓ T5 上限 5 条: ${ctx5.split("\n")[0]}`);

// === T6: blocked/frustrated 标签正确 ===
insertFrictionDb(db, "n2", "blocked", "卡在练习题第三步");
insertFrictionDb(db, "n2", "frustrated", "反复答错很挫败");
const ctx6 = buildFrictionContext(db, "n2");
assert.ok(ctx6.includes("卡住"), `T6: 应含"卡住", 实际: ${ctx6}`);
assert.ok(ctx6.includes("受挫"), `T6: 应含"受挫", 实际: ${ctx6}`);
console.log(`✓ T6 blocked/frustrated 标签: "${ctx6.replace(/\n/g, " | ")}"`);

console.log("\n=== ALL FRICTION CONTEXT TESTS PASSED ✅ ===");
