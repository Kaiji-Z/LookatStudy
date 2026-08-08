/**
 * 章节考试(关底 boss)验证 —— 测真实 exam-service.ts。
 *
 * 不调 LLM(startExam 需要 API key);直接造 exercises 行测 submitExam 逻辑。
 *
 * 不变量:
 *   - accuracyToStars: ≥95%→3, ≥80%→2, ≥60%→1, <60%→0
 *   - submitExam: 判分正确 + 星数正确 + crownLevel 取最高(重考不降)
 *   - ensureExamNodesForExistingCourses: 给没 exam 的 section 补 exam 节点(幂等)
 *   - 考试节点不出现在 dashboard mastery(被 type==='lesson' guard 排除)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { submitExam, accuracyToStars, listExamExercises } from "../src/main/services/exam-service.ts";
import { ensureExamNodesForExistingCourses } from "../src/main/services/course-generator.ts";
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

// === T1: accuracyToStars 纯函数分档 ===
assert.strictEqual(accuracyToStars(0.95), 3, "95% → 3 星");
assert.strictEqual(accuracyToStars(1.0), 3, "100% → 3 星");
assert.strictEqual(accuracyToStars(0.80), 2, "80% → 2 星");
assert.strictEqual(accuracyToStars(0.94), 2, "94% → 2 星");
assert.strictEqual(accuracyToStars(0.60), 1, "60% → 1 星");
assert.strictEqual(accuracyToStars(0.79), 1, "79% → 1 星");
assert.strictEqual(accuracyToStars(0.59), 0, "59% → 0 星");
assert.strictEqual(accuracyToStars(0.0), 0, "0% → 0 星");
console.log("✓ T1 accuracyToStars 分档(95/80/60 阈值)正确");

// === T2: submitExam 判分 + 星数(全对 → 3 星)===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','S1 测验')`);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('e1','available',0)`);
  // 3 道 mcq,正确答案分别是 "0"/"1"/"2"
  for (let i = 0; i < 3; i++) {
    sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex${i}','e1','mcq','Q${i}','${i}','["A","B","C","D"]',1)`);
  }
  // 全对
  const result = submitExam(db, "e1", { ex0: "0", ex1: "1", ex2: "2" });
  assert.strictEqual(result.correctCount, 3, "T2: 全对应 3 对");
  assert.strictEqual(result.totalCount, 3, "T2: 总数 3");
  assert.strictEqual(result.stars, 3, "T2: 100% → 3 星");
  assert.strictEqual(result.bestStars, 3, "T2: 首考 bestStars = 3");
  console.log("✓ T2 submitExam 全对 → 3 星");
}

// === T3: submitExam 部分对(1/3 = 33% → 0 星)===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  for (let i = 0; i < 3; i++) {
    sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex${i}','e1','mcq','Q${i}','${i}','["A","B","C","D"]',1)`);
  }
  // 只对 1 题(33% < 60% → 0 星)
  const result = submitExam(db, "e1", { ex0: "0", ex1: "0", ex2: "0" });
  assert.strictEqual(result.correctCount, 1, "T3: 1 对");
  assert.strictEqual(result.stars, 0, "T3: 33% → 0 星");
  console.log("✓ T3 submitExam 33% → 0 星(未达 60%)");
}

// === T4: 重考不降星(bestStars 取最高)===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('e1','available',2)`); // 历史最高 2 星
  for (let i = 0; i < 5; i++) {
    sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex${i}','e1','mcq','Q${i}','0','["A","B","C","D"]',1)`);
  }
  // 这次全错(0% → 0 星),但 bestStars 应保持 2
  const result = submitExam(db, "e1", { ex0: "1", ex1: "1", ex2: "1", ex3: "1", ex4: "1" });
  assert.strictEqual(result.stars, 0, "T4: 本次 0 星");
  assert.strictEqual(result.bestStars, 2, "T4: bestStars 保持历史最高 2(不降)");
  console.log("✓ T4 重考不降星(bestStars 取最高)");
}

// === T5: ensureExamNodesForExistingCourses 补 exam 节点(幂等)===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
  // 第一次补丁:应加 1 个 exam
  const r1 = ensureExamNodesForExistingCourses(db);
  assert.strictEqual(r1.patched, 1, "T5: 第一次补 1 个 exam");
  // 第二次补丁:幂等,不应再加
  const r2 = ensureExamNodesForExistingCourses(db);
  assert.strictEqual(r2.patched, 0, "T5: 第二次幂等(0 个)");
  // 确认 exam 节点存在
  const examNodes = db.select().from(schema.contentNodes).all().filter((n) => n.type === "exam");
  assert.strictEqual(examNodes.length, 1, "T5: 恰好 1 个 exam 节点");
  console.log("✓ T5 ensureExamNodesForExistingCourses 补丁幂等");
}

// === T6: 空 section(无 lesson)不加 exam ===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  // 没有 lesson
  const r = ensureExamNodesForExistingCourses(db);
  assert.strictEqual(r.patched, 0, "T6: 无 lesson 的 section 不加 exam");
  console.log("✓ T6 空 section(无 lesson)不加 exam");
}

// === T7: 考试节点不污染 dashboard mastery ===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  // l1: mastered(0.9), e1: mastery=0.95(但不该算进 dashboard,因为 type=exam)
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l1','mastered',5,0.9)`);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('e1','available',3,0.95)`);
  const dash = getDashboard(db, "c1");
  // S1 只有 1 个 lesson(l1),exam 不算 → avgMastery = 0.9(不是 (0.9+0.95)/2)
  assert.strictEqual(dash.sections.length, 1, "T7: 1 section");
  assert.ok(Math.abs(dash.sections[0].avgMastery - 0.9) < 0.001, `T7: avgMastery 应 0.9(exam 不污染), 实际 ${dash.sections[0].avgMastery}`);
  assert.strictEqual(dash.sections[0].lessonCount, 1, "T7: lessonCount=1(exam 不算 lesson)");
  console.log("✓ T7 考试节点不污染 dashboard mastery(type guard 排除)");
}

// === T8: listExamExercises 按节点过滤 ===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e2','c1','s1','exam','测验2')`);
  sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex1','e1','mcq','Q1','0','["A","B"]',1)`);
  sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex2','e1','mcq','Q2','1','["A","B"]',1)`);
  sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex3','e2','mcq','Q3','0','["A","B"]',1)`);
  const e1Qs = listExamExercises(db, "e1");
  assert.strictEqual(e1Qs.length, 2, "T8: e1 有 2 题");
  const e2Qs = listExamExercises(db, "e2");
  assert.strictEqual(e2Qs.length, 1, "T8: e2 有 1 题");
  console.log("✓ T8 listExamExercises 按节点隔离");
}

console.log("\n=== ALL EXAM SERVICE TESTS PASSED ✅ ===");
