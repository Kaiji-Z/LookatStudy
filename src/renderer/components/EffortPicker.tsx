/**
 * EffortPicker —— 输入框的思考强度切换(v0.10)。
 *
 * 三档:自动(零干预,模型默认)/ 快速(尽量关思考,答得快省 token)/ 深度(尽量开思考)。
 * 应用级偏好存 settings.reasoning_effort,下一轮对话生效(agent-engine 落地方言表
 * 见 @shared/reasoning-effort)。当前 provider 不在方言表内 → 芯条禁用 + tooltip 说明。
 *
 * 数据自取(active_provider + reasoning_effort 两个 settings + presets 查协议)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronUp } from "lucide-react";
import type { ReasoningEffortSetting, SettingKey } from "@shared/types";
import { supportsReasoningControl, type LlmProtocol } from "@shared/reasoning-effort";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";

/** 档位 key(空串=自动) → i18n label/desc key。 */
const LEVELS: Array<{ value: ReasoningEffortSetting; labelKey: string; descKey: string }> = [
  { value: "", labelKey: "effort.auto.label", descKey: "effort.auto.desc" },
  { value: "fast", labelKey: "effort.fast.label", descKey: "effort.fast.desc" },
  { value: "deep", labelKey: "effort.deep.label", descKey: "effort.deep.desc" },
];

export function EffortPicker() {
  const t = useLang();
  const [open, setOpen] = useState(false);
  const [effort, setEffort] = useState<ReasoningEffortSetting>("");
  const [supported, setSupported] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [provider, saved, presets, customs, activeModel] = await Promise.all([
        api.getSetting("active_provider"),
        api.getSetting("reasoning_effort" as SettingKey),
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_model" as SettingKey),
      ]);
      const id = provider ?? "glm";
      const custom = customs.find((c) => c.id === id);
      const protocol =
        (presets.find((p) => p.id === id)?.protocol as LlmProtocol | undefined) ??
        (custom?.protocol as LlmProtocol | undefined) ??
        "openai-compatible";
      // 嗅探 hints:custom provider 用 baseUrl + defaultModel/active_model
      setSupported(supportsReasoningControl(id, protocol, {
        baseUrl: custom?.baseUrl,
        model: activeModel ?? custom?.defaultModel,
      }));
      const v = saved ?? "";
      setEffort(v === "fast" || v === "deep" ? v : "");
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onCfg = () => void load(); // 切了 provider → 支持性可能变
    window.addEventListener("llm-config-changed", onCfg);
    return () => window.removeEventListener("llm-config-changed", onCfg);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) !== true) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (v: ReasoningEffortSetting) => {
    setOpen(false);
    if (v === effort) return;
    setEffort(v);
    try {
      await api.setSetting("reasoning_effort" as SettingKey, v);
    } catch {
      setEffort(effort); // 写失败回滚显示
    }
  };

  const current = LEVELS.find((l) => l.value === effort) ?? LEVELS[0]!;

  return (
    <div ref={rootRef} className="relative" data-testid="composer-effort">
      <button
        type="button"
        onClick={() => !(!supported) && setOpen(!open)}
        disabled={!supported}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="composer-effort-trigger"
        data-tooltip={supported ? t("effort.label") : t("effort.unsupported")}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-caption font-medium transition-colors ${
          effort ? "text-accent" : "text-ink-muted"
        } ${supported ? "hover:text-ink-strong hover:bg-ink/[0.06]" : "opacity-40 cursor-not-allowed"}`}
      >
        <Brain className="w-3 h-3 shrink-0" />
        <span className="truncate">{t(current.labelKey)}</span>
        <ChevronUp className={`w-3 h-3 shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("effort.label")}
          data-testid="composer-effort-menu"
          className="absolute bottom-full right-0 mb-1.5 z-50 w-60 bg-surface-0 rounded-xl shadow-elevated border border-[var(--border)] py-1.5"
        >
          {LEVELS.map((l) => {
            const active = l.value === effort;
            return (
              <button
                key={l.value || "auto"}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => void pick(l.value)}
                className={`w-full flex items-start gap-1.5 px-3 py-1.5 text-left transition-colors ${
                  active ? "text-brand" : "text-ink-strong hover:bg-ink/[0.06]"
                }`}
              >
                <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${active ? "opacity-100" : "opacity-0"}`} />
                <span className="flex-1">
                  <span className="block text-label font-bold">{t(l.labelKey)}</span>
                  <span className="block text-caption text-ink-faint">{t(l.descKey)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
