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
import { api } from "../lib/api.js";
import type { ContentNode, ReviewQuality } from "@shared/types";

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

export function ReviewPanel({ tree, onReviewNode }: ReviewPanelProps) {
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
    return <div className="text-center py-12 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />正在检查哪些课该复习了…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16" data-testid="review-empty">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-sm text-neutral-500 dark:text-neutral-400">还没有复习项</div>
        <div className="text-[11px] text-neutral-400 mt-1">完成一些练习后,这里会出现间隔复习提醒</div>
      </div>
    );
  }

  return (
    <div className="p-5 max-w-2xl mx-auto" data-testid="review-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-extrabold text-neutral-900 dark:text-neutral-100">复习</h2>
        {totalDue > 0 && (
          <span className="text-xs font-bold text-review" data-testid="review-due-count">
            {totalDue} 个待复习
          </span>
        )}
      </div>

      {/* 开始复习按钮 */}
      {totalDue > 0 && (
        <button
          onClick={() => groups.overdue[0] && onReviewNode(groups.overdue[0].nodeId)}
          data-testid="review-start"
          className="btn-3d-brand w-full py-2.5 text-sm mb-5"
        >
          开始复习({sessionCount}/{MAX_SESSION}) →
        </button>
      )}

      {/* 四象限网格 */}
      <div className="grid grid-cols-2 gap-3">
        <Quadrant
          title="逾期"
          icon="🔴"
          accent="orange"
          count={groups.overdue.length}
          nodes={groups.overdue.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-overdue"
        />
        <Quadrant
          title="短期"
          icon="🟡"
          accent="gold"
          count={groups.shortTerm.length}
          nodes={groups.shortTerm.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-short"
        />
        <Quadrant
          title="长期"
          icon="🟢"
          accent="brand"
          count={groups.longTerm.length}
          nodes={groups.longTerm.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-long"
        />
        <Quadrant
          title="待激活"
          icon="⚪"
          accent="neutral"
          count={groups.inactive.length}
          nodes={groups.inactive.map((i) => tree.find((n) => n.id === i.nodeId)!).filter(Boolean)}
          onItemClick={onReviewNode}
          testid="quadrant-inactive"
        />
      </div>

      <div className="mt-5 text-[11px] text-neutral-400 dark:text-neutral-600 leading-relaxed">
        💡 复习采用 SM-2 间隔重复算法。逾期项优先复习;长期记忆项间隔更长。
        单次复习封顶 {MAX_SESSION} 题,避免积压压垮节奏。
      </div>
    </div>
  );
}

function Quadrant({
  title,
  icon,
  accent,
  count,
  nodes,
  onItemClick,
  testid,
}: {
  title: string;
  icon: string;
  accent: "orange" | "gold" | "brand" | "neutral";
  count: number;
  nodes: ContentNode[];
  onItemClick: (id: string) => void;
  testid: string;
}) {
  const accentClass = {
    orange: "border-review/30 bg-review/5",
    gold: "border-gold/30 bg-gold/5",
    brand: "border-brand/30 bg-brand/5",
    neutral: "border-neutral-200 dark:border-neutral-800",
  }[accent];

  return (
    <div className={`rounded-xl border p-3 ${accentClass}`} data-testid={testid}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1">
          <span>{icon}</span>
          <span>{title}</span>
        </span>
        <span className="text-xs font-extrabold text-neutral-500 dark:text-neutral-400 tabular-nums">{count}</span>
      </div>
      {count === 0 ? (
        <div className="text-[11px] text-neutral-400 py-2 text-center">—</div>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {nodes.slice(0, 8).map((node) => (
            <li key={node.id}>
              <button
                onClick={() => onItemClick(node.id)}
                data-testid={`review-node-${node.id.slice(0, 8)}`}
                className="w-full text-left text-[11px] px-2 py-1 rounded text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200 truncate transition-colors"
                title={node.title}
              >
                {node.title}
              </button>
            </li>
          ))}
          {count > 8 && (
            <li className="text-[10px] text-neutral-400 px-2">+{count - 8} 更多</li>
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
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const rate = async (quality: ReviewQuality) => {
    if (busy || done) return;
    setBusy(true);
    try {
      await api.recordReview(nodeId, quality);
      setDone(true);
      onRated?.();
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="text-center text-xs text-brand py-2" data-testid="self-rated">
        ✓ 已记录,掌握度已更新
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 mt-3" data-testid="self-rating">
      <div className="text-[10px] font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2 text-center">
        复习完了吗?给自己打分
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => rate(1)}
          disabled={busy}
          data-testid="rate-again"
          className="text-[11px] py-2 rounded-lg border border-warning/40 text-warning hover:bg-warning/10 transition-colors disabled:opacity-40"
        >
          再来一次
        </button>
        <button
          onClick={() => rate(4)}
          disabled={busy}
          data-testid="rate-remembered"
          className="text-[11px] py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
        >
          记住了
        </button>
        <button
          onClick={() => rate(5)}
          disabled={busy}
          data-testid="rate-mastered"
          className="text-[11px] py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/10 transition-colors disabled:opacity-40"
        >
          完全掌握
        </button>
      </div>
    </div>
  );
}
