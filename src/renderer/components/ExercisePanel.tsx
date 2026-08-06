/**
 * 练习题面板 —— AI 出题 + 作答 + 判分。
 *
 * 设计: Duolingo-style 练习卡片，3D 按钮反馈，颜色编码的判分结果。
 */
import { useState, useCallback } from "react";
import { api } from "../lib/api.js";
import type { Exercise, ExerciseType, ContentNode } from "@shared/types";

export function ExercisePanel({ node }: { node: ContentNode | null }) {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; explanation: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ExerciseType>("mcq");

  const handleGenerate = useCallback(async () => {
    if (!node || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setUserAnswer("");
    setSelectedOption(null);
    try {
      const ex = await api.generateExercise(node.id, type);
      setExercise(ex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [node, busy, type]);

  const handleSubmit = async () => {
    if (!exercise || busy) return;
    let answer: string;
    if (exercise.type === "mcq") {
      if (selectedOption === null) return;
      answer = String(selectedOption);
    } else {
      if (!userAnswer.trim()) return;
      answer = userAnswer.trim();
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitExerciseAnswer(exercise.id, answer);
      setResult({ correct: r.correct, explanation: r.explanation });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleNext = () => {
    setExercise(null);
    setResult(null);
    setUserAnswer("");
    setSelectedOption(null);
    handleGenerate();
  };

  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12">
        <div className="text-4xl mb-3 opacity-40">🎯</div>
        <div className="text-sm text-neutral-500">先在右侧选一个课程节点，再开始练习</div>
      </div>
    );
  }

  const typeLabels: Record<ExerciseType, string> = {
    mcq: "选择题",
    fill_blank: "填空题",
    true_false: "判断题",
  };

  return (
    <div className="space-y-4" data-testid="exercise-panel">
      {/* 顶部：标题 + 题型切换 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-neutral-200">📝 练习</h3>
        {!exercise && !busy && (
          <div className="flex gap-1 bg-neutral-800/50 rounded-xl p-0.5">
            {(["mcq", "fill_blank", "true_false"] as ExerciseType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  type === t ? "bg-brand text-white" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {typeLabels[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 出题按钮（无题目时） */}
      {!exercise && !busy && (
        <button
          onClick={handleGenerate}
          disabled={!node}
          data-testid="exercise-generate"
          className="btn-3d-brand w-full py-3 text-sm"
        >
          出一道{typeLabels[type]}练习
        </button>
      )}

      {/* 加载状态 */}
      {busy && !exercise && (
        <div className="flex flex-col items-center py-8">
          <div className="flex gap-1.5 mb-3">
            <span className="typing-dot w-2 h-2 bg-brand rounded-full inline-block"></span>
            <span className="typing-dot w-2 h-2 bg-brand rounded-full inline-block"></span>
            <span className="typing-dot w-2 h-2 bg-brand rounded-full inline-block"></span>
          </div>
          <div className="text-sm text-neutral-500">AI 正在出题…</div>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="surface-card p-3 border-red-800/50 text-sm text-red-300">
          ❌ {error}
          <div className="text-[11px] text-red-400/60 mt-1">请到 ⚙️设置 检查 API key 和网络</div>
        </div>
      )}

      {/* 题目卡片 */}
      {exercise && (
        <div className="surface-card p-4 space-y-4 msg-enter" data-testid="exercise-card">
          {/* 题型标签 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/15 text-brand">
              {typeLabels[exercise.type]}
            </span>
            {exercise.aiGenerated && (
              <span className="text-[10px] text-neutral-600">AI 生成</span>
            )}
          </div>

          {/* 题干 */}
          <div className="text-sm text-neutral-100 leading-relaxed font-medium">{exercise.prompt}</div>

          {/* MCQ 选项 */}
          {exercise.type === "mcq" && exercise.options && (
            <div className="space-y-2" data-testid="mcq-options">
              {exercise.options.map((opt, idx) => {
                const isSelected = selectedOption === idx;
                const isCorrect = result && idx === parseInt(exercise.answer);
                const isWrongSelected = result && isSelected && !isCorrect;
                return (
                  <button
                    key={idx}
                    onClick={() => !result && setSelectedOption(idx)}
                    disabled={!!result}
                    data-testid={`mcq-option-${idx}`}
                    className={`w-full text-left text-sm p-3 rounded-xl border-2 font-medium transition-all ${
                      isCorrect
                        ? "border-brand bg-brand/10 text-brand"
                        : isWrongSelected
                          ? "border-red-500 bg-red-500/10 text-red-400"
                          : isSelected
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-neutral-700 text-neutral-300 hover:border-neutral-600"
                    } ${result ? "cursor-default" : "cursor-pointer hover:scale-[1.01]"}`}
                  >
                    <span className="font-extrabold mr-2">{String.fromCharCode(65 + idx)}</span>
                    {opt}
                    {isCorrect && <span className="float-right">✅</span>}
                    {isWrongSelected && <span className="float-right">❌</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* 填空输入 */}
          {exercise.type === "fill_blank" && (
            <input
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder="输入你的答案…"
              disabled={!!result}
              data-testid="fill-input"
              className="w-full bg-neutral-950 text-neutral-100 text-sm rounded-xl px-4 py-3 border-2 border-neutral-700 focus:border-brand focus:outline-none disabled:opacity-50"
            />
          )}

          {/* 判断题 */}
          {exercise.type === "true_false" && (
            <div className="grid grid-cols-2 gap-3" data-testid="tf-options">
              {[
                { val: "true", label: "✓ 正确", color: "brand" },
                { val: "false", label: "✗ 错误", color: "red" },
              ].map((opt) => {
                const isSelected = userAnswer === opt.val;
                const isCorrect = result && exercise.answer === opt.val;
                const isWrongSelected = result && isSelected && !isCorrect;
                return (
                  <button
                    key={opt.val}
                    onClick={() => !result && setUserAnswer(opt.val)}
                    disabled={!!result}
                    data-testid={`tf-option-${opt.val}`}
                    className={`py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                      isCorrect
                        ? "border-brand bg-brand/10 text-brand"
                        : isWrongSelected
                          ? "border-red-500 bg-red-500/10 text-red-400"
                          : isSelected
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* 判分结果 */}
          {result && (
            <div
              className={`rounded-xl p-4 msg-enter ${result.correct ? "bg-brand/10 border-2 border-brand/30" : "bg-red-500/10 border-2 border-red-500/30"}`}
              data-testid="exercise-result"
            >
              <div className={`text-base font-extrabold ${result.correct ? "text-brand" : "text-red-400"}`}>
                {result.correct ? "✅ 答对了！" : "❌ 答错了"}
              </div>
              {result.explanation && (
                <div className="text-xs text-neutral-300 mt-2 leading-relaxed">{result.explanation}</div>
              )}
              <div className="text-[11px] text-neutral-500 mt-2">
                💡 掌握度已更新，到 💬对话 查看提议并确认
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          {!result ? (
            <button
              onClick={handleSubmit}
              disabled={busy || (exercise.type === "mcq" ? selectedOption === null : !userAnswer.trim())}
              data-testid="exercise-submit"
              className="btn-3d-blue w-full py-3 text-sm"
            >
              {busy ? "判分中…" : "提交答案"}
            </button>
          ) : (
            <button
              onClick={handleNext}
              data-testid="exercise-next"
              className="btn-3d-brand w-full py-3 text-sm"
            >
              下一题 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
