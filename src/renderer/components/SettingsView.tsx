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
  // 当前模型上下文窗口编辑(自定义 provider):从 models 列表条目同步,保存时写回
  const [customWindow, setCustomWindow] = useState("");
  const [customWindowSaving, setCustomWindowSaving] = useState(false);
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

  // 活跃 provider/模型变化 → 窗口输入框跟随该模型条目的现值(空 = 未知)
  useEffect(() => {
    if (!activeCustomProvider) return;
    const entry = activeCustomProvider.models.find((m) => m.id === activeModel);
    setCustomWindow(entry?.contextWindow ? String(entry.contextWindow) : "");
  }, [activeCustomProvider, activeModel]);

  const handleSaveCustomWindow = async () => {
    if (!activeCustomProvider) return;
    const raw = customWindow.trim().replace(/[,\s_]/g, "");
    // 支持 128k / 1m 风格
    const m = /^(\d+)([km]?)$/i.exec(raw);
    if (raw !== "" && !m) return; // 非法输入不保存
    const mult = m?.[2]?.toLowerCase() === "k" ? 1000 : m?.[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
    const parsed = raw === "" || !m ? null : Math.max(1, Math.round(parseInt(m[1]!, 10) * mult));
    setCustomWindowSaving(true);
    try {
      const models = activeCustomProvider.models.map((en) =>
        en.id === activeModel ? { ...en, contextWindow: parsed } : en,
      );
      await api.updateCustomProvider(activeCustomProvider.id, { models });
      await load();
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 保存失败静默(下次打开仍显示旧值) */
    } finally {
      setCustomWindowSaving(false);
    }
  };

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
                  <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.custom.windowLabel")}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={customWindow}
                      onChange={(e) => setCustomWindow(e.target.value)}
                      placeholder={t("settings.custom.windowPh")}
                      data-testid="context-window-input"
                      className={`${fieldCls} flex-1 px-2.5 py-1.5 font-mono tabular-nums`}
                    />
                    <button onClick={handleSaveCustomWindow} disabled={customWindowSaving} data-testid="context-window-save" className="btn-3d-neutral px-3 py-1.5 text-label shrink-0 disabled:opacity-40">
                      {t("settings.custom.save")}
                    </button>
                  </div>
                  <div className="text-caption text-ink-faint mt-1">{t("settings.custom.windowHint")}</div>
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

        {/* ========== 组 2.7:语音能力(v0.12) ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.speech.title")}</h3>
          <div className="surface-card overflow-hidden">
            <SpeechContent />
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

  /** 测识图覆盖:先保存当前选择再测(测的就是生效链路:覆盖优先,缺省回落主模型) */
  const [visionTesting, setVisionTesting] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const handleTestOverride = async () => {
    if (visionTesting) return;
    await handleSaveOverride();
    setVisionTesting(true);
    setVisionTestResult(null);
    try {
      const res = await api.testLlmConnection({ vision: true });
      setVisionTestResult({ ok: res.ok, detail: res.detail });
    } catch (e) {
      setVisionTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setVisionTesting(false);
    }
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
                  <div className="flex flex-wrap items-center gap-2 self-start">
                    <button
                      onClick={handleSaveOverride}
                      data-testid="vision-override-save"
                      className="btn-3d-brand px-4 py-1.5 text-label"
                    >
                      {t("settings.multimodal.save_override")}
                    </button>
                    <button
                      onClick={() => void handleTestOverride()}
                      disabled={visionTesting}
                      data-testid="vision-override-test"
                      className="btn-3d-neutral px-4 py-1.5 text-label disabled:opacity-50"
                    >
                      {visionTesting ? t("settings.testing") : t("settings.multimodal.test_override")}
                    </button>
                    {visionTestResult && (
                      <span className={`text-label inline-flex items-center gap-1 ${visionTestResult.ok ? "text-brand" : "text-warning"}`}>
                        {visionTestResult.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
                        {visionTestResult.detail}
                      </span>
                    )}
                  </div>
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


/* ---------- v0.12 语音能力:模型下载/删除/状态;v0.13 三档 TTS 引擎 ---------- */

interface SpeechModelRow {
  id: string;
  state: string;
  progress: number;
  totalBytes: number;
}

/** Edge/Azure 共用音色表(ShortName 同格式);local 用 kokoro sid */
const TTS_VOICE_OPTIONS = [
  { id: "zh-CN-XiaoxiaoNeural", label: "zh-CN · 晓晓(女)" },
  { id: "zh-CN-XiaoyiNeural", label: "zh-CN · 晓伊(女)" },
  { id: "zh-CN-YunxiNeural", label: "zh-CN · 云希(男)" },
  { id: "zh-CN-YunyangNeural", label: "zh-CN · 云扬(男·新闻)" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "zh-CN · 晓北(女·东北)" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "zh-CN · 晓妮(女·陕西)" },
  { id: "en-US-AriaNeural", label: "en-US · Aria(女)" },
  { id: "en-US-GuyNeural", label: "en-US · Guy(男)" },
  { id: "en-US-JennyNeural", label: "en-US · Jenny(女)" },
];

const TTS_LOCAL_SID_OPTIONS = [
  { sid: "45", label: "zf_xiaobei(女)" },
  { sid: "46", label: "zf_xiaoni(女)" },
  { sid: "47", label: "zf_xiaoxiao(女)" },
  { sid: "48", label: "zf_xiaoyi(女·默认)" },
  { sid: "49", label: "zm_yunjian(男)" },
  { sid: "50", label: "zm_yunxi(男)" },
  { sid: "51", label: "zm_yunxia(男)" },
  { sid: "52", label: "zm_yunyang(男)" },
];

function SpeechContent() {
  const t = useLang();
  const [rows, setRows] = useState<SpeechModelRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prog, setProg] = useState<{ id: string; pct: number; label: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // v0.13 三档 TTS 设置
  const [engine, setEngine] = useState<"edge" | "azure" | "local">("edge");
  const [voiceEdge, setVoiceEdge] = useState("zh-CN-XiaoxiaoNeural");
  const [voiceAzure, setVoiceAzure] = useState("zh-CN-XiaoxiaoNeural");
  const [sidLocal, setSidLocal] = useState("48");
  const [speed, setSpeed] = useState("1.0");
  const [azureKey, setAzureKey] = useState("");
  const [azureRegion, setAzureRegion] = useState("");
  const [keyMasked, setKeyMasked] = useState(false);

  // v0.13 听写三档 + UX 开关
  const [asrEngine, setAsrEngine] = useState<"local" | "groq" | "azure">("local");
  const [sttKey, setSttKey] = useState("");
  const [sttRegion, setSttRegion] = useState("");
  const [sttKeyMasked, setSttKeyMasked] = useState(false);
  const [groqReady, setGroqReady] = useState(false);
  const [asrAutoStop, setAsrAutoStop] = useState(true);

  useEffect(() => {
    void Promise.all([
      api.getSetting("tts_engine"),
      api.getSetting("tts_voice_edge"),
      api.getSetting("azure_tts_voice"),
      api.getSetting("tts_sid_local"),
      api.getSetting("tts_speed"),
      api.getSetting("azure_tts_region"),
      api.getSetting("azure_tts_api_key"),
      api.getSetting("asr_engine"),
      api.getSetting("azure_stt_region"),
      api.getSetting("azure_stt_api_key"),
      api.getSetting("groq_api_key"),
      api.getSetting("asr_auto_stop"),
    ]).then(([e, ve, va, sid, sp, region, key, ae, sttRegionRaw, sttKeyRaw, groqKeyRaw, autoStopRaw]) => {
      if (e === "azure" || e === "local") setEngine(e);
      if (ve) setVoiceEdge(ve);
      if (va) setVoiceAzure(va);
      if (sid) setSidLocal(sid);
      if (sp) setSpeed(sp);
      if (region) setAzureRegion(region);
      if (key) {
        setKeyMasked(true);
        setAzureKey("");
      }
      if (ae === "groq" || ae === "azure") setAsrEngine(ae);
      if (sttRegionRaw) setSttRegion(sttRegionRaw);
      if (sttKeyRaw) {
        setSttKeyMasked(true);
        setSttKey("");
      }
      setGroqReady(!!groqKeyRaw);
      setAsrAutoStop(autoStopRaw !== "0");
    });
  }, []);

  const saveEngine = (next: "edge" | "azure" | "local") => {
    setEngine(next);
    void api.setSetting("tts_engine", next);
  };

  const saveAsrEngine = (next: "local" | "groq" | "azure") => {
    setAsrEngine(next);
    void api.setSetting("asr_engine", next);
  };

  const refresh = useCallback(() => {
    void window.api
      .getSpeechModelStatus()
      .then((st) => setRows(st as SpeechModelRow[]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const off = window.api.on("speech:modelProgress", (e: { id: string; progress: number; currentFile?: string }) => {
      setProg({
        id: e.id,
        pct: Math.floor(e.progress * 100),
        label: e.currentFile ? e.currentFile.split("/").pop() ?? "" : "",
      });
    });
    return off;
  }, [refresh]);

  const download = (id: string) => {
    setErr(null);
    setBusy(id);
    setProg({ id, pct: 0, label: "" });
    void window.api
      .ensureSpeechModel(id as never)
      .then(() => {
        setBusy(null);
        setProg(null);
        refresh();
      })
      .catch((e: unknown) => {
        setBusy(null);
        setProg(null);
        setErr(e instanceof Error ? e.message : String(e));
        refresh();
      });
  };

  const remove = (id: string) => {
    setBusy(id);
    setConfirmDelete(null);
    void window.api
      .deleteSpeechModel(id as never)
      .then(refresh)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const labelOf = (id: string) =>
    id === "tts-kokoro"
      ? t("settings.speech.model.tts")
      : id === "asr-whisper-turbo"
        ? t("settings.speech.model.asr_turbo")
        : id === "asr-whisper-small"
          ? t("settings.speech.model.asr_small")
          : t("settings.speech.model.asr");
  const licenseOf = (id: string) =>
    id.startsWith("asr-whisper") ? t("settings.speech.license_mit") : t("settings.speech.license");
  const stateLabel = (state: string) =>
    state === "ready" ? t("settings.speech.state.ready") : state === "error" ? t("settings.speech.state.error") : t("settings.speech.state.absent");

  const voiceValue = engine === "azure" ? voiceAzure : voiceEdge;
  const setVoiceValue = (v: string) => {
    if (engine === "azure") {
      setVoiceAzure(v);
      void api.setSetting("azure_tts_voice", v);
    } else {
      setVoiceEdge(v);
      void api.setSetting("tts_voice_edge", v);
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="settings-speech">
      <p className="text-label text-ink-muted">{t("settings.speech.desc")}</p>

      {/* 引擎三选一 */}
      <div className={rowCls(false)}>
        <div className="text-label font-medium text-ink-strong mb-2">{t("settings.speech.tts_engine")}</div>
        <div className="flex gap-2 flex-wrap">
          {([
            { id: "edge" as const, label: t("settings.speech.engine.edge") },
            { id: "azure" as const, label: t("settings.speech.engine.azure") },
            { id: "local" as const, label: t("settings.speech.engine.local") },
          ]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => saveEngine(id)}
              data-testid={`tts-engine-${id}`}
              aria-pressed={engine === id}
              className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${engine === id ? pillActiveCls : pillInactiveCls}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-label text-ink-muted mt-2">
          {engine === "edge"
            ? t("settings.speech.engine.edge_note")
            : engine === "azure"
              ? t("settings.speech.engine.azure_note")
              : t("settings.speech.engine.local_note")}
        </p>
      </div>

      {/* 音色(azure 复用 Edge 同名 Neural 音色) */}
      {engine !== "local" && (
        <div className={rowCls(false)}>
          <div className="flex items-center gap-2">
            <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.voice")}</span>
            <select
              value={voiceValue}
              onChange={(e) => setVoiceValue(e.target.value)}
              data-testid="tts-voice-select"
              className={`${fieldCls} flex-1 px-2.5 py-1.5`}
            >
              {TTS_VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {engine === "local" && (
        <div className={rowCls(false)}>
          <div className="flex items-center gap-2">
            <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.voice")}</span>
            <select
              value={sidLocal}
              onChange={(e) => {
                setSidLocal(e.target.value);
                void api.setSetting("tts_sid_local", e.target.value);
              }}
              data-testid="tts-sid-select"
              className={`${fieldCls} flex-1 px-2.5 py-1.5`}
            >
              {TTS_LOCAL_SID_OPTIONS.map((v) => (
                <option key={v.sid} value={v.sid}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 语速(三档共用) */}
      <div className={rowCls(false)}>
        <div className="flex items-center gap-2">
          <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.speed")}</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={Number(speed)}
            onChange={(e) => setSpeed(e.target.value)}
            onPointerUp={() => void api.setSetting("tts_speed", speed)}
            onKeyUp={() => void api.setSetting("tts_speed", speed)}
            data-testid="tts-speed-range"
            className="flex-1 accent-brand"
          />
          <span className="text-label text-ink-muted w-10 text-right" data-testid="tts-speed-value">{Number(speed).toFixed(2)}×</span>
        </div>
      </div>

      {/* azure 凭据 */}
      {engine === "azure" && (
        <>
          <div className={rowCls(false)}>
            <div className="flex items-center gap-2">
              <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.azure_key")}</span>
              <div className="flex-1 flex items-center gap-2">
                {keyMasked && azureKey === "" && (
                  <span className="text-label text-brand shrink-0">✓</span>
                )}
                <input
                  type="password"
                  value={azureKey}
                  onChange={(e) => setAzureKey(e.target.value)}
                  onBlur={() => {
                    if (azureKey.trim()) {
                      void api.setSetting("azure_tts_api_key", azureKey.trim());
                      setKeyMasked(true);
                      setAzureKey("");
                    }
                  }}
                  placeholder={keyMasked ? t("settings.key.overwrite_ph") : t("settings.key.paste_ph")}
                  data-testid="azure-tts-key-input"
                  className={`${fieldCls} flex-1 px-2.5 py-1.5`}
                />
              </div>
            </div>
          </div>
          <div className={rowCls(true)}>
            <div className="flex items-center gap-2">
              <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.azure_region")}</span>
              <input
                type="text"
                value={azureRegion}
                onChange={(e) => setAzureRegion(e.target.value)}
                onBlur={() => void api.setSetting("azure_tts_region", azureRegion.trim())}
                placeholder="eastus"
                data-testid="azure-tts-region-input"
                className={`${fieldCls} flex-1 px-2.5 py-1.5`}
              />
            </div>
          </div>
        </>
      )}

      {/* 听写引擎三选一(v0.13:质量优先,local=Whisper 离线) */}
      <div className={rowCls(false)}>
        <div className="text-label font-medium text-ink-strong mb-2">{t("settings.speech.asr_engine")}</div>
        <div className="flex gap-2 flex-wrap">
          {([
            { id: "local" as const, label: t("settings.speech.asr_engine.local") },
            { id: "groq" as const, label: t("settings.speech.asr_engine.groq") },
            { id: "azure" as const, label: t("settings.speech.asr_engine.azure") },
          ]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => saveAsrEngine(id)}
              data-testid={`asr-engine-${id}`}
              aria-pressed={asrEngine === id}
              className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${asrEngine === id ? pillActiveCls : pillInactiveCls}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-label text-ink-muted mt-2">
          {asrEngine === "local"
            ? t("settings.speech.asr_engine.local_note")
            : asrEngine === "groq"
              ? groqReady
                ? t("settings.speech.asr_engine.groq_ready")
                : t("settings.speech.asr_engine.groq_note")
              : t("settings.speech.asr_engine.azure_note")}
        </p>
      </div>

      {/* azure STT 凭据 */}
      {asrEngine === "azure" && (
        <>
          <div className={rowCls(false)}>
            <div className="flex items-center gap-2">
              <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.azure_key")}</span>
              <div className="flex-1 flex items-center gap-2">
                {sttKeyMasked && sttKey === "" && <span className="text-label text-brand shrink-0">✓</span>}
                <input
                  type="password"
                  value={sttKey}
                  onChange={(e) => setSttKey(e.target.value)}
                  onBlur={() => {
                    if (sttKey.trim()) {
                      void api.setSetting("azure_stt_api_key", sttKey.trim());
                      setSttKeyMasked(true);
                      setSttKey("");
                    }
                  }}
                  placeholder={sttKeyMasked ? t("settings.key.overwrite_ph") : t("settings.key.paste_ph")}
                  data-testid="azure-stt-key-input"
                  className={`${fieldCls} flex-1 px-2.5 py-1.5`}
                />
              </div>
            </div>
          </div>
          <div className={rowCls(false)}>
            <div className="flex items-center gap-2">
              <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.azure_region")}</span>
              <input
                type="text"
                value={sttRegion}
                onChange={(e) => setSttRegion(e.target.value)}
                onBlur={() => void api.setSetting("azure_stt_region", sttRegion.trim())}
                placeholder="eastus"
                data-testid="azure-stt-region-input"
                className={`${fieldCls} flex-1 px-2.5 py-1.5`}
              />
            </div>
          </div>
        </>
      )}

      {/* 听写 UX 开关(v0.14 飞书式:语音文本先进复查浮层再发送,auto-send 已废) */}
      <div className={rowCls(false)}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-label font-medium text-ink-strong">{t("settings.speech.asr_auto_stop")}</div>
          <button
            onClick={() => {
              const next = !asrAutoStop;
              setAsrAutoStop(next);
              void api.setSetting("asr_auto_stop", next ? "1" : "0");
            }}
            role="switch"
            aria-checked={asrAutoStop}
            data-testid="asr-auto-stop-toggle"
            className={`relative w-10 h-6 rounded-full transition-colors ${asrAutoStop ? "bg-brand" : "bg-ink/[0.15]"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${asrAutoStop ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </div>
        <p className="text-label text-ink-muted mt-2">{t("settings.speech.asr_ux_note")}</p>
      </div>

      {/* 模型管理:local TTS 档才需要 kokoro;ASR 模型常驻列表 */}
      {err && (
        <div className="text-label text-warning break-all" role="alert">
          {err === "engine-unavailable" ? t("chat.speech.engine_unavailable") : err}
        </div>
      )}
      {rows
        .filter((m) => m.id !== "tts-kokoro" || engine === "local")
        .map((m) => (
        <div key={m.id} className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-label font-medium text-ink-strong truncate">{labelOf(m.id)}</div>
            <div className="text-caption text-ink-muted">
              {stateLabel(m.state)} · {licenseOf(m.id)}
            </div>
            {busy === m.id && prog?.id === m.id && (
              <div className="mt-1.5 h-1.5 rounded-full bg-ink/[0.08] overflow-hidden" data-testid={`speech-dl-bar-${m.id}`}>
                <div className="h-full bg-brand transition-all" style={{ width: `${prog.pct}%` }} />
              </div>
            )}
            {busy === m.id && prog?.id === m.id && (
              <div className="text-caption text-ink-muted mt-0.5" data-testid={`speech-dl-pct-${m.id}`}>
                {prog.pct}% {prog.label}
              </div>
            )}
          </div>
          {m.state === "ready" ? (
            confirmDelete === m.id ? (
              <div className="flex gap-1.5">
                <button
                  onClick={() => remove(m.id)}
                  className="px-3 py-1.5 rounded-xl text-label font-bold bg-warning text-white"
                  data-testid={`speech-del-confirm-${m.id}`}
                >
                  {t("action.confirm")}
                </button>
                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-xl text-label font-bold bg-ink/[0.08] text-ink">
                  {t("action.cancel")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(m.id)}
                disabled={busy !== null}
                className="px-3 py-1.5 rounded-xl text-label font-bold bg-ink/[0.08] text-ink hover:bg-ink/[0.12] disabled:opacity-40"
                data-testid={`speech-del-${m.id}`}
              >
                {t("settings.speech.delete")}
              </button>
            )
          ) : (
            <button
              onClick={() => download(m.id)}
              disabled={busy !== null}
              className="btn-3d-brand px-3 py-1.5 text-label"
              data-testid={`speech-dl-${m.id}`}
            >
              {busy === m.id ? `${prog?.pct ?? 0}%` : t("settings.speech.download")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
