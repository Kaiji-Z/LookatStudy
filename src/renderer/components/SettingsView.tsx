/**
 * 设置页 —— v0.8 重构为分组设置(iOS / Linear 式)。
 *
 * 设计语汇:
 *   - 单标题:抽屉头已有"设置 + 关闭",本组件不再重复标题。
 *   - 分组:AI 模型 / AI 看图 / 外观与语言。每组一张 surface-card,卡内用
 *     发丝线(border-t border-faint)分行,避开"每节一张卡平铺无层级"的老问题。
 *   - 行:左侧标签(text-label 粗体)+ 右侧控件;helper 文字在标签下。
 *   - 粘性页脚:保存按钮(仅作用于 AI 模型区)+ hint 说明即时/显式语义。
 *
 * 功能边界:
 *   - AI 模型区(provider/model/key/test)显式保存 —— 改完点"保存 AI 配置"。
 *   - 主题/界面语言/导入偏好/AI 看图 都是即时存(toggle/pill onChange 即写)。
 *   - 图片下载:永久开启(无 UI 开关,后端 flag 默认 true)。
 *   - 每日目标:已移除(改由顶栏"今日能量"展示 todayXp,无配置项)。
 *
 * 密钥边界:key 输入框 password 类型;保存只走 setSetting,渲染层永不留全量 key。
 */
import { useEffect, useState, useCallback } from "react";
import { Plus, RotateCw, CheckCircle2, XCircle, Wrench, Check } from "lucide-react";
import { api } from "../lib/api.js";
import type { ProviderPresetInfo, CustomProvider } from "@shared/types";
import { ConfirmCard } from "./ConfirmCard.js";
import { useTheme, type ThemeMode } from "../lib/useTheme.js";
import { useLang, setLang, getLang } from "../lib/i18n.js";

/** 表单控件统一样式:token 化背景/边框/聚焦,placeholder 用 ink-faint 保 ≥4.5:1 对比。 */
const fieldCls =
  "bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint";

/** pill 按钮(语言/主题/provider 共用)。 */
const pillInactiveCls =
  "bg-surface-3 text-ink-muted hover:bg-surface-3 hover:bg-surface-3 hover:text-ink-strong";
const pillActiveCls = "bg-brand text-white shadow-sm";

/** 卡内行:第一行无线,后续行顶发丝线分隔。 */
function rowCls(divider: boolean): string {
  return divider
    ? "px-4 py-3.5 border-t border-[var(--border-faint)]"
    : "px-4 py-3.5";
}

