/**
 * NotebookPanel —— v0.3 康奈尔式学习笔记本。
 *
 * 两标签:
 *   - 讲解(默认):当前节点 markdown 内容,选区可"提问这段"或"加到笔记"
 *   - 笔记:康奈尔笔记法三区
 *     · 🗺️ 理解区(线索区):AI 产物(概念图/对比表/流程图/代码讲解)—— 知识结构
 *     · ✏️ 记录区(笔记区):用户画线笔记(user_note,带溯源跳转)—— 个人内化
 *     · 📝 练习区(总结区):quiz 产物,可重做,显示上次答对/答错 —— 检验
 *
 * 砍掉了"全部"tab —— 笔记跟随节点,跨节点靠左侧地图切换。
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import type { ContentNode, CanvasItem, NoteSourceAnchor } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api.js";
import { applyPersistentMarksByText, flashMark, getTextModel, rangeToOffsets } from "../lib/highlightText.js";
import { ArtifactRenderer } from "./artifacts/index.js";
import { Pin, Trash, ChevronDown, Pencil, Check, X } from "lucide-react";

export type NotebookTab = "content" | "notes";

interface NotebookPanelProps {
  selectedNode: ContentNode | null;
  items: CanvasItem[];
  loading: boolean;
  forceTab?: NotebookTab | null;
  onUserTabChange: () => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** quiz 重做后更新 last_result */
  onRecordQuizResult: (id: string, correct: boolean) => void;
  /** 用户从讲解区画线加笔记 */
  onSaveContentNote: (text: string, anchor: NoteSourceAnchor) => void;
  /** 更新 user_note 的用户注释(空串=删除) */
  onUpdateNoteComment?: (id: string, comment: string) => void;
  /** 笔记卡溯源跳转:点击 → 切到讲解/对话定位高亮。noteText 用于消息内文字级定位,noteId 用于画线定位 */
  onJumpToSource?: (anchor: NoteSourceAnchor, noteText?: string, noteId?: string) => void;
  /** 选中文字后"提问这段"→ 插入聊天框(哪里不会点哪里) */
  onQuoteToChat?: (text: string) => void;
}

