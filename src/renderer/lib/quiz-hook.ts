/**
 * quiz-hook —— 答题完成自动 hook AI 的消息组装(纯函数,t 注入可测)。
 *
 * 设计:答完最后一题提交时,把成绩单自动发给 AI(用户不再手动点"下一步")——
 * AI 根据表现决定讲错题/放行/换角度。气泡只显示短标签(displayText),
 * 完整成绩单(content)只给 LLM——与按钮触发消息同一模式。
 */
import type { QuizCompletedResult } from "../components/artifacts/QuizArtifact.js";

type TFn = (key: string, params?: Record<string, string | number>) => string;

const truncate = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 气泡短标签(用户可见的动作标签) */
export function buildQuizHookLabel(r: QuizCompletedResult, t: TFn): string {
  return t("quiz.hook.label", { correct: r.correct, total: r.total });
}

/** 发给 LLM 的完整成绩单 */
export function buildQuizHookMessage(r: QuizCompletedResult, t: TFn): string {
  const lines = r.detail.map((d, i) =>
    d.correct
      ? t("quiz.hook.lineOk", { n: i + 1, prompt: truncate(d.prompt) })
      : t("quiz.hook.lineWrong", { n: i + 1, prompt: truncate(d.prompt), chosen: truncate(d.chosen, 30), answer: truncate(d.answerText, 30) }),
  );
  const titlePart = r.title ? `《${r.title}》` : "";
  return (
    t("quiz.hook.message", { title: titlePart, correct: r.correct, total: r.total }) +
    (lines.length ? "\n" + lines.join("\n") : "")
  );
}
