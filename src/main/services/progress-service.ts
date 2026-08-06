/**
 * 进度服务 —— 把 IPC handler 里的业务逻辑抽出来，便于无头测试。
 *
 * VERIFICATION §2.1: 工作流必须有 CLI/headless 形态，不能只能点 UI 触发。
 * 之前这些逻辑直接写在 ipc/index.ts 的 ipcMain.handle 回调里，无法在纯 Node 跑。
 * 抽到这里后：
 *   - IPC handler 变成薄壳：getDb() → 调本服务函数
 *   - verify-progress.mjs 构造真实 sql.js DB，直接调本服务函数，覆盖真实业务路径
 *
 * 设计：所有函数都接收 db 参数（dependency injection），不直接 import getDb。
 * markNodeAttempted 的 streak 副作用用 onAttempted 回调注入，避免本文件依赖 streak.ts。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { progress as progressTable, contentNodes } from "../db/schema.js";
import type { Progress } from "@shared/types";

// 项目用 sql.js（drizzle 的同步 API）。注入式传入便于无头测试构造真实 DB。
type Db = SQLJsDatabase<typeof schema>;

/**
 * 读取某节点的进度。不存在返回 null。
 */
export function getProgress(db: Db, nodeId: string): Progress | null {
  const row = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, nodeId))
    .get();
  return (row as Progress | undefined) ?? null;
}

/**
 * 更新进度（patch 合并语义）。不存在则插入。
 * 与原 ipc handler 行为一致：默认值 status=locked / crownLevel=0。
 */
export function updateProgress(
  db: Db,
  nodeId: string,
  patch: Partial<Progress>,
  now: Date = new Date(),
): Progress {
  const existing = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, nodeId))
    .get() as Progress | undefined;

  const merged: Progress = {
    nodeId,
    status: patch.status ?? existing?.status ?? "locked",
    crownLevel: patch.crownLevel ?? existing?.crownLevel ?? 0,
    lastAttemptAt:
      patch.lastAttemptAt ?? existing?.lastAttemptAt ?? now.toISOString(),
    mastery: existing?.mastery ?? null,
  };

  if (existing) {
    db.update(progressTable)
      .set({
        status: merged.status,
        crownLevel: merged.crownLevel,
        lastAttemptAt: merged.lastAttemptAt,
      })
      .where(eq(progressTable.nodeId, nodeId))
      .run();
  } else {
    db.insert(progressTable)
      .values({
        nodeId,
        status: merged.status,
        crownLevel: merged.crownLevel,
        lastAttemptAt: merged.lastAttemptAt,
      })
      .run();
  }

  return merged;
}

/**
 * 标记节点已尝试：status=in_progress + lastAttemptAt=now。不存在则插入。
 * 同时解锁同章节的下一课（Duolingo 式关卡门控：开始当前课 → 下一课变 available）。
 * 成功（被尝试）后回调 onAttempted —— 由 IPC 层接 touchStreakToday，测试可注入断言。
 */
export function markNodeAttempted(
  db: Db,
  nodeId: string,
  onAttempted?: () => void,
  now: Date = new Date(),
): Progress {
  const iso = now.toISOString();
  const existing = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, nodeId))
    .get() as Progress | undefined;

  if (existing) {
    db.update(progressTable)
      .set({ lastAttemptAt: iso, status: "in_progress" })
      .where(eq(progressTable.nodeId, nodeId))
      .run();
  } else {
    db.insert(progressTable)
      .values({
        nodeId,
        status: "in_progress",
        crownLevel: 0,
        lastAttemptAt: iso,
      })
      .run();
  }

  // 解锁同章节的下一课（按 orderIdx 排序找当前课的下一个 lesson）
  unlockNextLesson(db, nodeId);

  onAttempted?.();
  return {
    nodeId,
    status: "in_progress",
    crownLevel: existing?.crownLevel ?? 0,
    lastAttemptAt: iso,
    mastery: existing?.mastery ?? null,
  };
}

/**
 * 解锁同父章节里、orderIdx 大于当前节点的第一个 lesson。
 * 如果当前章节没有下一课了，解锁下一章节的第一课。
 */
function unlockNextLesson(db: Db, currentNodeId: string): void {
  // 查当前节点（要拿到 parentId 和 orderIdx）
  const current = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, currentNodeId))
    .get();
  if (!current) return;

  // 同章节、orderIdx 更大的 lesson，取第一个
  const siblings = db
    .select()
    .from(contentNodes)
    .all()
    .filter(
      (n) =>
        n.parentId === current.parentId &&
        n.type === "lesson" &&
        n.orderIdx > current.orderIdx,
    )
    .sort((a, b) => a.orderIdx - b.orderIdx);

  let nextNodeId: string | null = null;
  if (siblings.length > 0) {
    // 同章节有下一课
    nextNodeId = siblings[0]!.id;
  } else {
    // 同章节没下一课了 → 找下一章节的第一课
    const allSections = db
      .select()
      .from(contentNodes)
      .all()
      .filter((n) => n.type === "section" && n.orderIdx > (current.parentId ? getParentOrderIdx(db, current.parentId) : -1))
      .sort((a, b) => a.orderIdx - b.orderIdx);
    if (allSections.length > 0) {
      const nextSectionLessons = db
        .select()
        .from(contentNodes)
        .all()
        .filter((n) => n.parentId === allSections[0]!.id && n.type === "lesson")
        .sort((a, b) => a.orderIdx - b.orderIdx);
      if (nextSectionLessons.length > 0) {
        nextNodeId = nextSectionLessons[0]!.id;
      }
    }
  }

  if (nextNodeId) {
    // 如果下一课还是 locked，解锁成 available
    const nextProgress = db
      .select()
      .from(progressTable)
      .where(eq(progressTable.nodeId, nextNodeId))
      .get() as Progress | undefined;
    if (!nextProgress || nextProgress.status === "locked") {
      if (nextProgress) {
        db.update(progressTable)
          .set({ status: "available" })
          .where(eq(progressTable.nodeId, nextNodeId))
          .run();
      } else {
        db.insert(progressTable)
          .values({
            nodeId: nextNodeId,
            status: "available",
            crownLevel: 0,
            lastAttemptAt: null,
          })
          .run();
      }
    }
  }
}

/** 取某 section 的 orderIdx（辅助 unlockNextLesson） */
function getParentOrderIdx(db: Db, parentId: string): number {
  const parent = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, parentId))
    .get();
  return parent?.orderIdx ?? -1;
}
