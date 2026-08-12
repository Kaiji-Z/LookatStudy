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
import { ArrowUp, Square, Compass, ClipboardCheck, Hammer, RefreshCw, HelpCircle } from "lucide-react";
import type { Skill, StarterPrompt, HumanFrictionCategory } from "@shared/types";
import { useLang } from "../lib/i18n.js";

/** 模式名 → i18n key(短标签,显示在药丸里)。 */
const SKILL_LABEL_KEY: Record<string, string> = {
  "socratic-mode": "skill.socratic",
  "exam-prep-mode": "skill.exam",
  "project-mode": "skill.project",
  "review-mode": "skill.review",
};

/** 模式 → lucide 图标(场景语义,非装饰)。 */
const SKILL_ICONS: Record<string, typeof Compass> = {
  "socratic-mode": Compass,        // 罗盘:探索/指引方向
  "exam-prep-mode": ClipboardCheck, // 答题卡:考试
  "project-mode": Hammer,           // 锤子:动手做
  "review-mode": RefreshCw,         // 循环:间隔复习
};

/** 模式名 → i18n key(完整说明,data-tooltip 显示)。 */
const SKILL_DESC_KEY: Record<string, string> = {
  "socratic-mode": "skill.socratic.desc",
  "exam-prep-mode": "skill.exam.desc",
  "project-mode": "skill.project.desc",
  "review-mode": "skill.review.desc",
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
  /** P3: 学习者报"卡点" → 写 friction_log(供 agent 上下文自适应)。无节点时不渲染入口。 */
  onLogFriction?: (category: HumanFrictionCategory, summary: string | null) => void;
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
  onLogFriction,
  onGotoSettings,
  insertText,
}: ChatComposerProps) {
  const t = useLang();
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

  // P3: 卡点上报(🤔)。选感受 + 可选一句话 → 写 friction_log,agent 下轮会"看见"并调整。
  const [frictionOpen, setFrictionOpen] = useState(false);
  const [frictionCat, setFrictionCat] = useState<HumanFrictionCategory | null>(null);
  const [frictionText, setFrictionText] = useState("");
  const handleSubmitFriction = () => {
    if (!frictionCat || !onLogFriction) return;
    onLogFriction(frictionCat, frictionText.trim() || null);
    setFrictionOpen(false);
    setFrictionCat(null);
    setFrictionText("");
  };

  if (!agentReady) {
    return (
      <div className="px-5 pb-4 shrink-0" data-testid="composer-nokey">
        <div className="flex items-center justify-center gap-3 py-3 text-body text-ink-muted">
          <span>{t("chat.no_key.short")}</span>
          <button onClick={onGotoSettings} className="text-brand hover:underline font-bold">{t("chat.no_key.cta")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-4 pt-1 shrink-0" data-testid="composer">
      {/* starter prompts:淡色小药丸,浮在输入框上方(claude.ai 风)。
          仅当有节点 + 有推荐时显示。低对比,不抢对话流焦点。 */}
      {starterPrompts.length > 0 && nodeId && (
        <div className="flex gap-1.5 overflow-x-auto pb-2" data-testid="starter-prompts">
          {starterPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => !streaming && onSend(p.message)}
              disabled={streaming}
              data-testid={`starter-prompt-${i}`}
              className="shrink-0 flex items-center gap-1 text-body px-2.5 py-1 rounded-full text-ink-muted hover:text-ink-strong hover:bg-ink/5 transition-colors disabled:opacity-30"
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
          <div className="flex items-center gap-1 overflow-x-auto mb-1" data-testid="skill-picker">
            <span className="text-body text-ink-faint shrink-0">{t("chat.mode.label")}</span>
            {skills.map((s) => {
              const isActive = activeSkill === s.name;
              const Icon = SKILL_ICONS[s.name] ?? Compass;
              const fullDesc = t(SKILL_DESC_KEY[s.name] ?? "skill.socratic.desc");
              return (
                <button
                  key={s.id}
                  onClick={() => onPickSkill(s.name)}
                  data-testid={`skill-pill-${s.name}`}
                  data-tooltip={fullDesc}
                  className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-body font-medium transition-colors ${
                    isActive
                      ? "bg-brand/15 text-brand"
                      : "text-ink-muted hover:text-ink-strong hover:bg-ink/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t(SKILL_LABEL_KEY[s.name] ?? "skill.socratic")}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* P3: 卡点上报表单(🤔 展开时显示) */}
        {frictionOpen && onLogFriction && nodeId && (
          <div className="surface-card p-3 mb-2" data-testid="friction-form">
            <div className="text-label text-ink-muted mb-2">{t("chat.friction.hint")}</div>
            <div className="flex gap-1.5 mb-2">
              {(["confused", "blocked", "frustrated"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setFrictionCat(c)}
                  data-testid={`friction-cat-${c}`}
                  className={
                    "shrink-0 text-body px-2.5 py-1 rounded-full transition-colors " +
                    (frictionCat === c
                      ? "bg-brand text-white font-bold"
                      : "text-ink-muted hover:text-ink-strong hover:bg-ink/5")
                  }
                >
                  {t(`chat.friction.${c}`)}
                </button>
              ))}
            </div>
            <input
              value={frictionText}
              onChange={(e) => setFrictionText(e.target.value)}
              placeholder={t("chat.friction.desc_placeholder")}
              className="w-full bg-transparent text-body rounded-lg px-1 py-1 mb-2 focus:outline-none placeholder:text-ink-faint"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFrictionOpen(false)}
                className="btn-3d-neutral px-3 py-1 text-label"
              >
                {t("chat.friction.cancel")}
              </button>
              <button
                onClick={handleSubmitFriction}
                disabled={!frictionCat}
                data-testid="friction-submit"
                className="btn-3d-brand px-3 py-1 text-label disabled:opacity-40"
              >
                {t("chat.friction.submit")}
              </button>
            </div>
          </div>
        )}
        {/* textarea + 发送钮:发送钮内嵌右下,圆形。🤔 卡点入口在最左。 */}
        <div className="flex gap-2 items-end">
          {onLogFriction && nodeId && (
            <button
              onClick={() => setFrictionOpen((o) => !o)}
              title={t("chat.friction.trigger")}
              aria-label={t("chat.friction.trigger")}
              data-testid="friction-toggle"
              className="shrink-0 w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-700 text-ink-muted hover:text-ink-strong flex items-center justify-center transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={nodeId ? t("chat.input.placeholder") : t("chat.input.no_node")}
            disabled={streaming || !nodeId}
            rows={2}
            data-testid="chat-input"
            className="flex-1 bg-transparent text-ink-strong text-body rounded-lg px-1 py-1 resize-none focus:outline-none disabled:opacity-40 placeholder:text-ink-faint"
          />
          {streaming ? (
            <button
              onClick={onStop}
              data-testid="chat-stop"
              className="shrink-0 w-9 h-9 rounded-full bg-warning text-white flex items-center justify-center hover:bg-warning-light transition-colors"
              title={t("chat.stop")}
              aria-label={t("chat.stop")}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={streaming || !input.trim() || !nodeId}
              data-testid="chat-send"
              className="shrink-0 w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center hover:bg-brand-light disabled:bg-neutral-300 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed transition-colors"
              title={t("chat.send")}
              aria-label={t("chat.send")}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
