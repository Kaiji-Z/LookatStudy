/**
 * tool-part-summary —— 把 assistant 消息里持久化的工具调用 parts 压成简明文字标记。
 *
 * 为什么:thread 历史喂给 LLM 时只有 role+content 纯文本(附件/工具产物在 parts_json,
 * 只用于渲染)。上一回合发过答题卡但正文只有一句"来做题吧"时,模型下一回合对自己
 * 的工具调用完全失忆 —— 会"道歉说没真正发出题"然后重发(真实事故)。把工具调用
 * 压成一行标记注入历史 content,模型就能看见"我当时确实发出了产物"。
 *
 * 纯函数;损坏 JSON 返回空串(历史装配静默降级)。
 */
import type { ChatMessagePart } from "@shared/part-accumulator";

interface ArtifactLike {
  artifactType?: string;
  title?: string;
  questions?: unknown[];
  nodes?: unknown[];
  edges?: unknown[];
  headers?: unknown[];
  rows?: unknown[];
}

function describeOne(toolName: string, output: unknown): string {
  const o = (output ?? {}) as ArtifactLike;
  const title = typeof o.title === "string" && o.title ? `《${o.title}》` : "";
  switch (o.artifactType ?? toolName) {
    case "quiz":
      return `已向学习者发出交互答题卡${title}(共 ${o.questions?.length ?? "?"} 题),学习者可直接作答`;
    case "concept_map":
      return `已向学习者展示概念图${title}(${o.nodes?.length ?? "?"} 个节点)`;
    case "compare_table":
      return `已向学习者展示对比表${title}(${o.rows?.length ?? "?"} 行)`;
    case "diagram":
      return `已向学习者展示流程图${title}`;
    case "code_walkthrough":
      return `已向学习者展示代码讲解${title}`;
    case "guess":
      return `已向学习者发出二选一猜测(不计分)`;
    case "pose_guess":
      return `已向学习者发出二选一猜测(不计分)`;
    default:
      // attach_node_images / remember / propose_* 等:统一说"已执行",别让模型以为没发
      return `已执行工具 ${toolName},产物/效果已作用于学习者界面`;
  }
}

/** 把持久化 parts 压成多行标记(只 summarise tool-call;text/reasoning 已在 content 里)。 */
export function summarizeToolParts(parts: ChatMessagePart[]): string {
  const lines: string[] = [];
  for (const p of parts) {
    if (p.type !== "tool-call") continue;
    if (p.state === "output-available") {
      lines.push(`[工具调用已执行] ${p.toolName} → ${describeOne(p.toolName, p.output)}`);
    } else if (p.state === "output-error") {
      // 工具失败也要可见:模型才知道当时确实失败过(而不是"忘了发")
      lines.push(`[工具调用失败] ${p.toolName} → ${p.error ?? "执行失败"}`);
    }
    // input-available(流被中断,工具没跑完)不标——如实留白
  }
  return lines.join("\n");
}

/** JSON 包装版(历史装配用):null/损坏返回空串。 */
export function summarizeToolPartsJson(partsJson: string | null): string {
  if (!partsJson) return "";
  try {
    const parts = JSON.parse(partsJson) as ChatMessagePart[];
    if (!Array.isArray(parts)) return "";
    return summarizeToolParts(parts);
  } catch {
    return "";
  }
}
