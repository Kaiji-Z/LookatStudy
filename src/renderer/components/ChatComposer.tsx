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
import { ArrowUp, Square, Compass, ClipboardCheck, Hammer, RefreshCw } from "lucide-react";
import type { Skill, StarterPrompt } from "@shared/types";
import { translate } from "../lib/i18n.js";

const SKILL_LABELS: Record<string, string> = {
  "socratic-mode": "苏格拉底",
  "exam-prep-mode": "考试冲刺",
  "project-mode": "项目实战",
  "review-mode": "复习",
};

/** 模式 → lucide 图标(场景语义,非装饰)。 */
const SKILL_ICONS: Record<string, typeof Compass> = {
  "socratic-mode": Compass,        // 罗盘:探索/指引方向
  "exam-prep-mode": ClipboardCheck, // 答题卡:考试
  "project-mode": Hammer,           // 锤子:动手做
  "review-mode": RefreshCw,         // 循环:间隔复习
};

/** 悬停时显示的完整说明(data-tooltip → GlobalTooltip)。比药丸里的场景提示更详细。 */
const SKILL_FULL_DESC: Record<string, string> = {
  "socratic-mode": "苏格拉底模式 · 学新概念时用。不直接给答案,用引导性问题帮你自己推导,真正理解而不是死记",
  "exam-prep-mode": "考试冲刺模式 · 考前用。模拟真实考试压力,计时答题,答错直接给标准答案和失分点分析",
  "project-mode": "项目实战模式 · 想动手时用。每个概念配最小可运行任务,在做中学,做完要解释自己的代码",
  "review-mode": "复习模式 · 日常巩固用。只出到期的复习题,巩固长期记忆,不引入新内容",
};

interface ChatComposerProps {
  nodeId: string | null;
  agentReady: boolean;
  streaming: boolean;
  skills: Skill[];
  activeSkill: string | null;
  starterPrompts: StarterPrompt[];
  onPickSkill: (name: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onGotoSettings: () => void;
  /** 外部注入文字(哪里不会点哪里:右栏选中→追加到输入框)。每次变化触发追加。 */
  insertText?: string;
}

export function ChatComposer({
  nodeId,
  agentReady,
  streaming,
  skills,
  activeSkill,
  starterPrompts,
  onPickSkill,
  onSend,
  onStop,
  onGotoSettings,
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
        <div className="flex items-center justify-center gap-3 py-3 text-body text-neutral-500">
          <span>未配置 AI 模型</span>
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
              className="shrink-0 flex items-center gap-1 text-body px-2.5 py-1 rounded-full text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-ink/5 transition-colors disabled:opacity-30"
              title={p.hint ?? p.label}
            >
              <span className="opacity-70">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 输入区:一个圆角胶囊容器(claude.ai 风)。
          内部:模式药丸行 + textarea + 发送钮。
          模式选择是输入框的一部分(决定"这段话用什么方式教"),不是独立工具栏。
          字号控制已移到顶栏(全局字号,不只中栏)。 */}
      <div className="rounded-2xl bg-ink/[0.05] focus-within:bg-ink/[0.07] transition-colors px-3 pt-2 pb-1.5">
        {/* 模式药丸:"模式:" 标签 + 四个药丸(图标+名字),hover 显示完整说明 */}
        {skills.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin mb-1" data-testid="skill-picker">
            <span className="text-body text-neutral-600 shrink-0">模式:</span>
            {skills.map((s) => {
              const isActive = activeSkill === s.name;
              const Icon = SKILL_ICONS[s.name] ?? Compass;
              const fullDesc = SKILL_FULL_DESC[s.name] ?? s.name;
              return (
                <button
                  key={s.id}
                  onClick={() => onPickSkill(s.name)}
                  data-testid={`skill-pill-${s.name}`}
                  data-tooltip={fullDesc}
                  className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-body font-medium transition-colors ${
                    isActive
                      ? "bg-brand/15 text-brand"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-ink/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{SKILL_LABELS[s.name] ?? s.name}</span>
                </button>
              );
            })}
          </div>
        )}

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
            className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 text-body rounded-lg px-1 py-1 resize-none focus:outline-none disabled:opacity-40 placeholder:text-neutral-600 dark:text-neutral-400 dark:placeholder:text-neutral-600"
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
              className="shrink-0 w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center hover:bg-brand-light disabled:bg-neutral-300 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed transition-colors"
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
