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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, X, ChevronDown } from "lucide-react";
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
  /** 点"开始学习"→ 发学习方法请求,建立会话 */
  onStartLearning?: () => void;
}

export function ChatStream({ messages, streaming, onApplyProposal, onRejectProposal, summary, onStartLearning }: ChatStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户是否"贴底"——只在贴底时自动跟随,避免用户上滑翻历史被强拉回来。
  // 用 ref 存判断结果(useEffect 里读,无需触发重渲染)。
  const stickToBottomRef = useRef(true);
  // "回到底部"按钮可见性——这个必须用 state(驱动 JSX 渲染)。
  // 只在阈值翻转时 set,避免每次 scroll 触发重渲染。
  const [showScrollBtn, setShowScrollBtn] = useState(false);

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
        className="h-full overflow-y-auto px-4 py-4 space-y-4"
        data-testid="chat-stream"
      >
        {messages.length === 0 && (
          <div className="mt-10 mx-auto max-w-md" data-testid="chat-empty-state">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3 opacity-30">📖</div>
              <div className="text-neutral-500 dark:text-neutral-400 text-sm">这是这一课的概览</div>
            </div>
            {/* 摘要卡片 */}
            {summary ? (
              <div className="surface-card p-4 mb-5">
                <div className="text-[10px] font-bold text-brand uppercase tracking-wider mb-2">本课摘要</div>
                <div className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {summary}
                </div>
              </div>
            ) : (
              <div className="surface-card p-4 mb-5 text-center">
                <div className="text-sm text-neutral-500 dark:text-neutral-400">暂无摘要,点开始学习让 AI 帮你了解这一课</div>
              </div>
            )}
            {/* 开始学习按钮 */}
            {onStartLearning && (
              <button
                onClick={onStartLearning}
                disabled={streaming}
                data-testid="start-learning-btn"
                className="btn-3d-brand w-full py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <span>🚀</span>
                <span>开始学习</span>
              </button>
            )}
            <div className="text-center mt-4 text-[11px] text-neutral-500 dark:text-neutral-500">
              或从下面的快捷按钮选一个
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageRowV2
            key={msg.id}
            msg={msg}
            onApplyProposal={onApplyProposal}
            onRejectProposal={onRejectProposal}
          />
        ))}

        {streaming && (
          <div className="flex items-center gap-1.5 text-xs text-brand">
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
          aria-label="回到底部"
          title="回到底部"
          className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 shadow-elevated flex items-center justify-center hover:scale-105 active:scale-95 transition-transform msg-enter"
        >
          <ChevronDown className="w-5 h-5" />
          {streaming && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-brand rounded-full border-2 border-neutral-950 animate-pulse" />
          )}
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
}: {
  msg: ChatMessageV2;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
}) {
  if (msg.role === "user") {
    // user:左 4px 绿色竖条 + 全宽浅绿底(扁平,非气泡)
    return (
      <div className="msg-enter bg-brand/10 dark:bg-brand/15 rounded-lg px-3 py-2 border border-brand/20" data-testid="msg-user">
        <div className="font-medium text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap" style={{ fontSize: "var(--chat-font-size, 15px)" }}>
          {msg.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
        </div>
      </div>
    );
  }

  // assistant:全宽无背景,带小 AI 头像。parts 按 type 分别渲染。
  return (
    <div className="msg-enter flex gap-2.5" data-testid="msg-assistant">
      <div
        className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5"
        style={{ boxShadow: "0 2px 6px rgba(28,176,246,0.2)" }}
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
}: {
  part: ChatMessagePart;
  msgId: string;
  toolCallIdx: number;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
}) {
  if (part.type === "text") {
    return (
      <div
        className="text-neutral-800 dark:text-neutral-200 prose prose-sm dark:prose-invert max-w-none leading-relaxed" style={{ fontSize: "var(--chat-font-size, 15px)" }}
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
    />
  );
}

/** Reasoning 折叠块(Cursor 痛点:思考过程必须可折叠)。 */
function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg bg-neutral-100 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800"
      data-testid="part-reasoning"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
      >
        <span>{open ? "▾" : "▸"} 思考过程</span>
        <span className="text-neutral-500 dark:text-neutral-500 font-normal">{text.length} 字</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-[11px] text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap leading-relaxed border-t border-neutral-200 dark:border-neutral-800/60 pt-2">
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
}: {
  toolName: string;
  state: "input-available" | "output-available" | "output-error";
  output?: unknown;
  error?: string;
  msgId: string;
  toolCallIdx: number;
  onApplyProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
  onRejectProposal?: (proposalId: string, msgId: string, toolCallIdx: number) => void;
}) {
  // proposal 类工具(record_answer/mark_mastered):output 里有 proposalId + summary
  const isProposal = toolName === "record_answer" || toolName === "mark_mastered";
  const proposalData = isProposal && state === "output-available" && typeof output === "object" && output !== null
    ? (output as { proposalId?: string; message?: string; status?: string })
    : null;

  if (proposalData?.proposalId) {
    return (
      <div className="proposal-card rounded-xl p-3 border border-brand/30 bg-brand/5" data-testid="part-proposal">
        <div className="text-neutral-700 dark:text-neutral-200 text-xs mb-2 flex items-center gap-1.5">
          <span className="text-sm">📋</span>
          <span className="font-bold">AI 提议</span>
        </div>
        <div className="text-neutral-600 dark:text-neutral-300 text-xs mb-3">
          {proposalData.message ?? `提议(${toolName})`}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onApplyProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
            data-testid="proposal-apply"
            className="btn-3d-brand px-4 py-1.5 text-xs"
          >
            <Check className="w-3 h-3 inline" />应用
          </button>
          <button
            onClick={() => onRejectProposal?.(proposalData.proposalId!, msgId, toolCallIdx)}
            data-testid="proposal-reject"
            className="btn-3d-neutral px-4 py-1.5 text-xs"
          >
            <X className="w-3 h-3 inline" />拒绝
          </button>
        </div>
      </div>
    );
  }

  // 通用 tool 块
  const label = TOOL_LABELS[toolName] ?? toolName;
  return (
    <div
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800"
      data-testid="part-tool"
      data-tool={toolName}
      data-state={state}
    >
      {state === "input-available" ? (
        <>
          <span className="typing-dot w-1.5 h-1.5 bg-accent rounded-full inline-block" />
          <span className="text-neutral-600 dark:text-neutral-400">{label}…</span>
        </>
      ) : state === "output-error" ? (
        <>
          <span>❌</span>
          <span className="text-red-500 dark:text-red-400">{label}: {error}</span>
        </>
      ) : (
        <>
          <span className="text-neutral-400 dark:text-neutral-500">🔧</span>
          <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
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
};

/** 代码块:语言标签 + 一键复制(学习场景高频需求)。 */
function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
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
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border border-b-0 border-neutral-700 rounded-t-md">
        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-neutral-400 hover:text-brand transition-colors opacity-0 group-hover:opacity-100"
          data-testid="md-copy"
        >
          {copied ? "✓ 已复制" : "复制"}
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

const TOOL_LABELS: Record<string, string> = {
  get_node_info: "读取节点信息",
  record_answer: "记录答题观测",
  mark_mastered: "标记掌握",
  show_concept_map: "生成概念图",
  generate_quiz: "出练习题",
  compare_table: "生成对比表",
  draw_diagram: "画流程图",
  show_code_walkthrough: "代码讲解",
};
