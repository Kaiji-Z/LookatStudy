/**
 * ExamView —— 章节考试 UI(关底 boss)。
 *
 * 当用户点考试节点(type=exam)时,App.tsx 把中栏从 ChatStream 换成本组件。
 *
 * 流程:
 *   1. 挂载 → examStart(生成/读取题目)
 *   2. 逐题答题(选选项 → 下一题,不限时)
 *   3. 全部答完 → examSubmit → 显示得分卡(⭐ 数 + 每题对错 + 正确答案)
 *   4. 可重考(题目已缓存,重新答一遍;星数取最高)
 *
 * 不走 BKT、不解锁下一章(考试完全独立,可选支线)。
 */
import { useState, useEffect, useCallback } from "react";
import type { ContentNode, Exercise } from "@shared/types";
import { api } from "../lib/api.js";
import { Target, Star, RotateCcw, Check, X, ArrowRight, AlertCircle } from "lucide-react";

interface ExamViewProps {
  examNode: ContentNode;
  /** 考试完成后回调,通知 App 刷新 progressMap(更新地图上的星数) */
  onExamCompleted?: () => void;
}

type Phase = "loading" | "answering" | "submitting" | "result" | "error";

export function ExamView({ examNode, onExamCompleted }: ExamViewProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{
    correctCount: number;
    totalCount: number;
    accuracy: number;
    stars: number;
    bestStars: number;
    perQuestion: Array<{
      exerciseId: string;
      correct: boolean;
      userAnswer: string;
      correctAnswer: string;
      explanation: string | null;
    }>;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // 挂载:拉题
  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrorMsg("");
    (async () => {
      try {
        const res = await api.examStart(examNode.id);
        if (cancelled) return;
        if (res.exercises.length === 0) {
          setErrorMsg("题目生成失败,请稍后重试");
          setPhase("error");
          return;
        }
        setExercises(res.exercises);
        setCurrentIdx(0);
        setAnswers({});
        setSelected(null);
        setPhase("answering");
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examNode.id]);

  const handleSelect = useCallback((idx: number) => {
    setSelected(idx);
  }, []);

  const handleNext = useCallback(() => {
    if (selected === null || !exercises[currentIdx]) return;
    const ex = exercises[currentIdx];
    // 存答案:userAnswer = 选项 index 的字符串(与 gradeAnswer 的 MCQ 判分对齐)
    const newAnswers = { ...answers, [ex.id]: String(selected) };
    setAnswers(newAnswers);

    if (currentIdx + 1 < exercises.length) {
      setCurrentIdx(currentIdx + 1);
      setSelected(null);
    } else {
      // 最后一题 → 提交
      setPhase("submitting");
      (async () => {
        try {
          const r = await api.examSubmit(examNode.id, newAnswers);
          setResult(r);
          setPhase("result");
          onExamCompleted?.();
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      })();
    }
  }, [selected, currentIdx, exercises, answers, examNode.id, onExamCompleted]);

  const handleRetry = useCallback(() => {
    setCurrentIdx(0);
    setAnswers({});
    setSelected(null);
    setResult(null);
    setPhase("answering");
  }, []);

  // ── 加载态 ──
  if (phase === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6" data-testid="exam-loading">
        <Target className="w-12 h-12 text-accent mb-4 opacity-60" />
        <div className="flex items-center gap-1.5 text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400">
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="ml-1">正在生成章节考试题…</span>
        </div>
      </div>
    );
  }

  // ── 错误态 ──
  if (phase === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center" data-testid="exam-error">
        <AlertCircle className="w-10 h-10 text-warning mb-3" />
        <div className="text-body font-bold text-neutral-800 dark:text-neutral-200 mb-1">考试加载失败</div>
        <div className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mb-4 max-w-xs">{errorMsg}</div>
        <button
          onClick={() => window.location.reload()}
          className="btn-3d-neutral px-4 py-1.5 text-body"
        >
          重新加载
        </button>
      </div>
    );
  }

  // ── 结果态:得分卡 ──
  if (phase === "result" && result) {
    return (
      <ExamResultCard
        result={result}
        exercises={exercises}
        answers={answers}
        onRetry={handleRetry}
      />
    );
  }

  // ── 答题态 ──
  const ex = exercises[currentIdx];
  if (!ex) return null;
  const progress = ((currentIdx + 1) / exercises.length) * 100;

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="exam-answering">
      {/* 顶部:考试标题 + 进度 */}
      <div className="px-4 pt-3 pb-2 shrink-0 bg-surface-2/30">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-accent" />
          <span className="text-body font-bold text-neutral-900 dark:text-neutral-100 truncate">{examNode.title}</span>
        </div>
        {/* 进度条 */}
        <div className="flex items-center gap-2">
          <span className="text-label font-bold tabular-nums text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 shrink-0">
            {currentIdx + 1}/{exercises.length}
          </span>
          <div className="flex-1 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* 题目卡片 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="text-label font-bold text-accent mb-2">第 {currentIdx + 1} 题</div>
        <div className="text-body text-neutral-900 dark:text-neutral-100 font-medium mb-4 leading-relaxed">
          {ex.prompt}
        </div>

        {ex.options && (
          <div className="space-y-2 mb-4">
            {ex.options.map((opt, idx) => {
              const isSelected = selected === idx;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(idx)}
                  data-testid={`exam-option-${idx}`}
                  className={`w-full text-left text-body p-2.5 rounded-lg border font-medium transition-all duration-150 ${
                    isSelected
                      ? "border-accent bg-accent/10 text-neutral-900 dark:text-neutral-100 ring-2 ring-accent/20"
                      : "border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  } cursor-pointer`}
                >
                  <span className={`font-bold mr-2 ${isSelected ? "text-accent" : ""}`}>{String.fromCharCode(65 + idx)}</span>
                  {opt}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部:下一题/提交 */}
      <div className="px-4 py-3 shrink-0 bg-surface-2/30">
        <button
          onClick={handleNext}
          disabled={selected === null}
          data-testid="exam-next"
          className={`w-full py-2 rounded-xl text-body font-bold transition-all ${
            selected === null
              ? "bg-neutral-200 dark:bg-neutral-800 text-ink-muted cursor-not-allowed"
              : "btn-3d-brand"
          }`}
        >
          {currentIdx + 1 < exercises.length ? (
            <>下一题 <ArrowRight className="w-4 h-4 inline ml-1" /></>
          ) : (
            "提交考试"
          )}
        </button>
      </div>
    </div>
  );
}

/* ---------- 结果卡:星数 + 每题对错 ---------- */
interface ExamResult {
  correctCount: number;
  totalCount: number;
  accuracy: number;
  stars: number;
  bestStars: number;
  perQuestion: Array<{
    exerciseId: string;
    correct: boolean;
    userAnswer: string;
    correctAnswer: string;
    explanation: string | null;
  }>;
}

function ExamResultCard({
  result,
  exercises,
  answers: _answers,
  onRetry,
}: {
  result: ExamResult;
  exercises: Exercise[];
  answers: Record<string, string>;
  onRetry: () => void;
}) {
  const { correctCount, totalCount, stars, bestStars, perQuestion } = result;
  const passed = stars > 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="exam-result">
      {/* 得分头部 */}
      <div className="text-center mb-5">
        <div className={`text-4xl font-extrabold mb-1 ${passed ? "text-accent" : "text-neutral-600 dark:text-neutral-400"}`}>
          {correctCount}/{totalCount}
        </div>
        <div className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mb-3">
          正确率 {Math.round((correctCount / totalCount) * 100)}%
        </div>
        {/* 星星 */}
        <div className="flex justify-center gap-1.5 mb-1" data-testid="exam-stars">
          {[0, 1, 2].map((s) => (
            <Star
              key={s}
              className={`w-8 h-8 ${s < stars ? "text-gold fill-gold" : "text-neutral-300 dark:text-neutral-700"}`}
            />
          ))}
        </div>
        {/* 本次/最佳 */}
        <div className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400">
          {passed ? (
            bestStars > stars ? `本次 ${stars} 星 · 历史最佳 ${bestStars} 星` : `恭喜,获得 ${stars} 星!`
          ) : (
            "未达 60%,再接再厉"
          )}
        </div>
      </div>

      {/* 逐题回顾 */}
      <div className="space-y-2.5 mb-4">
        <div className="text-label font-bold text-neutral-700 dark:text-neutral-300 mb-1">逐题回顾</div>
        {perQuestion.map((pq, i) => {
          const ex = exercises.find((e) => e.id === pq.exerciseId);
          return (
            <div
              key={pq.exerciseId}
              className={`rounded-lg p-2.5 border ${pq.correct ? "border-brand/30 bg-brand/5" : "border-warning/30 bg-warning/5"}`}
              data-testid={`exam-review-${i}`}
            >
              <div className="flex items-start gap-2 mb-1">
                {pq.correct ? (
                  <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                ) : (
                  <X className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                )}
                <div className="text-body text-neutral-800 dark:text-neutral-200 font-medium leading-relaxed">
                  {ex?.prompt ?? `(题目 ${i + 1})`}
                </div>
              </div>
              {!pq.correct && ex?.options && (
                <div className="text-label text-neutral-600 dark:text-neutral-600 dark:text-neutral-400 ml-6 mb-1">
                  <span className="text-warning">你的答案:</span>{" "}
                  {ex.options[Number.parseInt(pq.userAnswer)] ?? pq.userAnswer ?? "(未答)"}{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">·</span>{" "}
                  <span className="text-brand">正确:</span>{" "}
                  {ex.options[Number.parseInt(pq.correctAnswer)] ?? pq.correctAnswer}
                </div>
              )}
              {pq.explanation && (
                <div className="text-label text-neutral-600 dark:text-neutral-600 dark:text-neutral-400 ml-6 leading-relaxed">
                  {pq.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 重考按钮 */}
      <button
        onClick={onRetry}
        data-testid="exam-retry"
        className="btn-3d-neutral w-full py-2 text-body font-bold flex items-center justify-center gap-1.5"
      >
        <RotateCcw className="w-4 h-4" />
        重新考试(题目已缓存)
      </button>
    </div>
  );
}
