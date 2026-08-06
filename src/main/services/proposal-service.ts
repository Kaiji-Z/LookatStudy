/**
 * Proposal 流水线 —— AI 提议、人来批准的学习状态变更（VERIFICATION §M2 / ARCHITECTURE v2 原则 2）。
 *
 * 核心铁律：**AI 绝不直接改学习者状态**。所有持久状态变更（掌握度、进度、SRS 入队）
 * 先包装成 Proposal（status=pending），学习者 apply（同意）或 reject（拒绝）后才落库。
 *
 * Operation 类型（学习场景的"原子改动"）：
 *   - update_mastery : 用 BKT 更新某节点掌握度（基于一次答题观测）
 *   - mark_mastered  : 把节点进度标 mastered（crown 满）
 *   - set_node_status: 改 progress.status
 *   - add_to_srs     : 把节点入 SRS 队列
 *
 * apply 时按 operations 顺序原子回放；任一失败回滚（status=stale，记录失败原因）。
 * 这样 AI 即使生成离谱提议，也不会污染学习者数据。
 *
 * DB 注入式，便于无头测试。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  proposals as proposalsTable,
  progress as progressTable,
  srsItems,
} from "../db/schema.js";
import { randomUUID } from "node:crypto";
import { updateMastery, BKT_DEFAULTS } from "./pure/bkt.js";

type Db = SQLJsDatabase<typeof schema>;

/* ---------- 类型 ---------- */

export type OperationType =
  | "update_mastery"
  | "mark_mastered"
  | "set_node_status"
  | "add_to_srs";

export interface LearningOperation {
  type: OperationType;
  nodeId: string;
  // update_mastery: correct = 这次观测是否答对
  correct?: boolean;
  // set_node_status: status = 目标状态
  status?: "locked" | "available" | "in_progress" | "mastered";
  // add_to_srs: quality = 初始 SM-2 评分
  quality?: number;
}

export interface Proposal {
  id: string;
  nodeId: string | null;
  operations: LearningOperation[];
  status: "pending" | "applied" | "rejected" | "stale";
  rationale: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** apply 失败时的原因（status=stale 时有值） */
  applyError?: string;
}

/* ---------- 创建 ---------- */

export function createProposal(
  db: Db,
  input: {
    nodeId?: string | null;
    operations: LearningOperation[];
    rationale?: string;
  },
): Proposal {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(proposalsTable)
    .values({
      id,
      nodeId: input.nodeId ?? null,
      operationsJson: JSON.stringify(input.operations),
      status: "pending",
      rationale: input.rationale ?? null,
      createdAt: now,
    })
    .run();
  return {
    id,
    nodeId: input.nodeId ?? null,
    operations: input.operations,
    status: "pending",
    rationale: input.rationale ?? null,
    createdAt: now,
    resolvedAt: null,
  };
}

export function getProposal(db: Db, id: string): Proposal | null {
  const row = db
    .select()
    .from(proposalsTable)
    .where(eq(proposalsTable.id, id))
    .get();
  if (!row) return null;
  return mapRow(row);
}

export function listPendingProposals(db: Db): Proposal[] {
  return db
    .select()
    .from(proposalsTable)
    .where(eq(proposalsTable.status, "pending"))
    .all()
    .map(mapRow);
}

/* ---------- apply / reject ---------- */

/**
 * Apply：按顺序原子回放 operations。任一失败 → status=stale + applyError，已执行的不回滚
 * （学习场景下部分应用比全回滚更友好——例如 3 个操作第 2 个失败，前 1 个已落库的保留）。
 * 全成功 → status=applied。
 */
export function applyProposal(db: Db, id: string): Proposal {
  const row = db
    .select()
    .from(proposalsTable)
    .where(eq(proposalsTable.id, id))
    .get();
  if (!row) throw new Error(`Proposal ${id} not found`);
  if (row.status !== "pending") {
    throw new Error(`Proposal ${id} not pending (status=${row.status})`);
  }

  const operations: LearningOperation[] = JSON.parse(row.operationsJson);
  let firstError: string | undefined;

  for (const op of operations) {
    try {
      executeOperation(db, op);
    } catch (e) {
      firstError = firstError ?? (e instanceof Error ? e.message : String(e));
      // 继续尝试后续操作（部分应用语义）
    }
  }

  const now = new Date().toISOString();
  const finalStatus = firstError ? "stale" : "applied";
  db.update(proposalsTable)
    .set({ status: finalStatus, resolvedAt: now })
    .where(eq(proposalsTable.id, id))
    .run();

  return {
    ...mapRow(
      db.select().from(proposalsTable).where(eq(proposalsTable.id, id)).get()!,
    ),
    applyError: firstError,
  };
}

