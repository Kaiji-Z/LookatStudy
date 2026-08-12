/**
 * 设置页 —— provider / model / API key 管理 + 测试连接 + 每日目标。
 *
 * 这是 BYOK 的"完整管理入口"（ChatPanel 的 ConfigGuide 只在未配 key 时出现）。
 * 功能:
 *   - 选 provider（5 选 1）→ 显示该 provider 的 model 列表 → 选 model
 *   - 输入/更新 API key（当前 provider 的 key field）
 *   - "测试连接"按钮：调 testLlmConnection 发 ping，显示成功/失败 + 错误分类
 *   - 每日目标（daily_goal_xp）设置
 *
 * 密钥边界：key 输入框是 password type；保存只走 setSetting，永不渲染层留全量 key。
 * 已配的 key 只显示"已配置"掩码（sk-…1234），不回显完整值。
 *
 * 设计语汇(v0.8 i18n 全量化 + 设计系统收敛):
 *   - 所有用户可见字符串走 i18n(useLang);无硬编码中文。
 *   - 表单控件统一 fieldCls(token 化 bg-surface-1 + border + focus);不再 bg-white/dark 散落。
 *   - chrome 内无 emoji:状态用 lucide CheckCircle2/XCircle,自定义 provider 用 Wrench,
 *     操作前缀用 Plus/RotateCw/Globe。emoji 仅留给 skill-tree 节点(见 AGENTS 设计系统)。
 *   - pill 按钮(选语言/主题/provider)共用同一组 active/inactive class,跨行一致。
 *   - 开关用 role="switch" + aria-checked + aria-label,屏幕阅读器可读。
 */
import { useEffect, useState, useCallback } from "react";
import { Plus, RotateCw, CheckCircle2, XCircle, Wrench, Globe } from "lucide-react";
import { api } from "../lib/api.js";
import type { ProviderPresetInfo, CustomProvider } from "@shared/types";
import { ConfirmCard } from "./ConfirmCard.js";
import { useTheme, type ThemeMode } from "../lib/useTheme.js";
import { useLang, setLang, getLang } from "../lib/i18n.js";

/** 表单控件统一样式:token 化背景/边框/聚焦,placeholder 用 ink-faint 保 ≥4.5:1 对比。 */
const fieldCls =
  "bg-surface-1 text-ink text-body rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none transition-colors placeholder:text-ink-faint";

/** pill 按钮(语言/主题/provider 共用)。active=brand,inactive=surface 浅层 + ink-muted。 */
const pillInactiveCls =
  "bg-neutral-200 dark:bg-neutral-800 text-ink-muted hover:bg-neutral-300 dark:hover:bg-neutral-700 hover:text-ink-strong";
const pillActiveCls = "bg-brand text-white shadow-sm";

