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
import type { ChatMessageV2, ChatMessagePart } from "@shared/part-accumulator";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "../lib/markdown-sanitize.js";
import { Check, ChevronDown, Pencil, XCircle, Wrench, Rocket, Copy, Settings, GraduationCap, CheckCircle2, CircleSlash, Volume2, Square } from "lucide-react";
import { ArtifactRenderer } from "./artifacts/index.js";
import { UserAttachments } from "./AttachmentView.js";
import { api } from "../lib/api.js";
import { applyPersistentMarksByText, flashMark, getTextModel, rangeToOffsets } from "../lib/highlightText.js";
import { selectionPopoverPosition } from "../lib/selection-popover.js";
import { useLang } from "../lib/i18n.js";
import { useSpeech } from "../lib/useSpeech.js";
import { useToast } from "./Toast.js";
/** 一条消息 = role + parts 数组(v0.2 parts-based)。
 * ChatMessageV2 / ChatMessagePart 定义已移至 @shared/part-accumulator(main 与 renderer 共用)。 */

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
  /** 答完一组题后点"下一步"动作 → 把消息发进对话(父组件接 sendMessage)。消灭"答完不知道干嘛"死胡同。 */
  onPickQuizAction?: (message: string) => void;
  /** quiz 答完自动把成绩单发进对话(hook 给 AI 判定下一步)。 */
  onQuizCompleted?: (result: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => void;
  /** T3 卡片模式(一幕一屏):窄屏下每个 AI 回合装进一张占屏卡片,自由滚动(不做 snap 吸附);
   *  用户消息保持小气泡。宽屏不传=false,行为不变。 */
  cardMode?: boolean;
}

