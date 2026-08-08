/**
 * useCanvas —— v0.3 康奈尔式学习笔记本数据 hook。
 *
 * 管 canvas_items 的 CRUD + 自动持久化 + 用户画线 + quiz 记录。
 *   - load: 按 courseId 拉全部产物/笔记(含 user_note)
 *   - save: AI 产物生成时自动调
 *   - saveUserNote: 用户画线加笔记(带溯源)
 *   - recordQuizResult: quiz 重做后更新 last_result
 *   - remove / togglePin: 单删 / 置顶
 *   - byZone: 按康奈尔三区筛选(理解区/笔记区/练习区)
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import type { CanvasItem, CanvasZone, NoteSourceAnchor } from "@shared/types";

export function useCanvas(courseId: string | null) {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!courseId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.canvasList(courseId);
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (input: {
      nodeId?: string | null;
      artifactType: string;
      title?: string | null;
      data: unknown;
    }) => {
      if (!courseId) return null;
      try {
        const item = await api.canvasSave({ ...input, courseId });
        // 后端已按 (courseId,nodeId,type,data) 幂等去重,命中会返回旧行。
        // 本地 setItems 需同步去重,否则旧行被复制一份到顶部。
        setItems((prev) => {
          if (prev.some((i) => i.id === item.id)) return prev;
          return [item, ...prev];
        });
        return item;
      } catch {
        return null;
      }
    },
    [courseId],
  );

  /** 用户画线加笔记(user_note),带溯源(content/chat)。comment 为可选初始注释 */
  const saveUserNote = useCallback(
    async (input: {
      nodeId: string;
      text: string;
      sourceType: "content" | "chat";
      sourceAnchor: NoteSourceAnchor;
      comment?: string;
    }) => {
      if (!courseId) return null;
      try {
        const item = await api.canvasSaveUserNote({ ...input, courseId });
        setItems((prev) => [item, ...prev]);
        return item;
      } catch {
        return null;
      }
    },
    [courseId],
  );

  /** quiz 重做后更新 last_result(只保留最近一次) */
  const recordQuizResult = useCallback(async (id: string, correct: boolean) => {
    try {
      const updated = await api.canvasRecordQuizResult(id, correct);
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      }
      return updated;
    } catch {
      return null;
    }
  }, []);

  /** 更新 user_note 的用户注释(空串=删除)。返回更新后的 item 或 null */
  const updateUserNoteComment = useCallback(async (id: string, comment: string) => {
    try {
      const updated = await api.canvasUpdateUserNoteComment(id, comment);
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      }
      return updated;
    } catch {
      return null;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await api.canvasDelete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      /* 忽略 */
    }
  }, []);

  const togglePin = useCallback(async (id: string) => {
    try {
      const updated = await api.canvasTogglePin(id);
      if (updated) {
        setItems((prev) => {
          const next = prev.map((i) => (i.id === id ? updated : i));
          return next.sort((a, b) => {
            if (b.pinned !== a.pinned) return b.pinned - a.pinned;
            return b.createdAt.localeCompare(a.createdAt);
          });
        });
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  /** 按节点过滤的产物。 */
  const byNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) return items;
      return items.filter((i) => i.nodeId === nodeId);
    },
    [items],
  );

  /** 按康奈尔三区筛选(在一个节点内):
   *  understand=理解区(非 quiz 非 user_note 的 AI 产物)
   *  note=笔记区(user_note)
   *  practice=练习区(quiz) */
  const byZone = useCallback(
    (nodeId: string | null, zone: CanvasZone): CanvasItem[] => {
      const nodeItems = nodeId === null ? items : items.filter((i) => i.nodeId === nodeId);
      if (zone === "note") return nodeItems.filter((i) => i.artifactType === "user_note");
      if (zone === "practice") return nodeItems.filter((i) => i.artifactType === "quiz");
      // understand
      return nodeItems.filter((i) =>
        ["concept_map", "compare_table", "diagram", "code_walkthrough"].includes(i.artifactType),
      );
    },
    [items],
  );

  return {
    items,
    loading,
    reload,
    save,
    saveUserNote,
    recordQuizResult,
    updateUserNoteComment,
    remove,
    togglePin,
    byNode,
    byZone,
  };
}
