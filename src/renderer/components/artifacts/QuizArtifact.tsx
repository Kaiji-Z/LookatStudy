/**
 * QuizArtifact —— 练习题产物(M2)。
 *
 * tool generate_quiz 返回 { questions },这里渲染成可交互练习卡。
 * 提交后本地判分(不调 LLM),并触发 onResult 回调(父组件可借机触发 ExplainCard)。
 *
 * 这是 v0.2 把"📝练习 tab"并入对话流的核心:练习题作为 Generative UI 产物出现。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { celebrate } from "../../lib/celebration.js";
import { ListChecks, Check, X, AlertTriangle, HelpCircle, RotateCcw, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { getPostQuizActions, type PostQuizActionId } from "../../lib/post-quiz-actions.js";
import { quizProgressKey, loadQuizProgress, saveQuizProgress } from "../../lib/quiz-progress.js";
import type { LucideIcon } from "lucide-react";

interface QuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
}
interface QuizData {
  artifactType: "quiz";
  title?: string;
  questions: QuizQuestion[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

/**
 * 答完一组题后"下一步"动作的渲染元数据(常开)。
 * 动作 id 来自纯函数 getPostQuizActions(已测);这里只把 id 映射成图标 + i18n 文案 + 要发送的消息。
 * 消息是学习者"会说的话"(具体中文),发给 AI 后由 AI 接住(record_answer/mark_mastered 等)。
 */
const ACTION_META: Record<PostQuizActionId, { icon: LucideIcon; labelKey: string; message: string }> = {
  "explain-wrong": {
    icon: HelpCircle,
    labelKey: "quiz.action.explainWrong",
    message: "我刚才有题答错了,帮我讲讲为什么错、正确的思路是什么。",
  },
  "retry": {
    icon: RotateCcw,
    labelKey: "quiz.action.retry",
    message: "再来一组类似的题巩固一下。",
  },
  "go-deeper": {
    icon: Sparkles,
    labelKey: "quiz.action.goDeeper",
    message: "这组我答得不错,帮我深入讲讲背后的原理和容易混淆的地方。",
  },
  "mark-mastered": {
    icon: CheckCircle2,
    labelKey: "quiz.action.markMastered",
    message: "这课我觉得掌握了,帮我确认一下——出个综合题检验,通过了就标记为掌握。",
  },
  "next-topic": {
    icon: ArrowRight,
    labelKey: "quiz.action.nextTopic",
    message: "进入下一个知识点。",
  },
};

/** 答完整组题的成绩单(自动 hook 给 AI 用):总分 + 逐题判定。 */
export interface QuizCompletedResult {
  title: string;
  correct: number;
  total: number;
  detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[];
}

