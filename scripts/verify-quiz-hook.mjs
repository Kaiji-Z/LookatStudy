/**
 * verify-quiz-hook.mjs —— 答题完成自动 hook 的消息组装纯函数验证(quiz-hook.ts)。
 *
 * 设计:最后一题提交时把成绩单自动发给 AI(用户不再手动点"下一步")。
 * 气泡只显示短标签(label),完整逐题判定(message)只给 LLM。
 *
 * 跑法: npx tsx scripts/verify-quiz-hook.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { buildQuizHookLabel, buildQuizHookMessage } from "../src/renderer/lib/quiz-hook.ts";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

/** 假 t:直接返回 key+params 的可断言拼接 */
const fakeT = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;
const r = {
  title: "递归检验",
  correct: 1,
  total: 2,
  detail: [
    { prompt: "什么是递归基例?", chosen: "终止条件", answerText: "终止条件", correct: true },
    { prompt: "斐波那契递归复杂度?", chosen: "O(n)", answerText: "O(2^n)", correct: false },
  ],
};

test("label:短标签含分数", () => {
  const s = buildQuizHookLabel(r, fakeT);
  assert.ok(s.includes("quiz.hook.label"));
  assert.ok(s.includes('"correct":1'));
  assert.ok(s.includes('"total":2'));
});

test("message:含成绩 + 逐题两行判定", () => {
  const s = buildQuizHookMessage(r, fakeT);
  assert.ok(s.includes("quiz.hook.message"));
  const lines = s.split("\n");
  assert.equal(lines.length, 3, "消息头 + 2 行判定");
  assert.ok(lines[1].includes("quiz.hook.lineOk"));
  assert.ok(lines[2].includes("quiz.hook.lineWrong"));
  assert.ok(lines[2].includes("O(n)"), "错题含所选");
  assert.ok(lines[2].includes("O(2^n)"), "错题含正确答案");
});

test("message:题目超长截断(60 字)", () => {
  const long = { ...r, detail: [{ prompt: "长".repeat(100), chosen: "a", answerText: "b", correct: true }] };
  const s = buildQuizHookMessage(long, fakeT);
  assert.ok(s.includes("…"));
  assert.ok(!s.includes("长".repeat(61)));
});

test("message:空判定(不该发生但防崩)→ 只有消息头", () => {
  const s = buildQuizHookMessage({ title: "", correct: 0, total: 0, detail: [] }, fakeT);
  assert.ok(s.startsWith("quiz.hook.message"));
  assert.ok(!s.includes("\n"));
});

test("message:无标题时 title 参数为空串(模板自行处理书名号)", () => {
  const s = buildQuizHookMessage({ ...r, title: "" }, fakeT);
  assert.ok(s.includes('"title":""'));
});

console.log(`\n${passed} passed`);
