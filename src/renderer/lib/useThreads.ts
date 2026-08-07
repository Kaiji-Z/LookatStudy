/**
 * useThreads —— v0.4 会话 thread 列表管理。
 *
 * 管某课程下的所有 thread(active + archived):
 *   - list: 拉 active threads
 *   - create: 新建 thread(可带焦点节点)
 *   - update: 重命名/归档/切焦点
 *   - remove: 删除
 *
 * 与 useChatStream 配合:useThreads 管 thread 元数据,useChatStream 管
 * 当前 active thread 的消息流。
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import type { Thread } from "@shared/types";

export function useThreads(courseId: string | null) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!courseId) {
      setThreads([]);
      return;
    }
    try {
      const list = await api.threadList(courseId, "active");
      setThreads(list);
      // 默认选最近更新的(若当前 activeId 不在列表里)
      if (list.length > 0) {
        setActiveId((prev) => {
          if (prev && list.some((t) => t.id === prev)) return prev;
          return list[0]!.id;
        });
      }
    } catch {
      setThreads([]);
    }
  }, [courseId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (input: { focusNodeId?: string | null; title?: string | null }) => {
      if (!courseId) return null;
      try {
        const t = await api.threadCreate({ ...input, courseId });
        setThreads((prev) => [t, ...prev]);
        setActiveId(t.id);
        return t;
      } catch {
        return null;
      }
    },
    [courseId],
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

  /** 点地图节点:跳到该节点的最近 thread,没有则只记焦点(不立即建,输入才建)。 */
  const focusNode = useCallback(
    async (nodeId: string) => {
      if (!courseId) return;
      try {
        const recent = await api.threadFindRecentByNode(courseId, nodeId);
        if (recent) {
          setActiveId(recent.id);
        } else {
          // 首次:不立即建,清空 activeId,ThreadSwitcher 显示"输入问题开始新会话"
          // 实际 thread 在首次发送消息时由 ensureThreadForSend 创建
          setActiveId(null);
        }
      } catch {
        /* 忽略 */
      }
    },
    [courseId],
  );

  /**
   * 首次发送消息时调用:若无 active thread,建一条(焦点=当前节点,标题=用户输入截断)。
   * 返回 threadId 供 useChatStream 发消息用。
   */
  const ensureThreadForSend = useCallback(
    async (userMessage: string, focusNodeId: string | null): Promise<string | null> => {
      if (!courseId) return null;
      if (activeId) return activeId;
      // 自动命名:截断用户输入前 24 字
      const autoTitle = userMessage.trim().slice(0, 24) + (userMessage.trim().length > 24 ? "…" : "");
      const t = await create({ focusNodeId, title: autoTitle });
      return t?.id ?? null;
    },
    [courseId, activeId, create],
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
    focusNode,
    ensureThreadForSend,
  };
}
