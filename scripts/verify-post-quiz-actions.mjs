/**
 * Post-Quiz Actions 验证 —— 答完题后的"下一步"动作集合。
 *
 * 解决"答完题不知道干嘛"的死胡同:无论 AI 怎么发挥,UI 层先保证学习者答完一组题后
 * 永远能看到 >= 2 个明确去向(讲错题 / 再来一组 / 深入 / 标记掌握 / 下一课)。
 * 这正是"我们能提供的学习路径"——和用户的"学习习惯"两轴交集中的可操作部分。
 *
 * 纯函数(只返 id + advancesMastery 标志),零 React/CSS 依赖,verify 脚本可直接 import。
 * UI 层(QuizArtifact)把 id 映射成图标(lucide)+ i18n 文案 + 要发送的消息。
 *
 * 不变量:
 *   - 永远 >= 2 个动作(消灭死胡同,这是核心承诺)。
 *   - mark_mastered 只在"全对 + 高掌握度"时出现(避免误判掌握)。
 */
import assert from "node:assert";
import { getPostQuizActions } from "../src/renderer/lib/post-quiz-actions.ts";

const VALID_IDS = new Set(["explain-wrong", "retry", "go-deeper", "mark-mastered", "next-topic"]);
function idsOf(actions) {
  return actions.map((a) => a.id);
}

// === B1: 有错题 → 第一动作 "explain-wrong" + 含 "retry",不含 mark-mastered ===
const b1 = getPostQuizActions({ correct: 1, total: 3 }, 0.5);
assert.ok(b1.length >= 2, `B1: 有错题至少 2 个动作, 实际 ${b1.length}`);
assert.strictEqual(b1[0].id, "explain-wrong", `B1: 第一动作应为 explain-wrong, 实际 ${b1[0].id}`);
assert.ok(idsOf(b1).includes("retry"), `B1: 应含 retry, 实际 ${idsOf(b1)}`);
assert.ok(!idsOf(b1).includes("mark-mastered"), `B1: 有错题不应 mark-mastered, 实际 ${idsOf(b1)}`);
console.log(`✓ B1 有错题 → [explain-wrong, retry, …](无 mark-mastered)`);

// === B2: 全对 + 接近毕业(0.87)→ 含 mark-mastered(advancesMastery:true) + next-topic ===
const b2 = getPostQuizActions({ correct: 3, total: 3 }, 0.87);
assert.ok(idsOf(b2).includes("mark-mastered"), `B2: 全对+接近毕业应含 mark-mastered, 实际 ${idsOf(b2)}`);
const masteredAct = b2.find((a) => a.id === "mark-mastered");
assert.ok(masteredAct?.advancesMastery === true, "B2: mark-mastered 必须 advancesMastery:true");
assert.ok(idsOf(b2).includes("next-topic"), `B2: 应含 next-topic, 实际 ${idsOf(b2)}`);
console.log(`✓ B2 全对 + mastery 0.87 → [mark-mastered✓, next-topic, …]`);

// === B2b: 全对 + 已毕业(≥0.9,BKT 自动戴皇冠)→ 不含 mark-mastered(多余),含 next-topic ===
const b2b = getPostQuizActions({ correct: 3, total: 3 }, 0.92);
assert.ok(!idsOf(b2b).includes("mark-mastered"), `B2b: 已毕业不应 mark-mastered, 实际 ${idsOf(b2b)}`);
assert.ok(idsOf(b2b).includes("next-topic"), `B2b: 应含 next-topic, 实际 ${idsOf(b2b)}`);
console.log(`✓ B2b 全对 + mastery 0.92(已毕业) → [next-topic, go-deeper](无 mark-mastered)`);

// === B3: 全对 + 低掌握度(0.3)→ go-deeper + retry,不含 mark-mastered ===
const b3 = getPostQuizActions({ correct: 3, total: 3 }, 0.3);
assert.ok(idsOf(b3).includes("go-deeper"), `B3: 全对+低掌握应 go-deeper, 实际 ${idsOf(b3)}`);
assert.ok(idsOf(b3).includes("retry"), `B3: 应含 retry, 实际 ${idsOf(b3)}`);
assert.ok(!idsOf(b3).includes("mark-mastered"), `B3: 低掌握不应 mark-mastered, 实际 ${idsOf(b3)}`);
console.log(`✓ B3 全对 + mastery 0.3 → [go-deeper, retry](无 mark-mastered)`);

// === B4: 全对 + mastery null(未评估)→ 当作低掌握(go-deeper),不 mark-mastered ===
const b4 = getPostQuizActions({ correct: 2, total: 2 }, null);
assert.ok(idsOf(b4).includes("go-deeper"), `B4: mastery null 应 go-deeper, 实际 ${idsOf(b4)}`);
assert.ok(!idsOf(b4).includes("mark-mastered"), `B4: mastery null 不应 mark-mastered, 实际 ${idsOf(b4)}`);
console.log(`✓ B4 全对 + mastery null → go-deeper(未评估不冒险标记掌握)`);

// === B5: 永远 >= 2 个动作(消灭死胡同)——含边界 {0,0} ===
for (const [score, mastery, label] of [
  [{ correct: 0, total: 0 }, null, "{0,0}+null"],
  [{ correct: 0, total: 3 }, 0.1, "{0,3}+0.1"],
  [{ correct: 5, total: 5 }, 0.95, "{5,5}+0.95"],
  [{ correct: 2, total: 2 }, 0.5, "{2,2}+0.5"],
]) {
  const acts = getPostQuizActions(score, mastery);
  assert.ok(acts.length >= 2, `B5(${label}): 至少 2 个动作, 实际 ${acts.length}`);
  for (const a of acts) {
    assert.ok(VALID_IDS.has(a.id), `B5(${label}): 非法 id "${a.id}"`);
  }
}
console.log(`✓ B5 所有场景 >= 2 动作 + id 全合法(消灭死胡同)`);

console.log("\n=== ALL POST-QUIZ ACTIONS TESTS PASSED ✅ ===");
