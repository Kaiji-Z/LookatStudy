/**
 * useChatStream —— v0.23 异步会话:per-thread 流式状态(parts-based)。
 *
 * 订阅 chat:part/chat:done/chat:error(均带 threadId),把 part 流路由进
 * 对应 thread 的桶(stream-buckets.ts 纯函数)。视图只是当前 activeThread
 * 桶的观察窗口——**流式跟 thread 走**:AI 思考中切节点,原 thread 在后台
 * 继续累加输出,切回时缓存原样恢复(流式中间态只在桶里,DB 未落库,缓存
 * 优先于重拉);新节点自由开新会话,同 thread 流式中拒发(Stop 钮)。
 *
 * v0.2→v0.23 变更:旧实现事件不带 threadId 且流式全局单值,切节点会把 A
 * 的回答混进 B 的消息列表、done 错换 id、B 输入框被全局锁死——本版根治。
 * 后台流式中的 thread 由 streamingThreadIds 导出(ThreadSwitcher tab 指示)。
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { api } from "./api.js";
import { translate } from "./i18n.js";
import type { ChatStreamPart, ChatAttachmentInput } from "@shared/types";
import { type ChatMessageV2, type ChatMessagePart } from "@shared/part-accumulator.js";
import {
  makeBucket, touchBucket, applyPart, applyDone, applyError,
  beginSend, failSend, evictLRU, type StreamBuckets,
} from "./stream-buckets.js";

let msgIdCounter = 0;
const nextMsgId = () => `msg-v2-${++msgIdCounter}`;

/** 桶缓存上限(LRU 淘汰,流式桶永不淘汰;见 evictLRU)。 */
const MAX_BUCKETS = 8;

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
  /** 当前 thread 是否有回合在跑(后台 thread 的流式不算在这里) */
  streaming: boolean;
  /** 所有流式中的 thread id(含后台;ThreadSwitcher tab 指示用) */
  streamingThreadIds: string[];
  /** 所有流式中 thread 的焦点节点 id 去重(含后台;MapRail 球指示用) */
  streamingNodeIds: string[];
  send: (text: string, overrideThreadId?: string, displayText?: string, attachments?: ChatAttachmentInput[]) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  /** 把 proposal 消息内的 tool-call 标记为已应用/拒绝 */
  markProposalStatus: (msgId: string, toolCallIdx: number, applied: boolean) => void;
  setMessagesForNode: (messages: ChatMessageV2[]) => void;
}

