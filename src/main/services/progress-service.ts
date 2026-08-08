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
import { UNLOCK_MASTERY_THRESHOLD } from "@shared/types";
import { BKT_DEFAULTS } from "./pure/bkt.js";

// 项目用 sql.js（drizzle 的同步 API）。注入式传入便于无头测试构造真实 DB。
type Db = SQLJsDatabase<typeof schema>;

// UNLOCK_MASTERY_THRESHOLD 现从 @shared/types 导入(主进程+渲染层共享单一真源)

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
 * 标记节点已尝试：status=in_progress + lastAttemptAt=now + mastery 初始化为 BKT pInit。
 * 首次尝试时 mastery=pInit(0.5) ≥ UNLOCK_MASTERY_THRESHOLD → 触发硬门控解锁下一课。
 * （设计:mastery 不从 null/0 起步,让进度环有初始弧度、首次答题即可推进解锁。）
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

  // 跳关守卫:节点处于 locked 状态时拒绝标记(防 IPC 被绕过解锁任意节点)。
  // 正常路径:UI map-node disabled,isLocked 时按钮点不动。这里是兜底硬守卫,
  // 防键盘快捷键/deep link/未来新入口绕过按钮 disabled 直接调 IPC 跳关。
  // 设计:locked 节点"不存在进度"(返回 null-like 占位),不触发任何解锁级联。
  if (existing?.status === "locked") {
    return {
      nodeId,
      status: "locked",
      crownLevel: existing.crownLevel ?? 0,
      lastAttemptAt: existing.lastAttemptAt ?? null,
      mastery: existing.mastery ?? null,
    };
  }

  // 首次尝试:mastery 用 BKT pInit 作为起点(0.5),不是 null/0。
  // 已有 mastery 的保留(BKT 累积值不被尝试动作重置)。
  const mastery = existing?.mastery ?? BKT_DEFAULTS.pInit;
  const crownLevel = existing?.crownLevel ?? 0;

  if (existing) {
    db.update(progressTable)
      .set({ lastAttemptAt: iso, status: "in_progress", mastery })
      .where(eq(progressTable.nodeId, nodeId))
      .run();
  } else {
    db.insert(progressTable)
      .values({
        nodeId,
        status: "in_progress",
        crownLevel,
        mastery,
        lastAttemptAt: iso,
      })
      .run();
  }

  // 硬门控:当前节点 mastery ≥ 阈值才解锁下一课。
  // 首次尝试 mastery=pInit(0.5) 刚好达到 0.5 阈值 → 给用户"开始就能往下走"的顺畅感。
  if (mastery >= UNLOCK_MASTERY_THRESHOLD) {
    unlockNextLesson(db, nodeId);
  }

  onAttempted?.();
  return {
    nodeId,
    status: "in_progress",
    crownLevel,
    lastAttemptAt: iso,
    mastery,
  };
}

/**
 * 硬门控解锁:检查当前节点 mastery ≥ 阈值,是则解锁下一课。
 * 供 proposal-service 在 update_mastery 后调用(mastery 增长可能跨过阈值)。
 * 返回是否触了解锁(供测试断言)。
 */
export function unlockNextLessonIfEligible(db: Db, currentNodeId: string): boolean {
  const p = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, currentNodeId))
    .get() as Progress | undefined;
  if (!p || (p.mastery ?? 0) < UNLOCK_MASTERY_THRESHOLD) return false;
  unlockNextLesson(db, currentNodeId);
  return true;
}

/**
 * 解锁同父章节里、orderIdx 大于当前节点的第一个 lesson。
 * 如果当前章节没有下一课了，解锁下一章节的第一课。
 * 硬门控:调用方负责判断 mastery 是否达标(见 markNodeAttempted / update_mastery 应用)。
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
    // 同章节没下一课了 → 找下一章节的第一课。遍历所有后续 section,
    // 跳过没有 lesson 的空 section(原 bug:只看第一个 next section,若它
    // 全是 exam/skip 就停止,导致整条后续链路被锁死)。
    const parentOrderIdx = current.parentId ? getParentOrderIdx(db, current.parentId) : -1;
    const laterSections = db
      .select()
      .from(contentNodes)
      .all()
      .filter((n) => n.type === "section" && n.orderIdx > parentOrderIdx)
      .sort((a, b) => a.orderIdx - b.orderIdx);
    for (const sec of laterSections) {
      const sectionLessons = db
        .select()
        .from(contentNodes)
        .all()
        .filter((n) => n.parentId === sec.id && n.type === "lesson")
        .sort((a, b) => a.orderIdx - b.orderIdx);
      if (sectionLessons.length > 0) {
        nextNodeId = sectionLessons[0]!.id;
        break; // 找到第一个有课的 section 就停
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
