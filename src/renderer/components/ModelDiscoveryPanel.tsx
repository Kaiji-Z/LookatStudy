/**
 * ModelDiscoveryPanel — 设置页"拉取模型"的内联面板(预设与自定义 provider 通用)。
 *
 * 流程:api.discoverModelsFor(providerId) —— key 在主进程侧解析,渲染层永远拿不到
 * 明文;返回条目已做目录元数据回填(上下文/价格/能力)。勾选添加:
 *   - 预设 → agent:setModelOverlay(纯变换在 @shared/model-overlay,服务端再过归一化闸门)
 *   - 自定义 → customProvider:update 合并进 modelsJson(保留既有条目,按 id 去重)
 * 手工直填不依赖拉取;当前已添加条目带 ✕ 可移除。
 * 应用后广播 llm-config-changed(App/ModelPicker/ContextMeter 跟着刷新)。
 */
import { useMemo, useState } from "react";
import { Check, RotateCw, X } from "lucide-react";
import type { CustomProvider, ProviderModelInfo } from "@shared/types";
import { addToOverlay, removeFromOverlay } from "@shared/model-overlay";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";

interface ModelDiscoveryPanelProps {
  providerId: string;
  /** 该 provider 当前生效模型列表(预设=策展∪overlay;自定义=modelsJson) */
  existingModels: ProviderModelInfo[];
  /** 用户可移除的条目(预设=overlay.added;自定义=modelsJson 全部) */
  removableModels: ProviderModelInfo[];
  /** 自定义 provider 行(预设传 null)——决定添加走 modelsJson 还是 overlay */
  customProvider: CustomProvider | null;
  onApplied: () => void;
}

/** 价格显示:去尾零(0.15→"0.15";2→"2";null→"?") */
function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "?";
  return String(Number(v.toFixed(2)));
}

/** 元数据小注:窗口/价格一行(有才显示) */
function metaNote(m: ProviderModelInfo): string {
  const parts: string[] = [];
  if (m.contextWindow) parts.push(`${Math.round(m.contextWindow / 1000)}k`);
  if (m.pricing && (m.pricing.input !== null || m.pricing.output !== null)) {
    parts.push(`$${fmtPrice(m.pricing.input)}/${fmtPrice(m.pricing.output)}`);
  }
  return parts.join(" · ");
}

