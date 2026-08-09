/**
 * QuizArtifact —— 练习题产物(M2)。
 *
 * tool generate_quiz 返回 { questions },这里渲染成可交互练习卡。
 * 提交后本地判分(不调 LLM),并触发 onResult 回调(父组件可借机触发 ExplainCard)。
 *
 * 这是 v0.2 把"📝练习 tab"并入对话流的核心:练习题作为 Generative UI 产物出现。
 */
import { useState } from "react";

interface QuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}
interface QuizData {
  artifactType: "quiz";
  questions: QuizQuestion[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

export function QuizArtifact({
  data,
  onAnswered,
}: {
  data: unknown;
  onAnswered?: (question: QuizQuestion, selectedIndex: number, correct: boolean) => void;
}) {
  const d = data as QuizData;
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  if (current >= d.questions.length) {
    // 全部做完
    return (
      <div className="surface-card p-4 text-center" data-testid="artifact-quiz-done">
        <div className="text-2xl mb-2">{score.correct === score.total ? "🎉" : "📚"}</div>
        <div className="text-body font-bold text-neutral-800 dark:text-neutral-200">
          {score.correct}/{score.total} 答对
        </div>
        <div className="text-label text-neutral-500 dark:text-neutral-400 mt-1">
          {score.correct === score.total ? "全部答对,掌握度已提议更新" : "再练一组巩固一下"}
        </div>
      </div>
    );
  }

  const q = d.questions[current];
  const isCorrect = submitted && selected === q.answer;

  const handleSubmit = () => {
    if (selected === null) return;
    setSubmitted(true);
    const correct = selected === q.answer;
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    onAnswered?.(q, selected, correct);
  };

  const handleNext = () => {
    setCurrent((c) => c + 1);
    setSelected(null);
    setSubmitted(false);
  };

  return (
    <div className="surface-card p-4" data-testid="artifact-quiz">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-body">📝</span>
          <span className="text-label font-bold text-brand">
            第 {current + 1}/{d.questions.length} 题
          </span>
        </div>
        <span className="text-label text-neutral-400">
          已答对 {score.correct}
        </span>
      </div>

      <div className="text-body text-neutral-800 dark:text-neutral-200 font-medium mb-3 leading-relaxed">
        {q.prompt}
      </div>

      <div className="space-y-2 mb-3">
        {q.options.map((opt, idx) => {
          const isSelected = selected === idx;
          const isAnswer = submitted && idx === q.answer;
          const isWrongSelected = submitted && isSelected && !isAnswer;
          return (
            <button
              key={idx}
              onClick={() => !submitted && setSelected(idx)}
              disabled={submitted}
              data-testid={`quiz-option-${idx}`}
              className={`w-full text-left text-body p-2.5 rounded-lg border-2 font-medium transition-colors ${
                isAnswer
                  ? "border-brand bg-brand/10 text-brand animate-answer-correct"
                  : isWrongSelected
                    ? "border-warning bg-warning/10 text-warning animate-answer-wrong"
                    : isSelected
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600"
              } ${submitted ? "cursor-default" : "cursor-pointer"}`}
            >
              <span className="font-bold mr-2">{String.fromCharCode(65 + idx)}</span>
              {opt}
              {isAnswer && <span className="float-right">✅</span>}
              {isWrongSelected && <span className="float-right">❌</span>}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div
            className={`rounded-lg p-3 mb-3 text-body leading-relaxed animate-artifact-render ${
              isCorrect
                ? "bg-brand/10 border border-brand/30 text-brand"
                : "bg-warning/10 border border-warning/30 text-warning"
            }`}
            data-testid="quiz-explanation"
        >
          <div className="font-bold mb-1">{isCorrect ? "✅ 答对了" : "❌ 答错了"}</div>
          <div className="text-neutral-700 dark:text-neutral-300">{q.explanation}</div>
        </div>
      )}

      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={selected === null}
          data-testid="quiz-submit"
          className="btn-3d-brand w-full py-2 text-body disabled:opacity-40"
        >
          提交答案
        </button>
      ) : (
        <button
          onClick={handleNext}
          data-testid="quiz-next"
          className="btn-3d-brand w-full py-2 text-body"
        >
          {current + 1 < d.questions.length ? "下一题 →" : "完成练习"}
        </button>
      )}

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-amber-600 dark:text-amber-400" data-testid="artifact-warnings">
          ⚠️ {d.warnings.join("; ")}
        </div>
      )}
    </div>
  );
}