export function QuizArtifact({
  data,
  onAnswered,
  quizMastery,
  onPickAction,
  onQuizCompleted,
}: {
  data: unknown;
  onAnswered?: (question: QuizQuestion, selectedIndex: number, correct: boolean) => void;
  /** 当前节点掌握度(决定是否给出"标记掌握";空=未评估,按低掌握处理,不冒险标记)。 */
  quizMastery?: number | null;
  /** 点某个动作 → 把对应消息发进对话(父组件接 sendMessage)。常开:有回调就显示下一步动作(消灭死胡同)。 */
  onPickAction?: (message: string) => void;
  /** 最后一题提交后点「完成」时触发(真实点击才算,进度恢复不重放)——父组件把成绩单 hook 给 AI,
   *  由 AI 决定下一步(讲错题/放行/换角度)。提供后完成卡不再显示手动下一步按钮。 */
  onQuizCompleted?: (result: QuizCompletedResult) => void;
}) {
  const d = data as QuizData;
  const t = useLang();
  /* 进度跨挂载持久化(#2):T3 切栏卸载聊天面板会让本地 state 蒸发,
     判完分的卡切回来变回未作答。以题目内容哈希为键恢复 {current, score};
     副作用(判分上报/庆祝)只在提交点击时发生,恢复不重放。 */
  const progressKey = useMemo(() => quizProgressKey(d), [d]);
  const saved = useMemo(() => loadQuizProgress(progressKey), [progressKey]);
  const [current, setCurrent] = useState(saved?.current ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(saved?.score ?? { correct: 0, total: 0 });
  /* 逐题判定累积(真实提交才追加;恢复的进度没有判定,也不触发完成 hook) */
  const detailRef = useRef<QuizCompletedResult["detail"]>([]);
  useEffect(() => {
    saveQuizProgress(progressKey, { current, score });
  }, [progressKey, current, score]);

    // hook 触发点 = 最后一题提交后的「完成」按钮(先看答案再交卷);
    // hookSent 只为兜底:刷新恢复的完成态没经过「完成」点击,成绩卡留一个补交按钮。
    const [hookSent, setHookSent] = useState(false);
    if (current >= d.questions.length) {
      // 全部做完。hook 模式:成绩卡 + 已交给导师;手动"下一步动作"仅在无 hook 回调的上下文保留。
      const showActions = !!onPickAction && !onQuizCompleted;
      if (onQuizCompleted) {
        return (
          <div className="surface-card p-4 text-center" data-testid="artifact-quiz-done">
            <div className="text-2xl mb-2">{score.correct === score.total ? "🎉" : "📚"}</div>
            <div className="text-body font-bold text-ink">
              {t("quiz.scoreSummary", { correct: score.correct, total: score.total })}
            </div>
            {hookSent ? (
              <div className="text-label text-ink-muted mt-1" data-testid="quiz-hook-sent">
                {t("quiz.hook.sent")}
              </div>
            ) : (
              <button
                onClick={() => {
                  setHookSent(true);
                  onQuizCompleted({
                    title: d.title ?? "",
                    correct: score.correct,
                    total: score.total,
                    // 恢复的进度没有逐题判定:成绩单只带总分(detail 空),AI 仍可分析
                    detail: [...detailRef.current],
                  });
                }}
                data-testid="quiz-hook-finish"
                className="btn-3d-brand mt-3 px-5 py-2 text-body"
              >
                {t("quiz.hook.finish")}
              </button>
            )}
          </div>
        );
      }
    const actions = showActions ? getPostQuizActions(score, quizMastery ?? null) : [];
    return (
      <div className="surface-card p-4 text-center" data-testid="artifact-quiz-done">
        <div className="text-2xl mb-2">{score.correct === score.total ? "🎉" : "📚"}</div>
        <div className="text-body font-bold text-ink">
          {t("quiz.scoreSummary", { correct: score.correct, total: score.total })}
        </div>
        <div className="text-label text-ink-muted mt-1">
          {score.correct === score.total ? t("quiz.allCorrectHint") : t("quiz.tryAgainHint")}
        </div>
        {actions.length > 0 && (
          <div className="mt-3 space-y-2 text-left" data-testid="quiz-next-actions">
            <div className="text-label text-ink-muted">{t("quiz.action.nextPrompt")}</div>
            {actions.map((a, idx) => {
              const meta = ACTION_META[a.id];
              const Icon = meta.icon;
              return (
                <button
                  key={a.id}
                  onClick={() => onPickAction?.(meta.message)}
                  data-testid={`quiz-action-${a.id}`}
                  className={`${idx === 0 ? "btn-3d-brand" : "btn-3d-neutral"} w-full py-2 text-body flex items-center justify-center gap-1.5`}
                >
                  <Icon className="w-4 h-4" />
                  {t(meta.labelKey)}
                </button>
              );
            })}
          </div>
        )}
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
    // 逐题判定累积(供完成 hook 的成绩单)
    detailRef.current.push({
      prompt: q.prompt,
      chosen: q.options[selected] ?? "?",
      answerText: q.options[q.answer] ?? "?",
      correct,
    });
    // 最后一题提交只判分出答案,不发成绩单——hook 在「完成」按钮(handleNext)触发。
    // 逐题判定只在真实提交时累积——localStorage 恢复的完成态 detail 为空,补交时只带总分。
    // Phase 1: 答题高光时刻 — 答对粒子爆发,答错柔红光闪(CelebrationLayer 统一渲染)。
    celebrate(correct ? "correct" : "wrong");
  };

  const handleNext = () => {
    // 最后一题的「完成」按钮 = 交卷:触发 hook 把成绩单交给 AI,卡片翻成成绩卡。
    // 此时 detailRef 已含全部逐题判定(最后一题在 handleSubmit 里刚累积完)。
    if (current === d.questions.length - 1 && onQuizCompleted && !hookSent) {
      setHookSent(true);
      onQuizCompleted({
        title: d.title ?? "",
        correct: score.correct,
        total: score.total,
        detail: [...detailRef.current],
      });
    }
    setCurrent((c) => c + 1);
    setSelected(null);
    setSubmitted(false);
  };

  return (
    <div className="surface-card p-4" data-testid="artifact-quiz">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-brand" />
          <span className="text-label font-bold text-brand">
            {t("quiz.questionProgress", { cur: current + 1, total: d.questions.length })}
          </span>
        </div>
        <span className="text-label text-ink-muted">
          {t("quiz.answeredCorrect", { n: score.correct })}
        </span>
      </div>

      <div className="text-body text-ink font-medium mb-3 leading-relaxed">
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
                      : "border-[var(--border)] text-ink-muted hover:border-[var(--border)]"
              } ${submitted ? "cursor-default" : "cursor-pointer"}`}
            >
              <span className="font-bold mr-2">{String.fromCharCode(65 + idx)}</span>
              {opt}
              {isAnswer && <span className="float-right"><Check className="w-4 h-4 inline-block" /></span>}
              {isWrongSelected && <span className="float-right"><X className="w-4 h-4 inline-block" /></span>}
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
          <div className="font-bold mb-1 flex items-center gap-1.5">
            {isCorrect ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span>{isCorrect ? t("quiz.correct") : t("quiz.wrong")}</span>
          </div>
          <div className="text-ink-muted">{q.explanation}</div>
        </div>
      )}

      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={selected === null}
          data-testid="quiz-submit"
          className="btn-3d-brand w-full py-2 text-body disabled:opacity-40"
        >
          {t("exercise.submit")}
        </button>
      ) : (
        <button
          onClick={handleNext}
          data-testid="quiz-next"
          className="btn-3d-brand w-full py-2 text-body"
        >
          {current + 1 < d.questions.length ? t("exercise.next") : t("quiz.finish")}
        </button>
      )}

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-warning flex items-start gap-1" data-testid="artifact-warnings">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{d.warnings.join("; ")}</span>
        </div>
      )}
    </div>
  );
}
