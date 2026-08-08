/**
 * Canvas Service —— v0.3 康奈尔式学习笔记本。
 *
 * canvas_items 表存两类数据:
 *   1. AI 产物(concept_map/quiz/compare_table/diagram/code_walkthrough)—— 自动持久化
 *   2. 用户画线笔记(user_note)—— 用户从讲解/对话选区手动加
 *
 * 三区(康奈尔笔记法):
 *   - 理解区:AI 产物(非 quiz)= 知识结构
 *   - 笔记区:user_note = 用户内化
 *   - 练习区:quiz 产物 + last_result 答题记录
 *
 * 溯源:user_note 带 source_type('content'/'chat')+ source_anchor,可跳回原位。
 */
import { getDb, markDirty } from "../db/index.js";
import { canvasItems, type ArtifactType } from "../db/schema.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/** 笔记三区(康奈尔笔记法) */
export type CanvasZone = "understand" | "note" | "practice";

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
  /** v0.3 溯源:'ai' / 'content' / 'chat' */
  sourceType: string | null;
  /** 溯源锚点 JSON:content={surroundingText} / chat={threadId,msgId} */
  sourceAnchor: string | null;
  /** 仅 quiz:最近一次答题 'correct'/'wrong' */
  lastResult: string | null;
  /** 仅 quiz:答题时间 */
  resultAt: string | null;
}

export interface SaveCanvasInput {
  nodeId?: string | null;
  courseId: string;
  artifactType: ArtifactType;
  title?: string | null;
  data: unknown; // 会 JSON.stringify
}

/** 保存一个 AI 产物(自动调用,生成 id + 时间戳)。sourceType 默认 'ai'。 */
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
    sourceType: "ai",
    sourceAnchor: null,
    lastResult: null,
    resultAt: null,
  };
  db.insert(canvasItems).values(item).run();
  markDirty();
  return item as CanvasItem;
}

/** 用户画线加笔记(user_note)。带溯源:content(讲解)/chat(对话)。 */
export function saveUserNote(input: {
  nodeId: string;
  courseId: string;
  text: string; // 画线文字(已截断)
  sourceType: "content" | "chat";
  sourceAnchor: unknown; // content={surroundingText} / chat={threadId,msgId}
}): CanvasItem {
  const db = getDb();
  const id = randomUUID();
  const item = {
    id,
    nodeId: input.nodeId,
    courseId: input.courseId,
    artifactType: "user_note" as ArtifactType,
    title: input.text.slice(0, 40) + (input.text.length > 40 ? "…" : ""),
    data: JSON.stringify({ text: input.text }),
    pinned: 0,
    createdAt: new Date().toISOString(),
    notes: null,
    sourceType: input.sourceType,
    sourceAnchor: JSON.stringify(input.sourceAnchor),
    lastResult: null,
    resultAt: null,
  };
  db.insert(canvasItems).values(item).run();
  markDirty();
  return item as CanvasItem;
}

/** quiz 重做后,更新最近一次答题结果(只保留最近一次,不记历史)。 */
export function recordQuizResult(id: string, correct: boolean): CanvasItem | null {
  const db = getDb();
  const existing = db
    .select()
    .from(canvasItems)
    .where(eq(canvasItems.id, id))
    .get() as CanvasItem | undefined;
  if (!existing) return null;
  db.update(canvasItems)
    .set({
      lastResult: correct ? "correct" : "wrong",
      resultAt: new Date().toISOString(),
    })
    .where(eq(canvasItems.id, id))
    .run();
  markDirty();
  return {
    ...existing,
    lastResult: correct ? "correct" : "wrong",
    resultAt: new Date().toISOString(),
  };
}

/** 列产物。按节点过滤(可选),置顶优先 + 时间倒序。zone 可选:按康奈尔三区筛选。 */
export function listCanvasItems(
  courseId: string,
  nodeId?: string | null,
  zone?: CanvasZone,
): CanvasItem[] {
  const db = getDb();
  const conds = [eq(canvasItems.courseId, courseId)];
  if (nodeId) conds.push(eq(canvasItems.nodeId, nodeId));
  // zone 筛选:理解区=非 quiz 非 user_note 的 AI 产物;笔记区=user_note;练习区=quiz
  if (zone === "understand") {
    conds.push(
      inArray(canvasItems.artifactType, [
        "concept_map",
        "compare_table",
        "diagram",
        "code_walkthrough",
      ]),
    );
  } else if (zone === "note") {
    conds.push(eq(canvasItems.artifactType, "user_note"));
  } else if (zone === "practice") {
    conds.push(eq(canvasItems.artifactType, "quiz"));
  }
  return db
    .select()
    .from(canvasItems)
    .where(and(...conds))
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
