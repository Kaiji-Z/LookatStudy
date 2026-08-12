/**
 * ChatStream —— v0.2 中栏 AI 对话流(M1)。
 *
 * 重构自 ChatPanel 的消息渲染。核心变化:
 *   - parts-based 渲染(替代字符串拼接)。每条消息是 ChatMessagePart[] 数组。
 *   - 扁平全宽消息(非 SMS 气泡)——遵循 Setproduct 反模式禁令"别用聊天气泡损害工具感"
 *   - reasoning part 默认折叠(Cursor 真痛点)
 *   - tool-call part 内联展示 loading/ready/error 三态
 *   - proposal part 保留应用/拒绝卡
 *
 * 渲染层订阅 chat:part 事件(见 useChatStream hook),累积成 parts[]。
 * 兼容期同时订阅 chat:token(转成 text part),保证旧 onTextDelta 流不丢。
 *
 * 注意:本组件只负责"展示"。输入由 ChatComposer 负责。
 */
import { useState, useRef, useEffect, useCallback } from "react";
import type { CanvasItem } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, X, ChevronDown, Pencil, XCircle, Wrench, Rocket, ClipboardList, Copy, Settings } from "lucide-react";
import { ArtifactRenderer } from "./artifacts/index.js";
import { api } from "../lib/api.js";
import { applyPersistentMarksByText, flashMark, getTextModel, rangeToOffsets } from "../lib/highlightText.js";
import { useLang } from "../lib/i18n.js";
import { celebrate } from "../lib/celebrate.js";
/** 一条消息 = role + parts 数组(v0.2 parts-based)。 */
export interface ChatMessageV2 {
  id: string;
  role: "user" | "assistant";
  parts: ChatMessagePart[];
}

/** 渲染层累积后的 part 类型(text/reasoning 合并,tool 配对)。 */
export type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      toolName: string;
      state: "input-available" | "output-available" | "output-error";
      output?: unknown;
      error?: string;
    };

interface ChatStreamProps {
  messages: ChatMessageV2[];
  streaming: boolean;
  /** 对 proposal 消息内的 tool-call(record_answer/mark_mastered)应用提议 */
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  /** 当前节点摘要(空会话时显示,帮用户快速了解这课) */
  summary?: string | null;
  /** 点"开始学习"→ 直接进入学习(核心概念+检索题),建立会话 */
  onStartLearning?: () => void;
  /** AI 模型是否就绪(未就绪时空状态显示"去配置"卡而非🚀,消除冷启动死胡同) */
  agentReady?: boolean;
  /** 跳转设置(未配置 key 的空状态 CTA) */
  onGotoSettings?: () => void;
  /** 是否已选中节点(false 时空状态显示"选节点"引导) */
  hasNode?: boolean;
  /** 当前节点 id(用于内联 quiz 产物的答题 → mastery 更新) */
  selectedNodeId?: string | null;
  /** 当前 thread id(用于对话画线笔记的溯源锚点) */
  threadId?: string | null;
  /** 对话流画线加笔记:选消息文字 → 存 user_note(溯源到本消息,带消息内字符偏移) */
  onSaveChatNote?: (text: string, msgId: string, startOffset?: number, endOffset?: number) => void;
  /** 所有 user_note(用于对话流持久画线渲染)。按 msgId 分组应用 mark */
  chatNotes?: CanvasItem[];
}

