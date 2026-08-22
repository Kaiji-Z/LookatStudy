/**
 * stream-buckets.ts —— v0.23 异步会话的 per-thread 流式状态纯函数。
 *
 * 背景(2026-08-22 用户需求):AI 思考中允许切节点,原 thread 在后台继续流式输出,
 * 新节点自由开新会话。旧实现 chat:part 不带 threadId 且流式状态全局单值,
 * 切节点会把 A 的回答混进 B 的消息列表、chat:done 错换 B 的消息 id、B 的
 * 输入框被全局 streaming 锁死——"会话混乱要刷新"的根因。
 *
 * 模型:每个 thread 一个桶(bucket),流式事件按 threadId 路由进桶;视图只是
 * 当前 activeThread 桶的观察窗口。全部纯函数(不可变更新),React 19 StrictMode
 * 双调用安全;消息 id 由调用方注入(makeId),函数自身零副作用可直接 verify。
 */
import type { ChatStreamPart } from "@shared/types";
import { accumulatePart, type ChatMessageV2 } from "@shared/part-accumulator";

/** 单个 thread 的流式状态桶。 */
export interface StreamBucket {
  messages: ChatMessageV2[];
  /** 该 thread 是否有 agent 回合在跑(后台也算) */
  streaming: boolean;
  /** 当前流式追加的 assistant 消息 id(null=下一个 part 到达时新建) */
  streamingMsgId: string | null;
  /** DB 历史是否已加载过(缓存优先于重拉:流式未落库的 assistant 消息只在桶里) */
  loaded: boolean;
  /** thread 的焦点节点(part 事件携带;地图球后台流式指示用) */
  focusNodeId: string | null;
  /** LRU 时序戳,每次访问由调用方 touchBucket 更新 */
  touched: number;
}

export type StreamBuckets = Map<string, StreamBucket>;

/** 建空桶(不修改入参;已存在则原样返回)。 */
export function makeBucket(now: number): StreamBucket {
  return { messages: [], streaming: false, streamingMsgId: null, loaded: false, focusNodeId: null, touched: now };
}

/** 取桶;不存在则放入空桶并返回新 Map(不存在时才拷贝)。 */
export function ensureBucket(buckets: StreamBuckets, threadId: string, now: number): StreamBuckets {
  if (buckets.has(threadId)) return buckets;
  const next = new Map(buckets);
  next.set(threadId, makeBucket(now));
  return next;
}

/** touch(更新 LRU 时序戳);桶不存在则忽略。 */
export function touchBucket(buckets: StreamBuckets, threadId: string, now: number): StreamBuckets {
  const b = buckets.get(threadId);
  if (!b || b.touched === now) return buckets;
  const next = new Map(buckets);
  next.set(threadId, { ...b, touched: now });
  return next;
}

/**
 * 把一个 chat:part 路由进指定 thread 的桶。
 * 目标消息决策(与旧单线程逻辑同构,只是圈定在桶内):
 *   1. 桶 streamingMsgId 还在 → 追加到它
 *   2. 桶最后一条是 assistant(本回合已开流) → 追加到它
 *   3. 否则 → 新建 assistant 消息(id 由 makeId 生成),记为 streamingMsgId
 * 其他桶一律不动(跨 thread 零污染——本文件存在的意义)。
 */
export function applyPart(
  buckets: StreamBuckets,
  threadId: string,
  part: ChatStreamPart,
  makeId: () => string,
  now: number,
  /** part 事件携带的焦点节点(地图球后台指示);缺省保留桶内已有值 */
  focusNodeId?: string,
): StreamBuckets {
  const base = ensureBucket(buckets, threadId, now);
  const b = base.get(threadId)!;
  let targetId = b.streamingMsgId;
  let messages = b.messages;
  const exists = targetId && messages.some((m) => m.id === targetId);
  if (!exists) {
    const last = messages[messages.length - 1];
    if (b.streaming && last && last.role === "assistant") {
      // 流式中续流:本回合已开流的 assistant 消息继续追加。
      // 只在 streaming 态做此回退——非流式态强制新建,历史消息永不被追加。
      targetId = last.id;
    } else {
      targetId = makeId();
      messages = [...messages, { id: targetId, role: "assistant" as const, parts: [] }];
    }
  }
  const next = new Map(base);
  next.set(threadId, {
    ...b,
    messages: messages.map((m) => (m.id === targetId ? { ...m, parts: accumulatePart(m.parts, part) } : m)),
    streamingMsgId: targetId,
    focusNodeId: focusNodeId ?? b.focusNodeId,
    touched: now,
  });
  return next;
}

