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
import { ArrowUp, Square } from "lucide-react";
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
      <div className="px-5 pb-4 shrink-0" data-testid="composer-nokey">
        <div className="flex items-center justify-center gap-3 py-3 text-xs text-neutral-500">
          <span>{missingHint ?? "未配置 AI 模型"}</span>
          <button onClick={onGotoSettings} className="text-brand hover:underline font-bold">去配置 →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-4 pt-1 shrink-0" data-testid="composer">
      {/* starter prompts:淡色小药丸,浮在输入框上方(claude.ai 风)。
          仅当有节点 + 有推荐时显示。低对比,不抢对话流焦点。 */}
      {starterPrompts.length > 0 && nodeId && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin" data-testid="starter-prompts">
          {starterPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => !streaming && onSend(p.message)}
              disabled={streaming}
              data-testid={`starter-prompt-${i}`}
              className="shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full text-neutral-400 hover:text-neutral-200 hover:bg-white/5 transition-colors disabled:opacity-30"
              title={p.hint ?? p.label}
            >
              <span className="opacity-70">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 输入区:一个圆角胶囊容器(claude.ai 风)。
          内部布局:[模式选择 ... | textarea | 发送钮]。
          模式 + 字号收进输入框上方一行极淡工具栏,textarea 撑满,发送钮内嵌右下。 */}
      <div className="rounded-2xl bg-white/[0.05] focus-within:bg-white/[0.07] transition-colors px-3 pt-2 pb-1.5">
        {/* 极淡工具栏:模式(左) + 字号(右) */}
        <div className="flex items-center justify-between mb-1" data-testid="skill-picker">
          {skills.length > 0 ? (
            <select
              value={activeSkill ?? ""}
              onChange={(e) => onPickSkill(e.target.value)}
              className="text-[10px] bg-transparent text-neutral-500 border-none focus:outline-none cursor-pointer hover:text-neutral-300 transition-colors"
              data-testid="skill-select"
            >
              {skills.map((s) => (
                <option key={s.id} value={s.name} className="bg-neutral-900 text-neutral-200">
                  模式:{SKILL_LABELS[s.name] ?? s.name}
                </option>
              ))}
            </select>
          ) : <span />}
          <div className="flex items-center gap-0.5" data-testid="font-size-control">
            <button
              onClick={() => onFontBump("down")}
              disabled={fontSize === "small"}
              data-testid="font-smaller"
              className="text-[10px] w-5 h-5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/5 disabled:opacity-20 transition-colors"
              title="缩小字号"
            >A-</button>
            <button
              onClick={() => onFontBump("up")}
              disabled={fontSize === "large"}
              data-testid="font-larger"
              className="text-[12px] w-5 h-5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/5 disabled:opacity-20 transition-colors"
              title="放大字号"
            >A+</button>
          </div>
        </div>

        {/* textarea + 发送钮:发送钮内嵌右下,圆形 */}
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
            placeholder={nodeId ? translate("chat.input.placeholder") : translate("chat.input.no_node")}
            disabled={streaming || !nodeId}
            rows={2}
            data-testid="chat-input"
            className="flex-1 bg-transparent text-neutral-100 text-sm rounded-lg px-1 py-1 resize-none focus:outline-none disabled:opacity-40 placeholder:text-neutral-600"
            style={{ fontSize: "var(--chat-font-size, 15px)" }}
          />
          {streaming ? (
            <button
              onClick={onStop}
              data-testid="chat-stop"
              className="shrink-0 w-9 h-9 rounded-full bg-warning text-white flex items-center justify-center hover:bg-warning-light transition-colors"
              title={translate("chat.stop")}
              aria-label={translate("chat.stop")}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={streaming || !input.trim() || !nodeId}
              data-testid="chat-send"
              className="shrink-0 w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center hover:bg-brand-light disabled:bg-neutral-700 disabled:cursor-not-allowed transition-colors"
              title={translate("chat.send")}
              aria-label={translate("chat.send")}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