export function ChatStream({ messages, streaming, onApplyProposal, onRejectProposal, summary, onStartLearning, agentReady = true, onGotoSettings, hasNode = true, selectedNodeId, threadId, onSaveChatNote, chatNotes }: ChatStreamProps) {
  const t = useLang();
  // 内联 quiz 产物答题 → 触发 mastery 更新(本地评分,自动建+应用 update_mastery 提案)
  const handleQuizAnswered = useCallback(
    async (_q: { prompt: string }, _idx: number, correct: boolean) => {
      if (!selectedNodeId) return;
      celebrate(correct ? "correct" : "wrong");
      try {
        const r = await api.recordQuizAnswer(selectedNodeId, correct);
        if (r?.mastered) celebrate("mastered");
      } catch {
        /* 静默:庆祝不该因 IPC 失败阻塞主流程 */
      }
    },
    [selectedNodeId],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户是否"贴底"——只在贴底时自动跟随,避免用户上滑翻历史被强拉回来。
  // 用 ref 存判断结果(useEffect 里读,无需触发重渲染)。
  const stickToBottomRef = useRef(true);
  // "回到底部"按钮可见性——这个必须用 state(驱动 JSX 渲染)。
  // 只在阈值翻转时 set,避免每次 scroll 触发重渲染。
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // 笔记溯源跳转(legacy/无 offset 的旧笔记):滚动到消息 + ring 高亮。
  // 有 offset 的笔记走 jump-to-chat-note(持久画线 mark,更精准)。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ msgId: string }>).detail;
      if (!detail?.msgId) return;
      const el = document.querySelector(`[data-msg-id="${detail.msgId}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-accent", "rounded-lg");
      setTimeout(() => el.classList.remove("ring-2", "ring-accent", "rounded-lg"), 2500);
    };
    window.addEventListener("lookatstudy-highlight-message", handler);
    return () => window.removeEventListener("lookatstudy-highlight-message", handler);
  }, []);

  // 对话流持久画线:messages + chatNotes 都就绪后,按 msgId + offset 在每条消息内画 <mark>。
  // 只在非流式时画(streaming 中 DOM 会被 React 频繁重渲染,画的 mark 会被冲掉且冲突)。
  useEffect(() => {
    if (streaming) return; // 流式中不画,等 done 后 DOM 稳定再画
    if (!scrollRef.current || !chatNotes || chatNotes.length === 0) return;
    const t = setTimeout(() => {
      if (!scrollRef.current) return;
      // v0.3.3:改用文本搜索方案。按 msgId 分组,传 text + 前后文
      const byMsg = new Map<string, { noteId: string; text: string; surrounding?: string }[]>();
      for (const item of chatNotes) {
        try {
          const anchor = JSON.parse(item.sourceAnchor!) as { type: string; msgId?: string };
          if (anchor.type === "chat" && anchor.msgId) {
            const text = (JSON.parse(item.data) as { text?: string }).text ?? "";
            if (text) {
              const arr = byMsg.get(anchor.msgId) ?? [];
              arr.push({ noteId: item.id, text });
              byMsg.set(anchor.msgId, arr);
            }
          }
        } catch {
          /* 跳过坏 anchor */
        }
      }
      // 对每条消息 DOM 应用画线
      for (const [msgId, notes] of byMsg) {
        const msgEl = scrollRef.current.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
        if (msgEl) {
          applyPersistentMarksByText(msgEl, notes);
        }
      }
    }, 150);
    return () => clearTimeout(t);
  }, [messages, chatNotes, streaming]);

  // 监听溯源跳转(noteId):找到对应画线 mark,scrollIntoView + 闪烁
  useEffect(() => {
    const handler = (e: Event) => {
      const noteId = (e as CustomEvent<string>).detail;
      if (!noteId) return;
      const mark = scrollRef.current?.querySelector(`mark[data-note-id="${noteId}"]`) as HTMLElement | null;
      if (mark) flashMark(mark);
    };
    window.addEventListener("lookatstudy-jump-to-chat-note", handler);
    return () => window.removeEventListener("lookatstudy-jump-to-chat-note", handler);
  }, []);

  // 对话流画线加笔记:选 assistant 消息文字 → 浮出"✏️ 加笔记"按钮
  const [chatNoteBtn, setChatNoteBtn] = useState<{ x: number; y: number; text: string; msgId: string; startOffset?: number; endOffset?: number } | null>(null);
  const handleChatMouseUp = useCallback(() => {
    if (!onSaveChatNote || !threadId) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text.length < 2 || text.length > 500) {
      setChatNoteBtn(null);
      return;
    }
    // 选区必须在 chat-stream 内,且找到所属 msg 元素(取 data-msg-id)
    const range = sel?.getRangeAt(0);
    if (!range) { setChatNoteBtn(null); return; }
    const container = scrollRef.current;
    if (!container?.contains(range.commonAncestorContainer)) {
      setChatNoteBtn(null);
      return;
    }
    // 向上找最近的 [data-msg-id](可能是 user 或 assistant 消息)
    let node: Node | null = range.commonAncestorContainer;
    let msgEl: HTMLElement | null = null;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.msgId) {
        msgEl = node;
        break;
      }
      node = node.parentNode;
    }
    if (!msgEl) { setChatNoteBtn(null); return; }
    const msgId = msgEl.dataset.msgId!;
    // 用 Range-based 偏移(精准,不依赖 indexOf;过滤空白节点后索引空间一致)
    const model = getTextModel(msgEl);
    const offsets = rangeToOffsets(range, model);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setChatNoteBtn({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      text,
      msgId,
      startOffset: offsets?.start,
      endOffset: offsets?.end,
    });
  }, [onSaveChatNote, threadId]);

  const handleSaveChatNote = useCallback(() => {
    if (!chatNoteBtn || !onSaveChatNote) return;
    const text = chatNoteBtn.text.length > 200 ? chatNoteBtn.text.slice(0, 200) + "…" : chatNoteBtn.text;
    onSaveChatNote(text, chatNoteBtn.msgId, chatNoteBtn.startOffset, chatNoteBtn.endOffset);
    setChatNoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [chatNoteBtn, onSaveChatNote]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 80px 容差:轻微上滑(如点代码块复制按钮)仍算贴底。
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = atBottom;
    setShowScrollBtn((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  // 贴底时滚动到底。触发条件:
  //   - messages 变化(新消息行 / 最后一条消息 parts 增长)
  //   - streaming 切换(开始流式 → 跟随;结束 → 不必动)
  // 用 instant(非 smooth):流式期间 smooth 会被高频打断,产生抖动。
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // 用户发出新消息(send) → 无条件滚到底(用户刚发,必然想看回复)。
  // 检测:最后一条是 user → 强制贴底 + 立即滚 + 隐藏回到底部按钮。
  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === "user";
  useEffect(() => {
    if (!lastIsUser) return;
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastIsUser]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={handleChatMouseUp}
        className="h-full overflow-y-auto px-5 py-6 space-y-6 relative"
        data-testid="chat-stream"
      >
        {messages.length === 0 && (
          <div className="mt-10 mx-auto max-w-md" data-testid="chat-empty-state">
            {hasNode ? (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2 opacity-30">📖</div>
                  {/* 问候(P1.4):降低启动能垒,纯前端无 DB 写 */}
                  <div className="text-body font-bold text-neutral-700 dark:text-neutral-300 mb-1">{t("chat.empty.greeting")}</div>
                  <div className="text-ink-muted text-label">{t("chat.empty.overview")}</div>
                </div>
                {/* 摘要卡片 */}
                {summary ? (
                  <div className="surface-card p-4 mb-4">
                    <div className="text-caption font-bold text-brand uppercase tracking-wider mb-2">{t("chat.empty.summary.title")}</div>
                    <div className="text-body text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
                      {summary}
                    </div>
                  </div>
                ) : (
                  <div className="surface-card p-4 mb-4 text-center">
                    <div className="text-body text-ink-muted">{t("chat.empty.summary.none")}</div>
                  </div>
                )}
                {agentReady ? (
                  <>
                    {/* 开始学习:直接进入学习(核心概念+检索题),非方法论规划(P1.2) */}
                    {onStartLearning && (
                      <button
                        onClick={onStartLearning}
                        disabled={streaming}
                        data-testid="start-learning-btn"
                        className="btn-3d-brand w-full py-3 text-body font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        <Rocket className="w-4 h-4" />
                        <span>{t("chat.empty.start")}</span>
                      </button>
                    )}
                    <div className="text-center mt-4 text-label text-ink-muted">
                      {t("chat.empty.quick_hint")}
                    </div>
                  </>
                ) : (
                  /* 未配置 AI 模型:内容已在右侧讲解,引导去配置——消除冷启动死胡同(P1.1/P1.3) */
                  <div className="surface-card p-4 mb-2" data-testid="keyless-card">
                    <div className="text-body font-bold text-neutral-700 dark:text-neutral-300 mb-1">{t("chat.empty.keyless.title")}</div>
                    <div className="text-label text-ink-muted mb-3">{t("chat.empty.keyless.desc")}</div>
                    <button
                      onClick={onGotoSettings}
                      className="btn-3d-brand w-full py-2 text-body font-bold flex items-center justify-center gap-2"
                    >
                      <Settings className="w-4 h-4" />
                      <span>{t("chat.empty.keyless.btn")}</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* 未选节点:引导选节点(此时 ChatComposer 仍渲染,skill-picker 可见) */
              <div className="text-center mt-16" data-testid="no-node-selected">
                <div className="text-5xl mb-3 opacity-25">🗺️</div>
                <div className="text-body font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  {t("chat.empty.no_node.title")}
                </div>
                <div className="text-body text-ink-muted max-w-xs mx-auto">
                  {t("chat.empty.no_node.desc")}
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageRowV2
            key={msg.id}
            msg={msg}
            onApplyProposal={onApplyProposal}
            onRejectProposal={onRejectProposal}
            onQuizAnswered={handleQuizAnswered}
          />
        ))}

        {streaming && (
          <div className="flex items-center gap-1.5 text-body text-brand">
            <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
            <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
            <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          </div>
        )}
      </div>

      {/* 回到底部按钮:用户上滑翻历史时出现;流式中有新输出时按钮带红点提示 */}
      {showScrollBtn && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          data-testid="scroll-to-bottom"
          aria-label={t("chat.scroll.bottom")}
          title={t("chat.scroll.bottom")}
          className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 shadow-elevated flex items-center justify-center hover:scale-105 active:scale-95 transition-transform msg-enter"
        >
          <ChevronDown className="w-5 h-5" />
          {streaming && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-brand rounded-full border-2 border-neutral-950 animate-pulse" />
          )}
        </button>
      )}

      {/* 对话画线加笔记按钮:选 assistant 消息文字后浮出 */}
      {chatNoteBtn && (
        <button
          onClick={handleSaveChatNote}
          data-testid="save-chat-note-btn"
          style={{ left: chatNoteBtn.x, top: chatNoteBtn.y, transform: "translate(-50%, -100%)" }}
          className="absolute z-20 px-3 py-1.5 rounded-lg bg-brand text-white text-body font-bold shadow-elevated flex items-center gap-1 hover:bg-brand-light transition msg-enter"
          title={t("chat.note.add.title")}
        >
          <Pencil className="w-3 h-3" /> {t("chat.note.add")}
        </button>
      )}
    </div>
  );
}

/** 从 messages 提取所有展示型 tool 产物(供 ArtifactPanel 渲染)。 */
export function extractArtifacts(messages: ChatMessageV2[]): { id: string; toolName: string; output: unknown }[] {
  const artifacts: { id: string; toolName: string; output: unknown }[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i];
      if (
        part.type === "tool-call" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "artifactType" in (part.output as object)
      ) {
        artifacts.push({ id: `${msg.id}-${i}`, toolName: part.toolName, output: part.output });
      }
    }
  }
  return artifacts;
}

function MessageRowV2({
  msg,
  onApplyProposal,
  onRejectProposal,
  onQuizAnswered,
}: {
  msg: ChatMessageV2;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onQuizAnswered?: (q: { prompt: string }, idx: number, correct: boolean) => void;
}) {
  if (msg.role === "user") {
    // user:极简阅读流(claude.ai 风)。右对齐 + 极轻微染,无气泡边框。
    // 与 AI 消息靠"右对齐 + 稍亮底色 + 你 标签"区分,不靠气泡。
    return (
      <div className="msg-enter flex justify-end" data-testid="msg-user" data-msg-id={msg.id}>
        <div className="max-w-[85%] bg-ink/[0.04] rounded-2xl rounded-br-md px-4 py-2.5">
          <div className="font-medium text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap select-text text-body">
            {msg.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
          </div>
        </div>
      </div>
    );
  }

  // assistant:全宽无背景,带小 AI 头像。parts 按 type 分别渲染。
  return (
    <div className="msg-enter flex gap-2.5" data-testid="msg-assistant" data-msg-id={msg.id}>
      <div
        className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center text-white text-label font-bold shrink-0 mt-0.5 shadow-accent-soft"
      >
        AI
      </div>
      <div className="flex-1 min-w-0 space-y-2.5">
        {msg.parts.map((part, idx) => (
          <PartRenderer
            key={idx}
            part={part}
            msgId={msg.id}
            toolCallIdx={idx}
            onApplyProposal={onApplyProposal}
            onRejectProposal={onRejectProposal}
            onQuizAnswered={onQuizAnswered}
          />
        ))}
      </div>
    </div>
  );
}

function PartRenderer({
  part,
  msgId,
  toolCallIdx,
  onApplyProposal,
  onRejectProposal,
  onQuizAnswered,
}: {
  part: ChatMessagePart;
  msgId: string;
  toolCallIdx: number;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onQuizAnswered?: (q: { prompt: string }, idx: number, correct: boolean) => void;
}) {
  if (part.type === "text") {
    return (
      <div
        className="prose prose-sm max-w-[80ch] leading-relaxed select-text"
        data-testid="part-text"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {part.text}
        </ReactMarkdown>
      </div>
    );
  }

  if (part.type === "reasoning") {
    return <ReasoningBlock text={part.text} />;
  }

  // tool-call 三态
  const { toolName, state, output, error } = part;
  return (
    <ToolCallBlock
      toolName={toolName}
      state={state}
      output={output}
      error={error}
      msgId={msgId}
      toolCallIdx={toolCallIdx}
      onApplyProposal={onApplyProposal}
      onRejectProposal={onRejectProposal}
      onQuizAnswered={onQuizAnswered}
    />
  );
}

/** Reasoning 折叠块(Cursor 痛点:思考过程必须可折叠)。 */
function ReasoningBlock({ text }: { text: string }) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg bg-neutral-100 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800"
      data-testid="part-reasoning"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-label font-bold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
      >
        <span>{open ? "▾" : "▸"} {t("chat.reasoning.label")}</span>
        <span className="text-ink-muted font-normal">{t("chat.reasoning.chars", { n: text.length })}</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-label text-ink-muted whitespace-pre-wrap leading-relaxed border-t border-neutral-200 dark:border-neutral-800/60 pt-2">
          {text}
        </div>
      )}
    </div>
  );
}

/** Tool 调用块:loading / ready / error 三态 + proposal 特判。 */
function ToolCallBlock({
  toolName,
  state,
  output,
  error,
  msgId,
  toolCallIdx,
  onApplyProposal,
  onRejectProposal,
  onQuizAnswered,
}: {
  toolName: string;
  state: "input-available" | "output-available" | "output-error";
  output?: unknown;
  error?: string;
  msgId: string;
  toolCallIdx: number;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onQuizAnswered?: (q: { prompt: string }, idx: number, correct: boolean) => void;
}) {
  const t = useLang();
  // proposal 类工具(record_answer/mark_mastered):output 里有 proposalId + summary
  const isProposal = toolName === "record_answer" || toolName === "mark_mastered";
  const proposalData = isProposal && state === "output-available" && typeof output === "object" && output !== null
    ? (output as { proposalId?: string; message?: string; status?: string })
    : null;

  if (proposalData?.proposalId) {
    return (
      <div className="proposal-card rounded-xl p-3 border border-brand/30 bg-brand/5" data-testid="part-proposal">
        <div className="text-neutral-700 dark:text-neutral-200 text-body mb-2 flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" />
          <span className="font-bold">{t("chat.proposal.title")}</span>
        </div>
        <div className="text-neutral-600 dark:text-neutral-300 text-body mb-3">
          {proposalData.message ?? t("chat.proposal.fallback", { tool: toolName })}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onApplyProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
            data-testid="proposal-apply"
            className="btn-3d-brand px-4 py-1.5 text-body"
          >
            <Check className="w-3 h-3 inline" />{t("chat.proposal.apply")}
          </button>
          <button
            onClick={() => onRejectProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
            data-testid="proposal-reject"
            className="btn-3d-neutral px-4 py-1.5 text-body"
          >
            <X className="w-3 h-3 inline" />{t("chat.proposal.reject")}
          </button>
        </div>
      </div>
    );
  }

  // 展示型 tool(output 含 artifactType):内联渲染产物,而不是小徽章
  // loading 态仍走徽章,只有 output-available 才内联渲染
  const isArtifact =
    state === "output-available" &&
    output &&
    typeof output === "object" &&
    "artifactType" in (output as object);
  if (isArtifact) {
    const artifactType = (output as { artifactType: string }).artifactType;
    return (
      <div
        className="my-1 max-w-full"
        data-testid={`inline-artifact-${artifactType}`}
        data-tool={toolName}
      >
        <ArtifactRenderer data={output} onQuizAnswered={onQuizAnswered} />
      </div>
    );
  }

  // 通用 tool 块
  const label = toolLabel(toolName, t);
  return (
    <div
      className="inline-flex items-center gap-1.5 text-label px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800"
      data-testid="part-tool"
      data-tool={toolName}
      data-state={state}
    >
      {state === "input-available" ? (
        <>
          <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
          <span className="text-ink-muted">{label}…</span>
        </>
      ) : state === "output-error" ? (
        <>
          <XCircle className="w-3.5 h-3.5 text-warning shrink-0" />
          <span className="text-warning">{label}: {error}</span>
        </>
      ) : (
        <>
          <Wrench className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <span className="text-ink-muted">{label}</span>
        </>
      )}
    </div>
  );
}

/**
 * Markdown 渲染组件映射(v0.2 排版增强)。
 *
 * 给代码块加:语言标签 + 复制按钮 + 横滚。
 * 其他元素(h1-h6/p/table/ul/ol/blockquote)由 @tailwindcss/typography 的 prose 接管,
 * 配置见 tailwind.config.ts(标题层级/表格斑马纹/代码块深色面板等)。
 *
 * remark-gfm 已启用:支持 GFM 表格(| a | b |)、任务列表(- [x])、删除线(~~x~~)、自动链接。
 */
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // 代码块(pre > code)——加语言标签 + 复制按钮
  pre({ children, ...props }) {
    return <CodeBlock {...props}>{children}</CodeBlock>;
  },
  // 外链:强制新窗口打开(走 setWindowOpenHandler → 系统浏览器),
  // 避免点击 <a href> 导致 electron 主窗口被网页覆盖、丢失 app UI。
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/** 代码块:语言标签 + 一键复制(学习场景高频需求)。 */
function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const t = useLang();
  const [copied, setCopied] = useState(false);
  // 从子级 code 的 className 提取语言(如 language-typescript → typescript)
  const child = Array.isArray(children) ? children[0] : children;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childProps: any = (child as React.ReactElement)?.props ?? {};
  const langMatch = /language-(\w+)/.exec(childProps.className ?? "");
  const lang = langMatch?.[1] ?? "";

  const handleCopy = () => {
    const raw = childProps.children;
    const text = typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.join("")
        : "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative group my-3" data-testid="md-codeblock">
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-900 border border-b-0 border-neutral-200 dark:border-neutral-700 rounded-t-md">
        <span className="text-caption font-mono text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          aria-label={t("chat.copy")}
          className="text-caption text-ink-muted hover:text-brand transition-colors opacity-0 group-hover:opacity-100 inline-flex items-center gap-1"
          data-testid="md-copy"
        >
          {copied ? (
            <><Check className="w-3 h-3 inline" />{t("chat.copied")}</>
          ) : (
            <><Copy className="w-3 h-3 inline" />{t("chat.copy")}</>
          )}
        </button>
      </div>
      <pre
        {...props}
        className="!mt-0 !rounded-t-none !border-t-0"
      >
        {children}
      </pre>
    </div>
  );
}

/** 工具名 → 本地化标签(module-level helper,接受 t 函数避免 hook 限制)。 */
function toolLabel(name: string, t: ReturnType<typeof useLang>): string {
  const labels: Record<string, string> = {
    get_node_info: t("chat.tool.get_node_info"),
    record_answer: t("chat.tool.record_answer"),
    mark_mastered: t("chat.tool.mark_mastered"),
    show_concept_map: t("chat.tool.show_concept_map"),
    generate_quiz: t("chat.tool.generate_quiz"),
    compare_table: t("chat.tool.compare_table"),
    draw_diagram: t("chat.tool.draw_diagram"),
    show_code_walkthrough: t("chat.tool.show_code_walkthrough"),
  };
  return labels[name] ?? name;
}
