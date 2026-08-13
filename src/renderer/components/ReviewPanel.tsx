/**
 * ReviewPanel —— v0.2 四象限复习面板(M3)。
 *
 * 调研结论(olgaskuja SRS 平台案例):
 *   - 首页按 overdue / 短期 / 长期 / inactive 四组分组,overdue 显著突出
 *   - 颜色语义:overdue 用橙红(警告),其他用中性
 *   - 单次 session 封顶 10 题,防积压劝退
 *
 * 复习流程:点节点 → 跳到 tree 视图 + 选中该节点 + 切到内容标签。
 * 用户在内容标签看完后,用右下角的自评按钮(recordReview)打分。
 */
import { useState, useEffect, useMemo } from "react";
import { Circle, Shuffle } from "lucide-react";
import { api } from "../lib/api.js";
import { celebrate } from "../lib/celebration.js";
import type { ContentNode, ReviewQuality } from "@shared/types";
import { useLang } from "../lib/i18n.js";

const MAX_SESSION = 10; // 单次复习封顶(防积压劝退)

interface ReviewPanelProps {
  tree: ContentNode[];
  onReviewNode: (nodeId: string) => void;
}

interface SrsDetail {
  nodeId: string;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
  overdue: boolean;
}

type Accent = "orange" | "gold" | "brand" | "neutral";

