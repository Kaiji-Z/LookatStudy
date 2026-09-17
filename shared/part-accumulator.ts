/**
 * part 累积器 —— 把流式 ChatStreamPart[] 累积成渲染/持久层 message.parts[]。
 *
 * 这是 main 与 renderer 共用的单一真源:
 *  - renderer(useChatStream) 用它把 chat:part 事件流累积成内存消息
 *  - main(agent-engine) 用它在流式结束时累积出 parts[] 持久化到 chat_messages.parts_json
 *
 * 纯函数:不修改入参,返回全新数组+全新对象(React 19 严格模式双调用安全,见 verify-stream-parts T1b)。
 */
import type { ChatStreamPart, ChatAttachmentRef } from "./types";

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
    }
  /** v0.10: 用户消息的附件 chip(仅持久化/乐观显示;流式协议从不产生,accumulatePart 不处理)。 */
  | { type: "attachment"; attachment: ChatAttachmentRef };

export interface ChatMessageV2 {
  id: string;
  role: "user" | "assistant";
  parts: ChatMessagePart[];
  /** 气泡展示覆盖:user 消息为按钮触发时存短动作标签,渲染层优先于 parts 文本。 */
  displayText?: string;
}

/**
 * 把一个流式 part 累积进 currentParts,返回全新数组。
 * - text/reasoning: 合并到上一条同类(避免碎片化)
 * - tool-start: 追加一条 input-available 的 tool-call
 * - tool-result/tool-error: 回填到最后一条匹配的 input-available tool-call
 */
export function accumulatePart(
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

/**
 * 工具错误可见性掩码(v0.37.1)——与 parts 等长的 boolean[],false=该块不应渲染。
 *
 * 规则:同一条消息内,output-error 的 tool-call 若被**其后**同 toolName 的
 * input-available / output-available 接替(=模型当场重试并成功),则错误块隐藏——
 * 弱模型出题/画图首次入参过不了 zod 校验、重试即对是常态(实测:出题先闪一个
 * 错误块再正常显示题目),重试已成功的瞬时失败展示出来纯属噪音。
 * 没有接替者的错误保持可见(真失败必须浮出,绝不静默吞)。
 */
export function toolErrorVisibility(parts: ChatMessagePart[]): boolean[] {
  return parts.map((p, i) => {
    if (p.type !== "tool-call" || p.state !== "output-error") return true;
    return !parts.some(
      (q, j) =>
        j > i &&
        q.type === "tool-call" &&
        q.toolName === p.toolName &&
        (q.state === "input-available" || q.state === "output-available"),
    );
  });
}
