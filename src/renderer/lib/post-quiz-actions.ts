/**
 * 答题后的"下一步"动作集合 —— 消灭"答完题不知道干嘛"的死胡同。
 *
 * 这是 feat/adaptive-tutor 的确定性半边:无论 AI 怎么发挥,UI 层先保证学习者
 * 答完一组题后永远能看到 >= 2 个明确去向(讲错题 / 再来一组 / 深入 / 标记掌握 / 下一课)。
 * 这正是"我们能提供的学习路径"——和用户的"学习习惯"两轴交集中的可操作部分。
 *
 * 纯函数(只返 id + advancesMastery 标志),零 React/CSS 依赖,verify 脚本可直接 import。
 * UI 层(QuizArtifact)把 id 映射成图标(lucide)+ i18n 文案 + 要发送的消息。
 */
export type PostQuizActionId =
  | "explain-wrong" // 讲讲我答错的
  | "retry" // 再来一组
  | "go-deeper" // 深入原理
  | "mark-mastered" // 标记我掌握了(会触发掌握度提议)
  | "next-topic"; // 下一个知识点

export interface PostQuizAction {
  id: PostQuizActionId;
  /** true = 点这个会触发 AI 出题/判定 → 提议更新掌握度(mark_mastered 专用)。 */
  advancesMastery?: boolean;
}

/**
 * 按答对率 + 当前掌握度给出下一步动作。
 *
 * 设计原则:
 *   - 永远 >= 2 个动作(消灭死胡同,这是核心承诺)。
 *   - 有错题 → 首选"讲讲错题"(最该立刻补的漏洞),次选"再来一组"。
 *   - 全对 + 高掌握 → 可以"标记掌握"(advancesMastery)+ "下一课",鼓励前进。
 *   - 全对 + 低/未评估掌握 → "深入原理" + "再来一组",不冒险标记掌握(避免假阳性)。
 *   - 边界(total=0,极端空题集)→ 仍给 2 个安全动作,绝不空白。
 */
export function getPostQuizActions(
  score: { correct: number; total: number },
  mastery: number | null,
): PostQuizAction[] {
  const { correct, total } = score;
  const allCorrect = total > 0 && correct === total;
  const hasWrong = total > 0 && correct < total;
  const highMastery = mastery != null && mastery >= 0.7;

  // 有错题:先补漏洞,再巩固
  if (hasWrong) {
    return [{ id: "explain-wrong" }, { id: "retry" }];
  }

  // 全对 + 高掌握:可以毕业前进
  if (allCorrect && highMastery) {
    return [
      { id: "mark-mastered", advancesMastery: true },
      { id: "next-topic" },
      { id: "go-deeper" },
    ];
  }

  // 全对但掌握度还不够 / 未评估:深入 + 再练,不冒险标记掌握
  // (也兜底 total===0 的边界:落到这里,给 2 个安全动作)
  return [{ id: "go-deeper" }, { id: "retry" }];
}
