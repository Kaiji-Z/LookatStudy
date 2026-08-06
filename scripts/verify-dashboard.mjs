/**
 * 仪表盘数据服务验证 —— 测真实 dashboard-service.ts。
 *
 * 不变量：
 *   - sections 聚合：每个 section 有 avgMastery / lessonCount / masteredCount
 *   - mastery>=0.7 算 mastered
 *   - 整体平均 = 各 section avg 的平均
 *   - SRS 到期数 = due_at <= now 的行数
 *   - streak 透传
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { getDashboard } from "../src/main/services/dashboard-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

// 造：1 课程，2 section，每 section 2 lesson，给不同 mastery
const { sqljs, db } = await makeDb();
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s2','c1','section','S2')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l2','c1','s1','lesson','L2')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l3','c1','s2','lesson','L3')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l4','c1','s2','lesson','L4')`);
// mastery
sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l1','mastered',5,0.9)`);
sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l2','in_progress',2,0.4)`);
sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l3','mastered',5,0.8)`);
sqljs.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('l4','locked',0)`); // mastery NULL

// === T1: 2 个 section ===
const dash = getDashboard(db, "c1");
assert.strictEqual(dash.sections.length, 2, `T1: 应 2 section, 实际 ${dash.sections.length}`);
console.log(`✓ T1 sections: ${dash.sections.length}`);

// === T2: S1 的 avgMastery = (0.9 + 0.4) / 2 = 0.65 ===
const s1 = dash.sections.find((s) => s.sectionTitle === "S1");
assert.ok(s1, "T2: S1 存在");
assert.ok(Math.abs(s1.avgMastery - 0.65) < 0.001, `T2: S1 avg 应 0.65, 实际 ${s1.avgMastery}`);
assert.strictEqual(s1.lessonCount, 2);
assert.strictEqual(s1.masteredCount, 1, "T2: S1 mastered 应 1（l1=0.9>=0.7）");
console.log(`✓ T2 S1: avg=${s1.avgMastery.toFixed(2)}, lessons=2, mastered=1`);

// === T3: S2 mastery NULL 算 0，mastered=1（l3=0.8）===
const s2 = dash.sections.find((s) => s.sectionTitle === "S2");
assert.ok(s2, "T3: S2 存在");
assert.ok(Math.abs(s2.avgMastery - 0.4) < 0.001, `T3: S2 avg 应 0.4 ((0.8+0)/2), 实际 ${s2.avgMastery}`);
assert.strictEqual(s2.masteredCount, 1, "T3: S2 mastered 应 1");
console.log(`✓ T3 S2: avg=${s2.avgMastery.toFixed(2)}（NULL 算 0）, mastered=1`);

// === T4: 整体平均 = (0.65 + 0.4) / 2 ===
assert.ok(
  Math.abs(dash.overallMastery - 0.525) < 0.001,
  `T4: overall 应 0.525, 实际 ${dash.overallMastery}`,
);
console.log(`✓ T4 overall: ${dash.overallMastery.toFixed(3)}`);

// === T5: streak 透传 ===
assert.ok(dash.currentStreak >= 0, "T5: streak >= 0");
assert.ok(dash.freezeCount >= 0, "T5: freeze >= 0");
console.log(`✓ T5 streak=${dash.currentStreak}, freeze=${dash.freezeCount}`);

// === T6: SRS 到期数 ===
// 造 2 条 SRS：1 条已到期（due 过去），1 条未到期（due 未来）
sqljs.run(`INSERT INTO srs_items (id, node_id, due_at) VALUES ('srs1','l1','2020-01-01T00:00:00Z')`);
sqljs.run(`INSERT INTO srs_items (id, node_id, due_at) VALUES ('srs2','l2','2099-12-31T00:00:00Z')`);
const dash2 = getDashboard(db, "c1");
assert.strictEqual(dash2.dueToday, 1, `T6: 应 1 条到期, 实际 ${dash2.dueToday}`);
console.log(`✓ T6 dueToday: ${dash2.dueToday}（过去 1 条，未来 1 条）`);

// === T7: 空课程 → 空 sections，overall=0 ===
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c2','r','T2')`);
const empty = getDashboard(db, "c2");
assert.strictEqual(empty.sections.length, 0, "T7: 空课程 0 section");
assert.strictEqual(empty.overallMastery, 0, "T7: 空 overall=0");
console.log(`✓ T7 空课程：sections=0, overall=0`);

console.log("\n=== ALL DASHBOARD TESTS PASSED ✅ ===");
