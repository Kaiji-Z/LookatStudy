/**
 * Starter Prompts 验证 —— 测 starter-prompts-service.ts。
 *
 * 覆盖:
 *   - 新课阶段（mastery null）: 引导类 prompts（讲讲/关键点/前置/为什么）
 *   - 学习中阶段（mastery 0.1-0.7）: 深入类 prompts（疑问/辨析/应用/考考我）
 *   - 接近掌握阶段（mastery >0.7）: 检验类 prompts（总结/关联/进阶/费曼）
 *   - 不存在的节点 → 空数组
 *   - 每个 prompt 有 label + message + icon
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

// 建测试数据
const NODE_ID = "test-node-1";
sqljs.run("INSERT INTO courses (id, repo_name, title) VALUES ('c1', 'r', 'T')");
sqljs.run("INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, 'c1', 'lesson', '神经网络基础')", [NODE_ID]);

// === T1: 新课阶段（无 mastery） ===
sqljs.run("INSERT INTO progress (node_id, status, crown_level) VALUES (?, 'available', 0)", [NODE_ID]);
const newPrompts = getStarterPrompts(db, NODE_ID);
assert.ok(newPrompts.length >= 3, `T1: 新课应有≥3个 prompts, 实际 ${newPrompts.length}`);
assert.ok(newPrompts.some((p) => p.message.includes("核心概念")), "T1: 应有'核心概念'引导");
assert.ok(newPrompts.some((p) => p.message.includes("基础")), "T1: 应有'前置知识'引导");
console.log(`✓ T1 新课阶段: ${newPrompts.length} 个 prompts（讲讲/关键点/前置/为什么）`);

// === T2: 每个 prompt 结构完整 ===
for (const p of newPrompts) {
  assert.ok(p.label && p.label.length > 0, "T2: label 非空");
  assert.ok(p.message && p.message.length > 10, "T2: message 有实质内容");
  assert.ok(p.icon && p.icon.length > 0, "T2: icon 非空");
}
console.log("✓ T2 每个 prompt 有 label + message + icon");

// === T3: 学习中阶段（mastery 0.3） ===
sqljs.run("UPDATE progress SET mastery = 0.3 WHERE node_id = ?", [NODE_ID]);
const midPrompts = getStarterPrompts(db, NODE_ID);
assert.ok(midPrompts.length >= 3, `T3: 学习中应有≥3个 prompts`);
assert.ok(midPrompts.some((p) => p.message.includes("深入") || p.message.includes("不懂")), "T3: 应有深入引导");
assert.ok(midPrompts.some((p) => p.message.includes("练习题") || p.message.includes("考")), "T3: 应有考考我");
console.log(`✓ T3 学习中阶段(mastery=0.3): ${midPrompts.length} 个 prompts（疑问/辨析/应用/考考我）`);

// === T4: 新课和学习中的 prompts 不同 ===
const newLabels = new Set(newPrompts.map((p) => p.label));
const midLabels = new Set(midPrompts.map((p) => p.label));
const overlap = [...newLabels].filter((l) => midLabels.has(l));
assert.ok(overlap.length < newLabels.size, "T4: 两阶段 prompts 应大部分不同");
console.log(`✓ T4 新课 vs 学习中: prompts 内容不同（${overlap.length} 个重叠）`);

// === T5: 接近掌握阶段（mastery 0.85） ===
sqljs.run("UPDATE progress SET mastery = 0.85 WHERE node_id = ?", [NODE_ID]);
const masterPrompts = getStarterPrompts(db, NODE_ID);
assert.ok(masterPrompts.length >= 3, `T5: 接近掌握应有≥3个 prompts`);
assert.ok(masterPrompts.some((p) => p.message.includes("总结") || p.message.includes("复述")), "T5: 应有总结/费曼");
assert.ok(masterPrompts.some((p) => p.message.includes("关联") || p.message.includes("体系")), "T5: 应有知识关联");
console.log(`✓ T5 接近掌握阶段(mastery=0.85): ${masterPrompts.length} 个 prompts（总结/关联/进阶/费曼）`);

// === T6: 不存在的节点 → 空数组 ===
const empty = getStarterPrompts(db, "nonexistent");
assert.strictEqual(empty.length, 0, "T6: 不存在节点应返回空数组");
console.log("✓ T6 不存在节点 → 空数组");

// === T7: prompts 引用了节点标题 ===
sqljs.run("UPDATE progress SET mastery = NULL WHERE node_id = ?", [NODE_ID]);
const titledPrompts = getStarterPrompts(db, NODE_ID);
const allMentionTitle = titledPrompts.every((p) => p.message.includes("神经网络基础"));
assert.ok(allMentionTitle, "T7: 每个 prompt 的 message 都应引用节点标题");
console.log("✓ T7 prompts 引用节点标题（个性化）");

console.log("\n=== ALL STARTER PROMPTS TESTS PASSED ✅ ===");
