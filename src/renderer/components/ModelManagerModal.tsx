/**
 * ModelManagerModal —— 模型管理弹窗(v0.38;设置抽屉「AI 模型/看图模型」的专属空间)。
 *
 * 结构(PersonalProfileModal 同款骨架):遮罩 + role=dialog + useFocusTrap + Esc;
 * 顶部分段 [主模型] [看图]。
 *   主模型 tab = 双栏:左列表(搜索/19 预设+custom/状态点) | 右详情(key/模型/拉取/测试)。
 *     - 左列表点击 = 浏览详情(不切激活);模型下拉选定即激活(active_provider+active_model)。
 *     - 测试走 agent:testProvider —— key 主进程侧解析,浏览非激活 provider 也能测。
 *     - 拉取模型复用 ModelDiscoveryPanel(预设写 overlay / custom 合并 modelsJson)。
 *   看图 tab = ModelVisionTab(自设置抽屉原样迁入,testid 不变)。
 * 数据自取(getProviderPresets 服务端合并视图 + listCustomProviders + settings),
 * llm-config-changed 广播驱动刷新;弹窗打开时顺手尽力刷新模型目录(24h 缓存,失败静默)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Plus, Search, Wrench, XCircle } from "lucide-react";
import type { CustomProvider, ProviderPresetInfo, SettingKey } from "@shared/types";
import { formatTokenCount } from "@shared/token-estimate";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { ConfirmCard } from "./ConfirmCard.js";
import { CustomProviderForm } from "./CustomProviderForm.js";
import { ModelDiscoveryPanel } from "./ModelDiscoveryPanel.js";
import { ModelVisionTab } from "./ModelVisionTab.js";

export type ModelManagerTab = "main" | "vision";

interface ModelManagerModalProps {
  tab?: ModelManagerTab;
  onClose: () => void;
}

type TestResult = { ok: boolean; detail: string; latencyMs?: number } | null;

/** 价格徽标文本:输入价去尾零(0.15→"$0.15";2→"$2");null 不显 */
function priceText(p: { input: number | null; output: number | null } | undefined): string | null {
  if (!p || p.input === null || p.input === undefined) return null;
  return `$${String(Number(p.input.toFixed(2)))}`;
}

