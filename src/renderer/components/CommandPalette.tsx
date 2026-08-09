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
import { Search } from "lucide-react";

interface Command {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  group: "基于当前节点" | "学习模式" | "导航";
  requiresNode?: boolean;
}

const COMMANDS: Command[] = [
  { id: "explain_simple", icon: "💡", label: "用大白话解释这一节", group: "基于当前节点", requiresNode: true },
  { id: "quiz_3", icon: "📝", label: "出 3 道练习题考考我", group: "基于当前节点", requiresNode: true },
  { id: "concept_map", icon: "🗺️", label: "画个概念图理清结构", group: "基于当前节点", requiresNode: true },
  { id: "compare_prev", icon: "📊", label: "和上一节做对比表", group: "基于当前节点", requiresNode: true },
  { id: "socratic", icon: "🦉", label: "切到苏格拉底模式(提问引导)", group: "学习模式" },
  { id: "exam_mode", icon: "🎯", label: "切到考试冲刺模式", group: "学习模式" },
];

export function CommandPalette({
  onClose,
  onPick,
  hasNode,
}: {
  onClose: () => void;
  onPick: (action: string) => void;
  hasNode: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const visible = filtered.filter((c) => !c.requiresNode || hasNode);
  // 导航分组(占位,M3 可扩展)
  const groups = ["基于当前节点", "学习模式", "导航"] as const;

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
      <div className="relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-xl shadow-elevated overflow-hidden">
        {/* 搜索框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <Search className="w-4 h-4 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入指令或问题…(↑↓ 选择,Enter 确认)"
            className="flex-1 bg-transparent text-body text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
            data-testid="command-input"
          />
          <kbd className="text-caption text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">
            ESC
          </kbd>
        </div>

        {/* 命令列表 */}
        <div className="max-h-80 overflow-y-auto py-2" data-testid="command-list">
          {visible.length === 0 ? (
            <div className="px-4 py-6 text-center text-body text-neutral-400">
              {hasNode ? "没有匹配的命令" : "先在左侧选一个节点,才能用这些命令"}
            </div>
          ) : (
            groups.map((group) => {
              const cmds = visible.filter((c) => c.group === group);
              if (cmds.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-4 pt-2 pb-1 text-caption font-bold text-neutral-400 uppercase tracking-wider">
                    {group}
                  </div>
                  {cmds.map((cmd) => {
                    const idx = visible.indexOf(cmd);
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
                        <span className="text-base w-5 text-center">{cmd.icon}</span>
                        <span className="text-body font-medium flex-1">{cmd.label}</span>
                        {cmd.hint && <span className="text-caption text-neutral-400">{cmd.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-caption text-neutral-400">
          <span>AI 导师会根据指令生成对应内容</span>
          <span>↵ 确认 · esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
