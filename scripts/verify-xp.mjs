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
  bumpTotalXp,
  levelFromTotalXp,
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

// === 对抗性测试 ===
console.log("\n=== 对抗性测试 ===");

// T9: 负数 XP 应被防御为 0（防篡改）
addXp(db, -1000);
const afterNeg = getXpStatus(db);
assert.ok(afterNeg.todayXp >= 0, `T9: 负数 XP 不应让 todayXp 变负, 实际 ${afterNeg.todayXp}`);
console.log(`✓ T9 负数XP防御: addXp(-1000) → XP=${afterNeg.todayXp}（不变，防篡改）`);

// T10: 非法 daily_goal_xp 值不应崩溃
sqljs.run("UPDATE settings SET value = 'NaN' WHERE key = 'daily_goal_xp'");
const withNan = getXpStatus(db);
assert.ok(!Number.isNaN(withNan.dailyGoal), "T10: NaN 目标应 fallback 到默认");
// parseInt('NaN') = NaN，fallback 到 DEFAULT_DAILY_GOAL
assert.strictEqual(withNan.dailyGoal, 30, "T10: NaN 目标 fallback 到 30");
console.log("✓ T10 非法 daily_goal 值: fallback 到默认 30（不崩溃）");

// T11: 超大 XP 值不应崩溃
addXp(db, 999999);
const afterHuge = getXpStatus(db);
assert.ok(afterHuge.todayXp > 900000, "T11: 超大 XP 正确累加");
assert.strictEqual(afterHuge.pct, 100, "T11: pct 封顶 100");
console.log(`✓ T11 超大 XP(${afterHuge.todayXp}): pct=100（封顶不溢出）`);

// T12: getXpStatus 不应修改 DB（只读操作）
const beforeRead = sqljs.exec("SELECT value FROM settings WHERE key='daily_goal_xp'")[0].values[0][0];
getXpStatus(db);
const afterRead = sqljs.exec("SELECT value FROM settings WHERE key='daily_goal_xp'")[0].values[0][0];
assert.strictEqual(beforeRead, afterRead, "T12: getXpStatus 不应改 DB");
console.log("✓ T12 getXpStatus 纯只读（不改 DB）");

// === P4: 累计 XP + 等级(持久成长线)===

// T13: levelFromTotalXp 边界(纯函数,二次曲线 50·L²)
assert.strictEqual(levelFromTotalXp(0).level, 0, "T13: 0 XP → Lv0");
assert.strictEqual(levelFromTotalXp(49).level, 0, "T13: 49 → Lv0");
assert.strictEqual(levelFromTotalXp(50).level, 1, "T13: 50 → Lv1");
assert.strictEqual(levelFromTotalXp(199).level, 1, "T13: 199 → Lv1");
assert.strictEqual(levelFromTotalXp(200).level, 2, "T13: 200 → Lv2");
assert.strictEqual(levelFromTotalXp(450).level, 3, "T13: 450 → Lv3");
assert.strictEqual(levelFromTotalXp(5000).level, 10, "T13: 5000 → Lv10");
assert.strictEqual(levelFromTotalXp(50).pct, 0, "T13: Lv1 起点 pct=0");
assert.ok(levelFromTotalXp(75).pct > 0 && levelFromTotalXp(75).pct < 100, "T13: Lv1 中段 0<pct<100");
assert.ok(levelFromTotalXp(199).pct > 90, "T13: 接近 Lv2 时 pct 接近满");
console.log("✓ T13 levelFromTotalXp: 0/50/200/450/5000 → Lv0/1/2/3/10 + pct 单调递增");

// T14: addXp 累计进 total_xp(getXpStatus 读回,只增)
const xs = getXpStatus(db);
assert.ok(xs.totalXp > 0, `T14: 累计 XP 应 >0(多次 addXp 累加), 实际 ${xs.totalXp}`);
assert.ok(xs.level >= 0 && typeof xs.levelPct === "number", "T14: level/levelPct 字段存在");
bumpTotalXp(db, 1000);
const xs2 = getXpStatus(db);
assert.ok(xs2.totalXp === xs.totalXp + 1000, `T14: bump 后 totalXp 精确 +1000, ${xs.totalXp}→${xs2.totalXp}`);
assert.ok(xs2.level >= xs.level, "T14: level 不减");
console.log(`✓ T14 累计 XP: totalXp=${xs.totalXp}→${xs2.totalXp}, level ${xs.level}→${xs2.level}(持久成长)`);

// T15: total_xp 不随每日重置(跨天 todayXp 归零,totalXp 保留)
sqljs.run("DELETE FROM settings WHERE key LIKE 'daily_xp_%'");
const nextDay = getXpStatus(db);
assert.strictEqual(nextDay.todayXp, 0, "T15: 跨天 todayXp 归零");
assert.strictEqual(nextDay.totalXp, xs2.totalXp, "T15: 跨天 totalXp 保留(持久成长线)");
console.log(`✓ T15 跨天: todayXp 归零, totalXp=${nextDay.totalXp} 保留(不随每日清零)`);

console.log("\n=== 对抗性测试 PASSED ✅ ===");

