/**
 * NotebookPanel —— v0.3 黑板笔记本(替代 ArtifactPanel)。
 *
 * 三标签:
 *   - 讲解(默认):当前节点 markdown 内容
 *   - 笔记:当前节点的 AI 产物(canvas_items,持久化,可删可置顶)
 *   - 全部:跨节点时间线(翻整本笔记本)
 *
 * 核心隐喻:教室黑板 + 学习笔记本。AI 产物自动留存,可翻阅。
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { ContentNode, CanvasItem } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api.js";
import { ArtifactRenderer } from "./artifacts/index.js";
import { Pin, Trash, MapPin } from "lucide-react";

export type NotebookTab = "content" | "notes" | "all";

interface NotebookPanelProps {
  selectedNode: ContentNode | null;
  courseId: string | null;
  items: CanvasItem[];
  loading: boolean;
  forceTab?: NotebookTab | null;
  onUserTabChange: () => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** 选中文字后"提问这段"→ 插入聊天框(哪里不会点哪里) */
  onQuoteToChat?: (text: string) => void;
}

export function NotebookPanel({
  selectedNode,
  courseId,
  items,
  loading,
  forceTab,
  onUserTabChange,
  onRemove,
  onTogglePin,
  onQuoteToChat,
}: NotebookPanelProps) {
  const [internalTab, setInternalTab] = useState<NotebookTab>("content");
  const tab = forceTab ?? internalTab;

  const handleTabClick = (t: NotebookTab) => {
    setInternalTab(t);
    onUserTabChange?.();
  };

  // 当前节点的笔记数(用于 tab badge)
  const nodeItems = selectedNode
    ? items.filter((i) => i.nodeId === selectedNode.id)
    : [];

  return (
    <div
      className="h-full flex flex-col bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800/50"
      data-testid="notebook-panel"
    >
      {/* 标签栏 */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 shrink-0" data-testid="notebook-tabs">
        <TabBtn
          label="讲解"
          active={tab === "content"}
          onClick={() => handleTabClick("content")}
          testid="tab-content"
        />
        <TabBtn
          label="笔记"
          active={tab === "notes"}
          onClick={() => handleTabClick("notes")}
          testid="tab-notes"
          badge={nodeItems.length > 0 ? String(nodeItems.length) : undefined}
        />
        <TabBtn
          label="全部"
          active={tab === "all"}
          onClick={() => handleTabClick("all")}
          testid="tab-all"
          badge={items.length > 0 ? String(items.length) : undefined}
        />
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "content" ? (
          <ContentTab selectedNode={selectedNode} onQuoteToChat={onQuoteToChat} />
        ) : tab === "notes" ? (
          <NotesTab
            items={nodeItems}
            loading={loading}
            selectedNode={selectedNode}
            onRemove={onRemove}
            onTogglePin={onTogglePin}
          />
        ) : (
          <AllTab
            items={items}
            loading={loading}
            courseId={courseId}
            onRemove={onRemove}
            onTogglePin={onTogglePin}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- 讲解标签 ---------- */
function ContentTab({ selectedNode, onQuoteToChat }: { selectedNode: ContentNode | null; onQuoteToChat?: (text: string) => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 选区浮按钮:选中文字后显示,位置跟选区
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNode) {
      setContent(null);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.getNodeContent(selectedNode.id)
      .then((c) => { if (!cancelled) setContent(c); })
      .catch(() => { if (!cancelled) { setContent(null); setLoadError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNode?.id]);

  // 鼠标松开时检查选区(哪里不会点哪里)
  const handleMouseUp = useCallback(() => {
    if (!onQuoteToChat) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text.length < 2 || text.length > 500) {
      setQuoteBtn(null);
      return;
    }
    // 选区必须在 content 区域内
    const range = sel?.getRangeAt(0);
    if (!range || !contentRef.current?.contains(range.commonAncestorContainer)) {
      setQuoteBtn(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const containerRect = contentRef.current.getBoundingClientRect();
    setQuoteBtn({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      text,
    });
  }, [onQuoteToChat]);

  const handleQuoteClick = useCallback(() => {
    if (!quoteBtn || !onQuoteToChat) return;
    const truncated = quoteBtn.text.length > 200 ? quoteBtn.text.slice(0, 200) + "…" : quoteBtn.text;
    onQuoteToChat(`关于这段内容「${truncated}」,我不太懂,请帮我解释:`);
    setQuoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [quoteBtn, onQuoteToChat]);

  if (!selectedNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-sm text-neutral-600 dark:text-neutral-400 max-w-xs">
          从左侧地图选一个节点开始学习,讲解会显示在这里
        </div>
      </div>
    );
  }
  return (
    <div className="p-5 max-w-2xl mx-auto relative" data-testid="node-content" ref={contentRef} onMouseUp={handleMouseUp}>
      <div className="text-[10px] font-bold text-brand uppercase tracking-wider mb-1">
        {selectedNode.type === "section" ? "章节" : selectedNode.type === "concept" ? "概念" : "课时"}
      </div>
      <h2 className="text-xl font-extrabold mb-4 text-neutral-900 dark:text-neutral-100 tracking-tight">
        {selectedNode.title}
      </h2>
      {loading ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400 flex items-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />正在加载这一节的讲解…</div>
      ) : loadError ? (
        <div className="text-sm text-red-500 dark:text-red-400">
          ⚠️ 内容加载失败。<button className="underline ml-1" onClick={() => { setLoadError(false); setLoading(true); api.getNodeContent(selectedNode.id).then(setContent).catch(() => setLoadError(true)).finally(() => setLoading(false)); }}>重试</button>
        </div>
      ) : content ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-300 leading-relaxed select-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <div className="text-sm text-neutral-500 dark:text-neutral-500">
          这一节还没有讲解内容。问 AI 导师:「给我讲讲这一节」
        </div>
      )}
      {/* 哪里不会点哪里:选区浮按钮 */}
      {quoteBtn && (
        <button
          onClick={handleQuoteClick}
          data-testid="quote-to-chat-btn"
          style={{ left: quoteBtn.x, top: quoteBtn.y, transform: "translate(-50%, -100%)" }}
          className="absolute z-20 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold shadow-elevated flex items-center gap-1 hover:bg-brand-light transition-colors msg-enter"
        >
          💬 提问这段
        </button>
      )}
      {selectedNode.sourcePath && (
        <div className="mt-6 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-400 dark:text-neutral-600">
          来源:{selectedNode.sourcePath}
        </div>
      )}
      {/* 笔记提示 */}
      <div className="mt-4 p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-neutral-600 dark:text-neutral-400">
        💡 AI 生成的概念图、对比表、练习卡会自动保存到「笔记」标签,随时可翻阅
      </div>
    </div>
  );
}

/* ---------- 笔记标签(当前节点的产物) ---------- */
function NotesTab({
  items,
  loading,
  selectedNode,
  onRemove,
  onTogglePin,
}: {
  items: CanvasItem[];
  loading: boolean;
  selectedNode: ContentNode | null;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  if (!selectedNode) {
    return <EmptyNotebook message="选一个节点后,这里显示该节点的 AI 笔记" icon="📓" />;
  }
  if (loading) {
    return <div className="text-center py-12 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />正在整理这一节的 AI 笔记…</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyNotebook
        message="这一节还没有笔记。问 AI:「画个概念图」「出 3 道题」「做个对比表」"
        icon="🧩"
      />
    );
  }
  return (
    <div className="p-4 space-y-3 max-w-2xl mx-auto" data-testid="notes-list">
      {items.map((item) => (
        <CanvasItemCard
          key={item.id}
          item={item}
          onRemove={onRemove}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}

/* ---------- 全部标签(跨节点时间线) ---------- */
function AllTab({
  items,
  loading,
  courseId,
  onRemove,
  onTogglePin,
}: {
  items: CanvasItem[];
  loading: boolean;
  courseId: string | null;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [nodeTitles, setNodeTitles] = useState<Record<string, string>>({});

  // 拉所有节点标题(用于显示产物的归属节点)
  useEffect(() => {
    if (!courseId) return;
    api.getCourseTree(courseId).then((tree) => {
      const map: Record<string, string> = {};
      for (const n of tree) map[n.id] = n.title;
      setNodeTitles(map);
    }).catch(() => {});
  }, [courseId]);

  if (loading) {
    return <div className="text-center py-12 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />正在翻开你的笔记本…</div>;
  }
  if (items.length === 0) {
    return <EmptyNotebook message="笔记本还是空的。学习时 AI 生成的产物会自动保存到这里" icon="📓" />;
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl mx-auto" data-testid="all-notes-list">
      <div className="text-xs text-neutral-500 dark:text-neutral-500 mb-2">
        共 {items.length} 条笔记(置顶优先,按时间倒序)
      </div>
      {items.map((item) => (
        <CanvasItemCard
          key={item.id}
          item={item}
          nodeTitle={item.nodeId ? nodeTitles[item.nodeId] : null}
          onRemove={onRemove}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}

/* ---------- 单条笔记卡 ---------- */
function CanvasItemCard({
  item,
  nodeTitle,
  onRemove,
  onTogglePin,
}: {
  item: CanvasItem;
  nodeTitle?: string | null;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.data);
  } catch {
    parsed = null;
  }
  const created = new Date(item.createdAt);
  const timeStr = `${created.getMonth() + 1}/${created.getDate()} ${created.getHours().toString().padStart(2, "0")}:${created.getMinutes().toString().padStart(2, "0")}`;

  return (
    <div
      className={`surface-card p-3 relative ${item.pinned ? "border-brand/40 bg-brand/5" : ""}`}
      data-testid={`canvas-item-${item.id.slice(0, 8)}`}
    >
      {/* 卡顶:类型 + 标题 + 操作 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{ARTIFACT_ICON[item.artifactType] ?? "🧩"}</span>
        <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex-1 truncate">
          {item.title ?? ARTIFACT_LABEL[item.artifactType] ?? item.artifactType}
        </span>
        {item.pinned ? <span className="text-[10px] text-brand font-bold flex items-center gap-0.5"><Pin className="w-2.5 h-2.5" />已置顶</span> : null}
        <button
          onClick={() => onTogglePin(item.id)}
          className="text-[10px] text-neutral-400 hover:text-brand"
          data-testid={`canvas-pin-${item.id.slice(0, 8)}`}
          title={item.pinned ? "取消置顶" : "置顶"}
        >
          <Pin className="w-3 h-3" />
        </button>
        <button
          onClick={() => onRemove(item.id)}
          className="text-[10px] text-neutral-400 hover:text-red-500"
          data-testid={`canvas-delete-${item.id.slice(0, 8)}`}
          title="删除"
        >
          <Trash className="w-3 h-3" />
        </button>
      </div>

      {/* 归属节点(全部标签才显示) */}
      {nodeTitle && (
        <div className="text-[10px] text-neutral-400 dark:text-neutral-600 mb-1.5 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{nodeTitle}</div>
      )}

      {/* 产物内容 */}
      <div className="text-xs">
        {parsed ? <ArtifactRenderer data={parsed} /> : <div className="text-neutral-400">产物数据损坏</div>}
      </div>

      {/* 时间 */}
      <div className="text-[10px] text-neutral-400 dark:text-neutral-600 mt-2">{timeStr}</div>
    </div>
  );
}

function EmptyNotebook({ message, icon }: { message: string; icon: string }) {
  return (
    <div className="text-center py-16" data-testid="empty-notebook">
      <div className="text-4xl mb-3 opacity-30">{icon}</div>
      <div className="text-sm text-neutral-600 dark:text-neutral-400 max-w-xs mx-auto leading-relaxed">
        {message}
      </div>
    </div>
  );
}

function TabBtn({
  label,
  active,
  onClick,
  testid,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testid: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`flex-1 text-xs py-2 font-bold transition-colors duration-150 border-b-2 flex items-center justify-center gap-1.5 ${
        active
          ? "text-brand border-brand"
          : "text-neutral-500 dark:text-neutral-500 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300"
      }`}
    >
      <span>{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${active ? "bg-brand text-white" : "bg-neutral-200 dark:bg-neutral-800 text-neutral-500"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

const ARTIFACT_LABEL: Record<string, string> = {
  concept_map: "概念图",
  quiz: "练习题",
  compare_table: "对比表",
  diagram: "流程图",
  code_walkthrough: "代码讲解",
};
const ARTIFACT_ICON: Record<string, string> = {
  concept_map: "🗺️",
  quiz: "📝",
  compare_table: "📊",
  diagram: "📐",
  code_walkthrough: "🔍",
};
