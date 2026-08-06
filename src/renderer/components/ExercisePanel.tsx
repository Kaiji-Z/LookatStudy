/**
 * 练习题面板 —— AI 出题 + 作答 + 判分。
 *
 * 用法：选中一个 lesson 后，点「出题练习」→ AI 生成一道题（MCQ/填空/判断）
 * → 学习者作答 → 提交判分 → 显示对错 + 解释 → 自动创建掌握度更新 Proposal。
 *
 * 这是"结构化练习"路径（区别于 ChatPanel 的"自由对话"路径）。
 * 两种路径互补：对话用于讲解/追问，练习用于客观检验掌握度。
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
      <div className="text-center py-8 text-neutral-500 text-sm" data-testid="exercise-panel">
        先在右侧选一个 lesson，再开始练习。
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="exercise-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-300">📝 练习</h3>
        {!exercise && (
          <div className="flex gap-1">
            {(["mcq", "fill_blank", "true_false"] as ExerciseType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`text-[11px] px-2 py-1 rounded ${type === t ? "bg-brand/20 text-brand" : "text-neutral-500 hover:text-neutral-300"}`}
              >
                {t === "mcq" ? "选择题" : t === "fill_blank" ? "填空题" : "判断题"}
              </button>
            ))}
          </div>
        )}
      </div>

      {!exercise && !busy && (
        <button
          onClick={handleGenerate}
          disabled={!node || busy}
          data-testid="exercise-generate"
          className="w-full bg-brand text-white text-sm font-medium py-2.5 rounded-lg hover:bg-brand/80 disabled:opacity-40"
        >
          出一道{type === "mcq" ? "选择题" : type === "fill_blank" ? "填空题" : "判断题"}练习
        </button>
      )}

      {busy && !exercise && (
        <div className="text-center py-4 text-sm text-neutral-500 animate-pulse">AI 出题中…</div>
      )}

      {error && (
        <div className="bg-red-900/30 text-red-300 text-sm rounded p-2">
          ❌ {error}
          <div className="text-[11px] mt-1 opacity-70">请到设置页检查 API key 和网络。</div>
        </div>
      )}

      {exercise && (
        <div className="space-y-3" data-testid="exercise-card">
          {/* 题型标签 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
              {exercise.type === "mcq" ? "选择题" : exercise.type === "fill_blank" ? "填空题" : "判断题"}
            </span>
            {exercise.aiGenerated && (
              <span className="text-[10px] text-neutral-600">AI 生成</span>
            )}
          </div>

          {/* 题干 */}
          <div className="text-sm text-neutral-100 leading-relaxed">{exercise.prompt}</div>

          {/* 作答区 */}
          {exercise.type === "mcq" && exercise.options && (
            <div className="space-y-2" data-testid="mcq-options">
              {exercise.options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => !result && setSelectedOption(idx)}
                  disabled={!!result}
                  data-testid={`mcq-option-${idx}`}
                  className={`w-full text-left text-sm p-2.5 rounded-lg border transition-colors ${
                    selectedOption === idx
                      ? "border-brand bg-brand/10"
                      : "border-neutral-700 hover:border-neutral-600"
                  } ${result ? "cursor-default" : ""}`}
                >
                  <span className="text-neutral-500 mr-2">{String.fromCharCode(65 + idx)}.</span>
                  {opt}
                </button>
              ))}
            </div>
          )}

          {exercise.type === "fill_blank" && (
            <input
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder="输入你的答案…"
              disabled={!!result}
              data-testid="fill-input"
              className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-700 focus:border-brand focus:outline-none disabled:opacity-50"
            />
          )}

          {exercise.type === "true_false" && (
            <div className="flex gap-2" data-testid="tf-options">
              {["true", "false"].map((v) => (
                <button
                  key={v}
                  onClick={() => !result && setUserAnswer(v)}
                  disabled={!!result}
                  data-testid={`tf-option-${v}`}
                  className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${
                    userAnswer === v
                      ? "border-brand bg-brand/10"
                      : "border-neutral-700 hover:border-neutral-600"
                  }`}
                >
                  {v === "true" ? "✓ 正确" : "✗ 错误"}
                </button>
              ))}
            </div>
          )}

          {/* 判分结果 */}
          {result && (
            <div
              className={`rounded-lg p-3 ${result.correct ? "bg-green-900/30" : "bg-red-900/30"}`}
              data-testid="exercise-result"
            >
              <div className={`text-sm font-medium ${result.correct ? "text-green-300" : "text-red-300"}`}>
                {result.correct ? "✅ 答对了！" : "❌ 答错了"}
              </div>
              {result.explanation && (
                <div className="text-xs text-neutral-300 mt-1">{result.explanation}</div>
              )}
              <div className="text-[11px] text-neutral-500 mt-1">
                已自动生成掌握度更新提议，到聊天栏确认应用。
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2">
            {!result ? (
              <button
                onClick={handleSubmit}
                disabled={
                  busy ||
                  (exercise.type === "mcq" ? selectedOption === null : !userAnswer.trim())
                }
                data-testid="exercise-submit"
                className="flex-1 bg-brand text-white text-sm font-medium py-2 rounded-lg hover:bg-brand/80 disabled:opacity-40"
              >
                {busy ? "判分中…" : "提交答案"}
              </button>
            ) : (
              <button
                onClick={handleNext}
                data-testid="exercise-next"
                className="flex-1 bg-neutral-700 text-neutral-100 text-sm font-medium py-2 rounded-lg hover:bg-neutral-600"
              >
                下一题
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