export function SettingsView() {
  const t = useLang();
  const [presets, setPresets] = useState<ProviderPresetInfo[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("glm");
  const [activeModel, setActiveModel] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keyMasked, setKeyMasked] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string; errorKind?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // 自定义 provider 表单态
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customProtocol, setCustomProtocol] = useState<"openai-compatible" | "anthropic" | "google">("openai-compatible");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customTesting, setCustomTesting] = useState(false);
  const [customTestResult, setCustomTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<{ id: string; label: string; contextWindow: number | null }[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; rect: DOMRect } | null>(null);
  const theme = useTheme();

  const handleDiscoverModels = async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const r = await api.discoverModels();
      if (r.ok && r.models) {
        setDiscoveredModels(r.models);
      } else {
        setDiscoverError(r.error || t("settings.discover_failed"));
      }
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [ps, cps, provider, model] = await Promise.all([
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_provider"),
        api.getSetting("active_model"),
      ]);
      setPresets(ps);
      setCustomProviders(cps);
      const p = provider ?? "glm";
      setActiveProvider(p);
      if (!p.startsWith("custom-")) {
        const preset = ps.find((x) => x.id === p);
        if (preset) {
          const existingKey = await api.getSetting(preset.apiKeySetting as Parameters<typeof api.getSetting>[0]);
          setKeyMasked(existingKey ? `${existingKey.slice(0, 4)}…${existingKey.slice(-4)}` : null);
        }
      } else {
        const cp = cps.find((c) => c.id === p);
        setKeyMasked(cp?.hasApiKey ? t("settings.key.configured") : null);
      }
      if (p.startsWith("custom-")) {
        const cp = cps.find((c) => c.id === p);
        setActiveModel(model ?? cp?.defaultModel ?? "");
      } else {
        const preset = ps.find((x) => x.id === p);
        setActiveModel(model ?? preset?.defaultModel ?? "");
      }
    } catch (e) {
      console.error("[SettingsView] load() failed:", e);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleProviderChange = async (newProvider: string) => {
    setActiveProvider(newProvider);
    setTestResult(null);
    setKeyInput("");
    const preset = presets.find((p) => p.id === newProvider);
    if (preset) {
      const existingKey = await api.getSetting(preset.apiKeySetting as Parameters<typeof api.getSetting>[0]);
      setKeyMasked(existingKey ? `${existingKey.slice(0, 4)}…${existingKey.slice(-4)}` : null);
      setActiveModel(activeModel || preset.defaultModel);
    }
  };

  const handleSave = async () => {
    setSaved(false);
    try {
      await api.setSetting("active_provider", activeProvider);
      await api.setSetting("active_model", activeModel);
      if (keyInput.trim()) {
        const preset = presets.find((p) => p.id === activeProvider);
        if (preset) {
          await api.setSetting(preset.apiKeySetting as Parameters<typeof api.setSetting>[0], keyInput.trim());
          setKeyMasked(`${keyInput.trim().slice(0, 4)}…${keyInput.trim().slice(-4)}`);
          setKeyInput("");
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testLlmConnection();
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e), errorKind: "unknown" });
    } finally {
      setTesting(false);
    }
  };

  const handleTestCustom = async () => {
    if (!customBaseUrl.trim() || !customModel.trim() || customTesting) return;
    setCustomTesting(true);
    setCustomTestResult(null);
    try {
      const r = await api.testCustomProvider({
        label: customLabel || t("settings.custom.test_label"),
        protocol: customProtocol,
        baseUrl: customBaseUrl.trim(),
        apiKey: customApiKey.trim() || undefined,
        defaultModel: customModel.trim(),
      });
      setCustomTestResult({ ok: r.ok, detail: r.detail });
    } catch (e) {
      setCustomTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setCustomTesting(false);
    }
  };

  const handleSaveCustom = async () => {
    if (!customLabel.trim() || !customBaseUrl.trim() || !customModel.trim()) return;
    try {
      const created = await api.createCustomProvider({
        label: customLabel.trim(),
        protocol: customProtocol,
        baseUrl: customBaseUrl.trim(),
        apiKey: customApiKey.trim() || undefined,
        defaultModel: customModel.trim(),
      });
      await api.setSetting("active_provider", created.id);
      await api.setSetting("active_model", created.defaultModel);
      setActiveProvider(created.id);
      setActiveModel(created.defaultModel);
      setCustomLabel("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomModel("");
      setCustomProtocol("openai-compatible");
      setCustomTestResult(null);
      setShowCustomForm(false);
      await load();
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    }
  };

  const handleDeleteCustom = async (id: string) => {
    try {
      await api.deleteCustomProvider(id);
      if (activeProvider === id) {
        await api.setSetting("active_provider", "glm");
        setActiveProvider("glm");
      }
      await load();
    } catch {
      /* 忽略 */
    }
  };

  const activeCustomProvider = activeProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === activeProvider)
    : null;
  const currentPreset = !activeProvider.startsWith("custom-")
    ? presets.find((p) => p.id === activeProvider)
    : null;

  return (
    <>
      <div className="px-5 pt-5 space-y-6">
        {/* ========== 组 1:AI 模型 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.ai")}</h3>
          <div className="surface-card overflow-hidden">
            {/* 服务商 */}
            <div className={rowCls(false)}>
              <div className="text-label font-medium text-ink-strong mb-2">{t("settings.row.provider")}</div>
              <div className="flex flex-wrap gap-1.5" data-testid="provider-grid">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    data-testid={`provider-card-${p.id}`}
                    aria-pressed={activeProvider === p.id}
                    className={`px-3 py-1.5 rounded-lg text-label font-medium whitespace-nowrap transition-colors ${
                      activeProvider === p.id ? pillActiveCls : pillInactiveCls
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {customProviders.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleProviderChange(c.id)}
                    data-testid={`provider-card-${c.id}`}
                    aria-pressed={activeProvider === c.id}
                    className={`px-3 py-1.5 rounded-lg text-label font-medium whitespace-nowrap transition-colors inline-flex items-center gap-1 ${
                      activeProvider === c.id ? pillActiveCls : pillInactiveCls
                    }`}
                  >
                    <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                    {c.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustomForm((s) => !s)}
                  data-testid="add-custom-provider"
                  className="px-3 py-1.5 rounded-lg text-label whitespace-nowrap inline-flex items-center gap-1 border border-dashed border-[var(--border)] text-ink-muted hover:border-ink-muted hover:text-ink-strong transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {t("settings.add_custom")}
                </button>
              </div>
            </div>

            {/* 自定义 provider 表单(扁平,无嵌套卡;bg-surface-1 + 顶发丝线区隔) */}
            {showCustomForm && (
              <div className="px-4 py-3.5 bg-surface-1 border-t border-[var(--border-faint)] space-y-2.5" data-testid="custom-provider-form">
                <div className="text-label font-bold text-ink-strong">{t("settings.custom.form_title")}</div>
                <div className="flex gap-2">
                  <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder={t("settings.custom.label_ph")} data-testid="custom-label" className={`${fieldCls} flex-1 px-2.5 py-1.5`} />
                  <select value={customProtocol} onChange={(e) => setCustomProtocol(e.target.value as "openai-compatible" | "anthropic" | "google")} data-testid="custom-protocol" className={`${fieldCls} px-2 py-1.5`}>
                    <option value="openai-compatible">{t("settings.proto.openai")}</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </div>
                <input type="text" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder={t("settings.custom.baseurl_ph")} data-testid="custom-baseurl" className={`${fieldCls} w-full px-2.5 py-1.5 font-mono`} />
                <div className="flex gap-2">
                  <input type="text" value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={t("settings.custom.model_ph")} data-testid="custom-model" className={`${fieldCls} flex-1 px-2.5 py-1.5 font-mono`} />
                  <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder={t("settings.custom.apikey_ph")} data-testid="custom-apikey" className={`${fieldCls} flex-1 px-2.5 py-1.5`} />
                </div>
                {customTestResult && (
                  <div className={`text-label rounded p-2 inline-flex items-start gap-1.5 ${customTestResult.ok ? "bg-brand/10 text-brand" : "bg-warning/10 text-warning"}`}>
                    {customTestResult.ok ? <CheckCircle2 className="w-4 h-4 mt-px shrink-0" aria-hidden="true" /> : <XCircle className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />}
                    <span className="break-words">{customTestResult.detail}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={handleTestCustom} disabled={!customBaseUrl.trim() || !customModel.trim() || customTesting} data-testid="custom-test" className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40">{customTesting ? t("settings.testing") : t("settings.test")}</button>
                  <button onClick={handleSaveCustom} disabled={!customLabel.trim() || !customBaseUrl.trim() || !customModel.trim()} data-testid="custom-save" className="btn-3d-brand px-3 py-1.5 text-label disabled:opacity-40">{t("settings.custom.save")}</button>
                  <button onClick={() => setShowCustomForm(false)} className="text-label text-ink-muted hover:text-ink-strong px-3 py-1.5 transition-colors">{t("action.cancel")}</button>
                </div>
              </div>
            )}

            {/* 删除自定义 provider */}
            {customProviders.length > 0 && activeProvider.startsWith("custom-") && (
              <div className={rowCls(true)}>
                <button
                  onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const c = customProviders.find((x) => x.id === activeProvider); if (c) setConfirmDelete({ id: c.id, label: c.label, rect }); }}
                  className="text-label text-warning hover:underline"
                >{t("settings.delete_custom")}</button>
              </div>
            )}

            {/* 预设 provider 配置行 */}
            {currentPreset && (
              <>
                {currentPreset.baseUrl && (
                  <div className={rowCls(true)}>
                    <div className="text-label font-medium text-ink-strong mb-1.5">Base URL</div>
                    <code className="text-label text-ink-faint font-mono break-all">{currentPreset.baseUrl}</code>
                  </div>
                )}
                <div className={rowCls(true)}>
                  <div className="flex items-center gap-2">
                    <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.model")}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <select
                        value={activeModel}
                        onChange={(e) => setActiveModel(e.target.value)}
                        data-testid="model-select"
                        className={`${fieldCls} flex-1 px-2.5 py-1.5`}
                      >
                        {currentPreset.models.map((m) => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                        {activeProvider === "openrouter" && discoveredModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                      </select>
                      {activeProvider === "openrouter" && (
                        <button onClick={handleDiscoverModels} disabled={discovering} data-testid="discover-models-btn" className="text-label text-accent hover:underline disabled:opacity-40 whitespace-nowrap inline-flex items-center gap-1">
                          <RotateCw className={`w-3.5 h-3.5 ${discovering ? "animate-spin" : ""}`} aria-hidden="true" />
                          {discovering ? t("settings.discovering") : t("settings.refresh")}
                        </button>
                      )}
                    </div>
                  </div>
                  {discoverError && <div className="text-label text-warning mt-1.5 ml-[68px]">{discoverError}</div>}
                </div>
                <div className={rowCls(true)}>
                  <div className="flex items-center gap-2">
                    <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.apikey")}</span>
                    <div className="flex-1 flex items-center gap-2">
                      {keyMasked && (
                        <span className="text-label text-brand shrink-0 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          {keyMasked}
                        </span>
                      )}
                      <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={keyMasked ? t("settings.key.overwrite_ph") : t("settings.key.paste_ph")}
                        data-testid="settings-key-input"
                        className={`${fieldCls} flex-1 px-2.5 py-1.5`}
                      />
                      <a href={currentPreset.keyUrl} target="_blank" rel="noopener noreferrer" className="text-label text-brand hover:underline whitespace-nowrap">{t("settings.key.get")}</a>
                    </div>
                  </div>
                </div>
                <div className={rowCls(true)}>
                  <div className="flex items-center gap-3">
                    <button onClick={handleTest} disabled={testing} data-testid="test-connection-btn" className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40">
                      {testing ? t("settings.testing") : t("settings.test")}
                    </button>
                    {testResult && (
                      <span className={`text-label inline-flex items-center gap-1 ${testResult.ok ? "text-brand" : "text-warning"}`}>
                        {testResult.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
                        {testResult.detail}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 自定义 provider 配置行 */}
            {activeCustomProvider && !currentPreset && (
              <>
                <div className={rowCls(true)}>
                  <div className="text-label font-medium text-ink-strong mb-1.5">Base URL</div>
                  <code className="text-label text-ink-faint font-mono break-all">{activeCustomProvider.baseUrl}</code>
                </div>
                <div className={rowCls(true)}>
                  <div className="flex items-center gap-2">
                    <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.model")}</span>
                    {activeCustomProvider.models.length > 1 ? (
                      <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)} data-testid="model-select-custom" className={`${fieldCls} flex-1 px-2.5 py-1.5`}>
                        {activeCustomProvider.models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                      </select>
                    ) : (
                      <input type="text" value={activeModel} onChange={(e) => setActiveModel(e.target.value)} placeholder={t("settings.custom.model_ph")} data-testid="model-input-custom" className={`${fieldCls} flex-1 px-2.5 py-1.5 font-mono`} />
                    )}
                  </div>
                </div>
                <div className={rowCls(true)}>
                  <div className="flex items-center gap-3">
                    <button onClick={handleTest} disabled={testing} data-testid="test-connection-btn" className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40">
                      {testing ? t("settings.testing") : t("settings.test")}
                    </button>
                    {testResult && (
                      <span className={`text-label inline-flex items-center gap-1 ${testResult.ok ? "text-brand" : "text-warning"}`}>
                        {testResult.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
                        {testResult.detail}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ========== 组 2:AI 看图 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.vision")}</h3>
          <div className="surface-card overflow-hidden">
            <MultimodalContent
              activeProvider={activeProvider}
              activeModel={activeModel}
              presets={presets}
              customProviders={customProviders}
            />
          </div>
        </section>

        {/* ========== 组 2.5:学习者记忆 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.memory")}</h3>
          <div className="surface-card overflow-hidden">
            <MemoryContent />
          </div>
        </section>

        {/* ========== 组 3:外观与语言 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.appearance")}</h3>
          <div className="surface-card overflow-hidden">
            {/* 主题 */}
            <div className={rowCls(false)}>
              <div className="text-label font-medium text-ink-strong mb-2">{t("settings.row.theme")}</div>
              <div className="flex gap-2">
                {([
                  { mode: "auto" as ThemeMode, label: t("settings.theme.auto") },
                  { mode: "light" as ThemeMode, label: t("settings.theme.light") },
                  { mode: "dark" as ThemeMode, label: t("settings.theme.dark") },
                ]).map(({ mode: m, label }) => (
                  <button
                    key={m}
                    onClick={() => theme.setMode(m)}
                    data-testid={`theme-${m}`}
                    aria-pressed={theme.mode === m}
                    className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${theme.mode === m ? pillActiveCls : pillInactiveCls}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-label text-ink-muted mt-2">
                {theme.mode === "auto" ? t("settings.theme.following", { mode: t(`settings.theme.${theme.resolved}`) }) : null}
              </p>
            </div>
            {/* 界面语言 */}
            <div className={rowCls(true)}>
              <div className="text-label font-medium text-ink-strong mb-2">{t("settings.row.interface_lang")}</div>
              <div className="flex gap-2">
                {(["zh-CN", "en"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    data-testid={`lang-${l}`}
                    aria-pressed={getLang() === l}
                    className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${getLang() === l ? pillActiveCls : pillInactiveCls}`}
                  >
                    {l === "zh-CN" ? "中文" : "English"}
                  </button>
                ))}
              </div>
            </div>
            {/* 导入偏好 */}
            <div className={rowCls(true)}>
              <div className="text-label font-medium text-ink-strong mb-2">{t("settings.row.import_lang")}</div>
              <ImportPrefButtons />
            </div>
          </div>
        </section>
      </div>

      {/* ========== 粘性页脚 ========== */}
      <div className="sticky bottom-0 px-5 py-3 bg-surface-0 border-t border-[var(--border)] flex items-center justify-between gap-3">
        <span className="text-label text-ink-muted">{t("settings.footer.hint")}</span>
        <button
          onClick={handleSave}
          data-testid="settings-save"
          className="btn-3d-brand px-5 py-2 text-body inline-flex items-center gap-1.5"
        >
          {saved && <Check className="w-4 h-4" aria-hidden="true" />}
          {saved ? t("settings.saved_text") : t("settings.footer.save")}
        </button>
      </div>

      {/* 删除自定义 provider 内联确认 */}
      {confirmDelete && (
        <ConfirmCard
          anchorRect={confirmDelete.rect}
          message={t("settings.delete_custom_confirm", { name: confirmDelete.label })}
          danger
          confirmLabel={t("action.delete")}
          testid="custom-provider-delete-confirm"
          onConfirm={() => { handleDeleteCustom(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

/**
 * 导入语言偏好按钮(只渲染按钮行;卡片/标题由父组提供)。
 * 首次启动按系统语言写入默认值(在 main/index.ts ensurePrefLang)。
 */
function ImportPrefButtons() {
  const [prefLang, setPrefLang] = useState<string>("en");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getSetting("pref_lang").then((v) => {
      if (v) setPrefLang(v);
      setLoaded(true);
    });
  }, []);

  const handleChange = async (lang: string) => {
    setPrefLang(lang);
    await api.setSetting("pref_lang", lang);
  };

  const options = [
    { code: "en", label: "English" },
    { code: "zh-CN", label: "简体中文" },
    { code: "zh-TW", label: "繁體中文" },
  ];

  if (!loaded) return null;

  return (
    <div className="flex gap-2" data-testid="pref-lang-options">
      {options.map((o) => (
        <button
          key={o.code}
          onClick={() => handleChange(o.code)}
          data-testid={`pref-lang-${o.code}`}
          aria-pressed={prefLang === o.code}
          className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${prefLang === o.code ? pillActiveCls : pillInactiveCls}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * AI 看图内容(只渲染开关行 + vision 覆盖;卡片/标题由父组提供)。
 * 图片下载已改为永久开启(无开关);此处只管 vision。
 */
function MultimodalContent({
  activeProvider,
  activeModel,
  presets,
  customProviders,
}: {
  activeProvider: string;
  activeModel: string;
  presets: ProviderPresetInfo[];
  customProviders: CustomProvider[];
}) {
  const t = useLang();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [overrideProvider, setOverrideProvider] = useState<string>("");
  const [overrideModel, setOverrideModel] = useState<string>("");

  useEffect(() => {
    Promise.all([
      api.getSetting("flag_multimodal_import"),
      api.getSetting("vision_provider_override"),
      api.getSetting("vision_model_override"),
    ]).then(([flag, prov, model]) => {
      setEnabled(flag === "true");
      setOverrideProvider(prov ?? "");
      setOverrideModel(model ?? "");
      setLoaded(true);
    });
  }, []);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await api.setSetting("flag_multimodal_import", String(next));
  };

  const handleSaveOverride = async () => {
    await api.setSetting("vision_provider_override", overrideProvider);
    await api.setSetting("vision_model_override", overrideModel);
  };

  const overridePreset = overrideProvider && !overrideProvider.startsWith("custom-")
    ? presets.find((p) => p.id === overrideProvider)
    : null;
  const overrideCustom = overrideProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === overrideProvider)
    : null;

  if (!loaded) return null;

  return (
    <>
      <div className="px-4 py-3.5 flex items-center gap-3">
        <Toggle checked={enabled} onChange={handleToggle} label={t("settings.multimodal.toggle")} testid="multimodal-toggle" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-medium text-ink-strong">{t("settings.multimodal.toggle")}</div>
          <div className="text-label text-ink-muted">{t("settings.multimodal.toggle.desc")}</div>
        </div>
      </div>
      {/* v0.11:视觉覆盖常显(不再被 flag_multimodal_import 门控)——它同时驱动聊天图像转译桥:
          主模型纯文本时,上传的图片由该模型转译成文字再交给主模型。 */}
      <div className="px-4 py-3.5 border-t border-[var(--border-faint)] space-y-3">
          {/* 当前主模型 vision 能力提示 */}
          <div className="text-label text-ink-muted bg-ink/5 rounded-lg p-3">
            <div className="font-medium mb-1">{t("settings.multimodal.current_model", { model: activeModel || t("settings.multimodal.not_selected") })}</div>
            <div>
              {activeProvider.startsWith("custom-")
                ? t("settings.multimodal.hint_custom")
                : t("settings.multimodal.hint_preset")}
            </div>
          </div>
          {/* Vision 模型覆盖 */}
          <div className="bg-ink/5 rounded-lg p-3">
            <div className="text-label font-medium text-ink-muted mb-2">
              {t("settings.multimodal.override_title")}
            </div>
            <div className="text-caption text-ink-muted mb-2">
              {t("settings.multimodal.override_bridge_hint")}
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={overrideProvider}
                onChange={(e) => {
                  setOverrideProvider(e.target.value);
                  const pid = e.target.value;
                  if (pid.startsWith("custom-")) {
                    const cp = customProviders.find((c) => c.id === pid);
                    setOverrideModel(cp?.defaultModel ?? "");
                  } else {
                    const p = presets.find((pr) => pr.id === pid);
                    setOverrideModel(p?.defaultModel ?? "");
                  }
                }}
                className={`${fieldCls} w-full px-3 py-2`}
              >
                <option value="">{t("settings.multimodal.no_override")}</option>
                <optgroup label={t("settings.multimodal.group_preset")}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                {customProviders.length > 0 && (
                  <optgroup label={t("settings.multimodal.group_custom")}>
                    {customProviders.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {overrideProvider && (
                <>
                  {(overridePreset?.models.length ?? 0) > 0 ? (
                    <select
                      value={overrideModel}
                      onChange={(e) => setOverrideModel(e.target.value)}
                      className={`${fieldCls} w-full px-3 py-2`}
                    >
                      {overridePreset!.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}{(m.capabilities ?? []).includes("vision") ? ` · ${t("settings.multimodal.vision_capable")}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={overrideModel}
                      onChange={(e) => setOverrideModel(e.target.value)}
                      placeholder={overrideCustom?.defaultModel ?? t("settings.custom.model_ph")}
                      className={`${fieldCls} w-full px-3 py-2`}
                    />
                  )}
                  <button
                    onClick={handleSaveOverride}
                    data-testid="vision-override-save"
                    className="btn-3d-brand px-4 py-1.5 text-label self-start"
                  >
                    {t("settings.multimodal.save_override")}
                  </button>
                </>
              )}
            </div>
          </div>
      </div>
    </>
  );
}

/** 记忆开关:读写 flag_memory_system。开 → agent 记住学习者(remember tool + 里程碑自动固化)。 */
function MemoryContent() {
  const t = useLang();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getSetting("flag_memory_system").then((flag) => {
      setEnabled(flag === "true");
      setLoaded(true);
    });
  }, []);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await api.setSetting("flag_memory_system", String(next));
  };

  if (!loaded) return null;

  return (
    <div className="px-4 py-3.5 flex items-center gap-3">
      <Toggle checked={enabled} onChange={handleToggle} label={t("settings.memory.toggle")} testid="memory-toggle" />
      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-ink-strong">{t("settings.memory.toggle")}</div>
        <div className="text-label text-ink-muted">{t("settings.memory.toggle.desc")}</div>
      </div>
    </div>
  );
}

/**
 * Toggle —— 项目内唯一的开关控件(canonical form-control vocabulary)。
 * ON = bg-brand(绿);OFF = bg-ink/20(主题感知半透明灰)。role=switch + aria。
 */
function Toggle({
  checked,
  onChange,
  label,
  testid,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      data-testid={testid}
      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] ${
        checked ? "bg-brand" : "bg-ink/20 hover:bg-ink/25"
      }`}
    >
      <span
        className={`absolute left-0.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : ""}`}
      />
    </button>
  );
}
