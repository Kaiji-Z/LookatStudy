/**
 * ChatComposer —— v0.2 中栏输入区(M1)。
 *
 * 重构自 ChatPanel 的输入区。包含:
 *   - starter prompts 横条(常驻,基于掌握度)
 *   - 教学人设药丸(精讲/引导/实战,默认收起)
 *   - textarea(Enter 发送,Shift+Enter 换行)
 *   - 发送 / 停止按钮
 *
 * 未配 key 时显示引导(去设置)。
 */
import { useState, useEffect } from "react";
import { ArrowUp, Square, BookOpen, Compass, Hammer } from "lucide-react";
import type { Soul, StarterPrompt, HumanFrictionCategory } from "@shared/types";
import { useLang } from "../lib/i18n.js";

/** soul 名 → i18n key(短标签,显示在药丸里)。 */
const SOUL_LABEL_KEY: Record<string, string> = {
  direct: "soul.direct",
  guide: "soul.guide",
  practice: "soul.practice",
};

/** soul → lucide 图标(场景语义,非装饰)。 */
const SOUL_ICONS: Record<string, typeof Compass> = {
  direct: BookOpen, // 书:讲解/精讲
  guide: Compass, // 罗盘:探索/指引方向
  practice: Hammer, // 锤子:动手做
};

/** soul 名 → i18n key(完整说明,data-tooltip 显示)。 */
const SOUL_DESC_KEY: Record<string, string> = {
  direct: "soul.direct.desc",
  guide: "soul.guide.desc",
  practice: "soul.practice.desc",
};

interface ChatComposerProps {
  nodeId: string | null;
  agentReady: boolean;
  streaming: boolean;
  souls: Soul[];
  activeSoul: string | null;
  starterPrompts: StarterPrompt[];
  onPickSoul: (name: string) => void;
  onSend: (text: string, displayText?: string) => void;
  onStop: () => void;
  /** "我没太懂"等带 frictionCategory 的选择会额外记一条 friction(原 ? 卡点的归宿)。 */
  onLogFriction?: (category: HumanFrictionCategory, summary: string | null) => void;
  onGotoSettings: () => void;
  /** 外部注入文字(哪里不会点哪里:右栏选中→追加到输入框)。每次变化触发追加。 */
  insertText?: string;
}

export function ChatComposer({
  nodeId,
  agentReady,
  streaming,
  souls,
  activeSoul,
  starterPrompts,
  onPickSoul,
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

  // starter 选择:发消息;带 frictionCategory 的("我没太懂")额外记一条 friction。
  const handleStarterPick = (p: StarterPrompt) => {
    if (streaming) return;
    onSend(p.message, p.label); // 气泡只显示按钮文字,不显示完整提示词
    if (p.frictionCategory) onLogFriction?.(p.frictionCategory, null);
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
      {/* 巩固选择:只在对话开始后(App 传非空 starterPrompts)才出现 = 语境前零决策税。
          4 个正交的"一瞥→懂"路径(精加工/具体化/检索/困惑处置)。单行药丸排列(省空间,
          不过度遮挡对话区);hint 走 data-tooltip(GlobalTooltip),hover 才显示。 */}
      {starterPrompts.length > 0 && nodeId && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2" data-testid="starter-prompts">
          {starterPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => handleStarterPick(p)}
              disabled={streaming}
              data-testid={`starter-prompt-${i}`}
              data-tooltip={p.hint ?? p.label}
              className="shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full text-caption font-medium text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06] transition-colors disabled:opacity-30"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区:一个圆角胶囊容器(claude.ai 风)。
          内部:模式药丸行 + textarea + 发送钮。
          模式选择是输入框的一部分(决定"这段话用什么方式教"),不是独立工具栏。
          字号控制已移到顶栏(全局字号,不只中栏)。 */}
      <div className="rounded-2xl bg-ink/[0.05] focus-within:bg-ink/[0.07] transition-colors px-3 pt-2 pb-1.5">
        {/* 风格药丸:"风格:" 标签 + 三个教学人设药丸(图标+名字),hover 显示完整说明 */}
        {souls.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto mb-1" data-testid="soul-picker">
            <span className="text-body text-ink-faint shrink-0">{t("chat.soul.label")}</span>
            {souls.map((s) => {
              const isActive = activeSoul === s.name;
              const Icon = SOUL_ICONS[s.name] ?? Compass;
              const fullDesc = t(SOUL_DESC_KEY[s.name] ?? "soul.direct.desc");
              return (
                <button
                  key={s.id}
                  onClick={() => onPickSoul(s.name)}
                  data-testid={`soul-pill-${s.name}`}
                  data-tooltip={fullDesc}
                  className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-body font-medium transition-colors ${
                    isActive
                      ? "bg-brand/15 text-brand"
                      : "text-ink-muted hover:text-ink-strong hover:bg-ink/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t(SOUL_LABEL_KEY[s.name] ?? "soul.direct")}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* textarea + 发送钮:发送钮内嵌右下,圆形。
            原 ? 卡点入口已撤,折进上方"我没太懂"巩固选择(语境后出现)。 */}
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
              className="btn-icon-3d-warning shrink-0 w-9 h-9"
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
              className="btn-icon-3d-brand shrink-0 w-9 h-9"
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
