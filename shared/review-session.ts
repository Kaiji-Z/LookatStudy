/**
 * review-session —— 复习会话(对话式复习导师)的共享纯函数层(main + renderer 同一真源)。
 *
 * 复习会话 = kind='review' 的 thread + 引擎注入【复习导师姿态】+ end_review_session 收束工具。
 * 本文件零依赖(只引 @shared/part-accumulator),verify 可直测:
 *   - REVIEW_END_TOOL_NAME:收束工具名单一真源(引擎注册 + 渲染层收束卡识别 + 轮次判定共用)
 *   - REVIEW_KICKOFF_MARKER:开场标记(kickoff 提示词开头,两侧按它划分复习轮次)
 *   - reviewXpKindForQuality:收束质量 → XP 档(与 srs:record 自评同映射:≥4 记功/≤2 记错/3 不计)
 *   - reviewRoundState:本轮收束状态(最后一次 kickoff 之后是否已有 end 结果;多轮复用线程安全)
 *
 * 设计纪律(与 srs:record Phase D 同口径):AI 收束只写 SRS 排期 + XP + streak,
 * 不写 BKT 掌握度——掌握度只由客观答题观测(quiz/exercise/record_answer)驱动。
 */
import type { ChatMessagePart } from "./part-accumulator";

/** 收束工具名——引擎注册名与渲染层 tool-result 识别必须逐字一致。 */
export const REVIEW_END_TOOL_NAME = "end_review_session";

/**
 * 开场标记:kickoff 提示词正文的开头标记(zh/en 双语版都必须以此开头)。
 * 主进程按它识别"新一轮复习从这里开始";渲染层兜底自评卡的显隐同样按它判定轮次。
 * 标记只进 content(发给 LLM),气泡展示被 display_text 覆盖,用户永远看不到它。
 */
export const REVIEW_KICKOFF_MARKER = "[[review-kickoff]]";

/** end_review_session 工具的返回形状(收束卡数据源)。 */
export interface ReviewSessionOutcome {
  status: "ended";
  quality: 1 | 2 | 3 | 4 | 5;
  summary: string;
  weakPoints: string[];
  /** SM-2 计算出的新间隔(天) */
  intervalDays: number;
  /** 下次到期时间(ISO) */
  nextDueAt: string;
  message?: string;
}

/**
 * 收束质量 → XP 档。
 * 与 ipc srs:record 自评路径的既有映射保持一致(quality>=4 → correct,<=2 → wrong,3 不计)。
 */
export function reviewXpKindForQuality(quality: number): "correct" | "wrong" | null {
  if (quality >= 4) return "correct";
  if (quality <= 2) return "wrong";
  return null;
}

/**
 * 本轮复习的收束状态(按轮次判定,从消息尾向前扫,谁先出现谁算数):
 *   - 先遇到 end 工具结果(output-available)→ "ended"(本轮已收束,再调 end 会被拒)
 *   - 先遇到 kickoff 标记 → "open"(本轮进行中)
 *   - 都没遇到 → "open"(还没发过开场也允许收束——开场失败/历史线程的宽容路径)
 * 损坏 JSON 静默跳过(与 tool-part-summary 同降级哲学)。
 * 多轮复习:同一 review 线程每次点「复习」发新 kickoff,上一轮的 end 不影响下一轮。
 */
export function reviewRoundState(
  messages: Array<{ role: string; content: string; partsJson: string | null }>,
): "open" | "ended" {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.partsJson && partsHaveEnd(jsonParts(m.partsJson))) return "ended";
    if (m.role === "user" && m.content.includes(REVIEW_KICKOFF_MARKER)) return "open";
  }
  return "open";
}

/** 损坏 JSON 返回 [](静默降级,与 tool-part-summary 同哲学)。 */
function jsonParts(partsJson: string): ChatMessagePart[] {
  try {
    const parts = JSON.parse(partsJson);
    return Array.isArray(parts) ? (parts as ChatMessagePart[]) : [];
  } catch {
    return [];
  }
}

/** 渲染层变体:ChatMessageV2[] 上判本轮收束状态(兜底自评卡显隐)。 */
export function reviewRoundStateFromParts(
  messages: Array<{ role: "user" | "assistant"; parts: ChatMessagePart[] }>,
): "open" | "ended" {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && partsHaveEnd(m.parts)) return "ended";
    if (m.role === "user" && partsText(m.parts).includes(REVIEW_KICKOFF_MARKER)) return "open";
  }
  return "open";
}

function partsHaveEnd(parts: ChatMessagePart[]): boolean {
  for (const part of parts) {
    if (
      part.type === "tool-call" &&
      part.toolName === REVIEW_END_TOOL_NAME &&
      part.state === "output-available"
    ) {
      return true;
    }
  }
  return false;
}

function partsText(parts: ChatMessagePart[]): string {
  return parts
    .filter((p): p is Extract<ChatMessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}
