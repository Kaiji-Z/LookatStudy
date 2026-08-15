/**
 * ModelPicker —— 输入框内的模型快速切换器(v0.10)。
 *
 * 触发芯条显示当前模型名(caption 调,工具栏后撤原则);点开向上弹的菜单:
 * 按"已配置密钥的 provider"分组(当前 provider 永远在列,即使密钥缺失),
 * 每组列出 preset 的模型清单,支持看图的模型带 Eye 徽标(与附件功能呼应)。
 * 选择即写 active_provider + active_model 并广播 llm-config-changed
 * (与 SettingsView 同一机制,App 会重拉 agentReady)。
 *
 * 数据自取(getProviderPresets + listCustomProviders + settings),不依赖父组件喂。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Eye, Settings2 } from "lucide-react";
import type { CustomProvider, ProviderPresetInfo, SettingKey } from "@shared/types";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";

interface ModelPickerProps {
  onGotoSettings: () => void;
}

/** 一个可选模型的行数据。 */
interface ModelRow {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  vision: boolean;
  contextWindow: number | null;
}

export function ModelPicker({ onGotoSettings }: ModelPickerProps) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ModelRow[] | null>(null);
  const [activeProvider, setActiveProvider] = useState("");
  const [activeModel, setActiveModel] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [presets, customs, provider, model] = await Promise.all([
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_provider"),
        api.getSetting("active_model"),
      ]);
      const cur = provider ?? "glm";
      // 已配置密钥的 preset(并行查 key)+ 当前 provider(即使没 key 也要展示当前值)
      const keyedFlags = await Promise.all(
        presets.map(async (p) => (await api.getSetting(p.apiKeySetting as SettingKey)) != null),
      );
      const usable = new Set<string>();
      presets.forEach((p, i) => {
        if (keyedFlags[i] || p.id === cur) usable.add(p.id);
      });
      const modelRows: ModelRow[] = [];
      const pushGroup = (providerId: string, providerLabel: string, models: ProviderPresetInfo["models"]) => {
        for (const m of models) {
          modelRows.push({
            providerId,
            providerLabel,
            modelId: m.id,
            modelLabel: m.label,
            vision: (m.capabilities ?? []).includes("vision"),
            contextWindow: m.contextWindow,
          });
        }
      };
      for (const p of presets) {
        if (usable.has(p.id)) pushGroup(p.id, p.label, p.models);
      }
      for (const c of customs as CustomProvider[]) {
        pushGroup(c.id, c.label, c.models);
      }
      // 当前模型不在任何清单(手输/发现来的):补一行保证芯条与菜单永远能显示当前值
      const activeModelId = model ?? "";
      if (activeModelId && !modelRows.some((r) => r.providerId === cur && r.modelId === activeModelId)) {
        const label = presets.find((p) => p.id === cur)?.label ?? customs.find((c) => c.id === cur)?.label ?? cur;
        modelRows.unshift({
          providerId: cur,
          providerLabel: label,
          modelId: activeModelId,
          modelLabel: activeModelId,
          vision: true, // 未收录模型:宽松按可看图(与 supportsVision 口径一致)
          contextWindow: null,
        });
      }
      setRows(modelRows);
      setActiveProvider(cur);
      setActiveModel(activeModelId);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // Settings 里改了配置 → 这里跟着刷新(与 App 的 agentReady 重拉同一事件)
    const onCfg = () => void load();
    window.addEventListener("llm-config-changed", onCfg);
    return () => window.removeEventListener("llm-config-changed", onCfg);
  }, [load]);

  // 开着时:外点/Escape 关闭(一次 document 监听)
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

  const pick = async (row: ModelRow) => {
    setOpen(false);
    if (row.providerId === activeProvider && row.modelId === activeModel) return;
    try {
      await api.setSetting("active_provider", row.providerId);
      await api.setSetting("active_model", row.modelId);
      setActiveProvider(row.providerId);
      setActiveModel(row.modelId);
      // 与 SettingsView.handleSave 同一广播:App 重拉 agentReady,ContextMeter 重拉窗口
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* setSetting 失败保持原值 */
    }
  };

  const currentLabel =
    rows?.find((r) => r.providerId === activeProvider && r.modelId === activeModel)?.modelLabel ??
    activeModel ??
    t("model.picker.label");

  // 分组渲染:同 provider 的行归一段,段头是 provider 名
  const groups: Array<{ label: string; rows: ModelRow[] }> = [];
  for (const r of rows ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.label === r.providerLabel) last.rows.push(r);
    else groups.push({ label: r.providerLabel, rows: [r] });
  }

  return (
    <div ref={rootRef} className="relative" data-testid="composer-model">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={t("model.picker.label")}
        data-testid="composer-model-trigger"
        className="flex items-center gap-1 max-w-[13rem] px-1.5 py-0.5 rounded-full text-caption font-medium text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06] transition-colors"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronUp className={`w-3 h-3 shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("model.picker.label")}
          data-testid="composer-model-menu"
          className="absolute bottom-full right-0 mb-1.5 z-50 w-64 max-h-72 overflow-y-auto bg-surface-0 rounded-xl shadow-elevated border border-[var(--border)] py-1.5"
        >
          {groups.length === 0 && (
            <div className="px-3 py-2 text-caption text-ink-faint">{t("model.picker.noneConfigured")}</div>
          )}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className="px-3 pt-1.5 pb-0.5 text-caption font-bold text-ink-faint">{g.label}</div>
              {g.rows.map((r) => {
                const active = r.providerId === activeProvider && r.modelId === activeModel;
                return (
                  <button
                    key={`${r.providerId}:${r.modelId}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => void pick(r)}
                    className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
                      active ? "text-brand" : "text-ink-strong hover:bg-ink/[0.06]"
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${active ? "opacity-100" : "opacity-0"}`} />
                    <span className="flex-1 truncate text-label">{r.modelLabel}</span>
                    {r.vision && (
                      <Eye
                        className="w-3 h-3 shrink-0 text-ink-faint"
                        aria-label={t("model.picker.vision")}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onGotoSettings();
              }}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-label text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {t("model.picker.manage")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
