/**
 * Starter Prompts 验证 —— 测 starter-prompts-service.ts。
 *
 * 设计转向(2026-08-13):starter 不再按 mastery 分档,改成固定的 4 个"巩固选择"
 * (深入 / 举个例子 / 考考我 / 我没太懂),只在对话开始后才渲染。
 * 本套验证这组的不变量:
 *   - 恰好 4 个,label 是约定的 4 个
 *   - 每个结构完整(label + message + icon + hint)
 *   - 只有"考考我"advancesMastery;只有"我没太懂"带 frictionCategory
 *   - message 引用节点标题(个性化)
 *   - 不存在节点 → []
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { getStarterPrompts } from "../src/main/services/starter-prompts-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

const NODE_ID = "test-node-1";
sqljs.run("INSERT INTO courses (id, repo_name, title) VALUES ('c1', 'r', 'T')");
sqljs.run("INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, 'c1', 'lesson', '神经网络基础')", [NODE_ID]);

const prompts = getStarterPrompts(db, NODE_ID);

// === T1: 恰好 4 个 ===
assert.strictEqual(prompts.length, 4, `T1: 应恰好 4 个巩固选择, 实际 ${prompts.length}`);
console.log(`✓ T1 恰好 4 个巩固选择`);

// === T2: 4 个 label 是约定的 ===
const labels = prompts.map((p) => p.label);
for (const expected of ["深入这点", "举个例子", "考考我", "我没太懂"]) {
  assert.ok(labels.includes(expected), `T2: 应含"${expected}", 实际 ${JSON.stringify(labels)}`);
}
console.log(`✓ T2 4 个 label: ${labels.join(" / ")}`);

// === T3: 每个结构完整(label + message + icon + 可见 hint) ===
for (const p of prompts) {
  assert.ok(p.label && p.label.length > 0, `T3: label 非空`);
  assert.ok(p.message && p.message.length > 10, `T3: message 有实质内容`);
  assert.ok(p.icon && p.icon.length > 0, `T3: icon 非空`);
  assert.ok(p.hint && p.hint.length > 0, `T3: hint 非空(hint 必须可见,不靠 hover)`);
}
console.log(`✓ T3 每个 prompt 结构完整(label + message + icon + hint)`);

// === T4: 只有"考考我"advancesMastery ===
const mastery = prompts.filter((p) => p.advancesMastery);
assert.strictEqual(mastery.length, 1, `T4: 应只有 1 个 advancesMastery, 实际 ${mastery.length}`);
assert.strictEqual(mastery[0].label, "考考我", `T4: advancesMastery 应是"考考我"`);
console.log(`✓ T4 只有"考考我"涨掌握度`);

// === T5: 只有"我没太懂"带 frictionCategory ===
const friction = prompts.filter((p) => p.frictionCategory);
assert.strictEqual(friction.length, 1, `T5: 应只有 1 个 frictionCategory, 实际 ${friction.length}`);
assert.strictEqual(friction[0].label, "我没太懂", `T5: frictionCategory 应是"我没太懂"`);
assert.strictEqual(friction[0].frictionCategory, "confused", `T5: frictionCategory 值应为 confused`);
console.log(`✓ T5 只有"我没太懂"记 friction(原 ? 卡点的归宿)`);

// === T6: message 引用节点标题(个性化) ===
const allMentionTitle = prompts.every((p) => p.message.includes("神经网络基础"));
assert.ok(allMentionTitle, "T6: 每个 prompt 的 message 都应引用节点标题");
console.log(`✓ T6 prompts 引用节点标题(个性化)`);

// === T7: 不存在节点 → [] ===
assert.strictEqual(getStarterPrompts(db, "nonexistent").length, 0, "T7: 不存在节点应返回 []");
console.log(`✓ T7 不存在节点 → []`);

console.log("\n=== ALL STARTER PROMPTS TESTS PASSED ✅ ===");
