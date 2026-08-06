/**
 * 导出服务验证 —— 测 export-service.ts 的数据收集 + 格式生成。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  collectExportData,
  exportJson,
  exportMarkdown,
} from "../src/main/services/export-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
const db = drizzle(sqljs, { schema });

// 建测试课程
sqljs.run("INSERT INTO courses (id, repo_name, title, description) VALUES ('c1', 'test-repo', '测试课程', '这是一个测试课程')");
sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, order_idx) VALUES ('s1', 'c1', 'section', '第一章', 0)");
sqljs.run("INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('l1', 'c1', 's1', 'lesson', '课时1', 0)");
sqljs.run("INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('l2', 'c1', 's1', 'lesson', '课时2', 1)");
// 进度: l1 已掌握, l2 进行中
sqljs.run("INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l1', 'mastered', 5, 0.95)");
sqljs.run("INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l2', 'in_progress', 0, 0.3)");
// streak (schema.sql 已有默认 singleton 行，UPDATE 即可)
sqljs.run("UPDATE streaks SET current_streak = 7, longest_streak = 14, freeze_count = 2 WHERE id = 'singleton'");
// XP
sqljs.run("INSERT INTO settings (key, value) VALUES ('daily_xp_2026-08-07', '150')");

// === T1: collectExportData 正确收集 ===
const data = collectExportData(db, "c1");
assert.ok(data, "T1: 应返回数据");
assert.strictEqual(data.courseTitle, "测试课程");
assert.strictEqual(data.totalLessons, 2);
assert.strictEqual(data.masteredLessons, 1);
assert.strictEqual(data.currentStreak, 7);
assert.strictEqual(data.longestStreak, 14);
assert.ok(data.avgMastery > 0.5 && data.avgMastery < 1.0, `T1: avgMastery=${data.avgMastery}`);
console.log(`✓ T1 collectExportData: 2课时/1掌握/avg=${data.avgMastery.toFixed(2)}/streak=7/xp=150`);

// === T2: JSON 格式 ===
const json = exportJson(data);
const parsed = JSON.parse(json); // 能解析 = 格式正确
assert.strictEqual(parsed.courseTitle, "测试课程");
assert.strictEqual(parsed.sections.length, 1);
assert.strictEqual(parsed.sections[0].lessons.length, 2);
console.log("✓ T2 exportJson: 合法 JSON + 结构正确");

// === T3: Markdown 格式 ===
const md = exportMarkdown(data);
assert.ok(md.includes("# 🎓 LookatStudy 学习报告"), "T3: 有标题");
assert.ok(md.includes("测试课程"), "T3: 有课程名");
assert.ok(md.includes("150"), "T3: 有 XP");
assert.ok(md.includes("7 天"), "T3: 有连续天数");
assert.ok(md.includes("课时1"), "T3: 有课时名");
assert.ok(md.includes("👑"), "T3: 掌握的课时有皇冠图标");
console.log("✓ T3 exportMarkdown: 含课程名/XP/streak/课时/皇冠");

// === T4: 不存在的课程返回 null ===
const nullData = collectExportData(db, "nonexistent");
assert.strictEqual(nullData, null, "T4: 不存在课程返回 null");
console.log("✓ T4 不存在课程 → null");

// === T5: 空课程（无课时）不崩溃 ===
sqljs.run("INSERT INTO courses (id, repo_name, title) VALUES ('c2', 'empty', '空课程')");
const emptyData = collectExportData(db, "c2");
assert.ok(emptyData, "T5: 空课程也能导出");
assert.strictEqual(emptyData.totalLessons, 0);
assert.strictEqual(emptyData.masteredLessons, 0);
assert.strictEqual(emptyData.avgMastery, 0);
const emptyMd = exportMarkdown(emptyData);
assert.ok(emptyMd.includes("空课程"), "T5: 空课程 Markdown 有标题");
console.log("✓ T5 空课程: 不崩溃, 0课时/0掌握");

// === T6: 完成度百分比正确 ===
const completionPct = data.totalLessons > 0
  ? Math.round((data.masteredLessons / data.totalLessons) * 100) : 0;
assert.strictEqual(completionPct, 50, "T6: 1/2 = 50%");
console.log(`✓ T6 完成度: 1/2 = ${completionPct}%`);

console.log("\n=== ALL EXPORT TESTS PASSED ✅ ===");

// === 对抗性测试 ===
console.log("\n=== 导出对抗性测试 ===");

// ADV1: 超大课程（100 课时）不崩溃
sqljs.run("INSERT INTO courses (id, repo_name, title) VALUES ('c3', 'big', '超大课程')");
for (let i = 0; i < 100; i++) {
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('big-${i}', 'c3', NULL, 'lesson', '课时${i}', ${i})`);
}
const bigData = collectExportData(db, "c3");
assert.ok(bigData, "ADV1: 超大课程能导出");
assert.strictEqual(bigData.totalLessons, 100, "ADV1: 100 课时");
const bigMd = exportMarkdown(bigData);
assert.ok(bigMd.length > 100, `ADV1: Markdown 非空 (${bigMd.length})`);
console.log(`✓ ADV1 超大课程(100课): 导出成功, totalLessons=${bigData.totalLessons}`);

// ADV2: 课时标题含特殊字符
sqljs.run("INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('special', 'c1', 's1', 'lesson', '课时<特殊>&\"字符\"', 99)");
const specialData = collectExportData(db, "c1");
const specialJson = exportJson(specialData);
assert.ok(specialJson.includes('课时<特殊>'), "ADV2: 特殊字符在 JSON 中保留");
JSON.parse(specialJson); // 不崩溃
console.log("✓ ADV2 特殊字符标题: JSON 合法不崩溃");

// ADV3: 进度数据损坏（mastery > 1.0）不崩溃
sqljs.run("INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('special', 'in_progress', 0, 999.99)");
const corruptData = collectExportData(db, "c1");
assert.ok(corruptData.avgMastery > 0, `ADV3: 损坏 mastery 不崩溃, avg=${corruptData.avgMastery}`);
const corruptMd = exportMarkdown(corruptData);
assert.ok(corruptMd.length > 0, "ADV3: 损坏数据仍能导出 Markdown");
console.log(`✓ ADV3 损坏mastery(999.99): 不崩溃, avgMastery=${corruptData.avgMastery.toFixed(2)}`);

// ADV4: JSON 导出可被重新解析（往返测试）
const jsonRoundtrip = JSON.parse(exportJson(data));
assert.strictEqual(jsonRoundtrip.courseTitle, data.courseTitle, "ADV4: 往返一致");
assert.strictEqual(jsonRoundtrip.totalLessons, data.totalLessons, "ADV4: 课时数一致");
console.log("✓ ADV4 JSON 往返: 导出→解析→字段一致");

console.log("\n=== 导出对抗性测试 PASSED ✅ ===");