export function ChatStream({ messages, streaming, onApplyProposal, onRejectProposal, summary, onStartLearning, agentReady = true, onGotoSettings, hasNode = true, selectedNodeId, threadId, onSaveChatNote, chatNotes, onPickQuizAction, onQuizCompleted, cardMode = false }: ChatStreamProps) {
  const t = useLang();
  const toast = useToast();
  const speech = useSpeech();

  useEffect(() => {
    if (speech.failReason) {
      const key =
        speech.failReason === "engine-unavailable"
          ? "chat.speech.engine_unavailable"
          : "chat.speech.model_missing";
      toast.show(t(key), { severity: "warning" });
      speech.clearFailReason();
    }
  }, [speech.failReason, toast, t, speech]);
  // 内联 quiz 产物答题 → 触发 mastery 更新(本地评分,自动建+应用 update_mastery 提案)
  const handleQuizAnswered = useCallback(
    (q: { prompt: string; kc?: string }, _idx: number, correct: boolean) => {
      // 庆祝由 CelebrationLayer 统一处理(recordQuizAnswer 触发 mastery 状态变化 → state:changed)。
      if (selectedNodeId) {
        api.recordQuizAnswer(selectedNodeId, correct, q.kc).catch(() => {});
      }
    },
    [selectedNodeId],
  );

  // 答完题下一步动作(常开):拉当前节点掌握度,决定给"标记掌握"还是"深入"。
  const [quizMastery, setQuizMastery] = useState<number | null>(null);
  useEffect(() => {
    if (!selectedNodeId) {
      setQuizMastery(null);
      return;
    }
    let cancelled = false;
    const fetchMastery = () =>
      api
        .getProgress(selectedNodeId)
        .then((p: { mastery?: number | null } | null) => {
          if (!cancelled) setQuizMastery(p?.mastery ?? null);
        })
        .catch(() => {});
    fetchMastery();
    // 答题/SRS 复习触发 mastery 变化 → 重拉,确保 post-quiz 动作用最新掌握度决策。
    const off = api.on("state:changed", (kind: string) => {
      if (kind === "mastery") fetchMastery();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [selectedNodeId]);

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
  const [chatNoteBtn, setChatNoteBtn] = useState<{ x: number; y: number; transform?: string; text: string; msgId: string; startOffset?: number; endOffset?: number } | null>(null);
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
    // 浮钮定位:右侧优先(手机 Chrome 原生 复制/分享 菜单锚在选区上方,上侧必被遮)
    const pos = selectionPopoverPosition(
      {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top,
        width: rect.width,
        height: rect.height,
      },
      containerRect.width,
      110,
    );
    setChatNoteBtn({
      x: pos.left,
      y: pos.top,
      transform: pos.transform,
      text,
      msgId,
      startOffset: offsets?.start,
      endOffset: offsets?.end,
    });
  }, [onSaveChatNote, threadId]);

  // 触屏长按选字不触发 mouseup:selectionchange(防抖)走同一检测(与 NotebookPanel 同款);
  // 选区清空延迟 250ms 收按钮,给 tap 的 click 留竞态窗口。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const hasText = (window.getSelection()?.toString().trim().length ?? 0) >= 2;
        if (hasText) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          handleChatMouseUp();
        } else if (!hideTimer) {
          hideTimer = setTimeout(() => setChatNoteBtn((cur) => (cur ? null : cur)), 250);
        }
      }, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      if (timer) clearTimeout(timer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [handleChatMouseUp]);

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
        className={`h-full overflow-y-auto px-3 py-4 space-y-2 relative ${cardMode ? "" : "px-5 py-6 space-y-6"}`}
        data-testid="chat-stream"
      >
        {messages.length === 0 && (
          <div className="mt-10 mx-auto max-w-md" data-testid="chat-empty-state">
            {hasNode ? (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2 opacity-30">📖</div>
                  {/* 问候(P1.4):降低启动能垒,纯前端无 DB 写 */}
                  <div className="text-body font-bold text-ink-muted mb-1">{t("chat.empty.greeting")}</div>
                  <div className="text-ink-muted text-label">{t("chat.empty.overview")}</div>
                </div>
                {/* 摘要卡片 */}
                {summary ? (
                  <div className="surface-card p-4 mb-4">
                    <div className="text-caption font-bold text-brand uppercase tracking-wider mb-2">{t("chat.empty.summary.title")}</div>
                    <div className="text-body text-ink-muted leading-relaxed whitespace-pre-wrap">
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
                  </>
                ) : (
                  /* 未配置 AI 模型:内容已在右侧讲解,引导去配置——消除冷启动死胡同(P1.1/P1.3) */
                  <div className="surface-card p-4 mb-2" data-testid="keyless-card">
                    <div className="text-body font-bold text-ink-muted mb-1">{t("chat.empty.keyless.title")}</div>
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
              /* 未选节点:引导选节点(此时 ChatComposer 仍渲染,soul-picker 可见) */
              <div className="text-center mt-16" data-testid="no-node-selected">
                <div className="text-5xl mb-3 opacity-25">🗺️</div>
                <div className="text-body font-bold text-ink-muted mb-1">
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
          /* T3 一幕一屏:AI 回合 = 一张占屏卡片(讲解/测验/反馈各成一幕),
             自由滚动不吸附(snap 实测会在甩动后回拉,已去掉);用户消息保持小气泡作幕间插页 */
          <div
            key={msg.id}
            className={cardMode ? "" : "contents"}
          >
            <div className={cardMode && msg.role === "assistant" ? "surface-card p-4 rounded-2xl shadow-card" : undefined}>
              <MessageRowV2
                msg={msg}
                onApplyProposal={onApplyProposal}
                onRejectProposal={onRejectProposal}
                onQuizAnswered={handleQuizAnswered}
                quizMastery={quizMastery}
                onPickAction={onPickQuizAction}
                onQuizCompleted={onQuizCompleted}
                speakingMessageId={speech.speakingMessageId}
                speakingSentence={speech.speakingSentence}
                onSpeak={speech.speak}
              />
            </div>
          </div>
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
          className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-ink-strong text-surface-0 shadow-elevated flex items-center justify-center hover:scale-105 active:scale-95 transition-transform msg-enter"
        >
          <ChevronDown className="w-5 h-5" />
          {streaming && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-brand rounded-full border-2 border-[var(--ink-strong)] animate-pulse" />
          )}
        </button>
      )}

      {/* 对话画线加笔记按钮:选 assistant 消息文字后浮出 */}
      {chatNoteBtn && (
        <button
          onClick={handleSaveChatNote}
          data-testid="save-chat-note-btn"
          style={{ left: chatNoteBtn.x, top: chatNoteBtn.y, transform: chatNoteBtn.transform }}
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
  quizMastery,
  onPickAction,
  onQuizCompleted,
  speakingMessageId,
  speakingSentence,
  onSpeak,
}: {
  msg: ChatMessageV2;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onQuizAnswered?: (q: { prompt: string }, idx: number, correct: boolean) => void;
  quizMastery?: number | null;
  onPickAction?: (message: string) => void;
  onQuizCompleted?: (result: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => void;
  speakingMessageId?: string | null;
  speakingSentence?: { index: number; total: number } | null;
  onSpeak?: (messageId: string, text: string) => void;
}) {
  const t = useLang();
  if (msg.role === "user") {
    // user:极简阅读流(claude.ai 风)。右对齐 + 极轻微染,无气泡边框。
    // 与 AI 消息靠"右对齐 + 稍亮底色 + 你 标签"区分,不靠气泡。
    return (
      <div className="msg-enter flex justify-end" data-testid="msg-user" data-msg-id={msg.id}>
        <div className="max-w-[85%] bg-ink/[0.04] rounded-2xl rounded-br-md px-4 py-2.5">
          {/* 附件区(v0.10):图片缩略图 + 文本 chip,在正文之上 */}
          <UserAttachments parts={msg.parts} />
          {/* 按钮触发的消息(msg.displayText)只展示短动作标签;手打输入无 displayText,原样展示 */}
          <div className="font-medium text-ink-strong whitespace-pre-wrap select-text text-body">
            {msg.displayText ?? msg.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
          </div>
        </div>
      </div>
    );
  }

  // assistant:全宽无背景、无头像(claude.ai 风)。头像列给每条 AI 消息制造 ~38px
  // 固定左缩进(正文/产物卡全被推右,手机窄屏最伤);对话双方靠"用户右对齐微染底
  // vs AI 全宽"已足够区分,不靠头像。
  // 朗读文本 = 全部 text part 拼接(工具产物/附件不读)
  const speakableText = msg.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
  const isSpeakingThis = speakingMessageId === msg.id;

  return (
    <div className="msg-enter" data-testid="msg-assistant" data-msg-id={msg.id}>
      <div className="min-w-0 space-y-2.5">
        {msg.parts.map((part, idx) => (
          <PartRenderer
            key={idx}
            part={part}
            msgId={msg.id}
            toolCallIdx={idx}
            onApplyProposal={onApplyProposal}
            onRejectProposal={onRejectProposal}
            onQuizAnswered={onQuizAnswered}
            quizMastery={quizMastery}
            onPickAction={onPickAction}
            onQuizCompleted={onQuizCompleted}
          />
        ))}
      </div>
      {onSpeak && speakableText && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={() => onSpeak(msg.id, speakableText)}
            data-testid={isSpeakingThis ? "speech-stop-btn" : "speech-speak-btn"}
            aria-label={isSpeakingThis ? t("chat.speech.stop") : t("chat.speech.speak")}
            title={isSpeakingThis ? t("chat.speech.stop") : t("chat.speech.speak")}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
              isSpeakingThis
                ? "bg-brand/15 text-brand"
                : "text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
            }`}
          >
            {isSpeakingThis ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {isSpeakingThis && speakingSentence && speakingSentence.total > 0 && (
            <span className="text-caption text-ink-muted">
              {t("chat.speech.progress").replace("{n}", String(speakingSentence.index + 1)).replace("{total}", String(speakingSentence.total))}
            </span>
          )}
        </div>
      )}
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
  quizMastery,
  onPickAction,
  onQuizCompleted,
}: {
  part: ChatMessagePart;
  msgId: string;
  toolCallIdx: number;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onQuizAnswered?: (q: { prompt: string }, idx: number, correct: boolean) => void;
  quizMastery?: number | null;
  onPickAction?: (message: string) => void;
  onQuizCompleted?: (result: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => void;
}) {
  if (part.type === "text") {
    return (
      <div
        className="prose prose-sm max-w-[80ch] leading-relaxed break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_img]:max-w-full [&_video]:max-w-full [&_iframe]:max-w-full select-text"
        data-testid="part-text"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
          urlTransform={(url) => url}
          components={markdownComponents}
        >
          {part.text}
        </ReactMarkdown>
      </div>
    );
  }

  if (part.type === "reasoning") {
    return <ReasoningBlock text={part.text} />;
  }

  // tool-call 三态(attachment part 只出现在 user 消息,这里不会遇到;防御性跳过)
  if (part.type !== "tool-call") return null;
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
      quizMastery={quizMastery}
      onPickAction={onPickAction}
      onQuizCompleted={onQuizCompleted}
    />
  );
}

/** Reasoning 折叠块(Cursor 痛点:思考过程必须可折叠)。 */
function ReasoningBlock({ text }: { text: string }) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg bg-surface-1/60 border border-[var(--border-faint)]"
      data-testid="part-reasoning"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-label font-bold text-ink-muted hover:text-ink-strong transition-colors"
      >
        <span>{open ? "▾" : "▸"} {t("chat.reasoning.label")}</span>
        <span className="text-ink-muted font-normal">{t("chat.reasoning.chars", { n: text.length })}</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-label text-ink-muted whitespace-pre-wrap leading-relaxed border-t border-[var(--border-faint)]/60 pt-2">
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
  quizMastery,
  onPickAction,
  onQuizCompleted,
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
  quizMastery?: number | null;
  onPickAction?: (message: string) => void;
  onQuizCompleted?: (result: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => void;
}) {
  const t = useLang();
  // proposal 类工具(record_answer/mark_mastered):output 里有 proposalId + summary。
  // record_answer 已自动 apply(无 proposalId,不会进这里);实际只有 mark_mastered 会显示待决卡。
  const isProposal = toolName === "record_answer" || toolName === "mark_mastered";
  const proposalData = isProposal && state === "output-available" && typeof output === "object" && output !== null
    ? (output as { proposalId?: string; message?: string; status?: string })
    : null;

  if (proposalData?.proposalId) {
    const status = proposalData.status;
    // —— 已采纳:金色对勾徽章(gold=mastery),无按钮 ——
    if (status === "applied") {
      return (
        <div className="proposal-card rounded-xl border border-gold/30 bg-gold/5 p-3 flex items-center gap-2" data-testid="part-proposal">
          <CheckCircle2 className="w-4 h-4 text-gold shrink-0" />
          <span className="text-body font-bold text-ink">{t("chat.proposal.applied")}</span>
        </div>
      );
    }
    // —— 已忽略:muted 徽章,无按钮 ——
    if (status === "rejected") {
      return (
        <div className="proposal-card rounded-xl border border-ink/10 bg-ink/5 p-3 flex items-center gap-2" data-testid="part-proposal">
          <CircleSlash className="w-4 h-4 text-ink-muted shrink-0" />
          <span className="text-body text-ink-muted">{t("chat.proposal.rejected")}</span>
        </div>
      );
    }
    // —— 待决:mark_mastered 卡片(标题 + rationale + 后果提示 + 两按钮)——
    return (
      <div className="proposal-card relative rounded-xl border border-brand/30 bg-brand/5 overflow-hidden" data-testid="part-proposal">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand" />
        <div className="pl-4 pr-3 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand/15 text-brand shrink-0">
              <GraduationCap className="w-4 h-4" />
            </span>
            <span className="text-lead font-bold text-ink">{t("chat.proposal.mastered.title")}</span>
          </div>
          {proposalData.message && (
            <div className="text-body text-ink mb-2 leading-relaxed">{proposalData.message}</div>
          )}
          <div className="text-caption text-ink-muted mb-3">{t("chat.proposal.mastered.hint")}</div>
          <div className="flex gap-2">
            <button
              onClick={() => onApplyProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
              data-testid="proposal-apply"
              className="btn-3d-brand px-4 py-1.5 text-body"
            >
              <Check className="w-3.5 h-3.5 inline" />{t("chat.proposal.confirm")}
            </button>
            <button
              onClick={() => onRejectProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
              data-testid="proposal-reject"
              className="btn-3d-neutral px-4 py-1.5 text-body"
            >
              {t("chat.proposal.later")}
            </button>
          </div>
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
        <ArtifactRenderer
          data={output}
          onQuizAnswered={onQuizAnswered}
          quizMastery={quizMastery}
          onPickAction={onPickAction}
          onQuizCompleted={onQuizCompleted}
        />
      </div>
    );
  }

  // 通用 tool 块
  const label = toolLabel(toolName, t);
  return (
    <div
      className="inline-flex items-center gap-1.5 text-label px-2.5 py-1 rounded-md bg-surface-1/60 border border-[var(--border-faint)]"
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
          <Wrench className="w-3.5 h-3.5 text-ink-faint shrink-0" />
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
  // 宽表格包进 overflow 容器,横向滚动不撑爆对话流
  table({ children }) {
    return <div className="overflow-x-auto my-4"><table>{children}</table></div>;
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
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-1 border border-b-0 border-[var(--border-faint)] rounded-t-md">
        <span className="text-caption font-mono text-ink-faint uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          aria-label={t("chat.copy")}
          className="text-caption text-ink-muted hover:text-brand transition-colors opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 inline-flex items-center gap-1"
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
