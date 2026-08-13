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
import { eq, and, isNull, inArray, desc, ne } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  memory as memoryTable,
  threads as threadsTable,
  chatMessages,
  frictionLog,
  contentNodes,
} from "../db/schema.js";
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

/**
 * 取某槽位的当前条目。槽位键按类别不同：
 *   - global:node_id IS NULL,course_id 无关(跨课程风格)
 *   - node:node_id = nodeId(节点自带课程,不需 course_id)
 *   - friction_pattern:node_id IS NULL + course_id = courseId(课程隔离);
 *                       courseId 缺省 → 匹配 course_id IS NULL(无课程上下文的兜底槽)
 */
export function getSlot(
  db: Db,
  category: MemoryCategory,
  nodeId?: string | null,
  courseId?: string | null,
): MemoryEntry | null {
  let row;
  if (category === "node") {
    row = db
      .select()
      .from(memoryTable)
      .where(and(eq(memoryTable.category, "node"), eq(memoryTable.nodeId, nodeId ?? "")))
      .get();
  } else if (category === "friction_pattern") {
    const courseCond = courseId
      ? eq(memoryTable.courseId, courseId)
      : isNull(memoryTable.courseId);
    row = db
      .select()
      .from(memoryTable)
      .where(
        and(
          eq(memoryTable.category, "friction_pattern"),
          isNull(memoryTable.nodeId),
          courseCond,
        ),
      )
      .get();
  } else {
    // global:跨课程
    row = db
      .select()
      .from(memoryTable)
      .where(and(eq(memoryTable.category, "global"), isNull(memoryTable.nodeId)))
      .get();
  }
  return row ? mapRow(row) : null;
}

/**
 * 读学习者记忆 → 拼成"学习者记忆"块字符串。
 * 含：global（必带,跨课程）+ node（仅当传 nodeId）+ friction_pattern（按 courseId 过滤,课程隔离）。
 * 全空 → 返回 null（agent-engine 不注入该块，新用户零副作用）。
 */
export function getLearnerMemory(
  db: Db,
  nodeId?: string | null,
  courseId?: string | null,
): string | null {
  const globalRow = getSlot(db, "global");
  const patternRow = getSlot(db, "friction_pattern", undefined, courseId);
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
  courseId?: string | null,
): Promise<{ ok: true; summary: string }> {
  const category = input.category;
  const nodeId = category === "node" ? (input.nodeId ?? null) : null;
  // friction_pattern 课程隔离:存 course_id;global/node 不用(node 自带课程,global 跨课程)
  const memCourseId = category === "friction_pattern" ? (courseId ?? null) : null;
  const existing = getSlot(db, category, nodeId, memCourseId);
  const merged = await merge(existing?.summary ?? null, input.content);
  upsertSlot(db, {
    category,
    nodeId,
    courseId: memCourseId,
    summary: merged,
    existingId: existing?.id,
  });
  return { ok: true, summary: merged };
}

