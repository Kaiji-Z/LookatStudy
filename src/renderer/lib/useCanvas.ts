/**
 * useCanvas —— v0.3 黑板笔记本数据 hook。
 *
 * 管 canvas_items 的 CRUD + 自动持久化 AI 产物。
 *   - load: 按 courseId(+nodeId)拉产物列表
 *   - save: AI 产物生成时自动调(不让用户决定,全存)
 *   - remove: 用户单删
 *   - togglePin: 用户置顶
 *
 * 产物自动持久化触发点:agent-engine 的展示型 tool execute 后,
 * App.tsx 监听 chat:part 的 tool-result,调 saveCanvas。
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import type { CanvasItem } from "@shared/types";

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
        setItems((prev) => [item, ...prev]);
        return item;
      } catch {
        return null;
      }
    },
    [courseId],
  );

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
          // 重新排序:pinned 优先 + 时间倒序
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

  /** 按节点过滤的产物(置顶优先 + 时间倒序,已是默认排序)。 */
  const byNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) return items;
      return items.filter((i) => i.nodeId === nodeId);
    },
    [items],
  );

  return { items, loading, reload, save, remove, togglePin, byNode };
}
