/**
 * Thread Service —— v0.4 会话线程模型(类 Cursor 项目-会话)。
 *
 * 把"节点即会话"升级为"课程(项目)→ 多 thread → 节点是素材"。
 *
 * CRUD:
 *   - listThreads(courseId, status?) 按 updated_at 倒序
 *   - createThread(courseId, focusNodeId?, title?)
 *   - updateThread(id, { title?, status?, focusNodeId? })
 *   - deleteThread(id) 连带删除该 thread 的所有 chat_messages(硬删)
 *
 * 消息:
 *   - getThreadMessages(threadId) 按时间正序
 *   - appendMessage(threadId, role, content, partsJson?) 返回新消息 + 更新 thread.message_count/updated_at
 *
 * 不读写旧 chat_sessions 表(向后兼容)。
 */
import { getDb, markDirty } from "../db/index.js";
import { threads, chatMessages, proposals, type ThreadStatus } from "../db/schema.js";
import { eq, and, desc, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface Thread {
  id: string;
  courseId: string;
  title: string | null;
  focusNodeId: string | null;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageRow {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  partsJson: string | null;
  createdAt: string;
}

/** 列出某课程的 threads(可选状态过滤,按 updated_at 倒序)。 */
export function listThreads(courseId: string, status?: ThreadStatus): Thread[] {
  const db = getDb();
  const condition = status
    ? and(eq(threads.courseId, courseId), eq(threads.status, status))
    : eq(threads.courseId, courseId);
  return db
    .select()
    .from(threads)
    .where(condition)
    .orderBy(desc(threads.updatedAt))
    .all() as Thread[];
}

/** 新建 thread。 */
export function createThread(input: {
  courseId: string;
  focusNodeId?: string | null;
  title?: string | null;
}): Thread {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    courseId: input.courseId,
    title: input.title ?? null,
    focusNodeId: input.focusNodeId ?? null,
    status: "active" as ThreadStatus,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  db.insert(threads).values(row).run();
  markDirty();
  return row;
}

/** 更新 thread(标题/状态/焦点节点)。返回更新后的行,找不到返回 null。 */
export function updateThread(
  id: string,
  patch: { title?: string; status?: ThreadStatus; focusNodeId?: string | null },
): Thread | null {
  const db = getDb();
  const existing = db.select().from(threads).where(eq(threads.id, id)).get() as Thread | undefined;
  if (!existing) return null;
  const next: Partial<Thread> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.focusNodeId !== undefined) next.focusNodeId = patch.focusNodeId;
  db.update(threads).set(next).where(eq(threads.id, id)).run();
  markDirty();
  return { ...existing, ...next } as Thread;
}

/** 删除 thread + 连带删除它的所有 chat_messages(硬删)。 */
export function deleteThread(id: string): void {
  const db = getDb();
  db.delete(chatMessages).where(eq(chatMessages.threadId, id)).run();
  db.delete(threads).where(eq(threads.id, id)).run();
  markDirty();
}

/** 获取某 thread 的全部消息(按时间正序)。 */
export function getThreadMessages(threadId: string): ChatMessageRow[] {
  const db = getDb();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt))
    .all() as ChatMessageRow[];
}

/**
 * 给渲染层用的消息视图:在 getThreadMessages 基础上,把 parts_json 里引用的
 * proposal 状态 patch 成 proposals 表的真值。
 *
 * 为什么需要:mark_mastered 落库时 output.status="pending",但用户可能已 apply/reject
 * (状态只更新了 proposals 表,没回写 parts_json)。不 patch 的话,重载后已决议的提议卡
 * 会重新显示"采纳"按钮,点击还会触发 applyProposal 的 "not pending" 报错。
 *
 * agent-engine 不用本函数(它只读 role/content 组装历史,不碰 parts)。
 */
export function getThreadMessagesForDisplay(threadId: string): ChatMessageRow[] {
  const db = getDb();
  const rows = getThreadMessages(threadId);

  // 1) 扫所有 parts_json,收集引用到的 proposalId
  const proposalIds = new Set<string>();
  for (const row of rows) {
    if (!row.partsJson) continue;
    let parts: unknown;
    try {
      parts = JSON.parse(row.partsJson);
    } catch {
      continue;
    }
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (
        p && typeof p === "object" && (p as { type?: string }).type === "tool-call" &&
        ((p as { toolName?: string }).toolName === "mark_mastered" ||
          (p as { toolName?: string }).toolName === "record_answer")
      ) {
        const pid = (p as { output?: { proposalId?: unknown } }).output?.proposalId;
        if (typeof pid === "string") proposalIds.add(pid);
      }
    }
  }
  if (proposalIds.size === 0) return rows; // 无提议 → 原样返回,跳过序列化开销

  // 2) 批量查真值 status
  const statusMap = new Map<string, string>();
  for (const pid of proposalIds) {
    const r = db.select({ status: proposals.status }).from(proposals).where(eq(proposals.id, pid)).get();
    if (r) statusMap.set(pid, r.status);
  }
  if (statusMap.size === 0) return rows;

  // 3) patch 每个 row 的 parts_json(output.status ← 真值),重新序列化
  return rows.map((row) => {
    if (!row.partsJson) return row;
    let parts: unknown;
    try {
      parts = JSON.parse(row.partsJson);
    } catch {
      return row;
    }
    if (!Array.isArray(parts)) return row;
    let changed = false;
    for (const p of parts) {
      if (
        p && typeof p === "object" && (p as { type?: string }).type === "tool-call" &&
        ((p as { toolName?: string }).toolName === "mark_mastered" ||
          (p as { toolName?: string }).toolName === "record_answer")
      ) {
        const out = (p as { output?: { proposalId?: unknown; status?: unknown } }).output;
        const pid = out?.proposalId;
        if (typeof pid === "string" && statusMap.has(pid)) {
          const live = statusMap.get(pid)!;
          if (out?.status !== live) {
            (p as { output: Record<string, unknown> }).output = { ...(out ?? {}), status: live };
            changed = true;
          }
        }
      }
    }
    return changed ? { ...row, partsJson: JSON.stringify(parts) } : row;
  });
}

/** 追加一条消息,同步更新 thread 的 message_count + updated_at。 */
export function appendMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  partsJson?: string | null,
): ChatMessageRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    threadId,
    role,
    content,
    partsJson: partsJson ?? null,
    createdAt: now,
  };
  db.insert(chatMessages).values(row).run();
  // 更新 thread 计数 + 时间
  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get() as Thread | undefined;
  if (thread) {
    db.update(threads)
      .set({
        messageCount: thread.messageCount + 1,
        updatedAt: now,
      })
      .where(eq(threads.id, threadId))
      .run();
  }
  markDirty();
  return row;
}

/** 找某节点最近更新的 active thread(点地图节点时用)。没有返回 null。 */
export function findRecentThreadByNode(
  courseId: string,
  nodeId: string,
): Thread | null {
  const db = getDb();
  const row = db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.courseId, courseId),
        eq(threads.focusNodeId, nodeId),
        eq(threads.status, "active"),
      ),
    )
    .orderBy(desc(threads.updatedAt))
    .all() as Thread[];
  return row[0] ?? null;
}