export function ReviewPanel({ tree, onReviewNode }: ReviewPanelProps) {
  const t = useLang();
  const [items, setItems] = useState<SrsDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAllSrsItems()
      .then((data) => setItems(data as SrsDetail[]))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // 四象限分组
  const groups = useMemo(() => {
    const nodeMap = new Map(tree.map((n) => [n.id, n]));
    const valid = items.filter((it) => nodeMap.has(it.nodeId));
    return {
      overdue: valid.filter((i) => i.overdue),
      shortTerm: valid.filter((i) => !i.overdue && i.intervalDays > 0 && i.intervalDays <= 7),
      longTerm: valid.filter((i) => !i.overdue && i.intervalDays > 7),
      inactive: valid.filter((i) => i.repetitions === 0 && !i.overdue),
    };
  }, [items, tree]);

  const totalDue = groups.overdue.length;
  const sessionCount = Math.min(totalDue, MAX_SESSION);

  if (loading) {
    return (
      <div className="text-center py-12 text-body text-ink-muted flex items-center justify-center gap-2">
        <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
        {t("review.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16" data-testid="review-empty">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-body text-ink-muted">{t("review.empty.title")}</div>
        <div className="text-label text-ink-faint mt-1">{t("review.empty.desc")}</div>
      </div>
    );
  }

  return (
    <div className="p-5 max-w-2xl mx-auto" data-testid="review-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-title font-extrabold text-ink-strong">{t("review.title")}</h2>
        {totalDue > 0 && (
          <span className="text-label font-bold text-review" data-testid="review-due-count">
            {totalDue} {t("review.due.count")}
          </span>
        )}
      </div>

      {/* 开始复习按钮 */}
      {totalDue > 0 && (
        <button
          onClick={() => groups.overdue[0] && onReviewNode(groups.overdue[0].nodeId)}
          data-testid="review-start"
          className="btn-3d-brand w-full py-2.5 text-body mb-5"
        >
          {t("review.start")}({sessionCount}/{MAX_SESSION}) →
        </button>
      )}

      {/* 混合练习(交错复习):随机抽一个待复习节点——随机化检索顺序是 desirable difficulty,
          区别于默认顺序复习。(完整自动推进 session 留作后续增强。) */}
      {totalDue > 0 && (
        <button
          onClick={() => {
            const pool = groups.overdue;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            if (pick) onReviewNode(pick.nodeId);
          }}
          data-testid="review-shuffle"
          className="btn-3d-neutral w-full py-2 text-label mb-5 flex items-center justify-center gap-1.5"
        >
          <Shuffle className="w-3.5 h-3.5" />
          {t("review.shuffle")}
        </button>
      )}

      {/* 四象限网格 */}
      <div className="grid grid-cols-2 gap-3">
        <Quadrant
          title={t("review.quadrant.overdue")}
          accent="orange"
          count={groups.overdue.length}
          nodes={groups.overdue.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-overdue"
        />
        <Quadrant
          title={t("review.quadrant.short")}
          accent="gold"
          count={groups.shortTerm.length}
          nodes={groups.shortTerm.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-short"
        />
        <Quadrant
          title={t("review.quadrant.long")}
          accent="brand"
          count={groups.longTerm.length}
          nodes={groups.longTerm.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-long"
        />
        <Quadrant
          title={t("review.quadrant.inactive")}
          accent="neutral"
          count={groups.inactive.length}
          nodes={groups.inactive.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-inactive"
        />
      </div>

      <div className="mt-5 text-label text-ink-faint leading-relaxed">
        {t("review.tip", { n: MAX_SESSION })}
      </div>
    </div>
  );
}

const ACCENT_BORDER: Record<Accent, string> = {
  orange: "border-review/30 bg-review/5",
  gold: "border-gold/30 bg-gold/5",
  brand: "border-brand/30 bg-brand/5",
  neutral: "border-[var(--border-faint)]",
};
const ACCENT_DOT: Record<Accent, string> = {
  orange: "text-review",
  gold: "text-gold",
  brand: "text-brand",
  neutral: "text-ink-muted",
};

function Quadrant({
  title,
  accent,
  count,
  nodes,
  onItemClick,
  testid,
}: {
  title: string;
  accent: Accent;
  count: number;
  nodes: ContentNode[];
  onItemClick: (id: string) => void;
  testid: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${ACCENT_BORDER[accent]}`} data-testid={testid}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-label font-bold text-ink-muted flex items-center gap-1">
          <Circle className={`w-2.5 h-2.5 ${ACCENT_DOT[accent]}`} fill="currentColor" aria-hidden="true" />
          <span>{title}</span>
        </span>
        <span className="text-label font-extrabold text-ink-muted tabular-nums">{count}</span>
      </div>
      {count === 0 ? (
        <div className="text-label text-ink-faint py-2 text-center">—</div>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {nodes.slice(0, 8).map((node) => (
            <li key={node.id}>
              <button
                onClick={() => onItemClick(node.id)}
                data-testid={`review-node-${node.id.slice(0, 8)}`}
                className="w-full text-left text-label px-2 py-1 rounded text-ink-muted hover:bg-surface-3 hover:text-ink-strong truncate transition-colors"
                title={node.title}
              >
                {node.title}
              </button>
            </li>
          ))}
          {count > 8 && (
            <li className="text-caption text-ink-faint px-2">+{count - 8}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 自评卡(复习时打分用)。三档简化版(Memrise 风格):
 * 再来一次(quality 1)/ 记住了(quality 4)/ 完全掌握(quality 5)
 */
export function SelfRatingCard({
  nodeId,
  onRated,
}: {
  nodeId: string;
  onRated?: () => void;
}) {
  const t = useLang();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const rate = async (quality: ReviewQuality) => {
    if (busy || done) return;
    setBusy(true);
    try {
      await api.recordReview(nodeId, quality);
      setDone(true);
      onRated?.();
      // Phase 1: SRS 自评高光 — remembered/mastered(quality≥4)答对爆发,again(≤1)柔红闪。
      celebrate(quality >= 4 ? "correct" : "wrong");
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="text-center text-body text-brand py-2" data-testid="self-rated">
        {t("review.selfrated")}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border-faint)] pt-3 mt-3" data-testid="self-rating">
      <div className="text-caption font-bold text-ink-muted uppercase tracking-wider mb-2 text-center">
        {t("review.selfrate.title")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => rate(1)}
          disabled={busy}
          data-testid="rate-again"
          className="text-label py-2 rounded-lg border border-warning/40 text-warning hover:bg-warning/10 transition-colors disabled:opacity-40"
        >
          {t("review.selfrate.again")}
        </button>
        <button
          onClick={() => rate(4)}
          disabled={busy}
          data-testid="rate-remembered"
          className="text-label py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
        >
          {t("review.selfrate.remembered")}
        </button>
        <button
          onClick={() => rate(5)}
          disabled={busy}
          data-testid="rate-mastered"
          className="text-label py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/10 transition-colors disabled:opacity-40"
        >
          {t("review.selfrate.mastered")}
        </button>
      </div>
    </div>
  );
}
