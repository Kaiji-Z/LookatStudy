/**
 * 章节考试 v2 验证 —— 真实 exam-service.ts + shared/exam-logic.ts。
 *
 * 不调 LLM(生成走 live-test);直接造 exercises 行测 attempt 全生命周期。
 *
 * 不变量:
 *   - accuracyToStars: ≥95%→3, ≥80%→2, ≥60%→1, <60%→0
 *   - planExamQuota: clamp(ceil(KC×1.5), 5, 15) round-robin
 *   - questionTimeLimitSec: 60 默认 / 90 长题干或含代码
 *   - buildAttemptShuffle: 种子确定 + 排列合法 + 显示位→原始下标映射判分正确(闭环目标)
 *   - attempt 流:判分 + 星数 + crownLevel 取最高 + 未答=错 + terminated + 防重复提交
 *   - 悬挂 attempt:getStatusView 自动按"未答=错"判死
 *   - ensureExamNodesForExistingCourses 幂等;考试节点不污染 dashboard
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  accuracyToStars,
  getExamStatusView,
  prepareExam,
  regenerateExam,
  startExamAttempt,
  recordExamAnswer,
  submitExamAttempt,
  listExamQuestions,
} from "../src/main/services/exam-service.ts";
import { resetStoreForTest, setGenerating, setPromise, getPromise } from "../src/main/services/exam-generation-store.ts";
import {
  planExamQuota,
  questionTimeLimitSec,
  buildAttemptShuffle,
  displayAnswerToOriginal,
  EXAM_MIN_QUESTIONS,
  EXAM_MAX_QUESTIONS,
} from "../shared/exam-logic.ts";
import { gradeAnswer } from "../src/main/services/exercise-service.ts";
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

/** 造一门课:1 section + 1 exam 节点 + N 道 mcq(答案 "0")。 */
function seedExam(sqljs, n = 3, withKc = false) {
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','S1 测验')`);
  for (let i = 0; i < n; i++) {
    const kc = withKc ? `KC${i % 2}` : null;
    sqljs.run(
      `INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated${kc ? ", kc_title" : ""}) VALUES ('ex${i}','e1','mcq','Q${i}','0','["正确","错1","错2","错3"]',1${kc ? `,'${kc}'` : ""})`,
    );
  }
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

// === T2: planExamQuota 题量规则 ===
{
  const q4 = planExamQuota(["a", "b", "c", "d"]);
  assert.strictEqual(q4.reduce((a, b) => a + b, 0), 6, "T2: 4 KC → 6 题");
  const q8 = planExamQuota(Array.from({ length: 8 }, (_, i) => `k${i}`));
  assert.strictEqual(q8.reduce((a, b) => a + b, 0), 12, "T2: 8 KC → 12 题");
  const q1 = planExamQuota(["only"]);
  assert.strictEqual(q1.reduce((a, b) => a + b, 0), EXAM_MIN_QUESTIONS, "T2: 1 KC → 下限 5 题");
  const q20 = planExamQuota(Array.from({ length: 20 }, (_, i) => `k${i}`));
  assert.strictEqual(q20.reduce((a, b) => a + b, 0), EXAM_MAX_QUESTIONS, "T2: 20 KC → 上限 15 题");
  assert.ok(q20.every((q) => q <= 2), "T2: round-robin 无 KC 超过 2 题(均匀)");
  assert.deepStrictEqual(planExamQuota([]), [], "T2: 0 KC → 空配额");
  console.log("✓ T2 planExamQuota clamp(ceil(KC×1.5),5,15) + round-robin");
}

// === T3: questionTimeLimitSec 动态限时(v0.19 宽松:45+cjk/5+words/3+opts×8+code25+math25,clamp(60,300)) ===
assert.strictEqual(questionTimeLimitSec("短题干"), 78, "T3: 短题 45+1+0+32=78s");
assert.strictEqual(questionTimeLimitSec("长".repeat(200)), 117, "T3: 200 汉字 45+40+32=117s");
assert.strictEqual(questionTimeLimitSec("看代码:\n```js\nlet a=1\n```\n输出?"), 104, "T3: 代码块 +25(45+1+1+32+25)");
assert.strictEqual(questionTimeLimitSec("$E=mc^2$ 是质能方程", 4), 104, "T3: 公式 +25(45+1+1+32+25)");
assert.strictEqual(questionTimeLimitSec("x".repeat(199)), 78, "T3: 长英文单词按词计 45+0+1+32");
assert.strictEqual(questionTimeLimitSec("短", 0), 60, "T3: 地板 60s");
assert.strictEqual(questionTimeLimitSec("长".repeat(9000)), 300, "T3: 天花板 300s");
assert.notStrictEqual(questionTimeLimitSec("长".repeat(200)), 90, "T3: 旧 60/90 二档已废");
console.log("✓ T3 questionTimeLimitSec 动态宽松限时");

// === T4: buildAttemptShuffle 种子确定 + 排列合法 + 映射判分正确(闭环核心) ===
{
  const items = [
    { id: "q1", optionCount: 4 },
    { id: "q2", optionCount: 4 },
    { id: "q3", optionCount: 2 },
  ];
  const s1 = buildAttemptShuffle(items, "attempt-A");
  const s1b = buildAttemptShuffle(items, "attempt-A");
  assert.deepStrictEqual(s1, s1b, "T4: 同种子结果确定(可复现)");
  const s2 = buildAttemptShuffle(items, "attempt-B");
  // 不同种子应产生不同的重排(多样本断言,防小排列空间偶发碰撞的 flake)
  const seedPool = ["attempt-B", "attempt-C", "attempt-D", "attempt-E", "attempt-F", "attempt-G", "attempt-H", "attempt-I"];
  const distinctOrders = new Set(
    seedPool.map((sd) => JSON.stringify(buildAttemptShuffle(items, sd).questionOrder)),
  );
  assert.ok(distinctOrders.size > 1, `T4: 多种子题序应有差异(实际 ${distinctOrders.size} 种)`);
  const distinctPerms = new Set(
    seedPool.map((sd) => JSON.stringify(buildAttemptShuffle(items, sd).optionPerms["q1"])),
  );
  assert.ok(distinctPerms.size > 1, `T4: 多种子选项排列应有差异(实际 ${distinctPerms.size} 种)`);

  // 排列合法性:每个下标恰好出现一次
  for (const order of [s1.questionOrder, s2.questionOrder]) {
    assert.deepStrictEqual([...order].sort((a, b) => a - b), [0, 1, 2], "T4: 题序是合法排列");
  }
  for (const id of ["q1", "q2"]) {
    const perm = s1.optionPerms[id];
    assert.deepStrictEqual([...perm].sort((a, b) => a - b), [0, 1, 2, 3], `T4: ${id} 选项排列合法`);
  }

  // 映射判分正确:选项重排后,用户在显示位 j 点中"正确选项" → 原始下标判对
  const options = ["正确", "错1", "错2", "错3"]; // 原始 answer = "0"
  const correctAnswer = "0";
  for (const [id, perm] of Object.entries(s1.optionPerms)) {
    if (options.length !== perm.length) continue; // q3 只有 2 选项,跳过
    // 显示位上"正确"选项出现的位置 = perm.indexOf(0)
    const displayPos = perm.indexOf(0);
    const original = displayAnswerToOriginal(perm, displayPos);
    assert.strictEqual(
      gradeAnswer("mcq", correctAnswer, original, JSON.stringify(options)),
      true,
      `T4: ${id} 显示位 ${displayPos} 映射回原始 ${original} 判对`,
    );
    // 点错显示位 → 判错
    const wrongPos = (displayPos + 1) % perm.length;
    const wrongOriginal = displayAnswerToOriginal(perm, wrongPos);
    if (wrongOriginal !== correctAnswer) {
      assert.strictEqual(
        gradeAnswer("mcq", correctAnswer, wrongOriginal, JSON.stringify(options)),
        false,
        `T4: ${id} 点错显示位判错`,
      );
    }
  }
  console.log("✓ T4 buildAttemptShuffle 确定性 + 合法排列 + 显示位映射判分正确");
}

// === T5: attempt 全流程:判分 + 星数 + crownLevel 取最高 ===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3); // ex0-ex2, 答案全 "0"
  const { attemptId, exercises } = startExamAttempt(db, "e1");
  assert.strictEqual(exercises.length, 3, "T5: 返回 3 题");
  // 全对 → 3 星
  const r = submitExamAttempt(db, "e1", attemptId, { ex0: "0", ex1: "0", ex2: "0" });
  assert.strictEqual(r.correctCount, 3, "T5: 全对 3 题");
  assert.strictEqual(r.stars, 3, "T5: 100% → 3 星");
  assert.strictEqual(r.bestStars, 3, "T5: 首考 bestStars=3");
  assert.strictEqual(r.terminated, false, "T5: 正常提交非 terminated");
  // 重复提交拒绝
  assert.throws(() => submitExamAttempt(db, "e1", attemptId, {}), /已提交/, "T5: 防重复提交");
  console.log("✓ T5 startAttempt→submitAttempt 全对 3 星 + 防重复提交");
}

