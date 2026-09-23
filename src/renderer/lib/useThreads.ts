/**
 * useThreads —— v0.5 会话 thread 列表管理(节点 = 会话组模型)。
 *
 * 每个 thread 强绑一个节点(focusNodeId)。点节点 = 切会话组:
 *   - 标签栏只显示当前节点的 thread
 *   - 中栏整个跟随节点切换(标签栏 + 对话 + 输入)
 *
 * thread 列表按 nodeId 过滤(而非全局),点节点时 reload。
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import type { Thread } from "@shared/types";

export function useThreads(courseId: string | null, nodeId: string | null) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 节点切换时重新拉该节点的 thread(会话组切换)
  const reload = useCallback(async () => {
    if (!courseId || !nodeId) {
      setThreads([]);
      setActiveId(null);
      return;
    }
    try {
      const all = await api.threadList(courseId, "active");
      const nodeThreads = all.filter((t) => t.focusNodeId === nodeId);
      setThreads(nodeThreads);
      if (nodeThreads.length > 0) {
        setActiveId(nodeThreads[0]!.id);
      } else {
        setActiveId(null);
      }
    } catch {
      setThreads([]);
      setActiveId(null);
    }
  }, [courseId, nodeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (input: { title?: string | null; kind?: "chat" | "review" }) => {
      if (!courseId || !nodeId) return null;
      try {
        const t = await api.threadCreate({ ...input, courseId, focusNodeId: nodeId });
        setThreads((prev) => [t, ...prev]);
        setActiveId(t.id);
        return t;
      } catch {
        return null;
      }
    },
    [courseId, nodeId],
  );

  const update = useCallback(
    async (id: string, patch: { title?: string; status?: "active" | "archived"; focusNodeId?: string | null }) => {
      try {
        const updated = await api.threadUpdate(id, patch);
        if (updated) {
          if (updated.status === "archived") {
            // 归档:从 active 列表移除
            setThreads((prev) => prev.filter((t) => t.id !== id));
            setActiveId((prev) => {
              if (prev !== id) return prev;
              // 切到列表第一个
              const remaining = threads.filter((t) => t.id !== id);
              return remaining[0]?.id ?? null;
            });
          } else {
            setThreads((prev) => prev.map((t) => (t.id === id ? updated : t)));
          }
        }
        return updated;
      } catch {
        return null;
      }
    },
    [threads],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.threadDelete(id);
        setThreads((prev) => prev.filter((t) => t.id !== id));
        setActiveId((prev) => {
          if (prev !== id) return prev;
          const remaining = threads.filter((t) => t.id !== id);
          return remaining[0]?.id ?? null;
        });
      } catch {
        /* 忽略 */
      }
    },
    [threads],
  );

  /**
   * 软删 + undo:先从 UI 移除(乐观),返回被删 thread。
   * 调用方拿到后弹 undo toast;若 undo 则用 restore 恢复;否则 5 秒后真删。
   * 避免误删数据灾难。
   */
  const removeWithUndo = useCallback(
    (id: string): Thread | null => {
      const removed = threads.find((t) => t.id === id) ?? null;
      if (!removed) return null;
      // 乐观:先从 UI 移除
      setThreads((prev) => prev.filter((t) => t.id !== id));
      setActiveId((prev) => {
        if (prev !== id) return prev;
        const remaining = threads.filter((t) => t.id !== id);
        return remaining[0]?.id ?? null;
      });
      return removed;
    },
    [threads],
  );

  /** 恢复被软删的 thread(undo)。 */
  const restore = useCallback((thread: Thread) => {
    setThreads((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)]);
    setActiveId(thread.id);
  }, []);

  /**
   * 首次发送消息时调用:若无 active thread,建一条(自动绑当前节点,标题=用户输入截断)。
   * 返回 threadId 供 useChatStream 发消息用。
   */
  const ensureThreadForSend = useCallback(
    async (userMessage: string, displayText?: string): Promise<string | null> => {
      if (!courseId || !nodeId) return null;
      if (activeId) return activeId;
      // 标题=用户首条完整输入(不截断)。tab 用 CSS max-w truncate 显示,hover tooltip 看全名。
      // 按钮触发的首条消息(displayText 存在)标题用短动作标签——tab 里不该出现整段提示词。
      const t = await create({ title: (displayText ?? userMessage).trim() });
      return t?.id ?? null;
    },
    [courseId, nodeId, activeId, create],
  );

  /**
   * v0.39 复习会话:打开(或创建)某节点的 kind=review 会话线程并让它成为激活线程。
   * 每课单 review 线程——续用旧线程,保留上轮收束记录(AI 看得到上次的 weakPoints,复习有连续性)。
   * - 目标就是当前节点:直接更新本地列表 + 激活;
   * - 目标是别的节点:调用方随后 setSelectedNodeId 触发 reload;本函数 bump 目标线程的
   *   updatedAt(reload 排序=updatedAt 倒序),activeId 会自动落在它身上。
   * 返回 threadId(失败 null)。
   */
  const openOrCreateReview = useCallback(
    async (targetNodeId: string, title: string): Promise<string | null> => {
      if (!courseId) return null;
      try {
        const all = await api.threadList(courseId, "active");
        let target = all.find((t) => t.kind === "review" && t.focusNodeId === targetNodeId) ?? null;
        if (!target) {
          target = await api.threadCreate({ courseId, focusNodeId: targetNodeId, title, kind: "review" });
        } else {
          // 空 patch 只 bump updatedAt(updateThread 的既有语义),让 reload 后排最前
          target = (await api.threadUpdate(target.id, {})) ?? target;
        }
        const finalTarget: Thread = target;
        if (targetNodeId === nodeId) {
          setThreads((prev) => [finalTarget, ...prev.filter((t) => t.id !== finalTarget.id)]);
          setActiveId(finalTarget.id);
        }
        return finalTarget.id;
      } catch {
        return null;
      }
    },
    [courseId, nodeId],
  );

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  return {
    threads,
    activeId,
    activeThread,
    setActiveId,
    reload,
    create,
    update,
    remove,
    removeWithUndo,
    restore,
    ensureThreadForSend,
    openOrCreateReview,
  };
}
