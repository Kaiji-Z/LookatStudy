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
import { translate } from "./i18n.js";
import type { ChatStreamPart } from "@shared/types";
import { accumulatePart, type ChatMessageV2, type ChatMessagePart } from "@shared/part-accumulator";

let msgIdCounter = 0;
const nextMsgId = () => `msg-v2-${++msgIdCounter}`;

/** 把持久化的 parts(JSON)安全还原成 ChatMessagePart[]。解析失败/形状不对 → null(回退纯文本)。 */
function deserializeParts(partsJson: string | null): ChatMessagePart[] | null {
  if (!partsJson) return null;
  try {
    const parsed = JSON.parse(partsJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // 轻量校验:每项必须有 type 字段。不全合法则整体回退(保守,避免渲染崩)。
    const ok = parsed.every(
      (p: unknown) =>
        typeof p === "object" && p !== null && typeof (p as { type?: unknown }).type === "string",
    );
    return ok ? (parsed as ChatMessagePart[]) : null;
  } catch {
    return null;
  }
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
  send: (text: string, overrideThreadId?: string, displayText?: string) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  /** 把 proposal 消息内的 tool-call 标记为已应用/拒绝 */
  markProposalStatus: (msgId: string, toolCallIdx: number, applied: boolean) => void;
  setMessagesForNode: (messages: ChatMessageV2[]) => void;
}

/** locale: 界面语言(i18n)。用户偏好什么界面,AI 就用什么语言回复。 */
export function useChatStream(threadId: string | null, locale?: string | null): UseChatStreamResult {
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
      setStreaming(false); // 切到空 thread 时重置 streaming(防卡死输入框)
      streamingMsgIdRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const history = await api.threadGetMessages(threadId);
        if (cancelled) return;
        // chat_messages 行 → ChatMessageV2。优先复原 parts_json(产物/提议卡/思考过程),
        // 无 parts_json 或解析失败则回退纯文本 content(旧消息兼容)。
        setMessages(
          history.map((m) => {
            const restored = deserializeParts(m.partsJson);
            return {
              id: m.id,
              role: m.role,
              parts: restored ?? [{ type: "text" as const, text: m.content }],
              // 按钮触发的消息:气泡只展示短动作标签(完整提示词在 parts/content,仅供 LLM)
              ...(m.displayText ? { displayText: m.displayText } : {}),
            };
          }),
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

  // 订阅 chat:done(流式结束)。后端带回两条消息的真实 DB id,
  // 用它替换流式时的临时 msg-v2-N id,让"对话画线笔记"的溯源 msgId 跨重载稳定匹配。
  useEffect(() => {
    const off = api.on("chat:done", (_fullText: string, ids?: { userMessageId?: string; assistantMessageId?: string }) => {
      setStreaming(false);
      streamingMsgIdRef.current = null;
      if (ids && (ids.userMessageId || ids.assistantMessageId)) {
        setMessages((prev) => {
          // 找最后一条 user 消息 + 最后一条 assistant 消息,替换它们的 id
          let lastUserIdx = -1;
          let lastAssistantIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "user" && lastUserIdx === -1) lastUserIdx = i;
            if (prev[i].role === "assistant" && lastAssistantIdx === -1) lastAssistantIdx = i;
            if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break;
          }
          return prev.map((m, i) => {
            if (i === lastUserIdx && ids.userMessageId) {
              return { ...m, id: ids.userMessageId };
            }
            if (i === lastAssistantIdx && ids.assistantMessageId) {
              return { ...m, id: ids.assistantMessageId };
            }
            return m;
          });
        });
      }
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
    async (text: string, overrideThreadId?: string, displayText?: string) => {
      // 优先用 overrideThreadId(首次建 thread 后立刻发,不等 prop 更新)
      const tid = overrideThreadId ?? threadId;
      if (!tid || streaming || !text.trim()) return;
      const trimmed = text.trim();
      const userMsg: ChatMessageV2 = {
        id: nextMsgId(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
        // 按钮触发时气泡只显示短动作标签,不显示发给 LLM 的完整提示词
        ...(displayText ? { displayText } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      streamingMsgIdRef.current = null;
      try {
        await api.agentChatThread(tid, trimmed, displayText, locale ?? null);
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
    [threadId, streaming, locale],
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
      // 把命令映射成发给 AI 的自然语言指令 + 气泡展示的短标签(不显示完整提示词)
      const COMMAND_MESSAGES: Record<string, { msg: string; labelKey: string }> = {
        explain_simple: { msg: "用大白话给我讲讲这一节的核心概念", labelKey: "command.explain_simple" },
        quiz_3: { msg: "出 3 道练习题考考我", labelKey: "command.quiz_3" },
        compare_prev: { msg: "把这一节和上一节做个对比表", labelKey: "command.compare_prev" },
        concept_map: { msg: "画个概念图帮我理清这一节的知识结构", labelKey: "command.concept_map" },
        socratic: { msg: "切换到苏格拉底模式,用提问引导我思考", labelKey: "command.socratic" },
        exam_mode: { msg: "切换到考试冲刺模式,出有难度的题", labelKey: "command.exam_mode" },
      };
      const cmd = COMMAND_MESSAGES[action];
      if (cmd) send(cmd.msg, undefined, translate(cmd.labelKey));
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