// === T6: 未答 = 错(terminated:只答 1/3,其余按错计分)===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  const { attemptId } = startExamAttempt(db, "e1");
  const r = submitExamAttempt(db, "e1", attemptId, { ex0: "0" }, { terminated: true });
  assert.strictEqual(r.correctCount, 1, "T6: 只对 1 题");
  assert.strictEqual(r.totalCount, 3, "T6: 总数 3(未答计入)");
  assert.strictEqual(r.stars, 0, "T6: 33% → 0 星");
  assert.strictEqual(r.terminated, true, "T6: terminated 标记");
  // perQuestion:未答题 answered=false
  const un = r.perQuestion.find((p) => p.exerciseId === "ex1");
  assert.ok(un, "T6: ex1 在结算里");
  assert.strictEqual(un.answered, false, "T6: 未答标记 answered=false");
  assert.strictEqual(un.correct, false, "T6: 未答 = 错");
  console.log("✓ T6 terminated 未答=错计分");
}

// === T7: 重考不降星(bestStars 取最高)===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 5);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('e1','available',2)`); // 历史最高 2 星
  const { attemptId } = startExamAttempt(db, "e1");
  const r = submitExamAttempt(db, "e1", attemptId, { ex0: "1", ex1: "1", ex2: "1", ex3: "1", ex4: "1" }); // 全错
  assert.strictEqual(r.stars, 0, "T7: 本次 0 星");
  assert.strictEqual(r.bestStars, 2, "T7: bestStars 保持 2(不降)");
  console.log("✓ T7 重考不降星");
}

