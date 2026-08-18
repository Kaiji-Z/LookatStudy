/**
 * ExamView v2 —— 章节考试 UI(关底 boss,五态生命周期)。
 *
 * 当用户点考试节点(type=exam)时,App.tsx 把中栏从 ChatStream 换成本组件。
 *
 * 生命周期:
 *   generating(进度条,可切走后台继续) → ready(N题/M知识点/预计时长 + 开始考试)
 *   failed(原因 + 重新生成)
 *   answering(每题限时 60/90s,超时自动记当前选择进下一题;答案逐题增量持久化)
 *   submitting → result(结算:星数 + 按知识点分解 + 逐题回顾 + 重新考试)
 *
 * 切回节点:有历史 attempt → 直接落结算页;否则 ready/idle(自动触发生成)。
 * 考试中切换节点:App 层拦截弹离开警告(paused prop 让计时暂停),
 *   确认离开 → terminate(未答=错计分)→ App 导航。
 * 重新考试:新 attempt,题目序 + 选项序都重排(shared/exam-logic 种子洗牌)。
 *
 * 不走 BKT、不解锁下一章(考试完全独立;KC 分解纯展示不回写)。
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { ContentNode } from "@shared/types";
import type {
  ExamQuestionView,
  ExamStatus,
  ExamStatusView,
  ExamPerQuestionResult,
} from "@shared/types";
import {
  buildAttemptShuffle,
  displayAnswerToOriginal,
  questionTimeLimitSec,
  type AttemptShuffle,
} from "@shared/exam-logic";
import { api } from "../lib/api.js";
import { celebrate } from "../lib/celebration.js";
import { useLang } from "../lib/i18n.js";
import { ConfirmCard } from "./ConfirmCard.js";
import { Target, Star, RotateCcw, Check, X, ArrowRight, AlertCircle, Timer, Lightbulb } from "lucide-react";

interface ExamViewProps {
  examNode: ContentNode;
  /** 界面语言(i18n)。题库生成时定格语言 */
  locale?: string | null;
  /** 考试完成后回调,通知 App 刷新 progressMap(更新地图上的星数) */
  onExamCompleted?: () => void;
  /** 向 App 上报考试会话(answering/submitting 时 active;terminate 供离开警告确认后调用) */
  onSessionChange?: (session: { active: boolean; terminate: (() => Promise<void>) | null }) => void;
  /** 离开警告模态打开期间暂停计时(弹窗不该吃掉答题时间) */
  paused?: boolean;
}

type Phase = "loading" | "generating" | "ready" | "failed" | "answering" | "submitting" | "result";

/** 结算页统一数据源(刚提交的 ExamSubmitResult 或历史 ExamAttemptView 投影) */
interface ResultData {
  correctCount: number;
  totalCount: number;
  stars: number;
  bestStars: number;
  terminated: boolean;
  perQuestion: ExamPerQuestionResult[];
}

function StarRow({ stars }: { stars: number }) {
  return (
    <div className="flex gap-1" aria-label={`${stars} stars`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          className={`w-7 h-7 ${i <= stars ? "text-gold fill-gold" : "text-white/20"}`}
        />
      ))}
    </div>
  );
}

