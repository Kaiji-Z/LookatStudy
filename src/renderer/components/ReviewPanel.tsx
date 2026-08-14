/**
 * ReviewPanel —— 章节式复习面板。
 *
 * 布局:
 *   - 交错复习按钮(随机抽逾期节点,打乱检索顺序巩固记忆)
 *   - 章节选择(有逾期项的章节 chips)
 *   - 选中章节的逾期课时列表,每行带"复习该课"按钮
 *
 * 复习流程:点"复习该课" → 跳到讲解 tab → 底部自评(SelfRatingCard) → SRS 更新。
 */
import { useState, useEffect, useMemo } from "react";
import { Shuffle } from "lucide-react";
import { api } from "../lib/api.js";
import { celebrate } from "../lib/celebration.js";
import type { ContentNode, Progress, ReviewQuality } from "@shared/types";
import { useLang } from "../lib/i18n.js";

interface ReviewPanelProps {
  tree: ContentNode[];
  onReviewNode: (nodeId: string) => void;
  progressMap: Record<string, Progress>;
}

interface SrsDetail {
  nodeId: string;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
  overdue: boolean;
}

export function ReviewPanel({ tree, onReviewNode, progressMap }: ReviewPanelProps) {
  const t = useLang();
  const [items, setItems] = useState<SrsDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  useEffect(() => {
    api.getAllSrsItems()
      .then((data) => setItems(data as SrsDetail[]))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const nodeMap = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree]);
  const overdueSet = useMemo(() => new Set(items.filter((i) => i.overdue).map((i) => i.nodeId)), [items]);

  // 所有已开始的课(in_progress / mastered)按章节分组——不限逾期,用户可自主选任何已学课复习
  const sectionsWithLessons = useMemo(() => {
    const started = tree.filter(
      (n) => {
        const status = progressMap[n.id]?.status;
        return (n.type === "lesson") && (status === "in_progress" || status === "mastered");
      },
    );
    const bySection = new Map<string, ContentNode[]>();
    for (const node of started) {
      const sectionId = node.parentId ?? "(root)";
      if (!bySection.has(sectionId)) bySection.set(sectionId, []);
      bySection.get(sectionId)!.push(node);
    }
    return bySection;
  }, [tree, progressMap]);

  const totalDue = useMemo(
    () => Array.from(sectionsWithLessons.values()).flat().filter((n) => overdueSet.has(n.id)).length,
    [sectionsWithLessons, overdueSet],
  );

  // 所有已开始的课时(交错复习用)
  const allStartedNodes = useMemo(
    () => Array.from(sectionsWithLessons.values()).flat(),
    [sectionsWithLessons],
  );

  // 自动选第一个有课的章节
  useEffect(() => {
    if (sectionsWithLessons.size > 0 && (!selectedSection || !sectionsWithLessons.has(selectedSection))) {
      const first = sectionsWithLessons.keys().next().value;
      if (first) setSelectedSection(first);
    }
  }, [sectionsWithLessons, selectedSection]);

  if (loading) {
    return (
      <div className="text-center py-12 text-body text-ink-muted flex items-center justify-center gap-2">
        <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
        {t("review.loading")}
      </div>
    );
  }

  if (allStartedNodes.length === 0) {
    return (
      <div className="text-center py-16" data-testid="review-empty">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-body text-ink-muted">{t("review.empty.title")}</div>
        <div className="text-label text-ink-faint mt-1">{t("review.empty.desc")}</div>
      </div>
    );
  }

  // 章节标题查找
  const sectionTitle = (sid: string) => nodeMap.get(sid)?.title ?? sid;

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

      {/* 交错复习:随机抽一个已开始的课(打乱检索顺序 = desirable difficulty) */}
      <button
        onClick={() => {
          const pick = allStartedNodes[Math.floor(Math.random() * allStartedNodes.length)];
          if (pick) onReviewNode(pick.id);
        }}
        data-testid="review-interleave"
        className="btn-3d-neutral w-full py-2.5 text-body mb-5 flex items-center justify-center gap-1.5"
      >
        <Shuffle className="w-4 h-4" />
        {t("review.interleave")}
      </button>

      {/* 章节选择 */}
      <div className="text-label font-bold text-ink-muted mb-2">{t("review.selectSection")}</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {Array.from(sectionsWithLessons.entries()).map(([sid, nodes]) => (
          <button
            key={sid}
            onClick={() => setSelectedSection(sid)}
            className={`px-2.5 py-1 rounded-full text-label font-bold transition-colors ${
              selectedSection === sid
                ? "bg-brand/15 text-brand ring-1 ring-brand/30"
                : "bg-surface-3 text-ink-muted hover:text-ink-strong"
            }`}
          >
            {sectionTitle(sid)}
            <span className="ml-1 opacity-60">({nodes.length})</span>
          </button>
        ))}
      </div>

      {/* 选中章节的已开始课时(逾期的高亮标记) */}
      {selectedSection && sectionsWithLessons.has(selectedSection) && (
        <div className="space-y-1.5" data-testid="review-lesson-list">
          {sectionsWithLessons.get(selectedSection)!.map((node) => {
            const isOverdue = overdueSet.has(node.id);
            return (
            <div
              key={node.id}
              className={`flex items-center justify-between gap-2 p-2.5 rounded-lg transition-colors ${isOverdue ? "bg-review/8 ring-1 ring-review/20" : "bg-surface-3 hover:bg-surface-3/80"}`}
            >
              <div className="flex items-center gap-1.5 truncate flex-1">
                {isOverdue && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-review" />}
                <span className="text-body text-ink-strong truncate">{node.title}</span>
              </div>
              <button
                onClick={() => onReviewNode(node.id)}
                data-testid={`review-lesson-${node.id.slice(0, 8)}`}
                className="shrink-0 px-3 py-1 rounded-lg bg-brand/15 text-brand text-label font-bold hover:bg-brand/25 transition-colors"
              >
                {t("review.reviewLesson")}
              </button>
            </div>
          );
          })}
        </div>
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
          className="py-2 rounded-lg border border-warning/40 text-warning hover:bg-warning/10 transition-colors disabled:opacity-40 flex flex-col items-center gap-0.5"
        >
          <span className="text-body font-bold">{t("review.selfrate.again")}</span>
          <span className="text-caption opacity-70">{t("review.selfrate.again.hint")}</span>
        </button>
        <button
          onClick={() => rate(4)}
          disabled={busy}
          data-testid="rate-remembered"
          className="py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 flex flex-col items-center gap-0.5"
        >
          <span className="text-body font-bold">{t("review.selfrate.remembered")}</span>
          <span className="text-caption opacity-70">{t("review.selfrate.remembered.hint")}</span>
        </button>
        <button
          onClick={() => rate(5)}
          disabled={busy}
          data-testid="rate-mastered"
          className="py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/10 transition-colors disabled:opacity-40 flex flex-col items-center gap-0.5"
        >
          <span className="text-body font-bold">{t("review.selfrate.mastered")}</span>
          <span className="text-caption opacity-70">{t("review.selfrate.mastered.hint")}</span>
        </button>
      </div>
    </div>
  );
}
