/**
 * ContextMeter —— 输入框的上下文用量表(v0.10)。
 *
 * 环形指示(14px SVG 环)+ 百分比数字;点击弹明细面板:五段条形图
 * (系统提示/课文/学习者状态/对话历史/草稿)+ 各段估算 token + 模型窗口。
 * 数据 = main 的固定开销(agent:getContextUsage,与实发同源) + 渲染层本地
 * 叠加的历史与草稿估算 → 边打字边动,不打字不打 IPC。
 *
 * 颜色语义(Full palette 数据可视化):accent=系统 / brand=课文 / gold=学习者
 * / ink=历史(中性)/ exam=草稿(待发送的"第六色")。≥85% 变 warning 提示将满。
 */
import { useEffect, useRef, useState } from "react";
import type { ContextUsageInfo } from "@shared/types";
import { contextPercent, formatTokenCount, segmentPercents } from "@shared/token-estimate";
import { useLang } from "../lib/i18n.js";

interface ContextMeterProps {
  info: ContextUsageInfo | null;
  /** 当前 thread 全部消息的估算 token(App useMemo 算好传入) */
  historyTokens: number;
  /** 输入框草稿的估算 token(Composer 本地算) */
  draftTokens: number;
}

/** 环几何:14px viewBox,2px 描边。 */
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 面板图例行定义(顺序=条形图段序)。 */
const SEGMENT_KEYS = ["system", "node", "learner", "history", "draft"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENT_BG: Record<SegmentKey, string> = {
  system: "bg-accent",
  node: "bg-brand",
  learner: "bg-gold",
  history: "bg-ink/50",
  draft: "bg-exam",
};

export function ContextMeter({ info, historyTokens, draftTokens }: ContextMeterProps) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // 窗口未知时不开面板(没有占比可讲)
  useEffect(() => {
    if (!info?.contextWindow && open) setOpen(false);
  }, [info?.contextWindow, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) !== true) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!info) return null;
  const segments: Record<SegmentKey, number> = {
    system: info.systemTokens,
    node: info.nodeTokens,
    learner: info.learnerTokens,
    history: historyTokens,
    draft: draftTokens,
  };
  const used = SEGMENT_KEYS.reduce((sum, k) => sum + segments[k], 0);
  const percent = contextPercent(used, info.contextWindow);
  const nearFull = percent !== null && percent >= 85;
  const widths = segmentPercents(
    SEGMENT_KEYS.map((k) => segments[k]),
    percent ?? 0,
  );

  return (
    <span ref={rootRef} className="relative inline-flex items-center" data-testid="composer-context">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={info.contextWindow === null}
        aria-label={t("context.aria", { p: percent !== null ? `${percent}%` : formatTokenCount(used) })}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="composer-context-trigger"
        data-tooltip={
          info.contextWindow === null
            ? `${t("context.label")} ~${formatTokenCount(used)} · ${t("context.unknownWindow")}`
            : t("context.aria", { p: `${percent}%` })
        }
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-caption font-medium transition-colors ${
          nearFull ? "text-warning" : "text-ink-muted"
        } hover:bg-ink/[0.06] disabled:hover:bg-transparent`}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden className="shrink-0">
          <circle cx="7" cy="7" r={RADIUS} fill="none" strokeWidth="2" className="stroke-ink/20" />
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeDasharray={`${(CIRCUMFERENCE * (percent ?? 100)) / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
        {percent !== null ? (
          <span className="tb-label">{percent}%</span>
        ) : (
          <span className="tb-label">~{formatTokenCount(used)}</span>
        )}
      </button>

      {open && info.contextWindow !== null && (
        <div
          role="dialog"
          aria-label={t("context.label")}
          data-testid="composer-context-panel"
          className="absolute bottom-full right-0 mb-1.5 z-50 w-64 bg-surface-0 rounded-xl shadow-elevated border border-[var(--border)] p-3"
        >
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-label font-bold text-ink-strong">{t("context.label")}</span>
            <span className={`text-caption ${nearFull ? "text-warning" : "text-ink-muted"}`}>
              {t("context.approx")} {formatTokenCount(used)} / {formatTokenCount(info.contextWindow)}
            </span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-ink/10 mb-2" role="img" aria-label={`${percent}%`}>
            {SEGMENT_KEYS.map((k) =>
              widths[SEGMENT_KEYS.indexOf(k)] > 0 ? (
                <div
                  key={k}
                  className={SEGMENT_BG[k]}
                  style={{ width: `${widths[SEGMENT_KEYS.indexOf(k)]}%` }}
                />
              ) : null,
            )}
          </div>
          <dl className="space-y-1">
            {SEGMENT_KEYS.map((k) => (
              <div key={k} className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <span className={`w-2 h-2 rounded-sm ${SEGMENT_BG[k]}`} aria-hidden />
                  {t(`context.${k}`)}
                </dt>
                <dd className="text-caption text-ink-strong tabular-nums">~{formatTokenCount(segments[k])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </span>
  );
}