export function ExamView({ examNode, locale, onExamCompleted, onSessionChange, paused }: ExamViewProps) {
  const t = useLang();
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusView, setStatusView] = useState<ExamStatusView | null>(null);
  const [exercises, setExercises] = useState<ExamQuestionView[]>([]);
  const [shuffle, setShuffle] = useState<AttemptShuffle | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  // 重新出题确认卡锚点(非 null = 确认中;复用于 ready/result 两态)
  const [regenRect, setRegenRect] = useState<DOMRect | null>(null);
  // answers 镜像(terminate 回调异步读最新值,不依赖闭包过期)
  const answersRef = useRef<Record<string, string>>({});
  const attemptIdRef = useRef<string | null>(null);
  // 单题消费守卫(「下一题」按钮与 0 秒超时竞态防重:一题只推进一次)
  const consumedQRef = useRef<string | null>(null);

  const currentQ: ExamQuestionView | null = shuffle
    ? (exercises[shuffle.questionOrder[currentIdx]] ?? null)
    : null;
  const perm = currentQ && shuffle ? (shuffle.optionPerms[currentQ.id] ?? []) : [];

  /* ---------- 挂载/换节点:拉状态,必要时自动触发生成 ---------- */
  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrorMsg("");
    setResult(null);
    setStatusView(null);
    (async () => {
      try {
        const sv = await api.examGetStatus(examNode.id);
        if (cancelled) return;
        setStatusView(sv);
        setExercises(sv.exercises);
        if (sv.status === "generating") {
          setPhase("generating");
        } else if (sv.status === "failed") {
          setErrorMsg(sv.error ?? t("exam.errorEmpty"));
          setPhase("failed");
        } else if (sv.status === "ready") {
          if (sv.latestAttempt && sv.latestAttempt.finishedAt) {
            // 有历史成绩 → 直接落结算页(切回节点可见之前的考试结果)
            setResult({
              correctCount: sv.latestAttempt.correctCount,
              totalCount: sv.latestAttempt.totalCount,
              stars: sv.latestAttempt.stars,
              bestStars: sv.bestStars,
              terminated: sv.latestAttempt.terminated,
              perQuestion: sv.latestAttempt.perQuestion ?? [],
            });
            setPhase("result");
          } else {
            setPhase("ready");
          }
        } else {
          // idle → 自动触发后台生成
          setPhase("generating");
          api.examPrepare(examNode.id, locale ?? null).catch(() => {});
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examNode.id]);

  /* ---------- 订阅生成进度事件 ---------- */
  useEffect(() => {
    const off = api.on("exam:status", (st: ExamStatus) => {
      if (st.nodeId !== examNode.id) return;
      if (st.status === "ready") {
        // 生成完成 → 重拉完整状态(题目/元信息/attempt)
        api.examGetStatus(examNode.id).then((sv) => {
          setStatusView(sv);
          setExercises(sv.exercises);
          setPhase((p) => (p === "generating" ? (sv.latestAttempt ? "result" : "ready") : p));
        }).catch(() => {});
      } else if (st.status === "failed") {
        setErrorMsg(st.error ?? t("exam.errorEmpty"));
        setPhase("failed");
      } else {
        setStatusView((prev) => (prev ? { ...prev, ...st } : prev));
        setPhase((p) => (p === "loading" ? "generating" : p));
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examNode.id]);

  /* ---------- 开始/重新考试 ---------- */
  const startAttempt = useCallback(async () => {
    try {
      const r = await api.examStartAttempt(examNode.id);
      const sh = buildAttemptShuffle(
        r.exercises.map((q) => ({ id: q.id, optionCount: q.options?.length ?? 0 })),
        r.attemptId,
      );
      setExercises(r.exercises);
      attemptIdRef.current = r.attemptId;
      setShuffle(sh);
      answersRef.current = {};
      setCurrentIdx(0);
      setSelected(null);
      setResult(null);
      consumedQRef.current = null;
      setPhase("answering");
      setTimeLeft(questionTimeLimitSec(r.exercises[sh.questionOrder[0]!]?.prompt ?? ""));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }, [examNode.id]);

  /* ---------- 重新出题:删旧题库重走后台生成(ConfirmCard 确认后调用) ---------- */
  const startRegenerate = useCallback(() => {
    setRegenRect(null);
    setResult(null);
    setPhase("generating");
    setStatusView((prev) => (prev ? { ...prev, status: "generating", done: 0, total: 0 } : prev));
    api
      .examRegenerate(examNode.id, locale ?? null)
      .then((st) => {
        // 无 LLM/同步失败等场景:事件之外的就地兜底(事件与这里幂等)
        if (st.status === "failed") {
          setErrorMsg(st.error ?? t("exam.errorEmpty"));
          setPhase("failed");
        }
      })
      .catch((e) => {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("failed");
      });
  }, [examNode.id, locale, t]);

  /** 重新出题按钮 + 内联确认卡(ready 与 result 两态共用;一次只渲染一个分支) */
  const regenButton = (
    <>
      <button
        className="btn-3d-neutral px-4 py-1.5 text-body"
        data-testid="exam-regen-btn"
        onClick={(e) => setRegenRect(e.currentTarget.getBoundingClientRect())}
      >
        <RotateCcw className="w-3.5 h-3.5 inline" />
        {t("exam.regenerate")}
      </button>
      {regenRect && (
        <ConfirmCard
          anchorRect={regenRect}
          message={t("exam.regenerate.confirmMsg")}
          confirmLabel={t("exam.regenerate")}
          onConfirm={startRegenerate}
          onCancel={() => setRegenRect(null)}
        />
      )}
    </>
  );

  /* ---------- 换题:重置计时与选择 ---------- */
  useEffect(() => {
    if (phase !== "answering" || !currentQ) return;
    if (consumedQRef.current !== currentQ.id) {
      setTimeLeft(questionTimeLimitSec(currentQ.prompt));
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase]);

  /* ---------- 计时器(paused 时暂停;递减是纯 updater,超时动作由独立 effect 触发) ---------- */
  useEffect(() => {
    if (phase !== "answering" || paused) return;
    const iv = setInterval(() => {
      setTimeLeft((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, paused]);

  /* ---------- 推进:记录答案(显示位→原始下标)并进下一题/提交 ---------- */
  const advance = useCallback(
    (displayIdx: number | null) => {
      const ex = currentQ;
      if (!ex || phase !== "answering") return;
      if (consumedQRef.current === ex.id) return; // 本题已消费
      consumedQRef.current = ex.id;
      const original = displayIdx === null ? "" : displayAnswerToOriginal(perm, displayIdx);
      const next = { ...answersRef.current, [ex.id]: original };
      answersRef.current = next;
      if (attemptIdRef.current) {
        api.examRecordAnswer(examNode.id, attemptIdRef.current, ex.id, original).catch(() => {});
      }
      if (currentIdx + 1 < exercises.length) {
        setCurrentIdx(currentIdx + 1);
      } else {
        setPhase("submitting");
        (async () => {
          try {
            const r = await api.examSubmitAttempt(examNode.id, attemptIdRef.current!, next);
            setResult({
              correctCount: r.correctCount,
              totalCount: r.totalCount,
              stars: r.stars,
              bestStars: r.bestStars,
              terminated: r.terminated,
              perQuestion: r.perQuestion,
            });
            setPhase("result");
            onExamCompleted?.();
            if (r.stars >= 1) celebrate("exam-pass");
          } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : String(e));
            setPhase("failed");
          }
        })();
      }
    },
    [currentQ, phase, perm, currentIdx, exercises.length, examNode.id, onExamCompleted],
  );

  const handleNext = useCallback(() => {
    if (selected === null) return;
    advance(selected);
  }, [selected, advance]);

  /* ---------- 超时:自动记当前选择(无则未答=错)进下一题 ---------- */
  useEffect(() => {
    if (phase !== "answering" || timeLeft > 0 || paused) return;
    advance(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase, paused]);

  /* ---------- 向 App 上报会话 + terminate(离开警告确认后调用) ---------- */
  useEffect(() => {
    const terminate = async () => {
      if (!attemptIdRef.current) return;
      try {
        await api.examSubmitAttempt(examNode.id, attemptIdRef.current, answersRef.current, {
          terminated: true,
        });
        onExamCompleted?.();
      } catch {
        /* 尽力而为:导航不因提交失败阻塞 */
      }
    };
    const active = phase === "answering" || phase === "submitting";
    onSessionChange?.(active ? { active: true, terminate } : { active: false, terminate: null });
  }, [phase, examNode.id, onExamCompleted, onSessionChange]);

  /* ---------- 渲染 ---------- */

  if (phase === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6" data-testid="exam-loading">
        <Target className="w-12 h-12 text-accent mb-4 opacity-60" />
        <div className="flex gap-1">
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
        </div>
      </div>
    );
  }

  // ── 生成中:真实进度(批数),可离开 ──
  if (phase === "generating") {
    const done = statusView?.done ?? 0;
    const total = statusView?.total ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6" data-testid="exam-generating">
        <Target className="w-12 h-12 text-accent mb-4 opacity-60" />
        <div className="text-title font-bold text-ink mb-2">{t("exam.generating.title")}</div>
        <div className="text-body text-ink-muted mb-4">{t("exam.generating.stage")}</div>
        <div
          className="w-56 h-2.5 rounded-full bg-white/10 overflow-hidden mb-2"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
        <div className="text-label text-ink-muted tabular-nums mb-6">
          {total > 0 ? t("exam.generating.kcProgress", { done, total }) : t("exam.generating.preparing")}
        </div>
        <div className="text-caption text-ink-muted max-w-xs text-center">{t("exam.generating.canLeave")}</div>
      </div>
    );
  }

  // ── 生成失败:原因 + 重新生成 ──
  if (phase === "failed") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center" data-testid="exam-error">
        <AlertCircle className="w-10 h-10 text-warning mb-3" />
        <div className="text-body font-bold text-ink mb-1">{t("exam.errorTitle")}</div>
        <div className="text-body text-ink-muted mb-4 max-w-xs break-words">{errorMsg || t("exam.errorEmpty")}</div>
        <button
          className="btn-3d-brand px-4 py-1.5 text-body"
          onClick={() => {
            setPhase("generating");
            api.examPrepare(examNode.id, locale ?? null).catch(() => {});
          }}
        >
          <RotateCcw className="w-3.5 h-3.5 inline" />
          {t("exam.failed.retry")}
        </button>
      </div>
    );
  }

  // ── 就绪:元信息 + 开始考试 ──
  if (phase === "ready" && statusView) {
    const estSec = statusView.exercises.reduce((a, q) => a + questionTimeLimitSec(q.prompt), 0);
    const estMin = Math.max(1, Math.round(estSec / 60));
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6" data-testid="exam-ready">
        <div className="w-14 h-14 rounded-full bg-brand/15 flex items-center justify-center mb-4">
          <Target className="w-7 h-7 text-brand" />
        </div>
        <div className="text-hero font-extrabold text-ink mb-1">{t("exam.ready.title")}</div>
        <div className="text-body text-ink-muted mb-3 text-center">{examNode.title}</div>
        <div className="text-label text-ink-muted mb-8">
          {t("exam.ready.meta", {
            q: statusView.questionCount,
            kc: statusView.kcCount,
            min: estMin,
          })}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            className="btn-3d-brand px-6 py-2 text-lead"
            onClick={startAttempt}
            data-testid="exam-start-btn"
          >
            {t("exam.start")}
            <ArrowRight className="w-4 h-4 inline ml-1" />
          </button>
          {regenButton}
        </div>
      </div>
    );
  }

  // ── 答题中/提交中 ──
  if (phase === "answering" || phase === "submitting") {
    if (!currentQ) return null;
    const timeWarn = timeLeft <= 10;
    return (
      <div className="flex-1 flex flex-col px-6 py-6 max-w-2xl w-full mx-auto" data-testid="exam-answering">
        {/* 顶栏:进度 + 计时 */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-label text-ink-muted tabular-nums">
            {t("exam.q.progress", { i: currentIdx + 1, n: exercises.length })}
          </div>
          <div
            className={`flex items-center gap-1 text-label font-bold tabular-nums transition-colors ${timeWarn ? "text-warning" : "text-ink"}`}
            data-testid="exam-timer"
          >
            <Timer className="w-3.5 h-3.5" />
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
          </div>
        </div>
        {/* 总进度条 */}
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mb-6">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${(currentIdx / exercises.length) * 100}%` }}
          />
        </div>
        {/* KC 标签 */}
        {currentQ.kcTitle && (
          <div className="inline-flex items-center gap-1 text-caption text-accent bg-accent/10 rounded-full px-2.5 py-1 mb-3 self-start">
            <Lightbulb className="w-3 h-3" />
            {currentQ.kcTitle}
          </div>
        )}
        {/* 题干 */}
        <div className="text-lead text-ink leading-relaxed mb-6 whitespace-pre-wrap">{currentQ.prompt}</div>
        {/* 选项(重排后的显示序) */}
        <div className="flex flex-col gap-2.5">
          {(currentQ.options ?? []).map((opt, j) => (
            <button
              key={j}
              onClick={() => setSelected(j)}
              data-testid={`exam-option-${j}`}
              className={`text-left px-4 py-3 rounded-xl border transition-all duration-150 ${
                selected === j
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-white/10 bg-white/5 text-ink hover:border-white/25"
              }`}
            >
              <span className="text-body">{opt}</span>
            </button>
          ))}
        </div>
        {/* 下一题/提交 */}
        <div className="mt-6 flex justify-end">
          {phase === "submitting" ? (
            <div className="text-body text-ink-muted">{t("exam.submitting")}</div>
          ) : (
            <button
              className="btn-3d-brand px-5 py-2 text-body disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selected === null}
              onClick={handleNext}
              data-testid="exam-next-btn"
            >
              {currentIdx + 1 < exercises.length ? t("exam.q.next") : t("exam.q.submit")}
              <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── 结算页 ──
  if (phase === "result" && result) {
    const pct = result.totalCount > 0 ? Math.round((result.correctCount / result.totalCount) * 100) : 0;
    // KC 分解(老题库无 kc_title → 隐藏)
    const kcGroups = new Map<string, { correct: number; total: number }>();
    for (const pq of result.perQuestion) {
      const key = pq.kcTitle ?? "";
      if (!key) continue;
      const g = kcGroups.get(key) ?? { correct: 0, total: 0 };
      g.total++;
      if (pq.correct) g.correct++;
      kcGroups.set(key, g);
    }
    const exById = new Map(exercises.map((q) => [q.id, q]));

    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-2xl w-full mx-auto" data-testid="exam-result">
        {/* 星数 + 总分 */}
        <div className="flex flex-col items-center mb-6">
          <StarRow stars={result.stars} />
          <div className="text-hero font-extrabold text-ink mt-3">
            {t("exam.result.score", { correct: result.correctCount, total: result.totalCount })}
          </div>
          <div className="text-body text-ink-muted mt-1">{t("exam.result.accuracy", { pct })}</div>
          <div className="flex items-center gap-3 text-label text-ink-muted mt-2">
            <span>{t("exam.result.best", { stars: result.bestStars })}</span>
            {statusView && statusView.attemptCount > 1 && (
              <span>{t("exam.result.attempts", { n: statusView.attemptCount })}</span>
            )}
          </div>
        </div>

        {/* 终止横幅 */}
        {result.terminated && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 mb-6 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0" />
            <span className="text-body text-ink">{t("exam.terminated.banner")}</span>
          </div>
        )}

        {/* KC 分解 */}
        {kcGroups.size > 0 && (
          <div className="mb-8">
            <div className="text-title font-bold text-ink mb-3">{t("exam.result.kcBreakdown")}</div>
            <div className="flex flex-col gap-2">
              {[...kcGroups.entries()].map(([kc, g]) => {
                const acc = g.total > 0 ? g.correct / g.total : 0;
                const weak = acc < 0.6;
                return (
                  <div key={kc} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5" data-testid="exam-kc-row">
                    <div className="flex items-center gap-2 min-w-0">
                      <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="text-body text-ink truncate">{kc}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {weak && <span className="text-caption text-warning">{t("exam.result.weakKc")}</span>}
                      <span className="text-label text-ink-muted tabular-nums">
                        {g.correct}/{g.total}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 逐题回顾 */}
        <div className="mb-8">
          <div className="text-title font-bold text-ink mb-3">{t("exam.result.review")}</div>
          <div className="flex flex-col gap-2">
            {result.perQuestion.map((pq, i) => {
              const ex = exById.get(pq.exerciseId);
              // 快照优先(重新生成删旧题后历史回顾仍自包含),老 attempt 无快照回退查表
              const opts = pq.options ?? ex?.options ?? null;
              const promptText = pq.prompt ?? ex?.prompt ?? `#${i + 1}`;
              const label = (v: string) =>
                opts && v !== "" && opts[Number(v)] !== undefined ? opts[Number(v)]! : v;
              return (
                <div key={pq.exerciseId} className="px-4 py-3 rounded-xl bg-white/5" data-testid="exam-review-row">
                  <div className="flex items-start gap-2">
                    {pq.correct ? (
                      <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    ) : (
                      <X className={`w-4 h-4 shrink-0 mt-0.5 ${pq.answered ? "text-warning" : "text-ink-muted"}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-body text-ink mb-1">{promptText}</div>
                      <div className="text-caption text-ink-muted">
                        {!pq.answered ? (
                          t("exam.result.unanswered")
                        ) : pq.correct ? (
                          <span className="text-brand">{t("exam.result.correctLabel")}</span>
                        ) : (
                          <>
                            {t("exam.result.yourAnswer")}:{label(pq.userAnswer)}
                            <span className="mx-1">·</span>
                            {t("exam.result.correctAnswer")}:{label(pq.correctAnswer)}
                          </>
                        )}
                      </div>
                      {pq.explanation && (
                        <div className="text-caption text-ink-muted mt-1 leading-relaxed">{pq.explanation}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 重新考试(题序 + 选项序都重排)/ 重新出题(换一批新题) */}
        <div className="flex justify-center items-center gap-3 pb-4">
          <button className="btn-3d-brand px-5 py-2 text-body" onClick={startAttempt} data-testid="exam-retry-btn">
            <RotateCcw className="w-3.5 h-3.5 inline" />
            {t("exam.retryExam")}
          </button>
          {regenButton}
        </div>
      </div>
    );
  }

  return null;
}
