/**
 * ExplainCard —— v0.2 答题后 AI 解释引导卡(M2)。
 *
 * 调研结论(Duolingo "Explain My Answer"):答题后自动触发 AI 解释。
 * 但 BYOK 省 token 原则下,我们不自动发 AI 请求,而是:
 *   - 错题:展示 explanation(tool 返回的)+ "问 AI 深入讲"按钮
 *   - 对题:展示一句鼓励 + 可选的"再来一题"
 *
 * 实际的 explanation 由 QuizArtifact 的 tool 返回数据驱动(零额外 token)。
 * 本组件是"想深入"的引导入口,点击后发一条预设消息给 AI。
 */
export function ExplainCard({
  correct,
  explanation,
  onAskMore,
}: {
  correct: boolean;
  explanation?: string;
  onAskMore?: () => void;
}) {
  return (
    <div
      className={`rounded-xl p-3 mt-2 border ${
        correct
          ? "bg-brand/5 border-brand/30"
          : "bg-red-500/5 border-red-500/30"
      }`}
      data-testid="explain-card"
    >
      <div className={`text-xs font-bold mb-1 ${correct ? "text-brand" : "text-red-500 dark:text-red-400"}`}>
        {correct ? "✅ 答对了" : "❌ 答错了"}
      </div>
      {explanation && (
        <div className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed mb-2">
          {explanation}
        </div>
      )}
      {!correct && onAskMore && (
        <button
          onClick={onAskMore}
          data-testid="explain-ask-more"
          className="text-[11px] text-accent hover:underline font-bold"
        >
          问 AI 详细讲讲 →
        </button>
      )}
    </div>
  );
}