// === T8: 悬挂 attempt 自动判死(模拟崩溃:有 attempt 无提交)===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  const { attemptId } = startExamAttempt(db, "e1");
  recordExamAnswer(db, "e1", attemptId, "ex0", "0"); // 崩溃前答了 1 题(对)
  recordExamAnswer(db, "e1", attemptId, "ex1", "1"); // 答错 1 题
  // 不提交 → getExamStatusView 应自动判死
  const sv = getExamStatusView(db, "e1");
  assert.strictEqual(sv.status, "ready", "T8: 题库在 → ready");
  const la = sv.latestAttempt;
  assert.ok(la && la.finishedAt, "T8: 悬挂 attempt 已被判定(finished)");
  assert.strictEqual(la.terminated, true, "T8: 判定为 terminated");
  assert.strictEqual(la.correctCount, 1, "T8: 只算对 1 题(ex2 未答=错)");
  assert.strictEqual(la.totalCount, 3, "T8: 总数 3");
  assert.strictEqual(sv.attemptCount, 1, "T8: 1 次 attempt");
  console.log("✓ T8 悬挂 attempt 在 getStatus 自动按未答=错判死");
}

// === T9: 逐题增量持久化 + 已结束 attempt 忽略后续记录 ===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 2);
  const { attemptId } = startExamAttempt(db, "e1");
  recordExamAnswer(db, "e1", attemptId, "ex0", "0");
  // 直接提交空 answers:应合并存量(ex0 已持久化的 "0" 保留)
  const r = submitExamAttempt(db, "e1", attemptId, {});
  assert.strictEqual(r.correctCount, 1, "T9: 提交空 answers 合并增量存量(ex0=对)");
  // 已结束 → 再记录被忽略
  recordExamAnswer(db, "e1", attemptId, "ex1", "0"); // no-op
  const sv = getExamStatusView(db, "e1");
  assert.strictEqual(sv.latestAttempt.correctCount, 1, "T9: 结束后 recordAnswer 不复活不改分");
  console.log("✓ T9 增量持久化合并 + 结束后忽略");
}

