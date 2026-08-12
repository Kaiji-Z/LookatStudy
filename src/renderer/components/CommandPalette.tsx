/**
 * CommandPalette —— v0.2 Cmd+K 命令面板(M2)。
 *
 * 调研结论:嵌入式 AI 的"上下文内联"原则。Cmd+K 让用户随时调起
 * "用大白话解释 / 出 3 道题 / 画概念图 / 对比"等高频指令,不必打字。
 *
 * 这是 Cursor 三粒度入口思路在学习场景的应用。
 * 注:命令实际触发见 useChatStream 的 lookatstudy-command 事件监听。
 */
import { useState, useEffect, useRef } from "react";
import { Search, Lightbulb, FileText, Map as MapIcon, BarChart3, GraduationCap, Target, type LucideIcon } from "lucide-react";
import { useLang } from "../lib/i18n.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";

type GroupKey = "command.group.node" | "command.group.mode" | "command.group.nav";

interface Command {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  group: GroupKey;
  requiresNode?: boolean;
}

const COMMANDS: Command[] = [
  { id: "explain_simple", icon: Lightbulb, labelKey: "command.explain_simple", group: "command.group.node", requiresNode: true },
  { id: "quiz_3", icon: FileText, labelKey: "command.quiz_3", group: "command.group.node", requiresNode: true },
  { id: "concept_map", icon: MapIcon, labelKey: "command.concept_map", group: "command.group.node", requiresNode: true },
  { id: "compare_prev", icon: BarChart3, labelKey: "command.compare_prev", group: "command.group.node", requiresNode: true },
  { id: "socratic", icon: GraduationCap, labelKey: "command.socratic", group: "command.group.mode" },
  { id: "exam_mode", icon: Target, labelKey: "command.exam_mode", group: "command.group.mode" },
];

const GROUP_ORDER: GroupKey[] = ["command.group.node", "command.group.mode", "command.group.nav"];

export function CommandPalette({
  onClose,
  onPick,
  hasNode,
}: {
  onClose: () => void;
  onPick: (action: string) => void;
  hasNode: boolean;
}) {
  const t = useLang();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Phase 3 a11y: focus-trap + restore on close
  useFocusTrap(panelRef, true);

  const filtered = COMMANDS.filter((c) =>
    t(c.labelKey).toLowerCase().includes(query.toLowerCase()),
  );
  const visible = filtered.filter((c) => !c.requiresNode || hasNode);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && visible[selected]) {
      e.preventDefault();
      onPick(visible[selected].id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" data-testid="command-palette">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("command.footer.hint")}
        className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-xl shadow-elevated overflow-hidden"
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <Search className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("command.placeholder")}
            className="flex-1 bg-transparent text-body text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-600 dark:placeholder:text-neutral-400 focus:outline-none"
            data-testid="command-input"
          />
          <kbd className="text-caption text-neutral-600 dark:text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">
            ESC
          </kbd>
        </div>

        {/* 命令列表 */}
        <div className="max-h-80 overflow-y-auto py-2" data-testid="command-list">
          {visible.length === 0 ? (
            <div className="px-4 py-6 text-center text-body text-neutral-600 dark:text-neutral-400">
              {hasNode ? t("command.empty.node") : t("command.empty.nonode")}
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const cmds = visible.filter((c) => c.group === group);
              if (cmds.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-4 pt-2 pb-1 text-caption font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
                    {t(group)}
                  </div>
                  {cmds.map((cmd) => {
                    const idx = visible.indexOf(cmd);
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        onClick={() => onPick(cmd.id)}
                        onMouseEnter={() => setSelected(idx)}
                        data-testid={`command-${cmd.id}`}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                          idx === selected
                            ? "bg-brand/10 text-brand"
                            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="text-body font-medium flex-1">{t(cmd.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-caption text-neutral-600 dark:text-neutral-400">
          <span>{t("command.footer.hint")}</span>
          <span>{t("command.footer.keys")}</span>
        </div>
      </div>
    </div>
  );
}
