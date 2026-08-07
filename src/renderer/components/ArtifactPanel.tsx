/**
 * ArtifactPanel —— v0.2 右栏产物面板(M1)。
 *
 * 三标签:内容(默认) / 产物 / 复习。
 *   - 内容:当前节点的 markdown 讲解
 *   - 产物:AI 调用展示型 tool 时,产物出现在这里(M2 完善,M1 先做容器)
 *   - 复习:点导航复习时切换(M3 完善,M1 先做占位)
 *
 * 这是 Generative UI 的"工作台"。产物随上下文动态切换。
 */
import { useState, useEffect } from "react";
import type { ContentNode } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api.js";

export type ArtifactTab = "content" | "artifact" | "review";

interface ArtifactPanelProps {
  selectedNode: ContentNode | null;
  /** AI 当前产出的产物(M2 起 Generative UI 填充,M1 为 null) */
  artifact?: React.ReactNode | null;
  /** 是否有复习任务(M3 起填充) */
  reviewContent?: React.ReactNode | null;
  /** 强制切到某个 tab(如导航复习入口 → review) */
  forceTab?: ArtifactTab | null;
  /** 用户主动点 tab 时触发(父级应清除 forceTab 让用户夺回控制权) */
  onUserTabChange?: (tab: ArtifactTab) => void;
}

export function ArtifactPanel({
  selectedNode,
  artifact,
  reviewContent,
  forceTab,
  onUserTabChange,
}: ArtifactPanelProps) {
  const [internalTab, setInternalTab] = useState<ArtifactTab>("content");
  const tab = forceTab ?? internalTab;

  // 用户主动点 tab:同时更新 internalTab + 通知父级清除 forceTab(让用户夺回控制权)
  const handleTabClick = (t: ArtifactTab) => {
    setInternalTab(t);
    onUserTabChange?.(t);
  };

  return (
    <div
      className="h-full flex flex-col bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800/50"
      data-testid="artifact-panel"
    >
      {/* 标签栏 */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 shrink-0" data-testid="artifact-tabs">
        <TabBtn
          label="内容"
          active={tab === "content"}
          onClick={() => handleTabClick("content")}
          testid="tab-content"
        />
        <TabBtn
          label="产物"
          active={tab === "artifact"}
          onClick={() => handleTabClick("artifact")}
          testid="tab-artifact"
          badge={artifact ? "·" : undefined}
        />
        <TabBtn
          label="复习"
          active={tab === "review"}
          onClick={() => handleTabClick("review")}
          testid="tab-review"
        />
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "content" ? (
          <ContentTab selectedNode={selectedNode} />
        ) : tab === "artifact" ? (
          <div className="p-4" data-testid="artifact-content">
            {artifact ?? <EmptyArtifact />}
          </div>
        ) : (
          <div className="p-4" data-testid="review-content">
            {reviewContent ?? <EmptyReview />}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentTab({ selectedNode }: { selectedNode: ContentNode | null }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedNode) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.getNodeContent(selectedNode.id)
      .then((c) => { if (!cancelled) setContent(c); })
      .catch(() => { if (!cancelled) setContent(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNode?.id]);

  if (!selectedNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-sm text-neutral-600 dark:text-neutral-400 max-w-xs">
          从左侧路径选一个节点开始学习,讲解会显示在这里
        </div>
      </div>
    );
  }
  return (
    <div className="p-5 max-w-2xl mx-auto" data-testid="node-content">
      <div className="text-[10px] font-bold text-brand uppercase tracking-wider mb-1">
        {selectedNode.type === "section" ? "章节" : selectedNode.type === "concept" ? "概念" : "课时"}
      </div>
      <h2 className="text-xl font-extrabold mb-4 text-neutral-900 dark:text-neutral-100 tracking-tight">
        {selectedNode.title}
      </h2>
      {loading ? (
        <div className="text-sm text-neutral-400 dark:text-neutral-600">加载内容中…</div>
      ) : content ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-300 leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <div className="text-sm text-neutral-600 dark:text-neutral-400">
          这一节还没有讲解内容。问 AI 导师:「给我讲讲这一节」
        </div>
      )}
      {selectedNode.sourcePath && (
        <div className="mt-6 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-400 dark:text-neutral-600">
          来源:{selectedNode.sourcePath}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  active,
  onClick,
  testid,
  disabled,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testid: string;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`flex-1 text-xs py-2 font-bold transition-colors duration-150 border-b-2 ${
        active
          ? "text-brand border-brand"
          : disabled
            ? "text-neutral-300 dark:text-neutral-700 border-transparent cursor-not-allowed"
            : "text-neutral-600 dark:text-neutral-400 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300"
      }`}
    >
      {label}
      {badge && <span className="ml-1 text-brand">{badge}</span>}
    </button>
  );
}

function EmptyArtifact() {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3 opacity-30">🧩</div>
      <div className="text-sm text-neutral-600 dark:text-neutral-400 max-w-xs mx-auto">
        AI 导师可以生成概念图、对比表、练习卡等产物,出现在这里
      </div>
      <div className="text-[11px] text-neutral-400 dark:text-neutral-600 mt-2">
        试试问:「画个概念图」「出 3 道题」
      </div>
    </div>
  );
}

function EmptyReview() {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3 opacity-30">📖</div>
      <div className="text-sm text-neutral-600 dark:text-neutral-400">暂无待复习内容</div>
    </div>
  );
}
