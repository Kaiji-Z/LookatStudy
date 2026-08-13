/**
 * kc-service —— Per-Knowledge-Component BKT 读写与聚合。
 *
 * 核心思想：把 BKT 从 per-lesson 下沉到 per-KC 粒度。每个知识组件(KC)有自己
 * 独立的 BKT P(L)。课级 mastery = min(各 KC mastery)（最薄弱环节决定整体）。
 *
 * 向后兼容：lesson 无 KCs 时，返回 null，caller 回退到单值 BKT。
 *
 * 数据存储：
 *   KC 定义 → content_nodes.knowledge_points (JSON-in-TEXT)
 *   KC mastery → knowledge_component_mastery 表 (per-node × per-kc_index)
 */
import { eq, and } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type * as schema from "../db/schema.js";
import { contentNodes, knowledgeComponentMastery } from "../db/schema.js";
import { updateMastery, BKT_DEFAULTS } from "./pure/bkt.js";
import type { KnowledgePoint } from "@shared/types";
import { randomUUID } from "node:crypto";

type Db = SQLJsDatabase<typeof schema>;

/** 从 content_nodes.knowledge_points JSON 列解析出 KC 定义数组。无 KC 返回空数组。 */
export function getKnowledgePoints(db: Db, nodeId: string): KnowledgePoint[] {
  const row = db
    .select({ kp: contentNodes.knowledgePoints })
    .from(contentNodes)
    .where(eq(contentNodes.id, nodeId))
    .get();
  if (!row?.kp) return [];
  try {
    const parsed = JSON.parse(row.kp);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (k): k is KnowledgePoint =>
        typeof k === "object" && k !== null && typeof k.title === "string",
    );
  } catch {
    return [];
  }
}

/** 读取某节点所有 KC 的 mastery 行。无行返回空数组（调用方应先 ensureKcRows）。 */
export function getKcMastery(
  db: Db,
  nodeId: string,
): { kcIndex: number; mastery: number; testedCount: number }[] {
  const rows = db
    .select()
    .from(knowledgeComponentMastery)
    .where(eq(knowledgeComponentMastery.nodeId, nodeId))
    .all();
  return rows.map((r) => ({
    kcIndex: r.kcIndex,
    mastery: r.mastery,
    testedCount: r.testedCount,
  }));
}

/**
 * 确保 KC mastery 行存在：根据 knowledge_points 定义，为每个 KC 创建初始行(pInit=0.5)。
 * 幂等：已有行不重复创建。在首次答题/首次访问时调。
 */
export function ensureKcRows(db: Db, nodeId: string): void {
  const kps = getKnowledgePoints(db, nodeId);
  if (kps.length === 0) return;
  const existing = new Set(
    db
      .select({ idx: knowledgeComponentMastery.kcIndex })
      .from(knowledgeComponentMastery)
      .where(eq(knowledgeComponentMastery.nodeId, nodeId))
      .all()
      .map((r) => r.idx),
  );
  for (let i = 0; i < kps.length; i++) {
    if (!existing.has(i)) {
      db.insert(knowledgeComponentMastery)
        .values({
          id: randomUUID(),
          nodeId,
          kcIndex: i,
          mastery: BKT_DEFAULTS.pInit,
          testedCount: 0,
        })
        .run();
    }
  }
}

/**
 * 更新单个 KC 的 BKT mastery。
 * @returns 该 KC 更新后的 mastery 值
 */
export function updateKcMastery(
  db: Db,
  nodeId: string,
  kcIndex: number,
  correct: boolean,
): number {
  const row = db
    .select()
    .from(knowledgeComponentMastery)
    .where(
      and(
        eq(knowledgeComponentMastery.nodeId, nodeId),
        eq(knowledgeComponentMastery.kcIndex, kcIndex),
      ),
    )
    .get();
  const prevMastery = row?.mastery ?? BKT_DEFAULTS.pInit;
  const newMastery = updateMastery(prevMastery, correct, BKT_DEFAULTS);
  if (row) {
    db.update(knowledgeComponentMastery)
      .set({ mastery: newMastery, testedCount: row.testedCount + 1 })
      .where(eq(knowledgeComponentMastery.id, row.id))
      .run();
  } else {
    db.insert(knowledgeComponentMastery)
      .values({
        id: randomUUID(),
        nodeId,
        kcIndex,
        mastery: newMastery,
        testedCount: 1,
      })
      .run();
  }
  return newMastery;
}

/**
 * 计算课级聚合 mastery = min(各 KC mastery)。
 * 最薄弱环节决定整体——符合"所有知识点都覆盖到才毕业"的设计理念。
 * @returns min(各 KC mastery)；无 KC 行返回 null（caller 应回退单值 BKT）
 */
export function computeAggregateMastery(db: Db, nodeId: string): number | null {
  const rows = getKcMastery(db, nodeId);
  if (rows.length === 0) return null;
  return Math.min(...rows.map((r) => r.mastery));
}

/** Force-graduation：把所有 KC mastery floor 到 floorValue（mark_mastered 用）。 */
export function floorAllKcMastery(db: Db, nodeId: string, floorValue: number): void {
  const rows = db
    .select()
    .from(knowledgeComponentMastery)
    .where(eq(knowledgeComponentMastery.nodeId, nodeId))
    .all();
  for (const row of rows) {
    if (row.mastery < floorValue) {
      db.update(knowledgeComponentMastery)
        .set({ mastery: floorValue })
        .where(eq(knowledgeComponentMastery.id, row.id))
        .run();
    }
  }
}
