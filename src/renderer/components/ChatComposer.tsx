/**
 * ChatComposer —— v0.2 中栏输入区(M1)。
 *
 * 重构自 ChatPanel 的输入区。包含:
 *   - starter prompts 横条(常驻,基于掌握度)
 *   - 学习模式下拉(苏格拉底/考试/项目/复习,默认收起)
 *   - textarea(Enter 发送,Shift+Enter 换行)
 *   - 发送 / 停止按钮
 *
 * 未配 key 时显示引导(去设置)。
 */
import { useState, useEffect } from "react";
import type { Skill, StarterPrompt } from "@shared/types";
import { translate } from "../lib/i18n.js";

const SKILL_LABELS: Record<string, string> = {
  "socratic-mode": "苏格拉底",
  "exam-prep-mode": "考试冲刺",
  "project-mode": "项目实战",
  "review-mode": "复习",
};

interface ChatComposerProps {
  nodeId: string | null;
  agentReady: boolean;
  missingHint?: string;
  streaming: boolean;
  skills: Skill[];
  activeSkill: string | null;
  starterPrompts: StarterPrompt[];
  onPickSkill: (name: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onGotoSettings: () => void;
  /** v0.3 字号调节 */
  fontSize: "small" | "medium" | "large";
  onFontBump: (dir: "up" | "down") => void;
  /** 外部注入文字(哪里不会点哪里:右栏选中→追加到输入框)。每次变化触发追加。 */
  insertText?: string;
}

export function ChatComposer({
  nodeId,
  agentReady,
  missingHint,
  streaming,
  skills,
  activeSkill,
  starterPrompts,
  onPickSkill,
  onSend,
  onStop,
  onGotoSettings,
  fontSize,
  onFontBump,
  insertText,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  // 外部插入文字(哪里不会点哪里:右栏选中→注入提问)。每次 insertText 变化时追加到输入框。
  useEffect(() => {
    if (insertText) {
      setInput((prev) => (prev.trim() ? `${prev}\n\n${insertText}` : insertText));
    }
  }, [insertText]);

  const handleSend = () => {
    if (!input.trim() || streaming || !nodeId || !agentReady) return;
    onSend(input);
    setInput("");
  };

  if (!agentReady) {
    return (
      <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0" data-testid="composer-nokey">
        <div className="flex items-center justify-center gap-3 py-2">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {missingHint ?? "未配置 AI 模型"}
          </span>
          <button
            onClick={onGotoSettings}
            className="text-xs text-brand hover:underline font-bold"
          >
            去配置 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0" data-testid="composer">
      {/* starter prompts 横条(常驻) */}
      {starterPrompts.length > 0 && nodeId && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1.5 scrollbar-thin" data-testid="starter-prompts">
          {starterPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => !streaming && onSend(p.message)}
              disabled={streaming}
              data-testid={`starter-prompt-${i}`}
              className={`shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${
                p.advancesMastery
                  ? "border-brand/50 bg-brand/10 text-brand hover:border-brand hover:bg-brand/20 font-semibold"
                  : "border-brand/30 bg-brand/5 text-brand hover:border-brand hover:bg-brand/10"
              }`}
              title={p.hint ?? p.label}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
              {p.advancesMastery && <span className="text-[9px] opacity-70">📈</span>}
            </button>
          ))}
        </div>
      )}

      {/* 学习模式 + 字号调节(一行) */}
      <div className="mb-1.5 flex items-center justify-between" data-testid="skill-picker">
        {skills.length > 0 ? (
          <select
            value={activeSkill ?? ""}
            onChange={(e) => onPickSkill(e.target.value)}
            className="text-[11px] bg-transparent text-neutral-600 dark:text-neutral-400 border-none focus:outline-none cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-700 dark:text-neutral-300"
            data-testid="skill-select"
          >
            {skills.map((s) => (
              <option key={s.id} value={s.name} className="bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200">
                模式:{SKILL_LABELS[s.name] ?? s.name}
              </option>
            ))}
          </select>
        ) : <span />}
        {/* v0.3 字号调节 */}
        <div className="flex items-center gap-1" data-testid="font-size-control">
          <button
            onClick={() => onFontBump("down")}
            disabled={fontSize === "small"}
            data-testid="font-smaller"
            className="text-[11px] w-6 h-6 rounded text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800/50 disabled:opacity-30 transition-colors"
            title="缩小字号"
          >A-</button>
          <span className="text-[9px] text-neutral-400 w-10 text-center">
            {fontSize === "small" ? "小" : fontSize === "large" ? "大" : "中"}
          </span>
          <button
            onClick={() => onFontBump("up")}
            disabled={fontSize === "large"}
            data-testid="font-larger"
            className="text-[13px] w-6 h-6 rounded text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800/50 disabled:opacity-30 transition-colors"
            title="放大字号"
          >A+</button>
        </div>
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            nodeId ? translate("chat.input.placeholder") : translate("chat.input.no_node")
          }
          disabled={streaming || !nodeId}
          rows={2}
          data-testid="chat-input"
          className="flex-1 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-sm rounded-lg px-3 py-2 resize-none border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={onStop}
            data-testid="chat-stop"
            className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-500 shrink-0"
          >
            {translate("chat.stop")}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim() || !nodeId}
            data-testid="chat-send"
            className="bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-light disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {translate("chat.send")}
          </button>
        )}
      </div>
    </div>
  );
}
