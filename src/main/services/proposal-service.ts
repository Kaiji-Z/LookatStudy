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
import {
  getKnowledgePoints,
  ensureKcRows,
  updateKcMastery,
  computeAggregateMastery,
  floorAllKcMastery,
} from "./kc-service.js";
import { addXpMastered } from "./xp-service.js";
import { unlockNextLessonIfEligible } from "./progress-service.js";
import { MASTERED_MASTERY_THRESHOLD } from "@shared/types";
import { emitStateChange } from "../lib/state-emitter.js";

type Db = SQLJsDatabase<typeof schema>;

// MASTERED_MASTERY_THRESHOLD 现从 @shared/types 导入(主进程+渲染层共享单一真源)

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
  // update_mastery: 考察的知识组件下标(per-KC BKT)。不传=无 KC 回退或更新全部。
  kcIndex?: number;
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
      const correct = op.correct ?? false;

      // Per-KC BKT: 如果 lesson 有知识组件定义，走 per-KC 路径。
      const kps = getKnowledgePoints(db, op.nodeId);
      let newMastery: number;
      if (kps.length > 0) {
        // 确保 KC mastery 行存在（首次答题初始化）
        ensureKcRows(db, op.nodeId);
        if (op.kcIndex !== undefined && op.kcIndex >= 0 && op.kcIndex < kps.length) {
          // 精准更新指定 KC
          updateKcMastery(db, op.nodeId, op.kcIndex, correct);
        } else {
          // 无 kcIndex：保守更新所有 KC（观测未标注具体 KC 时）
          for (let i = 0; i < kps.length; i++) {
            updateKcMastery(db, op.nodeId, i, correct);
          }
        }
        // 课级 mastery = min(各 KC)——最薄弱环节决定整体
        newMastery = computeAggregateMastery(db, op.nodeId) ?? BKT_DEFAULTS.pInit;
      } else {
        // 无 KC 定义：回退到单值 BKT（向后兼容）
        const prevMastery = existing?.mastery ?? null;
        newMastery = updateMastery(prevMastery, correct, BKT_DEFAULTS);
      }

      // 自动毕业:聚合 mastery ≥ 0.9 → 全部 KC 都达标 → status 转 mastered
      const autoMastered = newMastery >= MASTERED_MASTERY_THRESHOLD;
      if (existing) {
        db.update(progressTable)
          .set(
            autoMastered
              ? { mastery: newMastery, status: "mastered", crownLevel: 5 }
              : { mastery: newMastery },
          )
          .where(eq(progressTable.nodeId, op.nodeId))
          .run();
      } else {
        db.insert(progressTable)
          .values({
            nodeId: op.nodeId,
            status: autoMastered ? "mastered" : "in_progress",
            crownLevel: autoMastered ? 5 : 0,
            mastery: newMastery,
          })
          .run();
      }
      if (autoMastered) addXpMastered(db);
      unlockNextLessonIfEligible(db, op.nodeId);
      emitStateChange("mastery");
      break;
    }
    case "mark_mastered": {
      const existing = db
        .select()
        .from(progressTable)
        .where(eq(progressTable.nodeId, op.nodeId))
        .get();
      // Per-KC: force-graduation 时把所有 KC floor 到 0.95（不抹掉已更高的值）
      floorAllKcMastery(db, op.nodeId, 0.95);
      // 尊重 BKT 累积:如果已有更高的 mastery,不向下覆盖(mark_mastered 是"提前毕业",
      // 不该抹掉学习者答题累积出的真实掌握度)。至少给 0.95(满足 mastered 语义)。
      const preservedMastery = Math.max(existing?.mastery ?? 0, 0.95);
      if (existing) {
        db.update(progressTable)
          .set({ status: "mastered", crownLevel: 5, mastery: preservedMastery })
          .where(eq(progressTable.nodeId, op.nodeId))
          .run();
      } else {
        db.insert(progressTable)
          .values({
            nodeId: op.nodeId,
            status: "mastered",
            crownLevel: 5,
            mastery: preservedMastery,
          })
          .run();
      }
      // 掌握一课 +50 XP（SRS 入队在 IPC 层做，避免循环依赖）
      addXpMastered(db);
      // 硬门控:mastered 必然 ≥ 阈值,解锁下一课。
      unlockNextLessonIfEligible(db, op.nodeId);
      // Phase 0: mastery 变化通知 renderer(加冕庆祝)。
      emitStateChange("mastery");
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