export function SettingsView() {
  const t = useLang();
  const [presets, setPresets] = useState<ProviderPresetInfo[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("glm");
  const [activeModel, setActiveModel] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keyMasked, setKeyMasked] = useState<string | null>(null);
  const [dailyGoal, setDailyGoal] = useState<string>("30");
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
  // 删除自定义 provider 的内联确认(v0.6:替代 native confirm())
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; rect: DOMRect } | null>(null);
  // 主题切换(v0.7 浅色模式)
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

  // 初始化：拉预设 + 自定义 provider + 当前配置
  const load = useCallback(async () => {
    try {
      const [ps, cps, provider, model, goal] = await Promise.all([
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_provider"),
        api.getSetting("active_model"),
        api.getSetting("daily_goal_xp"),
      ]);
      setPresets(ps);
      setCustomProviders(cps);
      const p = provider ?? "glm";
      setActiveProvider(p);
      // 检查当前 provider 的 key 是否已配
      if (!p.startsWith("custom-")) {
        const preset = ps.find((x) => x.id === p);
        if (preset) {
          const existingKey = await api.getSetting(preset.apiKeySetting as Parameters<typeof api.getSetting>[0]);
          setKeyMasked(existingKey ? `${existingKey.slice(0, 4)}…${existingKey.slice(-4)}` : null);
        }
      } else {
        // 自定义 provider：key 状态从 customProviders 查
        const cp = cps.find((c) => c.id === p);
        setKeyMasked(cp?.hasApiKey ? t("settings.key.configured") : null);
      }
      // model：自定义 provider 的默认 model
      if (p.startsWith("custom-")) {
        const cp = cps.find((c) => c.id === p);
        setActiveModel(model ?? cp?.defaultModel ?? "");
      } else {
        const preset = ps.find((x) => x.id === p);
        setActiveModel(model ?? preset?.defaultModel ?? "");
      }
      setDailyGoal(goal ?? "30");
    } catch (e) {
      console.error("[SettingsView] load() failed:", e);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // 切 provider 时：重载该 provider 的 key 掩码 + 默认 model
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

  // 保存 provider + model + key（如果有输入）
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
      await api.setSetting("daily_goal_xp", dailyGoal);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // 广播配置变更：ChatPanel 监听此事件重新检查 agentReady
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

  // === 自定义 provider 处理 ===

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
      // 自动选中新创建的 provider + 写 active_model，这样用户保存后立即生效
      await api.setSetting("active_provider", created.id);
      await api.setSetting("active_model", created.defaultModel);
      setActiveProvider(created.id);
      setActiveModel(created.defaultModel);
      // 清表单 + 重新加载
      setCustomLabel("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomModel("");
      setCustomProtocol("openai-compatible");
      setCustomTestResult(null);
      setShowCustomForm(false);
      await load();
      // 广播配置变更：ChatPanel 立即感知新 provider
      window.dispatchEvent(new Event("llm-config-changed"));
    } catch {
      /* 忽略 */
    }
  };

  const handleDeleteCustom = async (id: string) => {
    try {
      await api.deleteCustomProvider(id);
      // 如果删的是当前激活的，切回 glm
      if (activeProvider === id) {
        await api.setSetting("active_provider", "glm");
        setActiveProvider("glm");
      }
      await load();
    } catch {
      /* 忽略 */
    }
  };

  // 当前激活的是自定义 provider？
  const activeCustomProvider = activeProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === activeProvider)
    : null;
  const currentPreset = !activeProvider.startsWith("custom-")
    ? presets.find((p) => p.id === activeProvider)
    : null;

  return (
    <div className="space-y-6">
      <h2 className="text-title font-extrabold text-ink-strong tracking-tight">{t("settings.title")}</h2>

      {/* Provider + Model + Key + Test 合并为一个折叠区 */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-ink-muted mb-3">{t("settings.heading.provider")}</h3>

        {/* Provider 单行按钮列表 */}
        <div className="flex flex-wrap gap-1.5 mb-1" data-testid="provider-grid">
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

        {/* 自定义 provider 添加表单 */}
        {showCustomForm && (
          <div className="mt-3 p-3 bg-surface-1 rounded-lg border border-[var(--border)] space-y-2.5" data-testid="custom-provider-form">
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

        {/* 已添加的自定义 provider 删除入口 */}
        {customProviders.length > 0 && activeProvider.startsWith("custom-") && (
          <div className="mt-2">
            <button
              onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const c = customProviders.find((x) => x.id === activeProvider); if (c) setConfirmDelete({ id: c.id, label: c.label, rect }); }}
              className="text-label text-warning hover:underline"
            >{t("settings.delete_custom")}</button>
          </div>
        )}

        {/* 选中 provider 的展开配置区 */}
        {currentPreset && (
          <div className="mt-4 pt-4 border-t border-[var(--border-faint)] space-y-3">
            {/* Base URL */}
            {currentPreset.baseUrl && (
              <div className="flex items-center gap-2">
                <span className="text-label text-ink-muted shrink-0">Base URL</span>
                <code className="text-label text-ink-faint font-mono break-all">{currentPreset.baseUrl}</code>
              </div>
            )}

            {/* Model 选择 */}
            <div className="flex items-center gap-2">
              <span className="text-label text-ink-muted shrink-0 w-12">{t("settings.model")}</span>
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
            {discoverError && <div className="text-label text-warning ml-14">{discoverError}</div>}

            {/* API Key */}
            <div className="flex items-center gap-2">
              <span className="text-label text-ink-muted shrink-0 w-12">{t("settings.apikey")}</span>
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

            {/* 测试连接 */}
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
        )}

        {/* 自定义 provider 的展开配置区 */}
        {activeCustomProvider && !currentPreset && (
          <div className="mt-4 pt-4 border-t border-[var(--border-faint)] space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-label text-ink-muted shrink-0">Base URL</span>
              <code className="text-label text-ink-faint font-mono break-all">{activeCustomProvider.baseUrl}</code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-label text-ink-muted shrink-0 w-12">{t("settings.model")}</span>
              {activeCustomProvider.models.length > 1 ? (
                <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)} data-testid="model-select-custom" className={`${fieldCls} flex-1 px-2.5 py-1.5`}>
                  {activeCustomProvider.models.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                </select>
              ) : (
                <input type="text" value={activeModel} onChange={(e) => setActiveModel(e.target.value)} placeholder={t("settings.custom.model_ph")} data-testid="model-input-custom" className={`${fieldCls} flex-1 px-2.5 py-1.5 font-mono`} />
              )}
            </div>
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
        )}
      </section>

      {/* 每日目标 */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-ink-muted mb-3">{t("settings.daily_goal")}</h3>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={dailyGoal}
            onChange={(e) => setDailyGoal(e.target.value)}
            min="1"
            max="500"
            data-testid="daily-goal-input"
            className={`${fieldCls} w-24 px-3 py-2`}
          />
          <span className="text-label text-ink-muted">{t("settings.daily_goal.hint")}</span>
        </div>
      </section>

      {/* 语言选择 —— v0.8:响应式 setLang,无需 reload */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-ink-muted mb-3">{t("settings.heading.language")}</h3>
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
      </section>

      {/* 主题切换(v0.7 浅色模式):三态 auto/light/dark */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-ink-muted mb-3">{t("settings.heading.theme")}</h3>
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
      </section>

      {/* 多模态:图片识别导入 + AI 看图 */}
      <MultimodalSection
        activeProvider={activeProvider}
        activeModel={activeModel}
        presets={presets}
        customProviders={customProviders}
      />

      {/* 语言偏好:导入时自动按此偏好选翻译 */}
      <LanguagePrefSection />

      {/* 保存按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          data-testid="settings-save"
          className="btn-3d-brand px-6 py-2.5 text-body"
        >
          {t("settings.save")}
        </button>
        {saved && (
          <span className="text-body text-brand font-bold inline-flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {t("settings.saved_text")}
          </span>
        )}
      </div>

      {/* 删除自定义 provider 的内联确认(替代 native confirm()) */}
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
    </div>
  );
}

/**
 * 语言偏好设置:导入课程时自动按此偏好选择翻译。
 * 首次启动按系统语言写入默认值(在 main/index.ts ensurePrefLang)。
 * 仓库无对应翻译时用原文(严格 fallback)。
 */
function LanguagePrefSection() {
  const t = useLang();
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
    <section className="surface-card p-4">
      <h3 className="text-body font-semibold text-ink-muted mb-1 inline-flex items-center gap-1.5">
        <Globe className="w-4 h-4" aria-hidden="true" />
        {t("settings.heading.lang_pref")}
      </h3>
      <p className="text-label text-ink-muted mb-3">
        {t("settings.lang_pref.desc")}
      </p>
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
    </section>
  );
}

/**
 * 多模态设置区:图片识别导入开关 + vision 模型覆盖选择器。
 *
 * - 开关写 flag_multimodal_import(默认 off;on 后导入时收集图片 + AI 看图)
 * - 覆盖选择器:可选配一个专门的 vision provider + model(不配则复用主模型)
 *   写 vision_provider_override / vision_model_override 两个 settings key
 */
function MultimodalSection({
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
  const [imgDownload, setImgDownload] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [overrideProvider, setOverrideProvider] = useState<string>("");
  const [overrideModel, setOverrideModel] = useState<string>("");

  useEffect(() => {
    Promise.all([
      api.getSetting("flag_multimodal_import"),
      api.getSetting("flag_image_download"),
      api.getSetting("vision_provider_override"),
      api.getSetting("vision_model_override"),
    ]).then(([flag, imgFlag, prov, model]) => {
      setEnabled(flag === "true");
      setImgDownload(imgFlag !== "false"); // 默认 on,只有显式 "false" 才关
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

  const handleImgToggle = async () => {
    const next = !imgDownload;
    setImgDownload(next);
    await api.setSetting("flag_image_download", String(next));
  };

  const handleSaveOverride = async () => {
    await api.setSetting("vision_provider_override", overrideProvider);
    await api.setSetting("vision_model_override", overrideModel);
  };

  // 选中的覆盖 provider 对应的 model 列表
  const overridePreset = overrideProvider && !overrideProvider.startsWith("custom-")
    ? presets.find((p) => p.id === overrideProvider)
    : null;
  const overrideCustom = overrideProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === overrideProvider)
    : null;

  if (!loaded) return null;

  return (
    <section className="surface-card p-4">
      <h3 className="text-body font-semibold text-ink-muted mb-3">{t("settings.heading.multimodal")}</h3>
      {/* 图片下载开关(默认 on) —— md/ipynb 里的图片引用直接下载,不涉及 AI */}
      <div className="flex items-center gap-3 mb-3">
        <Toggle checked={imgDownload} onChange={handleImgToggle} label={t("settings.img_download")} testid="image-download-toggle" />
        <div className="flex-1">
          <div className="text-body font-medium text-ink-strong">
            {t("settings.img_download")}
          </div>
          <div className="text-label text-ink-muted">
            {t("settings.img_download.desc")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <Toggle checked={enabled} onChange={handleToggle} label={t("settings.multimodal.toggle")} testid="multimodal-toggle" />
        <div className="flex-1">
          <div className="text-body font-medium text-ink-strong">
            {t("settings.multimodal.toggle")}
          </div>
          <div className="text-label text-ink-muted">
            {t("settings.multimodal.toggle.desc")}
          </div>
        </div>
      </div>
      {enabled && (
        <div className="space-y-3">
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
            <div className="flex flex-col gap-2">
              <select
                value={overrideProvider}
                onChange={(e) => {
                  setOverrideProvider(e.target.value);
                  // 自动选默认 model
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
      )}
    </section>
  );
}

/**
 * Toggle —— 项目内唯一的开关控件(canonical form-control vocabulary)。
 *
 * 设计:
 *   - 轨道 48×24,w-12 h-6,圆角 full。
 *   - 滑块 20×20,显式 left-0.5 + top-1/2 -translate-y-1/2 居中(不靠 translate 撑位置)。
 *   - ON = bg-brand(绿);OFF = bg-ink/20(主题感知半透明灰,深浅模式都对卡片有 ≥0.15 L 对比,
 *     不再像 bg-surface-3 那样融进卡片)。
 *   - 键盘焦点:ring-brand/60 + ring-offset,Tab 可见。
 *   - role="switch" + aria-checked + aria-label,屏幕阅读器读得出状态。
 *   - transition-transform 滑块滑动;transition-colors 轨道变色。
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

