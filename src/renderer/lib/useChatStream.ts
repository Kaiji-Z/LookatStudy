/**
 * useChatStream —— v0.2 parts-based 对话流 hook(M1)。
 *
 * 订阅 chat:part 事件,把 part 流累积成 ChatMessageV2[]。
 * 兼容期同时订阅 chat:token(转成 text part),保证旧 onTextDelta 流不丢。
 *
 * 这是 ChatStream 组件的数据源。把"协议解析"和"UI 渲染"解耦——
 * hook 管 parts 累积,组件只管按 type 渲染。
 *
 * 重构自 ChatPanel.tsx 里散落在 useEffect 里的 5 个事件订阅。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./api.js";
import type { ChatStreamPart } from "@shared/types";
import type { ChatMessageV2, ChatMessagePart } from "../components/ChatStream.js";

let msgIdCounter = 0;
const nextMsgId = () => `msg-v2-${++msgIdCounter}`;

/** 把流式 ChatStreamPart[] 累积成渲染层 message.parts[]。
 * 纯函数:不修改入参,返回全新数组+全新对象(React 严格模式安全)。
 */
function accumulatePart(
  currentParts: ChatMessagePart[],
  streamPart: ChatStreamPart,
): ChatMessagePart[] {
  if (streamPart.type === "text") {
    const last = currentParts[currentParts.length - 1];
    if (last && last.type === "text") {
      // 合并到上一条:返回新数组,最后一条用新对象
      return [
        ...currentParts.slice(0, -1),
        { type: "text" as const, text: last.text + streamPart.text },
      ];
    }
    return [...currentParts, { type: "text" as const, text: streamPart.text }];
  }
  if (streamPart.type === "reasoning") {
    const last = currentParts[currentParts.length - 1];
    if (last && last.type === "reasoning") {
      return [
        ...currentParts.slice(0, -1),
        { type: "reasoning" as const, text: last.text + streamPart.text },
      ];
    }
    return [...currentParts, { type: "reasoning" as const, text: streamPart.text }];
  }
  if (streamPart.type === "tool-start") {
    return [
      ...currentParts,
      { type: "tool-call" as const, toolName: streamPart.toolName, state: "input-available" as const },
    ];
  }
  if (streamPart.type === "tool-result") {
    let realIdx = -1;
    for (let i = currentParts.length - 1; i >= 0; i--) {
      const p = currentParts[i];
      if (
        p.type === "tool-call" && p.toolName === streamPart.toolName && p.state === "input-available"
      ) {
        realIdx = i;
        break;
      }
    }
    if (realIdx < 0) return currentParts;
    return currentParts.map((p, i) =>
      i === realIdx
        ? { ...p, state: "output-available" as const, output: streamPart.output }
        : p,
    );
  }
  if (streamPart.type === "tool-error") {
    let realIdx = -1;
    for (let i = currentParts.length - 1; i >= 0; i--) {
      const p = currentParts[i];
      if (
        p.type === "tool-call" && p.toolName === streamPart.toolName && p.state === "input-available"
      ) {
        realIdx = i;
        break;
      }
    }
    if (realIdx < 0) return currentParts;
    return currentParts.map((p, i) =>
      i === realIdx
        ? { ...p, state: "output-error" as const, error: streamPart.error }
        : p,
    );
  }
  return currentParts;
}

/** 把旧式纯文本历史消息转成 v2 parts 格式。 */
export function textHistoryToV2(
  history: { role: "user" | "assistant"; content: string }[],
): ChatMessageV2[] {
  return history.map((m) => ({
    id: nextMsgId(),
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  }));
}

interface UseChatStreamResult {
  messages: ChatMessageV2[];
  streaming: boolean;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  /** 把 proposal 消息内的 tool-call 标记为已应用/拒绝 */
  markProposalStatus: (msgId: string, toolCallIdx: number, applied: boolean) => void;
  setMessagesForNode: (messages: ChatMessageV2[]) => void;
}

