/**
 * Canvas Service —— v0.3 AI 产物画布(黑板笔记本)。
 *
 * 所有 Generative UI 产物自动持久化到 canvas_items 表。
 * 用户可单删、置顶、按节点/课程翻阅。这是"学习笔记本"的核心。
 *
 * 设计:
 *   - saveCanvasItem: AI tool execute 后自动调用(不让用户决定哪些存,全存)
 *   - listCanvasItems: 按节点或课程过滤,置顶优先 + 时间倒序
 *   - deleteCanvasItem: 用户单删(硬删,因为产物可重生)
 *   - togglePinCanvasItem: 用户置顶/取消
 *
 * 不做软删:产物是 AI 生成的,删了重新问 AI 就有,不需要回收站。
 */
import { getDb, markDirty } from "../db/index.js";
import { canvasItems, type ArtifactType } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface CanvasItem {
  id: string;
  nodeId: string | null;
  courseId: string;
  artifactType: ArtifactType;
  title: string | null;
  data: string; // JSON 字符串
  pinned: number; // 0/1
  createdAt: string;
  notes: string | null;
}

export interface SaveCanvasInput {
  nodeId?: string | null;
  courseId: string;
  artifactType: ArtifactType;
  title?: string | null;
  data: unknown; // 会 JSON.stringify
}

/** 保存一个 AI 产物(自动调用,生成 id + 时间戳)。 */
export function saveCanvasItem(input: SaveCanvasInput): CanvasItem {
  const db = getDb();
  const id = randomUUID();
  const item = {
    id,
    nodeId: input.nodeId ?? null,
    courseId: input.courseId,
    artifactType: input.artifactType,
    title: input.title ?? null,
    data: JSON.stringify(input.data),
    pinned: 0,
    createdAt: new Date().toISOString(),
    notes: null,
  };
  db.insert(canvasItems).values(item).run();
  markDirty();
  return item as CanvasItem;
}

/** 列产物。按节点过滤(可选),置顶优先 + 时间倒序。 */
export function listCanvasItems(
  courseId: string,
  nodeId?: string | null,
): CanvasItem[] {
  const db = getDb();
  const condition = nodeId
    ? and(eq(canvasItems.courseId, courseId), eq(canvasItems.nodeId, nodeId))
    : eq(canvasItems.courseId, courseId);
  return db
    .select()
    .from(canvasItems)
    .where(condition)
    .orderBy(desc(canvasItems.pinned), desc(canvasItems.createdAt))
    .all() as CanvasItem[];
}

/** 用户删除一个产物(硬删)。 */
export function deleteCanvasItem(id: string): void {
  const db = getDb();
  db.delete(canvasItems).where(eq(canvasItems.id, id)).run();
  markDirty();
}

/** 切换置顶状态。 */
export function togglePinCanvasItem(id: string): CanvasItem | null {
  const db = getDb();
  const existing = db
    .select()
    .from(canvasItems)
    .where(eq(canvasItems.id, id))
    .get() as CanvasItem | undefined;
  if (!existing) return null;
  const newPinned = existing.pinned ? 0 : 1;
  db.update(canvasItems)
    .set({ pinned: newPinned })
    .where(eq(canvasItems.id, id))
    .run();
  markDirty();
  return { ...existing, pinned: newPinned };
}
