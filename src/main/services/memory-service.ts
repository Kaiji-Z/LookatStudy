/**
 * Memory 服务 —— 学习者模型（定性层）。
 *
 * 定位（与 BKT / friction_log 正交，不重复）：
 *   - BKT(progress.mastery)  = 定量标量"懂不懂 X"
 *   - friction_log           = 原始事件流"这次卡哪"
 *   - memory（本服务）        = 综合/模式"怎么学、什么讲法管用、跨节点反复卡点"
 *
 * 写侧：agent remember tool → 写时 LLM 合并（去重/解冲突）→ 按 (category,nodeId) 槽位 upsert。
 *   - merge 函数**注入式**：生产用 defaultLlmMerge(llm)（resolveLlm 出来的 model），
 *     测试用确定性 stub（见 verify-memory.mjs）。这样写逻辑不绑 LLM，可闭环测。
 *   - 合并而非覆盖，防"越用越乱"（Mem0 Updater 思路，砍掉向量/抽取 pass）。
 *
 * 读侧：getLearnerMemory → 拼成"学习者记忆"块字符串（或 null），由 agent-engine 注入上下文。
 *
 * 槽位语义：
 *   - global          nodeId=null，1 条"学习者整体"（含学习风格/偏好/未来声明式画像）
 *   - node            nodeId=X，每节点 1 条"本节点历史/缺口"
 *   - friction_pattern nodeId=null，跨节点反复模式（Phase 3 从 friction_log 提炼，也可 agent 手记）
 *
 * Phase 1.5 将建 learner-model 投影统一 mastery+friction+memory 三处注入；本服务只管 memory。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { memory as memoryTable } from "../db/schema.js";
import { randomUUID } from "node:crypto";

type Db = SQLJsDatabase<typeof schema>;

export type MemoryCategory = "global" | "node" | "friction_pattern";

export interface MemoryEntry {
  id: string;
  nodeId: string | null;
  summary: string;
  category: MemoryCategory;
}

export interface RememberInput {
  category: MemoryCategory;
  content: string;
  /** 仅 category='node' 时生效；global/friction_pattern 强制 nodeId=null */
  nodeId?: string | null;
}

/**
 * merge 函数：把"现有槽 summary"与"新 content"合成一条。
 * 生产 = LLM 合并；测试 = 确定性 stub。注入式以解耦 LLM。
 */
export type MergeFn = (existing: string | null, incoming: string) => Promise<string>;

/* ---------- 读 ---------- */

/** 取某槽位 (category + nodeId) 的当前条目。global/pattern 作用域 nodeId=null。 */
export function getSlot(
  db: Db,
  category: MemoryCategory,
  nodeId?: string | null,
): MemoryEntry | null {
  const where =
    nodeId === undefined || nodeId === null
      ? and(eq(memoryTable.category, category), isNull(memoryTable.nodeId))
      : and(eq(memoryTable.category, category), eq(memoryTable.nodeId, nodeId));
  const row = db.select().from(memoryTable).where(where).get();
  return row ? mapRow(row) : null;
}

/**
 * 读学习者记忆 → 拼成"学习者记忆"块字符串。
 * 含：global（必带）+ node（仅当传 nodeId 且该节点有记忆）+ friction_pattern（有则带）。
 * 全空 → 返回 null（agent-engine 不注入该块，新用户零副作用）。
 */
export function getLearnerMemory(db: Db, nodeId?: string | null): string | null {
  const globalRow = getSlot(db, "global");
  const patternRow = getSlot(db, "friction_pattern");
  const nodeRow = nodeId ? getSlot(db, "node", nodeId) : null;

  const lines: string[] = [];
  if (globalRow) lines.push(`• 学习者整体:${globalRow.summary}`);
  if (nodeRow) lines.push(`• 本节点:${nodeRow.summary}`);
  if (patternRow) lines.push(`• 跨节点模式:${patternRow.summary}`);

  return lines.length > 0 ? lines.join("\n") : null;
}

/* ---------- 写（注入式 merge） ---------- */

/**
 * 记一条学习者记忆。取现有槽 → merge(现有, 新) → upsert。
 * @returns { ok, summary } summary 为合并后结果（agent 可据此确认记下了什么）
 */
export async function remember(
  db: Db,
  input: RememberInput,
  merge: MergeFn,
): Promise<{ ok: true; summary: string }> {
  const category = input.category;
  const nodeId = category === "node" ? (input.nodeId ?? null) : null;
  const existing = getSlot(db, category, nodeId);
  const merged = await merge(existing?.summary ?? null, input.content);
  upsertSlot(db, { category, nodeId, summary: merged, existingId: existing?.id });
  return { ok: true, summary: merged };
}

function upsertSlot(
  db: Db,
  args: { category: MemoryCategory; nodeId: string | null; summary: string; existingId?: string },
): void {
  if (args.existingId) {
    db.update(memoryTable)
      .set({ summary: args.summary, updatedAt: new Date().toISOString() })
      .where(eq(memoryTable.id, args.existingId))
      .run();
  } else {
    db.insert(memoryTable)
      .values({
        id: randomUUID(),
        nodeId: args.nodeId,
        summary: args.summary,
        category: args.category,
      })
      .run();
  }
}

/* ---------- 生产 merge（LLM） ---------- */

/**
 * 生产用 merge：把"现有槽 + 新事实"喂给 resolveLlm 出来的 model，产出一条
 * 去重 / 解冲突 / 保简洁的 summary（Mem0 Updater 思路）。
 * agent-engine 调用：remember(db, input, defaultLlmMerge(llm))。
 * 动态 import "ai" —— 测试侧（用确定性 stub）不触发此路径，service 不硬绑 AI SDK。
 */
export function defaultLlmMerge(llm: unknown): MergeFn {
  return async (existing, incoming) => {
    const { generateText } = await import("ai");
    const prompt = existing
      ? `你是记忆合并器。现有学习者记忆:\n${existing}\n\n新观察到的事实:\n${incoming}\n\n` +
        `合并成一条简洁中文 summary:去重(意思一样的并起来)、解冲突(矛盾处以新事实为准,但持久事实如背景/目标别丢)、控制在 3-5 句内。只输出 summary 正文,不要前后缀。`
      : `把以下事实整理成一条简洁中文 summary(学习者记忆,3-5 句内,只输出正文):\n${incoming}`;
    const res = await generateText({ model: llm as never, prompt });
    return (res.text || incoming).trim();
  };
}

/* ---------- 内部 ---------- */

function mapRow(row: {
  id: string;
  nodeId: string | null;
  summary: string;
  category: string;
}): MemoryEntry {
  return {
    id: row.id,
    nodeId: row.nodeId,
    summary: row.summary,
    category: row.category as MemoryCategory,
  };
}