/** locale: 界面语言(i18n)。用户偏好什么界面,AI 就用什么语言回复。 */
export function useChatStream(threadId: string | null, locale?: string | null): UseChatStreamResult {
  const [buckets, setBuckets] = useState<StreamBuckets>(() => new Map());
  // 事件回调与 send 闭包里读最新桶(不经 deps 冻结)
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;
  // error 事件缺 threadId 时的兜底目标(同构建内主进程总是带,防御升级窗口)
  const threadIdRef = useRef<string>(threadId ?? "");
  threadIdRef.current = threadId ?? "";

  // thread 切换:加载历史(缓存优先)。桶已有消息(流式中间态/已完成的回合)时
  // 全信桶——assistant 消息在 done 前不在 DB,重拉会丢;桶从建立起就跟踪完整生命周期。
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    (async () => {
      const existing = bucketsRef.current.get(threadId);
      if (existing && (existing.loaded || existing.messages.length > 0)) {
        setBuckets((prev) => touchBucket(prev, threadId, Date.now()));
        return;
      }
      try {
        const history = await api.threadGetMessages(threadId);
        if (cancelled) return;
        setBuckets((prev) => {
          const cur = prev.get(threadId);
          if (cur && (cur.loaded || cur.messages.length > 0)) return touchBucket(prev, threadId, Date.now()); // 竞态:期间桶已建立
          const msgs = history.map((m) => {
            const restored = deserializeParts(m.partsJson);
            return {
              id: m.id,
              role: m.role,
              parts: restored ?? [{ type: "text" as const, text: m.content }],
              // 按钮触发的消息:气泡只展示短动作标签(完整提示词在 parts/content,仅供 LLM)
              ...(m.displayText ? { displayText: m.displayText } : {}),
            } satisfies ChatMessageV2;
          });
          const next = new Map(prev);
          next.set(threadId, { ...(cur ?? makeBucket(Date.now())), messages: msgs, loaded: true, touched: Date.now() });
          return evictLRU(next, MAX_BUCKETS);
        });
      } catch {
        /* 拉取失败:视图投影为空桶,事件到达时仍能建立 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // 事件订阅(全局一次,与 activeThread 无关——后台 thread 的输出继续路由进自己的桶)
  useEffect(() => {
    const offPart = api.on("chat:part", (part: ChatStreamPart, tid?: string, focusNodeId?: string) => {
      const target = tid ?? threadIdRef.current;
      setBuckets((prev) => evictLRU(applyPart(prev, target, part, nextMsgId, Date.now(), focusNodeId), MAX_BUCKETS));
    });
    const offDone = api.on(
      "chat:done",
      (_fullText: string, ids?: { userMessageId?: string; assistantMessageId?: string }, tid?: string) => {
        const target = tid ?? threadIdRef.current;
        setBuckets((prev) => applyDone(prev, target, ids, Date.now()));
      },
    );
    const offErr = api.on("chat:error", (err: string, tid?: string) => {
      const target = tid ?? threadIdRef.current;
      setBuckets((prev) => applyError(prev, target, err, nextMsgId, Date.now()));
    });
    return () => {
      offPart();
      offDone();
      offErr();
    };
  }, []);

  const send = useCallback(
    async (text: string, overrideThreadId?: string, displayText?: string, attachments?: ChatAttachmentInput[]) => {
      // 优先用 overrideThreadId(首次建 thread 后立刻发,不等 prop 更新)
      const tid = overrideThreadId ?? threadId;
      if (!tid || !text.trim()) return;
      // 同 thread 流式中拒发(跨 thread 自由——异步会话的核心)
      if (bucketsRef.current.get(tid)?.streaming) return;
      const trimmed = text.trim();
      const userMsg: ChatMessageV2 = {
        id: nextMsgId(),
        role: "user",
        // 附件 chip(乐观:image 用 Composer 移交的本地 objectURL 预览)+ 原文文本
        parts: [
          ...(attachments ?? []).map(
            (a): ChatMessagePart => ({
              type: "attachment",
              attachment: {
                kind: a.kind,
                name: a.name,
                mime: a.mime,
                size: a.size,
                ...(a.previewUrl ? { previewUrl: a.previewUrl } : {}),
              },
            }),
          ),
          { type: "text", text: trimmed },
        ],
        // 按钮触发时气泡只显示短动作标签,不显示发给 LLM 的完整提示词
        ...(displayText ? { displayText } : {}),
      };
      const r = beginSend(bucketsRef.current, tid, userMsg, Date.now());
      if (!r.accepted) return;
      setBuckets(r.buckets);
      try {
        await api.agentChatThread(tid, trimmed, displayText, locale ?? null, attachments);
      } catch (e) {
        // 归位发起桶(发起后用户可能已切走,错误不能落到别的 thread 视图)
        const msg = e instanceof Error ? e.message : String(e);
        setBuckets((prev) => failSend(prev, tid, msg, nextMsgId, Date.now()));
      }
    },
    [threadId, locale],
  );

  const stop = useCallback(async () => {
    if (!threadId) return;
    try {
      await api.abortAgentChatThread(threadId);
    } catch {
      /* 忽略 */
    }
    // 立即结束当前桶的流式态(不等事件收尾,防卡输入框);
    // abort 的 reject 随后经 send catch 的 failSend 落 ⚠️ 消息
    setBuckets((prev) => {
      const b = prev.get(threadId);
      if (!b?.streaming) return prev;
      const next = new Map(prev);
      next.set(threadId, { ...b, streaming: false, streamingMsgId: null, touched: Date.now() });
      return next;
    });
  }, [threadId]);

  const clear = useCallback(() => {
    // v0.4: clear 在 thread 模型里改为"清空当前显示"(不删 DB,DB 里消息保留)
    // 真正删除整条 thread 走 useThreads.remove。清的是当前桶。
    if (!threadId) return;
    setBuckets((prev) => {
      const b = prev.get(threadId);
      if (!b) return prev;
      const next = new Map(prev);
      next.set(threadId, { ...b, messages: [], streamingMsgId: null, loaded: true, touched: Date.now() });
      return next;
    });
  }, [threadId]);

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
      if (cmd) void send(cmd.msg, undefined, translate(cmd.labelKey));
    };
    window.addEventListener("lookatstudy-command", handler);
    return () => window.removeEventListener("lookatstudy-command", handler);
  }, [send]);

  const markProposalStatus = useCallback(
    (msgId: string, toolCallIdx: number, applied: boolean) => {
      if (!threadId) return;
      setBuckets((prev) => {
        const b = prev.get(threadId);
        if (!b) return prev;
        const next = new Map(prev);
        next.set(threadId, {
          ...b,
          messages: b.messages.map((m) => {
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
        });
        return next;
      });
    },
    [threadId],
  );

  const setMessagesForNode = useCallback(
    (messages: ChatMessageV2[]) => {
      if (!threadId) return;
      setBuckets((prev) => {
        const b = prev.get(threadId) ?? makeBucket(Date.now());
        const next = new Map(prev);
        next.set(threadId, { ...b, messages, loaded: true, touched: Date.now() });
        return next;
      });
    },
    [threadId],
  );

  // 视图投影:当前 thread 的桶。空 thread=空视图。
  const bucket = threadId ? buckets.get(threadId) : undefined;
  const messages = useMemo(() => bucket?.messages ?? [], [bucket]);
  const streaming = bucket?.streaming ?? false;
  const streamingThreadIds = useMemo(
    () => Array.from(buckets.entries()).filter(([, b]) => b.streaming).map(([id]) => id),
    [buckets],
  );
  const streamingNodeIds = useMemo(
    () =>
      Array.from(buckets.values())
        .filter((b) => b.streaming && b.focusNodeId)
        .map((b) => b.focusNodeId as string)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    [buckets],
  );

  return {
    messages,
    streaming,
    streamingThreadIds,
    streamingNodeIds,
    send,
    stop,
    clear,
    markProposalStatus,
    setMessagesForNode,
  };
}