// === T10: getExamStatusView 元信息(kcCount / bestStars / 老题库兼容)===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 4, true); // 4 题,kc_title 交替 KC0/KC1 → 2 个 KC
  const sv = getExamStatusView(db, "e1");
  assert.strictEqual(sv.status, "ready", "T10: 有题 → ready");
  assert.strictEqual(sv.questionCount, 4, "T10: 4 题");
  assert.strictEqual(sv.kcCount, 2, "T10: 覆盖 2 个 KC");
  assert.strictEqual(sv.exercises.length, 4, "T10: exercises 带回");
  assert.ok(sv.exercises.every((q) => typeof q.kcTitle === "string"), "T10: 题目带 kcTitle");
  assert.strictEqual(sv.bestStars, 0, "T10: 无考试记录 bestStars=0");
  assert.strictEqual(sv.latestAttempt, null, "T10: 无 attempt");
  // 老题库(无 kc_title)→ kcCount=0(UI 隐藏 KC 分解)
  const { sqljs: s2, db: db2 } = await makeDb();
  seedExam(s2, 3, false);
  const sv2 = getExamStatusView(db2, "e1");
  assert.strictEqual(sv2.kcCount, 0, "T10: 老题库 kcCount=0");
  console.log("✓ T10 getStatusView 元信息 + 老题库兼容");
}

// === T11: prepareExam 幂等(DB 有题 → ready,不触 LLM)===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  const st = prepareExam(db, "e1");
  assert.strictEqual(st.status, "ready", "T11: 已有题 → ready(不生成)");
  // 节点不存在 → 抛
  assert.throws(() => prepareExam(db, "nope"), /不存在/, "T11: 不存在的节点抛错");
  console.log("✓ T11 prepareExam 幂等");
}

// === T12: ensureExamNodesForExistingCourses 补 exam 节点(幂等)===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
  const r1 = ensureExamNodesForExistingCourses(db);
  assert.strictEqual(r1.patched, 1, "T12: 第一次补 1 个 exam");
  const r2 = ensureExamNodesForExistingCourses(db);
  assert.strictEqual(r2.patched, 0, "T12: 第二次幂等(0 个)");
  console.log("✓ T12 ensureExamNodesForExistingCourses 幂等");
}