function upsertSlot(
  db: Db,
  args: {
    category: MemoryCategory;
    nodeId: string | null;
    courseId: string | null;
    summary: string;
    existingId?: string;
  },
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
        courseId: args.courseId,
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

/* ---------- Consolidation(记忆固化:全三类) ---------- */

/**
 * Consolidation 窗口:调用方(触发/采集层)从原始数据 gather 出来的快照。
 * 核心不关心怎么采,只消费 window。
 */
export interface ConsolidationWindow {
  courseId?: string | null;
  nodeId?: string | null;
  conversation: Array<{ role: string; content: string }>;
  frictionEntries: Array<{ category: string; summary?: string | null }>;
  answers: Array<{ correct: boolean; summary?: string | null }>;
}

export type ExistingMemory = {
  global?: string | null;
  node?: string | null;
  friction_pattern?: string | null;
};
/** 每个类别返回更新后的 summary(已与 existing 合并);未返回的类别不被触碰 */
export type ConsolidatedMemory = Partial<Record<MemoryCategory, string>>;

/**
 * consolidateFn:看 window(原始)+ existing(现有 memory)→ 返回每类更新后 summary。
 * 生产 defaultLlmConsolidate(llm) 一次 LLM 调用 extract+merge 全三类;测试用确定性 stub。
 */
export type ConsolidateFn = (
  win: ConsolidationWindow,
  existing: ExistingMemory,
) => Promise<ConsolidatedMemory>;

/**
 * 记忆固化:把原始数据(对话/friction/答题)固化进全三类 memory。
 * 这是 agent `remember`(实时手动)的系统级兜底——不靠 agent 自觉。
 * 触发无关:window 由调用方采集传入;合并由 consolidateFn 做(它收到 existing)。
 * @returns 实际写入的类别 summary(未返回的类别不写)
 */
/** 自动固化的节流间隔(每课程):避免每个 turn 都跑 LLM 固化。 */
export const CONSOLIDATE_THROTTLE_MS = 5 * 60 * 1000;

/** 节流决策(纯函数):该课程距上次固化是否已过 throttle。lastAtMs=null=从未固化→true。 */
export function consolidationDue(
  lastAtMs: number | null,
  nowMs: number,
  throttleMs: number = CONSOLIDATE_THROTTLE_MS,
): boolean {
  return lastAtMs === null || nowMs - lastAtMs >= throttleMs;
}

export async function consolidate(
  db: Db,
  win: ConsolidationWindow,
  fn: ConsolidateFn,
): Promise<ConsolidatedMemory> {
  const existing: ExistingMemory = {
    global: getSlot(db, "global")?.summary ?? null,
    node: win.nodeId ? (getSlot(db, "node", win.nodeId)?.summary ?? null) : null,
    friction_pattern: (win.courseId
      ? getSlot(db, "friction_pattern", undefined, win.courseId)
      : getSlot(db, "friction_pattern")
    )?.summary ?? null,
  };

  const updated = await fn(win, existing);

  if (updated.global !== undefined) {
    upsertSlot(db, {
      category: "global",
      nodeId: null,
      courseId: null,
      summary: updated.global,
      existingId: getSlot(db, "global")?.id,
    });
  }
  if (updated.node !== undefined && win.nodeId) {
    upsertSlot(db, {
      category: "node",
      nodeId: win.nodeId,
      courseId: null,
      summary: updated.node,
      existingId: getSlot(db, "node", win.nodeId)?.id,
    });
  }
  if (updated.friction_pattern !== undefined) {
    const fpCourse = win.courseId ?? null;
    upsertSlot(db, {
      category: "friction_pattern",
      nodeId: null,
      courseId: fpCourse,
      summary: updated.friction_pattern,
      existingId: getSlot(db, "friction_pattern", undefined, fpCourse)?.id,
    });
  }
  return updated;
}

/**
 * 窗口采集:从原始数据(thread 消息 + friction_log)gather 出 ConsolidationWindow。
 * 整课程范围(friction_pattern 本就跨节点);近期窗口防过长。
 * answers v1 暂空(答题历史无干净查询源,可后续从 proposals/canvas last_result 补)。
 */
export function gatherConsolidationWindow(
  db: Db,
  opts: { courseId: string; messageLimit?: number; frictionLimit?: number },
): ConsolidationWindow {
  const messageLimit = opts.messageLimit ?? 30;
  const frictionLimit = opts.frictionLimit ?? 20;

  // 课程节点 id(给 friction 按 course 圈定)
  const nodeIds = db
    .select({ id: contentNodes.id })
    .from(contentNodes)
    .where(eq(contentNodes.courseId, opts.courseId))
    .all()
    .map((r) => r.id);

  // 课程所有 active thread 的近期消息(每 thread 内时间正序)
  const courseThreads = db
    .select()
    .from(threadsTable)
    .where(and(eq(threadsTable.courseId, opts.courseId), eq(threadsTable.status, "active")))
    .all();
  const conversation: Array<{ role: string; content: string }> = [];
  for (const t of courseThreads) {
    const msgs = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, t.id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(messageLimit)
      .all()
      .reverse();
    conversation.push(...msgs.map((m) => ({ role: m.role, content: m.content })));
  }

  // 课程节点上的近期 friction(排除 agent_error 系统级)
  const frictionEntries = nodeIds.length
    ? db
        .select()
        .from(frictionLog)
        .where(and(inArray(frictionLog.nodeId, nodeIds), ne(frictionLog.category, "agent_error")))
        .orderBy(desc(frictionLog.createdAt))
        .limit(frictionLimit)
        .all()
        .map((f) => ({ category: f.category, summary: f.summary }))
    : [];

  return { courseId: opts.courseId, nodeId: null, conversation, frictionEntries, answers: [] };
}

/**
 * 生产 consolidateFn:一次 LLM 调用,看 window(原始)+ existing(现有 memory),
 * 产出每类更新后 summary(extract + merge 合一,Mem0 思路)。
 * 动态 import "ai";测试侧(用 stub)不触发此路径。
 */
export function defaultLlmConsolidate(llm: unknown): ConsolidateFn {
  return async (win, existing) => {
    const { generateText } = await import("ai");
    const prompt =
      `你是学习者记忆固化器。从下面的原始数据提炼/更新学习者记忆(跨会话用)。\n\n` +
      `【原始数据】\n对话:\n${win.conversation.map((m) => `- ${m.role}: ${m.content}`).join("\n") || "(无)"}\n` +
      `近期卡点:\n${win.frictionEntries.map((f) => `- ${f.category}: ${f.summary ?? ""}`).join("\n") || "(无)"}\n` +
      `答题:${win.answers.map((a) => ` ${a.correct ? "对" : "错"}(${a.summary ?? ""})`).join(" / ") || "(无)"}\n\n` +
      `【现有记忆(已有的,别丢)】global:${existing.global ?? "(无)"} | node:${existing.node ?? "(无)"} | friction_pattern:${existing.friction_pattern ?? "(无)"}\n\n` +
      `输出 JSON,键为 global/node/friction_pattern,值为更新后的简洁中文 summary(每类 1-3 句):\n` +
      `- global=学习风格/偏好/目标(从对话推);node=本节点(${win.nodeId ?? "?"})具体缺口;friction_pattern=跨节点反复模式\n` +
      `- 把新观察和 existing 合并、去重;某类有 existing 但本次无新观察→输出 existing 原值(保留);既无 existing 也无新观察→省略该键\n` +
      `- 只输出 JSON,不要前后缀。如 {"global":"...","friction_pattern":"..."}`;
    const res = await generateText({ model: llm as never, prompt });
    try {
      const parsed = JSON.parse(res.text.trim().replace(/^```json\s*|\s*```$/g, ""));
      const out: ConsolidatedMemory = {};
      for (const k of ["global", "node", "friction_pattern"] as const) {
        if (typeof parsed[k] === "string" && parsed[k].trim()) out[k] = parsed[k].trim();
      }
      return out;
    } catch {
      return {}; // LLM 返回非合法 JSON → 不写(保守,不破坏现有 memory)
    }
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