/**
 * chat:done 归位:结束该桶流式,把流式临时 id 替换成 DB 真实 id
 * (画线笔记溯源跨重载稳定匹配的前提)。只动目标桶。
 */
export function applyDone(
  buckets: StreamBuckets,
  threadId: string,
  ids: { userMessageId?: string; assistantMessageId?: string } | undefined,
  now: number,
): StreamBuckets {
  const b = buckets.get(threadId);
  if (!b) return buckets;
  let lastUserIdx = -1;
  let lastAssistantIdx = -1;
  for (let i = b.messages.length - 1; i >= 0; i--) {
    if (b.messages[i]!.role === "user" && lastUserIdx === -1) lastUserIdx = i;
    if (b.messages[i]!.role === "assistant" && lastAssistantIdx === -1) lastAssistantIdx = i;
    if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break;
  }
  const messages = b.messages.map((m, i) => {
    if (i === lastUserIdx && ids?.userMessageId) return { ...m, id: ids.userMessageId };
    if (i === lastAssistantIdx && ids?.assistantMessageId) return { ...m, id: ids.assistantMessageId };
    return m;
  });
  const next = new Map(buckets);
  next.set(threadId, { ...b, messages, streaming: false, streamingMsgId: null, touched: now });
  return next;
}

/** chat:error 归位:结束该桶流式 + 追加 ⚠️ assistant 消息(只动目标桶)。 */
export function applyError(
  buckets: StreamBuckets,
  threadId: string,
  err: string,
  makeId: () => string,
  now: number,
): StreamBuckets {
  const base = ensureBucket(buckets, threadId, now);
  const b = base.get(threadId)!;
  const next = new Map(base);
  next.set(threadId, {
    ...b,
    messages: [...b.messages, { id: makeId(), role: "assistant" as const, parts: [{ type: "text" as const, text: `⚠️ ${err}` }] }],
    streaming: false,
    streamingMsgId: null,
    touched: now,
  });
  return next;
}

/** 发起回合(send):追加乐观 user 消息 + 置流式态。同桶已在流式时拒绝(false)。 */
export function beginSend(
  buckets: StreamBuckets,
  threadId: string,
  userMsg: ChatMessageV2,
  now: number,
): { buckets: StreamBuckets; accepted: boolean } {
  const base = ensureBucket(buckets, threadId, now);
  const b = base.get(threadId)!;
  if (b.streaming) return { buckets, accepted: false }; // 同 thread 流式中拒发(跨 thread 自由)
  const next = new Map(base);
  next.set(threadId, {
    ...b,
    messages: [...b.messages, userMsg],
    streaming: true,
    streamingMsgId: null,
    touched: now,
  });
  return { buckets: next, accepted: true };
}

/** 发送失败(send 的 invoke 抛错):结束发起桶流式 + 追加错误消息(归位发起桶,不是当前视图)。 */
export function failSend(
  buckets: StreamBuckets,
  threadId: string,
  err: string,
  makeId: () => string,
  now: number,
): StreamBuckets {
  return applyError(buckets, threadId, err, makeId, now);
}

/**
 * LRU 淘汰:保留最近 keep 个桶,**流式中的桶永不淘汰**(后台思考不许丢)。
 * 淘汰后重新进入该 thread 会走 DB 重载(已落库的消息不丢,只有未落库的流式
 * 中间态会丢——而流式桶不淘汰,所以实际不丢)。
 */
export function evictLRU(buckets: StreamBuckets, keep: number): StreamBuckets {
  if (buckets.size <= keep) return buckets;
  const entries = Array.from(buckets.entries()).filter(([, b]) => !b.streaming);
  const pinned = buckets.size - entries.length; // 流式桶数量
  const slots = Math.max(0, keep - pinned);
  if (entries.length <= slots) return buckets;
  entries.sort((a, b) => a[1].touched - b[1].touched);
  const next = new Map(buckets);
  for (let i = 0; i < entries.length - slots; i++) next.delete(entries[i]![0]);
  return next;
}
