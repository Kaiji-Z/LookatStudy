/**
 * ThreadSwitcher —— v0.6 重新设计。
 *
 * 设计目标:
 *  - 区别于右栏 NotebookPanel 的"页面标签"(分段控件),这里做"会话流"标签:
 *    会话是动态、可增删、数量不定的,所以用**可滚动的圆角药丸行**(pill row),
 *    不是分段控件(分段控件适合 2-4 个固定项)。
 *  - 比 Chrome 填充 tab 更轻:药丸 + 微高亮当前 + 焦点点,视觉重量降到最低,
 *    让用户视线落在下方对话内容上,不在 tab 条上。
 *  - P0 修复:native confirm() → ConfirmCard(内联确认浮层)。
 *
 * 交互:
 *  - 当前会话:brand 描边药丸 + 左侧 brand 实心点
 *  - 其他会话:中性描边药丸 + 左侧中性点;hover 描边变亮
 *  - 药丸内 hover 出现齿轮(操作菜单:重命名/归档/删除)
 *  - 行末 + 新建按钮
 *  - 删除走 ConfirmCard(warning 红确认),不阻断渲染进程
 */
import { useState, useRef, useEffect } from "react";
import type { Thread } from "@shared/types";
import { Plus, Settings, Edit, Archive, Trash } from "lucide-react";
import { ConfirmCard } from "./ConfirmCard.js";
import { useLang } from "../lib/i18n.js";

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
  const t = useLang();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; rect: DOMRect } | null>(null);
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

  const openMenu = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.max(8, rect.right - 128);
    const top = rect.bottom + 4;
    setMenuPos({ top, left });
    setMenuFor(menuFor === threadId ? null : threadId);
  };

  const startRename = (th: Thread) => {
    setRenamingId(th.id);
    setRenameValue(th.title ?? "");
    setMenuFor(null);
    setMenuPos(null);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  // 无 thread:首次进入,焦点节点提示
  if (threads.length === 0) {
    return (
      <div className="px-4 py-2 shrink-0 flex items-center gap-2 text-label bg-surface-1 opacity-60" data-testid="thread-switcher-empty">
        <span className="w-1 h-1 rounded-full bg-brand shrink-0" />
        <span className="text-ink-muted truncate flex-1">
          {focusNodeTitle ?? t("thread.empty.no_node")}
        </span>
        <span className="text-caption text-ink-muted shrink-0">{t("thread.empty.hint")}</span>
      </div>
    );
  }

  return (
    <div className="shrink-0 bg-surface-1" data-testid="thread-switcher">
      {/* 极薄行:低对比文字标签,当前会话仅用 brand 点 + 加粗,无填充无描边。
          整行 opacity-70 淡入背景,hover 提到 100%。内容是主角,tab 让位。 */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin px-3 py-1.5 opacity-70 hover:opacity-100 transition-opacity">
        {threads.map((th) => {
          const isActive = th.id === activeThread?.id;
          const isRenaming = renamingId === th.id;
          return (
            <div
              key={th.id}
              className={`group relative flex items-center gap-1.5 px-2 py-0.5 cursor-pointer whitespace-nowrap transition-colors shrink-0 rounded ${
                isActive
                  ? "text-ink-strong"
                  : "text-ink-muted hover:text-ink-strong"
              }`}
              onClick={() => !isRenaming && onPickThread(th.id)}
              data-testid={`thread-tab-${th.id.slice(0, 8)}`}
            >
              <span className={`w-1 h-1 rounded-full shrink-0 transition-opacity ${isActive ? "bg-brand opacity-100" : "bg-[var(--border)] opacity-0 group-hover:opacity-60"}`} />

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
                  className="bg-surface-0 text-ink-strong text-label rounded px-1.5 py-0.5 border border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 w-28"
                  data-testid="thread-rename-input"
                />
              ) : (
                <span className={`text-label max-w-[120px] truncate ${isActive ? "font-semibold" : "font-normal"}`} data-tooltip={th.title || t("toast.threadDefault")}>
                  {th.title || t("toast.threadDefault")}
                </span>
              )}

              {!isRenaming && (
                <button
                  onClick={(e) => openMenu(e, th.id)}
                  className="flex items-center justify-center w-4 h-4 rounded text-ink-muted hover:text-ink-strong hover:bg-ink/5 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-all"
                  data-testid={`thread-gear-${th.id.slice(0, 8)}`}
                  title={t("thread.actions.label")}
                  aria-label={t("thread.actions.label")}
                ><Settings className="w-3 h-3" /></button>
              )}
            </div>
          );
        })}

        {/* + 新建:纯图标,极淡 */}
        <button
          onClick={onCreate}
          className="flex items-center justify-center w-6 h-6 ml-1 rounded text-ink-muted hover:text-brand hover:bg-ink/5 transition-colors shrink-0"
          data-testid="thread-new"
          title={t("thread.new.label")}
          aria-label={t("thread.new.label")}
        ><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {/* 齿轮菜单:fixed 定位,脱离滚动容器 */}
      {menuFor && menuPos && (() => {
        const th = threads.find((x) => x.id === menuFor);
        if (!th) return null;
        return (
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
            className="z-50 w-32 bg-surface-0 rounded-lg shadow-pop py-1 border border-[var(--border-faint)]"
            data-testid={`thread-menu-${th.id.slice(0, 8)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => startRename(th)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-label text-ink-muted hover:bg-surface-1 hover:bg-surface-3 hover:text-ink-strong transition-colors"
            ><Edit className="w-3 h-3" />{t("thread.menu.rename")}</button>
            <button
              onClick={() => { onArchive(th.id); setMenuFor(null); setMenuPos(null); }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-label text-ink-muted hover:bg-surface-1 hover:bg-surface-3 hover:text-ink-strong transition-colors"
            ><Archive className="w-3 h-3" />{t("thread.menu.archive")}</button>
            <button
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setConfirmDelete({ id: th.id, title: th.title ?? t("toast.threadDefault"), rect });
                setMenuFor(null);
                setMenuPos(null);
              }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-label text-warning hover:bg-warning/10 transition-colors"
            ><Trash className="w-3 h-3" />{t("action.delete")}</button>
          </div>
        );
      })()}

      {/* 删除确认:ConfirmCard 替代 native confirm() */}
      {confirmDelete && (
        <ConfirmCard
          anchorRect={confirmDelete.rect}
          message={t("thread.delete.confirm", { name: confirmDelete.title })}
          danger
          confirmLabel={t("action.delete")}
          testid="thread-delete-confirm"
          onConfirm={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
