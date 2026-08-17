/**
 * verify-quiz-progress —— 答题卡进度持久化(#2)纯函数测试。
 *
 * 背景:T3 切栏卸载聊天面板,QuizArtifact 本地 state 蒸发 → 判分结果"不同步"。
 * quiz-progress.ts 以题目内容哈希为键存/取 {current, score}。本套件守:
 *   T1 键稳定(同题同键/不同题不同键/选项变化键变化)
 *   T2 存取 round-trip + 损坏 JSON/越界值容错
 *   T3 localStorage 不可写时静默(save 不炸)
 */
import { strict as assert } from "node:assert";
import { quizProgressKey, loadQuizProgress, saveQuizProgress } from "../src/renderer/lib/quiz-progress.ts";

let passed = 0;
const ok = (n) => { console.log(`✓ ${n}`); passed++; };

// localStorage stub(两态:可写 / 抛错)
function makeStorage(throws = false) {
  if (throws) {
    return {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
  }
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
  };
}

// T1 键
{
  const quizA = { questions: [{ prompt: "p1", options: ["a", "b"], answer: 1 }, { prompt: "p2", options: ["c", "d"], answer: 0 }] };
  const quizA2 = JSON.parse(JSON.stringify(quizA));
  const quizB = { questions: [{ prompt: "p1", options: ["a", "b"], answer: 0 }] };
  const k1 = quizProgressKey(quizA);
  ok("T1 同题同键", k1 === quizProgressKey(quizA2));
  ok("T1 不同答案不同键", k1 !== quizProgressKey(quizB));
  const quizOpt = { questions: [{ prompt: "p1", options: ["a", "b", "z"], answer: 1 }] };
  ok("T1 选项变化键变化", k1 !== quizProgressKey(quizOpt));
  ok("T1 键带前缀", k1.startsWith("ls-quiz-progress:"));
}

// T2 round-trip + 容错
{
  globalThis.localStorage = makeStorage();
  const key = "ls-quiz-progress:test";
  saveQuizProgress(key, { current: 3, score: { correct: 2, total: 3 } });
  const p = loadQuizProgress(key);
  assert.deepEqual(p, { current: 3, score: { correct: 2, total: 3 } });
  ok("T2 round-trip 保真");

  assert.equal(loadQuizProgress("ls-quiz-progress:missing"), null);
  ok("T2 未存键返回 null");

  globalThis.localStorage.setItem(key, "{corrupted json");
  assert.equal(loadQuizProgress(key), null);
  ok("T2 损坏 JSON 返回 null");

  globalThis.localStorage.setItem(key, JSON.stringify({ current: -1, score: { correct: 0 } }));
  assert.equal(loadQuizProgress(key), null);
  ok("T2 越界/缺字段值返回 null");
}

// T3 localStorage 抛错不炸(隐私模式)
{
  globalThis.localStorage = makeStorage(true);
  let threw = false;
  try {
    saveQuizProgress("k", { current: 0, score: { correct: 0, total: 0 } });
    assert.equal(loadQuizProgress("k"), null);
  } catch {
    threw = true;
  }
  ok("T3 不可写静默降级", !threw);
}

console.log(`\n${passed} passed`);