export function ModelDiscoveryPanel({
  providerId,
  existingModels,
  removableModels,
  customProvider,
  onApplied,
}: ModelDiscoveryPanelProps) {
  const t = useLang();
  const [phase, setPhase] = useState<"idle" | "fetching" | "list" | "error">("idle");
  const [fetched, setFetched] = useState<ProviderModelInfo[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const [applying, setApplying] = useState(false);

  const existingIds = useMemo(
    () => new Set(existingModels.map((m) => m.id.toLowerCase())),
    [existingModels],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = fetched.filter((m) => !existingIds.has(m.id.toLowerCase()));
    if (!q) return list;
    return list.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [fetched, query, existingIds]);

  const fetchModels = async () => {
    setPhase("fetching");
    setFetchError(null);
    setSelected(new Set());
    try {
      const r = await api.discoverModelsFor(providerId);
      if (r.ok && r.models) {
        setFetched(r.models);
        setPhase("list");
      } else {
        setFetchError(r.error ?? t("settings.models.discover_failed"));
        setPhase("error");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 应用:预设写 overlay;自定义合并 modelsJson。写入后统一刷新 + 广播。 */
  const applyModels = async (models: ProviderModelInfo[]) => {
    if (applying || models.length === 0) return;
    setApplying(true);
    try {
      if (customProvider) {
        const merged = [...customProvider.models];
        const ids = new Set(merged.map((m) => m.id.toLowerCase()));
        for (const m of models) {
          if (ids.has(m.id.toLowerCase())) continue;
          ids.add(m.id.toLowerCase());
          merged.push(m);
        }
        await api.updateCustomProvider(customProvider.id, { models: merged });
      } else {
        const overlay = await api.getModelOverlay();
        await api.setModelOverlay(addToOverlay(overlay, providerId, models));
      }
      onApplied();
      window.dispatchEvent(new Event("llm-config-changed"));
      setSelected(new Set());
      setManualId("");
    } catch {
      /* 写失败保持面板现状,用户可重试 */
    } finally {
      setApplying(false);
    }
  };

  const removeModel = async (modelId: string) => {
    if (applying) return;
    setApplying(true);
    try {
      if (customProvider) {
        const merged = customProvider.models.filter((m) => m.id.toLowerCase() !== modelId.toLowerCase());
        await api.updateCustomProvider(customProvider.id, { models: merged });
      } else {
        const overlay = await api.getModelOverlay();
        await api.setModelOverlay(removeFromOverlay(overlay, providerId, modelId));
      }
      onApplied();
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    } finally {
      setApplying(false);
    }
  };

  const addManual = () => {
    const id = manualId.trim();
    if (!id) return;
    // 目录回填:如果恰在最近一次拉取结果里,带上元数据
    const hit = fetched.find((m) => m.id.toLowerCase() === id.toLowerCase());
    void applyModels([hit ?? { id, label: id, contextWindow: null }]);
  };

  return (
    <div className="space-y-2" data-testid="model-discovery-panel">
      {/* 头:拉取按钮 + 状态 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void fetchModels()}
          disabled={phase === "fetching"}
          data-testid="discover-for-btn"
          className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40 inline-flex items-center gap-1"
        >
          <RotateCw className={`w-3.5 h-3.5 ${phase === "fetching" ? "animate-spin" : ""}`} aria-hidden="true" />
          {phase === "fetching" ? t("settings.models.fetching") : t("settings.models.discover")}
        </button>
        {phase === "list" && (
          <span className="text-label text-ink-faint">{t("settings.models.discover_done", { n: String(fetched.length) })}</span>
        )}
        {phase === "error" && <span className="text-label text-warning break-all">{fetchError}</span>}
      </div>

      {/* 已添加条目(可移除) */}
      {removableModels.length > 0 && (
        <div className="space-y-1">
          <div className="text-caption font-bold text-ink-faint">{t("settings.models.added_title")}</div>
          <div className="flex flex-wrap gap-1.5">
            {removableModels.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-surface-3 text-label text-ink-strong"
              >
                <span className="font-mono">{m.id}</span>
                <button
                  type="button"
                  onClick={() => void removeModel(m.id)}
                  disabled={applying}
                  aria-label={`${t("settings.models.manual_add")} ✕ ${m.id}`}
                  data-tooltip={t("action.delete")}
                  data-testid={`discovery-remove-${m.id}`}
                  className="w-5 h-5 rounded-full hover:bg-ink/10 flex items-center justify-center text-ink-muted hover:text-warning"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 发现清单(拉取后) */}
      {phase === "list" && (
        <div className="space-y-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.models.search_ph")}
            className="w-full bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5"
            data-testid="discovery-search"
          />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-faint)]">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-label text-ink-faint">{t("settings.models.empty")}</div>
            )}
            {filtered.map((m) => {
              const checked = selected.has(m.id);
              const note = metaNote(m);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer border-b border-[var(--border-faint)] last:border-b-0 ${
                    checked ? "bg-brand/[0.08]" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(m.id)}
                    className="w-4 h-4 rounded accent-brand shrink-0"
                    data-testid={`discovery-check-${m.id}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-label font-mono text-ink-strong truncate">{m.id}</span>
                    {note && <span className="block text-caption text-ink-faint">{note}</span>}
                  </span>
                  {(m.capabilities ?? []).includes("vision") && (
                    <span className="text-caption text-ink-faint shrink-0" title={t("model.picker.vision")}>👁</span>
                  )}
                  {checked && <Check className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />}
                </label>
              );
            })}
          </div>
          <button
            onClick={() => void applyModels(filtered.filter((m) => selected.has(m.id)))}
            disabled={applying || selected.size === 0}
            data-testid="discovery-apply"
            className="btn-3d-brand px-3 py-1.5 text-label disabled:opacity-40"
          >
            {t("settings.models.add_selected", { n: String(selected.size) })}
          </button>
        </div>
      )}

      {/* 手工直填(不依赖拉取) */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder={t("settings.models.manual_ph")}
          className="flex-1 bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5 font-mono"
          data-testid="discovery-manual-input"
        />
        <button
          onClick={addManual}
          disabled={applying || !manualId.trim()}
          className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40 shrink-0"
          data-testid="discovery-manual-add"
        >
          {t("settings.models.manual_add")}
        </button>
      </div>
    </div>
  );
}