/** Reject：学习者拒绝整个提议。不改任何状态。 */
export function rejectProposal(db: Db, id: string): Proposal {
  const row = db
    .select()
    .from(proposalsTable)
    .where(eq(proposalsTable.id, id))
    .get();
  if (!row) throw new Error(`Proposal ${id} not found`);
  if (row.status !== "pending") {
    throw new Error(`Proposal ${id} not pending (status=${row.status})`);
  }
  const now = new Date().toISOString();
  db.update(proposalsTable)
    .set({ status: "rejected", resolvedAt: now })
    .where(eq(proposalsTable.id, id))
    .run();
  return mapRow(
    db.select().from(proposalsTable).where(eq(proposalsTable.id, id)).get()!,
  );
}

/* ---------- 单操作执行 ---------- */

function executeOperation(db: Db, op: LearningOperation): void {
  switch (op.type) {
    case "update_mastery": {
      const existing = db
        .select()
        .from(progressTable)
        .where(eq(progressTable.nodeId, op.nodeId))
        .get();
      const prevMastery = existing?.mastery ?? null;
      const newMastery = updateMastery(prevMastery, op.correct ?? false, BKT_DEFAULTS);
      if (existing) {
        db.update(progressTable)
          .set({ mastery: newMastery })
          .where(eq(progressTable.nodeId, op.nodeId))
          .run();
      } else {
        // 节点没进度行时也建一条（只放 mastery）
        db.insert(progressTable)
          .values({
            nodeId: op.nodeId,
            status: "in_progress",
            crownLevel: 0,
            mastery: newMastery,
          })
          .run();
      }
      break;
    }
    case "mark_mastered": {
      const existing = db
        .select()
        .from(progressTable)
        .where(eq(progressTable.nodeId, op.nodeId))
        .get();
      if (existing) {
        db.update(progressTable)
          .set({ status: "mastered", crownLevel: 5, mastery: 0.95 })
          .where(eq(progressTable.nodeId, op.nodeId))
          .run();
      } else {
        db.insert(progressTable)
          .values({
            nodeId: op.nodeId,
            status: "mastered",
            crownLevel: 5,
            mastery: 0.95,
          })
          .run();
      }
      break;
    }
    case "set_node_status": {
      if (!op.status) throw new Error("set_node_status 缺 status");
      const existing = db
        .select()
        .from(progressTable)
        .where(eq(progressTable.nodeId, op.nodeId))
        .get();
      if (existing) {
        db.update(progressTable)
          .set({ status: op.status })
          .where(eq(progressTable.nodeId, op.nodeId))
          .run();
      } else {
        db.insert(progressTable)
          .values({ nodeId: op.nodeId, status: op.status, crownLevel: 0 })
          .run();
      }
      break;
    }
    case "add_to_srs": {
      // SRS 入队：建一条初始 SM-2 记录（easeFactor 250, interval 1）
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      db.insert(srsItems)
        .values({
          id: randomUUID(),
          nodeId: op.nodeId,
          easeFactor: 250,
          intervalDays: 1,
          repetitions: op.quality && op.quality >= 3 ? 1 : 0,
          dueAt,
        })
        .run();
      break;
    }
    default:
      throw new Error(`未知 operation type: ${(op as LearningOperation).type}`);
  }
}

/* ---------- 内部 ---------- */

function mapRow(row: {
  id: string;
  nodeId: string | null;
  operationsJson: string;
  status: string;
  rationale: string | null;
  createdAt: string;
  resolvedAt: string | null;
}): Proposal {
  return {
    id: row.id,
    nodeId: row.nodeId,
    operations: JSON.parse(row.operationsJson),
    status: row.status as Proposal["status"],
    rationale: row.rationale,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}
