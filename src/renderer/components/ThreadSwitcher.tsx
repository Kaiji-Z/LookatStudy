/**
 * ThreadSwitcher —— v0.4 改 Chrome 式标签条。
 *
 * 顶部横排 tabs(可横向滚动),每个 tab:
 *   - 标题(自动摘要命名,如"Transformer 概念图…")
 *   - 当前 tab 绿底高亮
 *   - 右侧齿轮按钮:hover 出现,点开菜单(重命名/归档/删除)
 *   - 末尾 + 号新建
 *
 * 首次进入(无 thread):不显示 tabs,只显示一个"📍 焦点节点 + 准备开始"提示条,
 * 等用户输入发送后才真正建 thread。
 */
import { useState, useRef, useEffect } from "react";
import type { Thread } from "@shared/types";

interface ThreadSwitcherProps {
  threads: Thread[];
  activeThread: Thread | null;
  focusNodeTitle: string | null;
  onPickThread: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ThreadSwitcher({
  threads,
  activeThread,
  focusNodeTitle,
  onPickThread,
  onCreate,
  onRename,
  onArchive,
  onDelete,
}: ThreadSwitcherProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null); // 哪个 tab 的齿轮菜单开着
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null); // 菜单 fixed 坐标
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null);
        setMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 齿轮点击:计算按钮在视口的坐标,菜单用 fixed 定位脱离 overflow:auto 容器
  const openMenu = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 菜单宽 128px(w-32),右对齐到齿轮右侧
    const left = Math.max(8, rect.right - 128);
    const top = rect.bottom + 4;
    setMenuPos({ top, left });
    setMenuFor(menuFor === threadId ? null : threadId);
  };

  const startRename = (t: Thread) => {
    setRenamingId(t.id);
    setRenameValue(t.title ?? "");
    setMenuFor(null);
    setMenuPos(null);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  // 无 thread:首次进入,只显示焦点节点提示
  if (threads.length === 0) {
    return (
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 shrink-0 flex items-center text-xs" data-testid="thread-switcher-empty">
        <span className="text-neutral-600 dark:text-neutral-400 truncate flex-1">
          📍 {focusNodeTitle ?? "未选节点"}
        </span>
        <span className="text-[10px] text-neutral-400">输入问题开始新会话</span>
      </div>
    );
  }

  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800 shrink-0" data-testid="thread-switcher">
      <div className="flex items-stretch overflow-x-auto scrollbar-thin bg-neutral-100/60 dark:bg-neutral-900/40">
        {threads.map((t) => {
          const isActive = t.id === activeThread?.id;
          const isRenaming = renamingId === t.id;
          return (
            <div
              key={t.id}
              className={`group relative flex items-center gap-1.5 pl-3 pr-2 py-2 cursor-pointer border-r border-neutral-200 dark:border-neutral-800 whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-neutral-50 dark:bg-neutral-950 text-brand"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
              }`}
              onClick={() => !isRenaming && onPickThread(t.id)}
              data-testid={`thread-tab-${t.id.slice(0, 8)}`}
            >
              {/* 焦点标记(当前 thread 显示绿点) */}
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"}`} />

              {/* 标题 / 重命名输入框 */}
              {isRenaming ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-[11px] rounded px-1.5 py-0.5 border border-brand focus:outline-none w-32"
                  data-testid="thread-rename-input"
                />
              ) : (
                <span className="text-[11px] font-medium max-w-[120px] truncate">
                  {t.title || "新会话"}
                </span>
              )}

              {/* 齿轮按钮:hover 出现 */}
              {!isRenaming && (
                <button
                  onClick={(e) => openMenu(e, t.id)}
                  className="text-[10px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded"
                  data-testid={`thread-gear-${t.id.slice(0, 8)}`}
                  title="操作"
                >
                  ⚙
                </button>
              )}
            </div>
          );
        })}

        {/* + 新建 */}
        <button
          onClick={onCreate}
          className="px-3 py-2 text-neutral-500 hover:text-brand hover:bg-neutral-50 dark:hover:bg-neutral-900/60 text-sm shrink-0"
          data-testid="thread-new"
          title="新建会话"
        >+</button>
      </div>

      {/* 齿轮菜单:fixed 定位,脱离标签条的 overflow:auto 容器,依附齿轮下方 */}
      {menuFor && menuPos && (() => {
        const t = threads.find((x) => x.id === menuFor);
        if (!t) return null;
        return (
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
            className="z-50 w-32 bg-white dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-800 py-1"
            data-testid={`thread-menu-${t.id.slice(0, 8)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => startRename(t)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
            >✎ 重命名</button>
            <button
              onClick={() => { onArchive(t.id); setMenuFor(null); setMenuPos(null); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
            >📦 归档</button>
            <button
              onClick={() => { if (confirm("删除这条会话?消息也会删除")) { onDelete(t.id); setMenuFor(null); setMenuPos(null); } }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            >🗑️ 删除</button>
          </div>
        );
      })()}
    </div>
  );
}