// === T13: 考试节点不污染 dashboard mastery ===
{
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('l1','c1','s1','lesson','L1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('l1','mastered',5,0.9)`);
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level, mastery) VALUES ('e1','available',3,0.95)`);
  const dash = getDashboard(db, "c1");
  assert.ok(Math.abs(dash.sections[0].avgMastery - 0.9) < 0.001, "T13: exam 不污染 dashboard(exam mastery 0.95 被排除)");
  assert.strictEqual(dash.sections[0].lessonCount, 1, "T13: exam 不算 lesson");
  console.log("✓ T13 考试节点不污染 dashboard");
}

// === T14: listExamQuestions 按节点隔离 + kcTitle 透传 ===
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('s1','c1','section','S1')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e1','c1','s1','exam','测验')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title) VALUES ('e2','c1','s1','exam','测验2')`);
  sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated, kc_title) VALUES ('ex1','e1','mcq','Q1','0','["A","B"]',1,'梯度下降')`);
  sqljs.run(`INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('ex2','e2','mcq','Q2','0','["A","B"]',1)`);
  const e1Qs = listExamQuestions(db, "e1");
  assert.strictEqual(e1Qs.length, 1, "T14: e1 有 1 题");
  assert.strictEqual(e1Qs[0].kcTitle, "梯度下降", "T14: kcTitle 透传");
  assert.strictEqual(listExamQuestions(db, "e2")[0].kcTitle, null, "T14: 无标注 → null");
  console.log("✓ T14 listExamQuestions 按节点隔离 + kcTitle");
}

// === T15: regenerateExam 删旧题 + 悬挂 attempt 判死 + 星数保留(无 LLM → 同步 failed)==
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, content) VALUES ('l1','c1','s1','lesson','L1','课时内容')`);
  // 历史 2 星(重新出题不得清成绩)
  sqljs.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('e1','available',2)`);
  // 悬挂 attempt:答 1 题不提交(崩溃模拟)
  const { attemptId } = startExamAttempt(db, "e1");
  recordExamAnswer(db, "e1", attemptId, "ex0", "0");
  const st = regenerateExam(db, "e1");
  // 测试库无 LLM 配置:resolveLlm 同步抛错 → 整个后台生成同步收敛为 failed
  assert.strictEqual(st.status, "failed", "T15: 无 LLM → 同步 failed(而非假 generating)");
  assert.strictEqual(listExamQuestions(db, "e1").length, 0, "T15: 旧题库已删");
  const sv = getExamStatusView(db, "e1");
  const la = sv.latestAttempt;
  assert.ok(la && la.finishedAt, "T15: 悬挂 attempt 在重新出题时判死");
  assert.strictEqual(la.terminated, true, "T15: 判死为 terminated");
  assert.strictEqual(la.correctCount, 1, "T15: 判死成绩 1/3(ex0 对,ex1/ex2 未答=错)");
  assert.strictEqual(sv.bestStars, 2, "T15: 历史星数保留(重新出题不清成绩)");
  assert.strictEqual(sv.attemptCount, 1, "T15: attempt 档案保留");
  await getPromise("e1"); // 已同步失败,await 恒安全
  assert.strictEqual(getExamStatusView(db, "e1").status, "failed", "T15: 失败后状态保持(旧题不复活)");
  assert.throws(() => regenerateExam(db, "nope"), /不存在/, "T15: 不存在的节点抛错");
  console.log("✓ T15 regenerateExam 删旧题 + 悬挂判死 + 星数保留");
}

// === T16: 在飞生成中 regenerate = no-op(共享同一次生成,不删题)==
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  // store 是公开接缝:直接注入一个在飞(永不 settle)的生成
  setGenerating("e1", 5);
  const never = new Promise(() => {});
  setPromise("e1", never);
  const st = regenerateExam(db, "e1");
  assert.strictEqual(st.status, "generating", "T16: 在飞 → 原样返回 generating");
  assert.strictEqual(listExamQuestions(db, "e1").length, 3, "T16: 旧题未删(no-op)");
  assert.strictEqual(getPromise("e1"), never, "T16: promise 未被替换(共享同一次生成)");
  console.log("✓ T16 在飞生成中 regenerate no-op");
}

// === T17: 判分快照自包含(重新生成删题后历史回顾仍有题干/选项)==
{
  resetStoreForTest();
  const { sqljs, db } = await makeDb();
  seedExam(sqljs, 3);
  const { attemptId } = startExamAttempt(db, "e1");
  const r = submitExamAttempt(db, "e1", attemptId, { ex0: "0", ex1: "1" });
  assert.ok(
    r.perQuestion.every((pq) => typeof pq.prompt === "string" && pq.prompt.startsWith("Q")),
    "T17: 判分快照带题干",
  );
  assert.ok(
    r.perQuestion.every((pq) => Array.isArray(pq.options) && pq.options.length === 4),
    "T17: 判分快照带选项数组",
  );
  // 模拟重新生成后的删题:历史 attempt 回顾仍自包含
  sqljs.run(`DELETE FROM exercises WHERE node_id='e1'`);
  const la = getExamStatusView(db, "e1").latestAttempt;
  assert.ok(la && la.perQuestion, "T17: 历史 attempt 在");
  assert.strictEqual(la.perQuestion[0].prompt, "Q0", "T17: 删题后回顾仍有题干(不退化为 #1)");
  assert.deepStrictEqual(la.perQuestion[0].options, ["正确", "错1", "错2", "错3"], "T17: 删题后回顾仍有选项(答案文本可显示)");
  console.log("✓ T17 判分快照自包含");
}

console.log("\n=== ALL EXAM SERVICE TESTS PASSED ✅ ===");