export function NotebookPanel({
  selectedNode,
  items,
  loading,
  forceTab,
  onUserTabChange,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onSaveContentNote,
  onUpdateNoteComment,
  onJumpToSource,
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
      className="h-full flex flex-col bg-surface-2"
      data-testid="notebook-panel"
    >
      {/* 标签栏:分段控件(segmented control)。
          设计意图:与中栏 ThreadSwitcher(会话流药丸行)刻意不同——
          这里是"固定 2 个视图切换",分段控件语义更准;会话流是动态可增删的列表,
          用药丸行。两种 tab 词汇通过形态明确区分各自场景。 */}
      <div className="flex items-center gap-1 px-3 py-2 shrink-0" data-testid="notebook-tabs">
        <div className="flex p-0.5 bg-neutral-100 dark:bg-neutral-900 rounded-lg gap-0.5">
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
        </div>
      </div>

      {/* 内容区:tab 切换时内容滑入(PROPERTY.md motion: 状态传达,150-250ms) */}
      <div className="flex-1 overflow-y-auto min-h-0 animate-tab-slide" key={tab}>
        {tab === "content" ? (
          <ContentTab
            selectedNode={selectedNode}
            contentNotes={nodeItems.filter(
              (i) => i.artifactType === "user_note" && i.sourceAnchor,
            )}
            onQuoteToChat={onQuoteToChat}
            onSaveContentNote={onSaveContentNote}
          />
        ) : (
          <NotesTab
            items={nodeItems}
            loading={loading}
            selectedNode={selectedNode}
            onRemove={onRemove}
            onTogglePin={onTogglePin}
            onRecordQuizResult={onRecordQuizResult}
            onUpdateNoteComment={onUpdateNoteComment}
            onJumpToSource={onJumpToSource}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- 讲解标签 ---------- */
function ContentTab({
  selectedNode,
  contentNotes,
  onQuoteToChat,
  onSaveContentNote,
}: {
  selectedNode: ContentNode | null;
  /** 该节点的 user_note(用于持久画线渲染) */
  contentNotes: CanvasItem[];
  onQuoteToChat?: (text: string) => void;
  onSaveContentNote: (text: string, anchor: NoteSourceAnchor) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 选区浮按钮:选中文字后显示。带 offsets(Range-based 偏移,精准)和 surroundingText(legacy 回退)
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; surrounding: string; offsets?: { start: number; end: number } } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null); // 整个讲解容器(标题+正文+提示)
  const proseRef = useRef<HTMLDivElement>(null); // 仅 Markdown 正文(offset 计算和画线基于此,避免标题/提示污染偏移)

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

  // 持久画线:content + contentNotes 都就绪后,按偏移在讲解区画 <mark>(像书上画线)
  // 用 setTimeout 等 ReactMarkdown 渲染完 DOM 再画
  useEffect(() => {
    if (!content || !contentRef.current) return;
    // v0.3.3:改用文本搜索方案(不依赖 DOM offset 稳定性)
    const notes: { noteId: string; text: string; surrounding?: string }[] = [];
    for (const item of contentNotes) {
      try {
        const anchor = JSON.parse(item.sourceAnchor!) as NoteSourceAnchor;
        if (anchor.type === "content") {
          const text = (JSON.parse(item.data) as { text?: string }).text ?? "";
          if (text) notes.push({ noteId: item.id, text, surrounding: anchor.surroundingText });
        }
      } catch {
        /* 跳过坏 anchor */
      }
    }
    const t = setTimeout(() => {
      if (proseRef.current) {
        applyPersistentMarksByText(proseRef.current, notes);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [content, contentNotes]);

  // 监听溯源跳转事件:按 noteId 找到对应画线 mark,scrollIntoView + 闪烁
  useEffect(() => {
    const handler = (e: Event) => {
      const noteId = (e as CustomEvent<string>).detail;
      if (!noteId) return;
      const mark = proseRef.current?.querySelector(`mark[data-note-id="${noteId}"]`) as HTMLElement | null;
      if (mark) flashMark(mark);
    };
    window.addEventListener("lookatstudy-jump-to-note", handler);
    return () => window.removeEventListener("lookatstudy-jump-to-note", handler);
  }, []);

  // 鼠标松开时检查选区(哪里不会点哪里 + 加到笔记)
  const handleMouseUp = useCallback(() => {
    if (!onQuoteToChat && !onSaveContentNote) return;
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
    // 用 Range-based 偏移(精准,不依赖 indexOf 文本匹配)。
    // 选区必须在 prose 正文容器内(避免选到标题/提示的偏移污染)
    const proseEl = proseRef.current;
    let offsets: { start: number; end: number } | null = null;
    if (proseEl && proseEl.contains(range.commonAncestorContainer)) {
      const model = getTextModel(proseEl);
      offsets = rangeToOffsets(range, model);
    }
    // surroundingText 作为 legacy 回退(旧笔记搜索用),用 model.text 取(已过滤空白)
    const modelText = proseEl ? getTextModel(proseEl).text : text;
    const startIdx = offsets ? offsets.start : modelText.indexOf(text);
    const surrounding = startIdx >= 0 ? modelText.slice(Math.max(0, startIdx - 30), startIdx + text.length + 30) : text;
    setQuoteBtn({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      text,
      surrounding,
      offsets: offsets ?? undefined,
    });
  }, [onQuoteToChat, onSaveContentNote]);

  const handleQuoteClick = useCallback(() => {
    if (!quoteBtn || !onQuoteToChat) return;
    const truncated = quoteBtn.text.length > 200 ? quoteBtn.text.slice(0, 200) + "…" : quoteBtn.text;
    onQuoteToChat(`关于这段内容「${truncated}」,我不太懂,请帮我解释:`);
    setQuoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [quoteBtn, onQuoteToChat]);

  const handleSaveNoteClick = useCallback(() => {
    if (!quoteBtn || !onSaveContentNote || !selectedNode) return;
    // 截断到 200 字(画线太长意义不大)
    const text = quoteBtn.text.length > 200 ? quoteBtn.text.slice(0, 200) + "…" : quoteBtn.text;
    // 用 mouseUp 时用 Range 算好的 offsets(精准,不依赖 indexOf)
    onSaveContentNote(text, {
      type: "content",
      surroundingText: quoteBtn.surrounding,
      startOffset: quoteBtn.offsets?.start,
      endOffset: quoteBtn.offsets?.end,
    });
    setQuoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [quoteBtn, onSaveContentNote, selectedNode]);

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
        <div className="text-sm text-warning">
          ⚠️ 内容加载失败。<button className="underline ml-1" onClick={() => { setLoadError(false); setLoading(true); api.getNodeContent(selectedNode.id).then(setContent).catch(() => setLoadError(true)).finally(() => setLoading(false)); }}>重试</button>
        </div>
      ) : content ? (
        <div ref={proseRef} className="prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-300 leading-relaxed select-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // 外链强制新窗口 → setWindowOpenHandler → 系统浏览器,
              // 防止点击讲解里的链接把 electron 主窗口导航成网页。
              a({ children, ...props }) {
                return (
                  <a {...props} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          这一节还没有讲解内容。问 AI 导师:「给我讲讲这一节」
        </div>
      )}
      {/* 选区浮按钮:提问 + 加到笔记 */}
      {quoteBtn && (
        <div
          style={{ left: quoteBtn.x, top: quoteBtn.y, transform: "translate(-50%, -100%)" }}
          className="absolute z-20 flex items-center gap-1 msg-enter"
        >
          {onQuoteToChat && (
            <button
              onClick={handleQuoteClick}
              data-testid="quote-to-chat-btn"
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold shadow-elevated flex items-center gap-1 hover:bg-brand-light transition-colors"
            >
              💬 提问
            </button>
          )}
          <button
            onClick={handleSaveNoteClick}
            data-testid="save-note-btn"
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold shadow-elevated flex items-center gap-1 hover:brightness-110 transition"
            title="把选中文字存到记录区,带溯源跳转"
          >
            ✏️ 加笔记
          </button>
        </div>
      )}
      {selectedNode.sourcePath && (
        <div className="mt-6 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-400 dark:text-neutral-600">
          来源:{selectedNode.sourcePath}
        </div>
      )}
      {/* 笔记提示 */}
      <div className="mt-4 p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-neutral-600 dark:text-neutral-400">
        💡 选中讲解文字可「✏️ 加笔记」;AI 生成的概念图/对比表/练习卡会自动进「笔记」标签
      </div>
    </div>
  );
}

/* ---------- 笔记标签(康奈尔笔记法三区) ---------- */
function NotesTab({
  items,
  loading,
  selectedNode,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onUpdateNoteComment,
  onJumpToSource,
}: {
  items: CanvasItem[];
  loading: boolean;
  selectedNode: ContentNode | null;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRecordQuizResult: (id: string, correct: boolean) => void;
  onUpdateNoteComment?: (id: string, comment: string) => void;
  onJumpToSource?: (anchor: NoteSourceAnchor) => void;
}) {
  if (!selectedNode) {
    return <EmptyNotebook message="选一个节点后,这里显示该节点的学习笔记" icon="📓" />;
  }
  if (loading) {
    return <div className="text-center py-12 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />正在整理这一节的笔记…</div>;
  }

  // 三区筛选
  const understandItems = items.filter((i) =>
    ["concept_map", "compare_table", "diagram", "code_walkthrough"].includes(i.artifactType),
  );
  const noteItems = items.filter((i) => i.artifactType === "user_note");
  const practiceItems = items.filter((i) => i.artifactType === "quiz");
  const total = items.length;
  // 练习统计:上次答对/答错/未做
  const correctCount = practiceItems.filter((i) => i.lastResult === "correct").length;
  const wrongCount = practiceItems.filter((i) => i.lastResult === "wrong").length;

  if (total === 0) {
    return (
      <EmptyNotebook
        message="这一节还没有笔记。选中讲解文字「✏️ 加笔记」,或问 AI「画个概念图」「出 3 道题」「做个对比表」"
        icon="🧩"
      />
    );
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl mx-auto" data-testid="notes-list">
      {/* 🗺️ 理解区(线索区) */}
      <ZoneSection
        title="理解"
        icon="🗺️"
        subtitle="AI 帮你梳理的知识结构"
        count={understandItems.length}
        testid="zone-understand"
        defaultOpen={false}
      >
        {understandItems.length === 0 ? (
          <ZoneEmpty hint="问 AI「画个概念图」「做个对比表」梳理这一节" />
        ) : (
          understandItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>

      {/* ✏️ 记录区(笔记区:user_note) */}
      <ZoneSection
        title="记录"
        icon="✏️"
        subtitle="你的画线,点击可跳回原位"
        count={noteItems.length}
        testid="zone-note"
        defaultOpen={false}
      >
        {noteItems.length === 0 ? (
          <ZoneEmpty hint="选中讲解或对话的文字,点「✏️ 加笔记」存到这里" />
        ) : (
          noteItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>

      {/* 📝 练习区(总结区) */}
      <ZoneSection
        title="练习"
        icon="📝"
        subtitle={
          practiceItems.length > 0
            ? `${practiceItems.length} 题 · 上次答对 ${correctCount} · 答错 ${wrongCount}`
            : "做题检验掌握,可重做"
        }
        count={practiceItems.length}
        testid="zone-practice"
        defaultOpen={false}
      >
        {practiceItems.length === 0 ? (
          <ZoneEmpty hint="问 AI「出 3 道题考考我」,题目会自动进这里" />
        ) : (
          practiceItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>
    </div>
  );
}

/** 可折叠的区域(三区共用) */
function ZoneSection({
  title,
  icon,
  subtitle,
  count,
  testid,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  subtitle: string;
  count: number;
  testid: string;
  /** 初始展开/折叠;默认展开。三区默认折叠以减少视觉噪音 */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 运行时内容新增 → 自动展开,让用户立刻看到刚加的笔记/产物。
  // 用 ref 跳过首次挂载(尊重 defaultOpen,不把历史已有内容误判为"新增")。
  const firstRun = useRef(true);
  const prevCount = useRef(count);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      prevCount.current = count;
      return;
    }
    if (count > prevCount.current) {
      setOpen(true);
    }
    prevCount.current = count;
  }, [count]);
  return (
    <section
      className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
      data-testid={testid}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-neutral-100 dark:bg-neutral-900/50 hover:bg-neutral-200/60 dark:hover:bg-neutral-900 transition-colors text-left"
        data-testid={`${testid}-toggle`}
      >
        <ChevronDown className={`w-4 h-4 text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ease-out-back ${open ? "" : "-rotate-90"}`} />
        <span className="text-sm">{icon}</span>
        <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{title}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand/15 text-brand">{count}</span>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 ml-auto truncate">{subtitle}</span>
      </button>
      {/*
        折叠用 grid-template-rows 0fr↔1fr 过渡(CSS 动画高度的标准技巧)。
        内容始终在 DOM(不像 {open && ...} 卸载),所以:
          - headless/隐藏 tab 也能读到内容(testid 不丢)
          - 折叠/展开是平滑过渡而非瞬时显隐
        impeccable 规则:reveal 动画必须增强"已可见的默认",不能 gate 内容可见性。
      */}
      <div
        className="grid transition-all duration-200 ease-out-expo"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="p-3 space-y-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ZoneEmpty({ hint }: { hint: string }) {
  return (
    <div className="text-center py-3 text-xs text-neutral-400 dark:text-neutral-600">{hint}</div>
  );
}

/* ---------- 单条笔记卡 ---------- */
function CanvasItemCard({
  item,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onUpdateNoteComment,
  onJumpToSource,
}: {
  item: CanvasItem;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRecordQuizResult: (id: string, correct: boolean) => void;
  onUpdateNoteComment?: (id: string, comment: string) => void;
  onJumpToSource?: (anchor: NoteSourceAnchor, noteText?: string, noteId?: string) => void;
}) {
  // user_note 注释编辑态(本地 state,保存/取消即退出)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.notes ?? "");
  // quiz 产物答题 → 触发 mastery 更新 + 记录 last_result
  const handleQuizAnswered = useCallback(
    (_q: { prompt: string }, _idx: number, correct: boolean) => {
      if (item.nodeId) {
        api.recordQuizAnswer(item.nodeId, correct).catch(() => {});
      }
      onRecordQuizResult(item.id, correct);
    },
    [item.nodeId, item.id, onRecordQuizResult],
  );

  // 解析 user_note 的文字 + 溯源锚点
  const isUserNote = item.artifactType === "user_note";
  let noteText = "";
  let noteAnchor: NoteSourceAnchor | null = null;
  if (isUserNote) {
    try {
      noteText = (JSON.parse(item.data) as { text?: string }).text ?? "";
    } catch {
      noteText = item.title ?? "";
    }
    try {
      if (item.sourceAnchor) {
        const a = JSON.parse(item.sourceAnchor) as NoteSourceAnchor;
        noteAnchor = a;
      }
    } catch {
      noteAnchor = null;
    }
  }

  // 解析 AI 产物数据
  let parsed: unknown = null;
  if (!isUserNote) {
    try {
      parsed = JSON.parse(item.data);
    } catch {
      parsed = null;
    }
  }
  const created = new Date(item.createdAt);
  const timeStr = `${created.getMonth() + 1}/${created.getDate()} ${created.getHours().toString().padStart(2, "0")}:${created.getMinutes().toString().padStart(2, "0")}`;

  // user_note 卡:画线 + 溯源跳转 + 用户注释
  if (isUserNote) {
    const existingComment = item.notes && item.notes.trim().length > 0 ? item.notes : null;
    const handleStartEdit = () => {
      setDraft(existingComment ?? "");
      setEditing(true);
    };
    const handleCancelEdit = () => {
      setDraft(existingComment ?? "");
      setEditing(false);
    };
    const handleSaveComment = () => {
      onUpdateNoteComment?.(item.id, draft);
      setEditing(false);
    };
    return (
      <div
        className={`surface-card p-3 relative ${item.pinned ? "border-brand/40 bg-brand/5" : ""}`}
        data-testid={`canvas-item-${item.id.slice(0, 8)}`}
      >
        <div className="flex items-start gap-2">
          <span className="text-accent text-sm shrink-0 mt-0.5">❝</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap">
              {noteText}
            </div>
            {/* 用户注释:已有 → 显示引用块 + 编辑;编辑态 → textarea */}
            {onUpdateNoteComment && editing ? (
              <div className="mt-2 space-y-1.5" data-testid={`note-comment-edit-${item.id.slice(0, 8)}`}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder={
                    existingComment
                      ? "编辑注释…(清空保存即可删除)"
                      : "写下你对这段画线的注释…"
                  }
                  className="w-full text-[11px] leading-relaxed p-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 resize-none focus:outline-none focus:border-brand"
                  data-testid={`note-comment-textarea-${item.id.slice(0, 8)}`}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveComment}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-brand hover:bg-brand/90 px-2 py-0.5 rounded"
                    data-testid={`note-comment-save-${item.id.slice(0, 8)}`}
                  >
                    <Check className="w-3 h-3" /> 保存
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="inline-flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                    data-testid={`note-comment-cancel-${item.id.slice(0, 8)}`}
                  >
                    <X className="w-3 h-3" /> 取消
                  </button>
                </div>
              </div>
            ) : existingComment ? (
              <div className="mt-2 pl-2 border-l-2 border-accent/40">
                <div className="text-[11px] text-neutral-600 dark:text-neutral-400 italic leading-relaxed whitespace-pre-wrap">
                  {existingComment}
                </div>
                {onUpdateNoteComment && (
                  <button
                    onClick={handleStartEdit}
                    className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-accent"
                    data-testid={`note-comment-edit-btn-${item.id.slice(0, 8)}`}
                    title="编辑注释"
                  >
                    <Pencil className="w-2.5 h-2.5" /> 编辑注释
                  </button>
                )}
              </div>
            ) : onUpdateNoteComment ? (
              <button
                onClick={handleStartEdit}
                className="mt-2 inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-accent"
                data-testid={`note-comment-add-${item.id.slice(0, 8)}`}
                title="加注释"
              >
                <Pencil className="w-2.5 h-2.5" /> 加注释
              </button>
            ) : null}
            {/* 溯源跳转 */}
            {noteAnchor && onJumpToSource && (
              <button
                onClick={() => onJumpToSource(noteAnchor!, noteText, item.id)}
                className="mt-2 inline-flex items-center gap-1 text-[10px] text-accent hover:underline font-bold"
                data-testid={`note-source-${item.id.slice(0, 8)}`}
              >
                {noteAnchor.type === "content" ? "📖 跳到讲解原位" : "💬 跳到对话原位"}
              </button>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-neutral-400 dark:text-neutral-600">{timeStr}</span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-[10px] text-neutral-400 hover:text-warning"
                data-testid={`canvas-delete-${item.id.slice(0, 8)}`}
                title="删除"
              >
                <Trash className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // AI 产物卡(理解区 / 练习区)
  return (
    <div
      className={`surface-card p-3 relative ${item.pinned ? "border-brand/40 bg-brand/5" : ""}`}
      data-testid={`canvas-item-${item.id.slice(0, 8)}`}
    >
      {/* 卡顶:类型 + 标题 + last_result 徽章 + 操作 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{ARTIFACT_ICON[item.artifactType] ?? "🧩"}</span>
        <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex-1 truncate">
          {item.title ?? ARTIFACT_LABEL[item.artifactType] ?? item.artifactType}
        </span>
        {/* quiz 上次结果徽章 */}
        {item.artifactType === "quiz" && item.lastResult && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${item.lastResult === "correct" ? "bg-brand/15 text-brand" : "bg-warning/15 text-warning"}`}
            data-testid={`quiz-result-${item.id.slice(0, 8)}`}
          >
            {item.lastResult === "correct" ? "✅ 上次答对" : "❌ 上次答错"}
          </span>
        )}
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
          className="text-[10px] text-neutral-400 hover:text-warning"
          data-testid={`canvas-delete-${item.id.slice(0, 8)}`}
          title="删除"
        >
          <Trash className="w-3 h-3" />
        </button>
      </div>

      {/* 产物内容 */}
      <div className="text-xs">
        {parsed ? <ArtifactRenderer data={parsed} onQuizAnswered={handleQuizAnswered} /> : <div className="text-neutral-400">产物数据损坏</div>}
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
      className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all duration-150 ${
        active
          ? "bg-white dark:bg-neutral-950 text-brand shadow-sm"
          : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      <span>{label}</span>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
          active ? "bg-brand/15 text-brand" : "bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
        }`}>
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
