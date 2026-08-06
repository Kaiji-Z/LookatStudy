/**
 * XP 系统验证 —— 测 xp-service.ts 的纯逻辑。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  addXp,
  addXpCorrect,
  addXpWrong,
  addXpMastered,
  getXpStatus,
  cleanupOldXp,
  XP_CORRECT,
  XP_WRONG,
  XP_MASTERED,
} from "../src/main/services/xp-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
const db = drizzle(sqljs, { schema });

// === T1: 常量值 ===
assert.strictEqual(XP_CORRECT, 10, "T1: 答对=10 XP");
assert.strictEqual(XP_WRONG, 1, "T1: 答错=1 XP");
assert.strictEqual(XP_MASTERED, 50, "T1: 掌握=50 XP");
console.log("✓ T1 XP 常量: 答对10/答错1/掌握50");

// === T2: 初始状态 ===
const initial = getXpStatus(db);
assert.strictEqual(initial.todayXp, 0, "T2: 初始 XP=0");
assert.strictEqual(initial.dailyGoal, 30, "T2: 默认目标=30");
assert.strictEqual(initial.achieved, false, "T2: 初始未达成");
assert.strictEqual(initial.pct, 0, "T2: 初始百分比=0");
console.log("✓ T2 初始状态: XP=0, 目标=30, 未达成");

// === T3: 答对一题 +10 ===
addXpCorrect(db);
const after1 = getXpStatus(db);
assert.strictEqual(after1.todayXp, 10, "T3: 答对后 XP=10");
assert.strictEqual(after1.pct, 33, "T3: 百分比=33%");
console.log("✓ T3 答对: XP=10, pct=33%");

// === T4: 答错一题 +1 ===
addXpWrong(db);
const after2 = getXpStatus(db);
assert.strictEqual(after2.todayXp, 11, "T4: 答错后 XP=11");
console.log("✓ T4 答错: XP=11");

// === T5: 掌握一课 +50 ===
addXpMastered(db);
const after3 = getXpStatus(db);
assert.strictEqual(after3.todayXp, 61, "T5: 掌握后 XP=61");
assert.strictEqual(after3.achieved, true, "T5: 达成目标");
assert.strictEqual(after3.pct, 100, "T5: 百分比=100%");
console.log("✓ T5 掌握: XP=61, 达成, pct=100%");

// === T6: 自定义每日目标 ===
sqljs.run("INSERT INTO settings (key, value) VALUES ('daily_goal_xp', '100')");
const withGoal = getXpStatus(db);
assert.strictEqual(withGoal.dailyGoal, 100, "T6: 目标=100");
assert.strictEqual(withGoal.achieved, false, "T6: 61<100 未达成");
assert.strictEqual(withGoal.pct, 61, "T6: 百分比=61%");
console.log("✓ T6 自定义目标: 100, XP=61, pct=61%, 未达成");

// === T7: addXp 通用函数 ===
const total = addXp(db, 5);
assert.strictEqual(total, 66, "T7: +5 后=66");
console.log("✓ T7 addXp(5): XP=66");

// === T8: 清理过期 XP 条目 ===
// 手动插入一个 8 天前的 daily_xp 条目
const oldDate = new Date();
oldDate.setDate(oldDate.getDate() - 8);
const oldKey = `daily_xp_${oldDate.toISOString().slice(0, 10)}`;
sqljs.run(`INSERT INTO settings (key, value) VALUES ('${oldKey}', '999')`);
const deleted = cleanupOldXp(db);
assert.ok(deleted >= 1, `T8: 应清理≥1条, 实际 ${deleted}`);
// 确认旧条目已删
const check = sqljs.exec(`SELECT count(*) FROM settings WHERE key='${oldKey}'`);
assert.strictEqual(check[0].values[0][0], 0, "T8: 旧条目已删除");
console.log(`✓ T8 清理过期: 删除 ${deleted} 条`);

console.log("\n=== ALL XP TESTS PASSED ✅ ===");