export function useChatStream(threadId: string | null): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatMessageV2[]>([]);
  const [streaming, setStreaming] = useState(false);
  // 当前正在流式追加的 assistant 消息 id。
  // 注意:此 ref 只在事件回调(非 setState updater)里读/写,updater 内部不碰 ref
  // (React 严格模式会双调用 updater,ref mutation 在里面会导致状态不一致)。
  const streamingMsgIdRef = useRef<string | null>(null);

  // thread 切换时加载历史(从 chat_messages 表)
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const history = await api.threadGetMessages(threadId);
        if (cancelled) return;
        // chat_messages 行 → ChatMessageV2(纯文本;parts_json 暂不复原,只显示 content)
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role,
            parts: [{ type: "text" as const, text: m.content }],
          })),
        );
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // 订阅 chat:part 事件(parts-based,优先)
  useEffect(() => {
    const off = api.on("chat:part", (part: ChatStreamPart) => {
      // 在回调里确定目标消息 id(读 ref),然后传进纯 updater
      const candidateId = streamingMsgIdRef.current;
      const targetId = candidateId; // 下面用,ref 只在这里读一次
      setMessages((prev) => {
        // 判断是否需要新建 assistant 消息:
        //   1. ref 里有 id 且该消息还存在 → 追加到它
        //   2. 否则 → 看最后一条是不是 assistant 且是当前流式(启发式),是就追加,否则新建
        let msgId = targetId;
        let base = prev;
        const exists = msgId && prev.some((m) => m.id === msgId);
        if (!exists) {
          // 启发式:如果最后一条是 assistant 且还没有 chat:done 收尾,继续往它追加
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            msgId = last.id;
          } else {
            msgId = nextMsgId();
            base = [...prev, { id: msgId, role: "assistant" as const, parts: [] }];
          }
        }
        const finalId = msgId;
        return base.map((m) =>
          m.id === finalId
            ? { ...m, parts: accumulatePart(m.parts, part) }
            : m,
        );
      });
    });
    return off;
  }, []);

  // 订阅 chat:done(流式结束)
  useEffect(() => {
    const off = api.on("chat:done", () => {
      setStreaming(false);
      streamingMsgIdRef.current = null;
    });
    return off;
  }, []);

  // 订阅 chat:error
  useEffect(() => {
    const off = api.on("chat:error", (err: string) => {
      setStreaming(false);
      streamingMsgIdRef.current = null;
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "assistant", parts: [{ type: "text", text: `⚠️ ${err}` }] },
      ]);
    });
    return off;
  }, []);

  const send = useCallback(
    async (text: string, overrideThreadId?: string) => {
      // 优先用 overrideThreadId(首次建 thread 后立刻发,不等 prop 更新)
      const tid = overrideThreadId ?? threadId;
      if (!tid || streaming || !text.trim()) return;
      const trimmed = text.trim();
      const userMsg: ChatMessageV2 = {
        id: nextMsgId(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      streamingMsgIdRef.current = null;
      try {
        await api.agentChatThread(tid, trimmed);
      } catch (e) {
        setStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: "assistant",
            parts: [{ type: "text", text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }],
          },
        ]);
      }
    },
    [threadId, streaming],
  );

  const stop = useCallback(async () => {
    if (!threadId || !streaming) return;
    try {
      await api.abortAgentChatThread(threadId);
    } catch {
      /* 忽略 */
    }
    setStreaming(false);
    streamingMsgIdRef.current = null;
  }, [threadId, streaming]);

  const clear = useCallback(() => {
    // v0.4: clear 在 thread 模型里改为"清空当前显示"(不删 DB,DB 里消息保留)
    // 真正删除整条 thread 走 useThreads.remove
    setMessages([]);
  }, []);

  // M2: 监听命令面板事件(Cmd+K 派发的预设指令)
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (typeof action !== "string") return;
      // 把命令映射成发给 AI 的自然语言指令
      const COMMAND_MESSAGES: Record<string, string> = {
        explain_simple: "用大白话给我讲讲这一节的核心概念",
        quiz_3: "出 3 道练习题考考我",
        compare_prev: "把这一节和上一节做个对比表",
        concept_map: "画个概念图帮我理清这一节的知识结构",
        socratic: "切换到苏格拉底模式,用提问引导我思考",
        exam_mode: "切换到考试冲刺模式,出有难度的题",
      };
      const msg = COMMAND_MESSAGES[action];
      if (msg) send(msg);
    };
    window.addEventListener("lookatstudy-command", handler);
    return () => window.removeEventListener("lookatstudy-command", handler);
  }, [send]);

  const markProposalStatus = useCallback(
    (msgId: string, toolCallIdx: number, applied: boolean) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const parts = [...m.parts];
          const part = parts[toolCallIdx];
          if (part && part.type === "tool-call") {
            // 把 output 替换成标记已处理的状态(UI 只读)
            parts[toolCallIdx] = {
              ...part,
              output: {
                ...(typeof part.output === "object" && part.output ? part.output : {}),
                status: applied ? "applied" : "rejected",
              },
            };
          }
          return { ...m, parts };
        }),
      );
    },
    [],
  );

  const setMessagesForNode = useCallback((msgs: ChatMessageV2[]) => {
    setMessages(msgs);
  }, []);

  return {
    messages,
    streaming,
    send,
    stop,
    clear,
    markProposalStatus,
    setMessagesForNode,
  };
}
