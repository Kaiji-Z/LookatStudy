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
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
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

/**
 * 保存一个 AI 产物(自动调用,生成 id + 时间戳)。sourceType 默认 'ai'。
 *
 * 幂等去重(根治 quiz 等产物被重复保存):
 * 同 (courseId, nodeId, artifactType, data 内容) 已存在则直接返回旧行,不重复 insert。
 * 触发场景:流式中 chat:done 把临时 msg id 替换成 DB uuid,导致前端 effect
 * 用旧/新 id 各调一次 save;以及重载历史消息时 effect 再次跑。
 * data 是 JSON.stringify 同一 output 对象,顺序稳定,字符串相等即可判为同一产物。
 */
export function saveCanvasItem(input: SaveCanvasInput): CanvasItem {
  const db = getDb();
  const dataStr = JSON.stringify(input.data);
  const nodeId = input.nodeId ?? null;
  const dedupConds = [
    eq(canvasItems.courseId, input.courseId),
    eq(canvasItems.artifactType, input.artifactType),
    eq(canvasItems.data, dataStr),
    nodeId === null
      ? isNull(canvasItems.nodeId)
      : eq(canvasItems.nodeId, nodeId),
  ];
  const existing = db
    .select()
    .from(canvasItems)
    .where(and(...dedupConds))
    .all() as CanvasItem[];
  if (existing.length > 0) {
    return existing[0];
  }
  const id = randomUUID();
  const item = {
    id,
    nodeId,
    courseId: input.courseId,
    artifactType: input.artifactType,
    title: input.title ?? null,
    data: dataStr,
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

/** 用户画线加笔记(user_note)。带溯源:content(讲解)/chat(对话)。comment 为可选初始注释。 */
export function saveUserNote(input: {
  nodeId: string;
  courseId: string;
  text: string; // 画线文字(已截断)
  sourceType: "content" | "chat";
  sourceAnchor: unknown; // content={surroundingText} / chat={threadId,msgId}
  comment?: string; // 可选:用户对画线的注释(存 canvas_items.notes 列)
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
    notes: input.comment?.trim() ? input.comment.trim() : null,
    sourceType: input.sourceType,
    sourceAnchor: JSON.stringify(input.sourceAnchor),
    lastResult: null,
    resultAt: null,
  };
  db.insert(canvasItems).values(item).run();
  markDirty();
  return item as CanvasItem;
}

/**
 * 更新 user_note 的用户注释(存 canvas_items.notes 列)。
 * 空字符串/null → 删除注释(置 null)。返回更新后的 CanvasItem,找不到返回 null。
 * 顶层 notes 列语义见 schema.sql 注释"用户备注(后续扩展)"。
 */
export function updateUserNoteComment(id: string, comment: string): CanvasItem | null {
  const db = getDb();
  const existing = db
    .select()
    .from(canvasItems)
    .where(eq(canvasItems.id, id))
    .get() as CanvasItem | undefined;
  if (!existing) return null;
  const trimmed = comment.trim();
  db.update(canvasItems)
    .set({ notes: trimmed.length > 0 ? trimmed : null })
    .where(eq(canvasItems.id, id))
    .run();
  markDirty();
  return { ...existing, notes: trimmed.length > 0 ? trimmed : null };
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