/** 选中模型的元数据小注(窗口/价格/能力;无内容返回 null) */
function modelMetaNote(m: {
  contextWindow: number | null;
  pricing?: { input: number | null; output: number | null };
  capabilities?: string[];
  reasoning?: boolean;
  free?: boolean;
  status?: string;
} | null): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.contextWindow) parts.push(formatTokenCount(m.contextWindow));
  const price = m.free ? null : priceText(m.pricing);
  if (m.free) parts.push("free");
  else if (price) parts.push(price);
  if ((m.capabilities ?? []).includes("vision")) parts.push("👁");
  if ((m.capabilities ?? []).includes("reasoning") || m.reasoning) parts.push("🧠");
  if (m.status === "deprecated") parts.push("deprecated");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function ModelManagerModal({ tab = "main", onClose }: ModelManagerModalProps) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
  const [activeTab, setActiveTab] = useState<ModelManagerTab>(tab);

  /* Esc 关闭(useFocusTrap 只管 Tab 循环) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ---------- 数据(自取,ModelPicker 模式) ---------- */
  const [presets, setPresets] = useState<ProviderPresetInfo[]>([]);
  const [customs, setCustoms] = useState<CustomProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("glm");
  const [activeModel, setActiveModel] = useState("");
  const [presetKeyFlags, setPresetKeyFlags] = useState<Record<string, boolean>>({});
  const [overlay, setOverlay] = useState<Record<string, { added: CustomProvider["models"]; fetchedAt?: string }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ps, cs, provider, model, ov] = await Promise.all([
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_provider"),
        api.getSetting("active_model"),
        api.getModelOverlay(),
      ]);
      const llmCustoms = cs.filter((c) => c.kind === "llm");
      setPresets(ps);
      setCustoms(cs); // 全表:主模型 tab 自滤 kind=llm;看图 tab 需要 vision/旧覆盖查表
      setActiveProviderId(provider ?? "glm");
      setActiveModel(model ?? "");
      setOverlay(ov);
      const keyFlags: Record<string, boolean> = {};
      await Promise.all(
        ps.map(async (p) => {
          keyFlags[p.id] = await api.hasSetting(p.apiKeySetting as SettingKey);
        }),
      );
      setPresetKeyFlags(keyFlags);
      // 首次选中 = 当前激活 provider;之后保持用户的选择(除非该项被删)
      setSelectedId((prev) => {
        if (prev && (ps.some((p) => p.id === prev) || llmCustoms.some((c) => c.id === prev))) return prev;
        return provider ?? "glm";
      });
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onCfg = () => void load();
    window.addEventListener("llm-config-changed", onCfg);
    return () => window.removeEventListener("llm-config-changed", onCfg);
  }, [load]);

  // 弹窗打开时:目录尽力刷新(models.dev,24h 缓存,失败静默)→ 重拉徽标
  useEffect(() => {
    let alive = true;
    api
      .refreshModelCatalog()
      .then(() => {
        if (alive) void load();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [load]);

  /* ---------- 动作 ---------- */

  const broadcast = () => window.dispatchEvent(new Event("llm-config-changed"));

  /** 模型选定即激活(写 active_provider + active_model) */
  const activateModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await api.setSetting("active_provider", providerId);
        await api.setSetting("active_model", modelId);
        broadcast();
      } catch {
        /* 写失败保持原值(reload 会回读真实态) */
      }
    },
    [],
  );

  /* 删除自定义 provider 的内联确认(z-60 portal,弹窗内可用) */
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; rect: DOMRect } | null>(null);
  const handleDeleteCustom = async (id: string) => {
    setConfirmDelete(null);
    try {
      await api.deleteCustomProvider(id);
      if (activeProviderId === id) {
        await api.setSetting("active_provider", "glm");
      }
      if (selectedId === id) setSelectedId("glm");
      broadcast();
    } catch {
      /* 忽略 */
    }
  };

  // z-[60]:须盖住设置抽屉(z-50)——弹窗从抽屉卡片唤起,同为 z-50 时 DOM 序在后的
  // 抽屉会反过来盖住弹窗(2026-09-19 手机端实测);ConfirmCard(z-60 portal 到 body
  // 末尾)同层级靠 DOM 序仍在其上
  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" data-testid="model-manager-modal">
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t("model.manager.title")} className="w-[min(880px,94vw)] h-[60dvh] rounded-2xl bg-surface-0 shadow-elevated" onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-testid="model-manager-modal">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("model.manager.title")}
        className="w-[min(880px,94vw)] max-h-[86dvh] rounded-2xl bg-surface-0 shadow-elevated flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 固定头部:标题 + 分段 tab + 关闭 */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-body font-bold text-ink-strong">{t("model.manager.title")}</h2>
          <div className="flex gap-1 bg-surface-3 rounded-full p-0.5" role="tablist" aria-label={t("model.manager.title")}>
            {(["main", "vision"] as const).map((tabKey) => (
              <button
                key={tabKey}
                role="tab"
                aria-selected={activeTab === tabKey}
                onClick={() => setActiveTab(tabKey)}
                data-testid={`model-manager-tab-${tabKey}`}
                className={`px-3 py-1 rounded-full text-label font-medium transition-colors ${
                  activeTab === tabKey ? "bg-surface-0 text-ink-strong shadow-sm" : "text-ink-muted hover:text-ink-strong"
                }`}
              >
                {t(tabKey === "main" ? "model.manager.tab_main" : "model.manager.tab_vision")}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            data-testid="model-manager-close"
            aria-label={t("action.close")}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-strong hover:bg-surface-3"
          >
            ✕
          </button>
        </div>

        {activeTab === "vision" ? (
          /* ---------- 看图 tab:单列(自设置抽屉原样迁入;需要全表 customs) ---------- */
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ModelVisionTab
              activeProvider={activeProviderId}
              activeModel={activeModel}
              presets={presets}
              customProviders={customs}
              onProvidersChanged={() => void load()}
            />
          </div>
        ) : (
          /* ---------- 主模型 tab:双栏 ---------- */
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            <MainTabPane
              presets={presets}
              customs={customs.filter((c) => c.kind === "llm")}
              overlay={overlay}
              presetKeyFlags={presetKeyFlags}
              activeProviderId={activeProviderId}
              activeModel={activeModel}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onActivate={activateModel}
              onReload={load}
              setConfirmDelete={setConfirmDelete}
            />
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmCard
          anchorRect={confirmDelete.rect}
          message={t("settings.delete_custom_confirm", { name: confirmDelete.label })}
          danger
          confirmLabel={t("action.delete")}
          testid="model-manager-delete-confirm"
          onConfirm={() => void handleDeleteCustom(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/* ---------- 主模型 tab 双栏(独立子组件:选中态局部 state 随 selectedId 重置) ---------- */

interface MainTabPaneProps {
  presets: ProviderPresetInfo[];
  customs: CustomProvider[];
  overlay: Record<string, { added: CustomProvider["models"]; fetchedAt?: string }>;
  presetKeyFlags: Record<string, boolean>;
  activeProviderId: string;
  activeModel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onActivate: (providerId: string, modelId: string) => void;
  onReload: () => Promise<void>;
  setConfirmDelete: (v: { id: string; label: string; rect: DOMRect } | null) => void;
}

function MainTabPane({
  presets,
  customs,
  overlay,
  presetKeyFlags,
  activeProviderId,
  activeModel,
  selectedId,
  onSelect,
  onActivate,
  onReload,
  setConfirmDelete,
}: MainTabPaneProps) {
  const t = useLang();
  const [search, setSearch] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);

  const q = search.trim().toLowerCase();
  const filteredPresets = q
    ? presets.filter((p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.note ?? "").toLowerCase().includes(q))
    : presets;
  const filteredCustoms = q ? customs.filter((c) => c.label.toLowerCase().includes(q)) : customs;

  const selectedPreset = selectedId && !selectedId.startsWith("custom-") ? presets.find((p) => p.id === selectedId) ?? null : null;
  const selectedCustom = selectedId && selectedId.startsWith("custom-") ? customs.find((c) => c.id === selectedId) ?? null : null;

  const rowCls = (selected: boolean) =>
    `w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors shrink-0 ${
      selected ? "bg-brand/[0.1] text-ink-strong" : "text-ink-muted hover:bg-ink/[0.05] hover:text-ink-strong"
    }`;

  const dotCls = (active: boolean, keyed: boolean) =>
    `w-2 h-2 rounded-full shrink-0 ${active ? "bg-brand" : keyed ? "bg-ink/40" : "bg-ink/15"}`;

  const statusTip = (active: boolean, keyed: boolean) =>
    active ? t("model.manager.active") : keyed ? t("model.manager.key_set") : t("model.manager.no_key");

  return (
    <>
      {/* 左列表(含搜索;此块在移动端位于详情上方) */}
      <div className="shrink-0 md:w-60 flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-[var(--border-faint)]">
        <div className="p-2 pb-1.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("model.manager.search")}
              data-testid="model-manager-search"
              className="w-full bg-surface-1 text-ink text-label rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none pl-7 pr-2 py-1.5 placeholder:text-ink-faint"
            />
          </div>
        </div>
        <div className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-y-auto px-2 pb-2 min-h-0" data-testid="model-manager-list">
          {filteredPresets.map((p) => {
            const active = p.id === activeProviderId;
            const keyed = !!presetKeyFlags[p.id];
            return (
              <button key={p.id} onClick={() => onSelect(p.id)} className={rowCls(selectedId === p.id)} data-testid={`mm-provider-${p.id}`} title={statusTip(active, keyed)}>
                <span className={dotCls(active, keyed)} aria-hidden />
                <span className="truncate text-label flex-1">{p.label}</span>
                {active && <Check className="w-3.5 h-3.5 text-brand shrink-0" aria-label={t("model.manager.active")} />}
              </button>
            );
          })}
          {filteredCustoms.length > 0 && (
            <div className="hidden md:block px-1.5 pt-2 pb-0.5 text-caption font-bold text-ink-faint shrink-0">{t("model.manager.group_custom")}</div>
          )}
          {filteredCustoms.map((c) => {
            const active = c.id === activeProviderId;
            return (
              <button key={c.id} onClick={() => onSelect(c.id)} className={`${rowCls(selectedId === c.id)} md:w-full`} data-testid={`mm-provider-${c.id}`} title={statusTip(active, c.hasApiKey)}>
                <span className={dotCls(active, c.hasApiKey)} aria-hidden />
                <Wrench className="w-3 h-3 shrink-0 text-ink-faint" aria-hidden />
                <span className="truncate text-label flex-1">{c.label}</span>
                {active && <Check className="w-3.5 h-3.5 text-brand shrink-0" aria-label={t("model.manager.active")} />}
              </button>
            );
          })}
          <button
            onClick={() => setShowCustomForm((s) => !s)}
            className="shrink-0 w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-dashed border-[var(--border)] text-ink-muted hover:border-ink-muted hover:text-ink-strong text-label transition-colors"
            data-testid="mm-add-custom"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            {t("model.manager.add_custom")}
          </button>
        </div>
        {showCustomForm && (
          <div className="p-2 border-t border-[var(--border-faint)] shrink-0 md:overflow-y-auto">
            <CustomProviderForm
              kind="llm"
              testPrefix="mm-custom"
              onSaved={(created) => {
                setShowCustomForm(false);
                onSelect(created.id);
                void onReload();
                window.dispatchEvent(new Event("llm-config-changed"));
              }}
              onCancel={() => setShowCustomForm(false)}
            />
          </div>
        )}
      </div>

      {/* 右详情 */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 space-y-4" data-testid="model-manager-detail">
        {!selectedPreset && !selectedCustom && (
          <div className="text-label text-ink-faint py-8 text-center">{t("model.manager.no_selection")}</div>
        )}

        {selectedPreset && (
          <PresetDetail
            key={selectedPreset.id}
            preset={selectedPreset}
            keyConfigured={!!presetKeyFlags[selectedPreset.id]}
            isActive={selectedPreset.id === activeProviderId}
            shownModel={selectedPreset.id === activeProviderId ? activeModel || selectedPreset.defaultModel : selectedPreset.defaultModel}
            overlayEntry={overlay[selectedPreset.id]}
            onActivate={onActivate}
            onReload={onReload}
          />
        )}

        {selectedCustom && (
          <CustomDetail
            key={selectedCustom.id}
            custom={selectedCustom}
            isActive={selectedCustom.id === activeProviderId}
            activeModel={selectedCustom.id === activeProviderId ? activeModel : ""}
            onActivate={onActivate}
            onReload={onReload}
            onAskDelete={(rect) => setConfirmDelete({ id: selectedCustom.id, label: selectedCustom.label, rect })}
          />
        )}
      </div>
    </>
  );
}

/* ---------- 预设详情 ---------- */

function PresetDetail({
  preset,
  keyConfigured,
  isActive,
  shownModel,
  overlayEntry,
  onActivate,
  onReload,
}: {
  preset: ProviderPresetInfo;
  keyConfigured: boolean;
  isActive: boolean;
  shownModel: string;
  overlayEntry?: { added: CustomProvider["models"]; fetchedAt?: string };
  onActivate: (providerId: string, modelId: string) => void;
  onReload: () => Promise<void>;
}) {
  const t = useLang();
  const [keyInput, setKeyInput] = useState("");
  const [keySavedAt, setKeySavedAt] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);

  const selectedEntry = preset.models.find((m) => m.id === shownModel) ?? null;
  const note = modelMetaNote(selectedEntry);

  const saveKey = async () => {
    const v = keyInput.trim();
    if (!v) return;
    try {
      await api.setSetting(preset.apiKeySetting as SettingKey, v);
      setKeyInput("");
      setKeySavedAt(Date.now());
      window.dispatchEvent(new Event("llm-config-changed"));
      await onReload();
    } catch {
      /* 保存失败静默(输入保留) */
    }
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testProvider(preset.id, shownModel);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-brand" : keyConfigured ? "bg-ink/40" : "bg-ink/15"}`} aria-hidden />
        <span className="text-body font-bold text-ink-strong">{preset.label}</span>
        {preset.note && <span className="text-caption text-ink-faint">{preset.note}</span>}
      </div>

      {preset.baseUrl && (
        <div>
          <div className="text-caption font-bold text-ink-faint mb-1">Base URL</div>
          <code className="text-label text-ink-muted font-mono break-all">{preset.baseUrl}</code>
        </div>
      )}

      {/* key 行:password 输入,失焦即存;已配置态只显布尔芯片,永不回显明文 */}
      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">{t("settings.apikey")}</div>
        <div className="flex flex-wrap items-center gap-2">
          {keyConfigured && (
            <span className="text-label text-brand inline-flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t("settings.key.configured")}
            </span>
          )}
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onBlur={() => void saveKey()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveKey();
              }
            }}
            placeholder={keyConfigured ? t("settings.key.overwrite_ph") : t("settings.key.paste_ph")}
            data-testid="mm-key-input"
            className="flex-1 min-w-[10rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5"
          />
          <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="text-label text-brand hover:underline whitespace-nowrap">
            {t("settings.key.get")}
          </a>
          {keySavedAt > 0 && (
            <span className="text-caption text-brand inline-flex items-center gap-0.5 shrink-0">
              <Check className="w-3 h-3" aria-hidden />
              {t("model.manager.key_saved")}
            </span>
          )}
        </div>
      </div>

      {/* 模型行:选定即激活 */}
      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">{t("settings.model")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={shownModel}
            onChange={(e) => onActivate(preset.id, e.target.value)}
            data-testid="mm-model-select"
            aria-label={t("settings.model")}
            className="flex-1 min-w-[12rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none px-2.5 py-1.5"
          >
            {preset.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.status === "deprecated" ? " (deprecated)" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleTest()}
            disabled={testing}
            data-testid="mm-test-btn"
            className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40 shrink-0"
          >
            {testing ? t("settings.testing") : t("settings.test")}
          </button>
          <button
            onClick={() => setShowDiscovery((s) => !s)}
            data-testid="mm-discover-toggle"
            className="text-label text-accent hover:underline whitespace-nowrap shrink-0"
          >
            {t("settings.models.discover")}
          </button>
        </div>
        {note && <div className="text-caption text-ink-faint mt-1 tabular-nums">{note}</div>}
        {testResult && (
          <div className={`text-label mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 ${testResult.ok ? "text-brand" : "text-warning"}`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> : <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
            {testResult.detail}
          </div>
        )}
      </div>

      {showDiscovery && (
        <div className="rounded-lg bg-surface-1 border border-[var(--border-faint)] p-3">
          <ModelDiscoveryPanel
            providerId={preset.id}
            existingModels={preset.models}
            removableModels={overlayEntry?.added ?? []}
            customProvider={null}
            onApplied={() => void onReload()}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 自定义 provider 详情 ---------- */

function CustomDetail({
  custom,
  isActive,
  activeModel,
  onActivate,
  onReload,
  onAskDelete,
}: {
  custom: CustomProvider;
  isActive: boolean;
  activeModel: string;
  onActivate: (providerId: string, modelId: string) => void;
  onReload: () => Promise<void>;
  onAskDelete: (rect: DOMRect) => void;
}) {
  const t = useLang();
  const [keyInput, setKeyInput] = useState("");
  const [keySavedAt, setKeySavedAt] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  /** 自由文本模型草稿(null=受控显示 derived 值;输入中走 draft,blur 提交) */
  const [freeModelDraft, setFreeModelDraft] = useState<string | null>(null);
  /** 上下文窗口编辑(仅当前展示模型条目) */
  const shownModelId = isActive ? activeModel || custom.defaultModel : custom.defaultModel;
  const shownEntry = custom.models.find((m) => m.id === shownModelId) ?? null;
  const [windowDraft, setWindowDraft] = useState<string>(shownEntry?.contextWindow ? String(shownEntry.contextWindow) : "");
  const [windowSaving, setWindowSaving] = useState(false);
  const note = modelMetaNote(shownEntry);

  const saveKey = async () => {
    const v = keyInput.trim();
    if (!v) return;
    try {
      await api.updateCustomProvider(custom.id, { apiKey: v });
      setKeyInput("");
      setKeySavedAt(Date.now());
      window.dispatchEvent(new Event("llm-config-changed"));
      await onReload();
    } catch {
      /* 忽略 */
    }
  };

  const commitFreeModel = async () => {
    if (freeModelDraft === null) return;
    const v = freeModelDraft.trim();
    setFreeModelDraft(null);
    if (!v || v === shownModelId) return;
    onActivate(custom.id, v);
  };

  /** 上下文窗口保存(写回该模型条目;128k/1m 后缀解析与旧抽屉同款) */
  const saveWindow = async () => {
    const raw = windowDraft.trim().replace(/[,\s_]/g, "");
    const m = /^(\d+)([km]?)$/i.exec(raw);
    if (raw !== "" && !m) return;
    const mult = m?.[2]?.toLowerCase() === "k" ? 1000 : m?.[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
    const parsed = raw === "" || !m ? null : Math.max(1, Math.round(parseInt(m[1]!, 10) * mult));
    setWindowSaving(true);
    try {
      const models = custom.models.map((en) => (en.id === shownModelId ? { ...en, contextWindow: parsed } : en));
      await api.updateCustomProvider(custom.id, { models });
      await onReload();
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    } finally {
      setWindowSaving(false);
    }
  };

  const toggleVision = async (vision: boolean) => {
    try {
      await api.updateCustomProvider(custom.id, { vision });
      await onReload();
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    }
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testProvider(custom.id, shownModelId);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-brand" : custom.hasApiKey ? "bg-ink/40" : "bg-ink/15"}`} aria-hidden />
        <Wrench className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden="true" />
        <span className="text-body font-bold text-ink-strong">{custom.label}</span>
        <button
          onClick={(e) => onAskDelete((e.currentTarget as HTMLElement).getBoundingClientRect())}
          data-testid="mm-delete-custom"
          className="text-label text-ink-muted hover:text-warning ml-auto"
        >
          {t("action.delete")}
        </button>
      </div>

      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">Base URL</div>
        <code className="text-label text-ink-muted font-mono break-all">{custom.baseUrl}</code>
      </div>

      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">{t("settings.apikey")}</div>
        <div className="flex flex-wrap items-center gap-2">
          {custom.hasApiKey && (
            <span className="text-label text-brand inline-flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t("settings.key.configured")}
            </span>
          )}
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onBlur={() => void saveKey()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveKey();
              }
            }}
            placeholder={custom.hasApiKey ? t("settings.key.overwrite_ph") : t("settings.custom.apikey_ph")}
            data-testid="mm-key-input-custom"
            className="flex-1 min-w-[10rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5"
          />
          {keySavedAt > 0 && (
            <span className="text-caption text-brand inline-flex items-center gap-0.5 shrink-0">
              <Check className="w-3 h-3" aria-hidden />
              {t("model.manager.key_saved")}
            </span>
          )}
        </div>
      </div>

      {/* 模型行:多模型下拉 / 单模型自由文本;提交即激活 */}
      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">{t("settings.model")}</div>
        <div className="flex flex-wrap items-center gap-2">
          {custom.models.length > 1 ? (
            <select
              value={shownModelId}
              onChange={(e) => onActivate(custom.id, e.target.value)}
              data-testid="mm-model-select-custom"
              aria-label={t("settings.model")}
              className="flex-1 min-w-[12rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none px-2.5 py-1.5"
            >
              {custom.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={freeModelDraft ?? shownModelId}
              onChange={(e) => setFreeModelDraft(e.target.value)}
              onBlur={() => void commitFreeModel()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitFreeModel();
                }
              }}
              placeholder={t("settings.custom.model_ph")}
              data-testid="mm-model-input-custom"
              className="flex-1 min-w-[12rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5 font-mono"
            />
          )}
          <button
            onClick={() => void handleTest()}
            disabled={testing}
            data-testid="mm-test-btn-custom"
            className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40 shrink-0"
          >
            {testing ? t("settings.testing") : t("settings.test")}
          </button>
          {custom.protocol === "openai-compatible" && (
            <button
              onClick={() => setShowDiscovery((s) => !s)}
              data-testid="mm-discover-toggle-custom"
              className="text-label text-accent hover:underline whitespace-nowrap shrink-0"
            >
              {t("settings.models.discover")}
            </button>
          )}
        </div>
        {note && <div className="text-caption text-ink-faint mt-1 tabular-nums">{note}</div>}
        {testResult && (
          <div className={`text-label mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 ${testResult.ok ? "text-brand" : "text-warning"}`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> : <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
            {testResult.detail}
          </div>
        )}
      </div>

      {/* 上下文窗口编辑(写回模型条目;目录回填有值的场景一般无需手填) */}
      <div>
        <div className="text-caption font-bold text-ink-faint mb-1">{t("settings.custom.windowLabel")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={windowDraft}
            onChange={(e) => setWindowDraft(e.target.value)}
            placeholder={t("settings.custom.windowPh")}
            data-testid="mm-context-window-input"
            className="flex-1 min-w-[10rem] bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint px-2.5 py-1.5 font-mono tabular-nums"
          />
          <button onClick={() => void saveWindow()} disabled={windowSaving} data-testid="mm-context-window-save" className="btn-3d-neutral px-3 py-1.5 text-label shrink-0 disabled:opacity-40">
            {t("settings.custom.save")}
          </button>
        </div>
        <div className="text-caption text-ink-faint mt-1">{t("settings.custom.windowHint")}</div>
      </div>

      {/* vision 能力勾选(kind=llm 行声明看图) */}
      <label className="inline-flex items-center gap-2 text-label cursor-pointer select-none" data-testid="mm-vision-toggle">
        <input
          type="checkbox"
          checked={custom.vision}
          onChange={(e) => void toggleVision(e.target.checked)}
          className="w-4 h-4 rounded accent-brand"
        />
        <span className="text-ink-strong">{t("settings.custom.vision")}</span>
        <span className="text-ink-faint">{t("settings.custom.visionHint")}</span>
      </label>

      {showDiscovery && (
        <div className="rounded-lg bg-surface-1 border border-[var(--border-faint)] p-3">
          <ModelDiscoveryPanel
            providerId={custom.id}
            existingModels={custom.models}
            removableModels={custom.models}
            customProvider={custom}
            onApplied={() => void onReload()}
          />
        </div>
      )}
    </div>
  );
}
