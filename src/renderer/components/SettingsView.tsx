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
 */
import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api.js";
import type { ProviderPresetInfo, CustomProvider } from "@shared/types";
import { ConfirmCard } from "./ConfirmCard.js";
import { useTheme, type ThemeMode } from "../lib/useTheme.js";

export function SettingsView() {
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
  const [currentLang] = useState<string>(() => {
    try { return localStorage.getItem("lookatstudy-lang") || "zh-CN"; } catch { return "zh-CN"; }
  });
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
        setDiscoverError(r.error || "刷新失败（可能网络受限）");
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
        setKeyMasked(cp?.hasApiKey ? "已配置" : null);
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
  }, []);

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
        label: customLabel || "(测试)",
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
      <h2 className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100 tracking-tight">设置</h2>

      {/* Provider 选择 */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">AI 服务商（Provider）</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="provider-grid">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              data-testid={`provider-card-${p.id}`}
              className={`text-left p-3 rounded-lg border transition-colors ${
                activeProvider === p.id
                  ? "border-brand bg-brand/10"
                  : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-600"
              }`}
            >
              <div className="text-body font-medium text-neutral-900 dark:text-neutral-100">{p.label}</div>
              {p.note && <div className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mt-0.5">{p.note}</div>}
            </button>
          ))}
          {/* 自定义 provider 卡片 */}
          {customProviders.map((c) => (
            <button
              key={c.id}
              onClick={() => handleProviderChange(c.id)}
              data-testid={`provider-card-${c.id}`}
              className={`text-left p-3 rounded-lg border transition-colors ${
                activeProvider === c.id
                  ? "border-brand bg-brand/10"
                  : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-600"
              }`}
            >
              <div className="text-body font-medium text-neutral-900 dark:text-neutral-100">🔧 {c.label}</div>
              <div className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mt-0.5 truncate">{c.baseUrl}</div>
            </button>
          ))}
          {/* 添加自定义 provider 按钮 */}
          <button
            onClick={() => setShowCustomForm((s) => !s)}
            data-testid="add-custom-provider"
            className="text-left p-3 rounded-lg border border-dashed border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:border-neutral-500 hover:text-neutral-700 dark:text-neutral-300"
          >
            <div className="text-body">＋ 添加自定义 Provider</div>
            <div className="text-label text-neutral-600 mt-0.5">智谱 CodingPlan / Ollama / 自建代理 等</div>
          </button>
        </div>

        {/* 自定义 provider 添加表单 */}
        {showCustomForm && (
          <div className="mt-4 p-4 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-700 space-y-3" data-testid="custom-provider-form">
            <h4 className="text-body font-semibold text-neutral-700 dark:text-neutral-200">添加自定义 Provider</h4>
            <div>
              <label className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 block mb-1">名称（自己起个名字）</label>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="如：智谱 CodingPlan CN"
                data-testid="custom-label"
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 block mb-1">协议</label>
              <select
                value={customProtocol}
                onChange={(e) => setCustomProtocol(e.target.value as "openai-compatible" | "anthropic" | "google")}
                data-testid="custom-protocol"
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
              >
                <option value="openai-compatible">OpenAI 兼容（大多数，含 GLM/DeepSeek/Ollama）</option>
                <option value="anthropic">Anthropic（Claude 原生）</option>
                <option value="google">Google（Gemini 原生）</option>
              </select>
            </div>
            <div>
              <label className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 block mb-1">Base URL（端点地址）</label>
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="如 https://api.z.ai/api/coding/paas/v4"
                data-testid="custom-baseurl"
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none font-mono"
              />
              <p className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mt-1">
                智谱 CodingPlan CN: <code>https://api.z.ai/api/coding/paas/v4</code> ·
                Ollama: <code>http://localhost:11434/v1</code>
              </p>
            </div>
            <div>
              <label className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 block mb-1">默认模型 ID</label>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="如 glm-4.6 / gpt-4o / qwen2.5-coder:7b"
                data-testid="custom-model"
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 block mb-1">API Key（本地模型可留空）</label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="粘贴 API key（Ollama/LM Studio 不需要）"
                data-testid="custom-apikey"
                className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
              />
            </div>
            {/* 测试结果 */}
            {customTestResult && (
              <div className={`text-body rounded p-2 ${customTestResult.ok ? "bg-brand/10 text-brand" : "bg-warning/10 text-warning"}`}>
                {customTestResult.ok ? "✅" : "❌"} {customTestResult.detail}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleTestCustom}
                disabled={!customBaseUrl.trim() || !customModel.trim() || customTesting}
                data-testid="custom-test"
                className="btn-3d-neutral px-3 py-2 text-body disabled:opacity-40"
              >
                {customTesting ? "测试中…" : "测试连接"}
              </button>
              <button
                onClick={handleSaveCustom}
                disabled={!customLabel.trim() || !customBaseUrl.trim() || !customModel.trim()}
                data-testid="custom-save"
                className="btn-3d-brand px-3 py-2 text-body disabled:opacity-40"
              >
                保存
              </button>
              <button
                onClick={() => setShowCustomForm(false)}
                className="text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 px-3 py-2 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 已添加的自定义 provider 列表（带删除） */}
        {customProviders.length > 0 && (
          <div className="mt-3 space-y-1">
            {customProviders.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-label bg-neutral-100 dark:bg-neutral-950/50 px-3 py-1.5 rounded">
                <span className="text-neutral-500 dark:text-neutral-600 dark:text-neutral-400">🔧 {c.label} · {c.protocol}</span>
                <button
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setConfirmDelete({ id: c.id, label: c.label, rect });
                  }}
                  className="text-warning hover:underline font-bold"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Model 选择 / 输入 */}
      {currentPreset ? (
        <section className="surface-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300">模型（Model）</h3>
            {/* 只对 OpenRouter provider 显示"从 OpenRouter 刷新" */}
            {activeProvider === "openrouter" && (
              <button
                onClick={handleDiscoverModels}
                disabled={discovering}
                data-testid="discover-models-btn"
                className="text-label text-accent hover:underline disabled:opacity-40"
              >
                {discovering ? "刷新中…" : "🔄 刷新模型列表"}
              </button>
            )}
          </div>
          <select
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value)}
            data-testid="model-select"
            className="w-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
          >
            {currentPreset.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}K 上下文` : ""}
              </option>
            ))}
            {/* 只对 OpenRouter 显示发现的模型 */}
            {activeProvider === "openrouter" && discoveredModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}（OpenRouter）{m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}K` : ""}
              </option>
            ))}
          </select>
          {discoverError && (
            <div className="text-label text-neutral-600 mt-1">{discoverError}</div>
          )}
        </section>
      ) : activeCustomProvider ? (
        <section className="surface-card p-4">
          <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">模型（Model）</h3>
          {activeCustomProvider.models.length > 1 ? (
            <select
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
              data-testid="model-select-custom"
              className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
            >
              {activeCustomProvider.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
              placeholder="输入模型 ID"
              data-testid="model-input-custom"
              className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none font-mono"
            />
          )}
        </section>
      ) : null}

      {/* API Key */}
      {currentPreset && (
        <section className="surface-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300">API Key</h3>
            <a
              href={currentPreset.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-label text-brand hover:underline"
            >
              去获取 key →
            </a>
          </div>
          {keyMasked && (
            <div className="text-body text-neutral-600 dark:text-neutral-400 mb-2" data-testid="key-status">
              ✅ 已配置：<code className="bg-neutral-200 dark:bg-neutral-800 px-1 rounded">{keyMasked}</code>
            </div>
          )}
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={keyMasked ? "输入新 key 覆盖…" : "粘贴 API key（sk-…）"}
            data-testid="settings-key-input"
            className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
          />
          <p className="text-label text-neutral-600 mt-2">
            🔒 key 只存在本地主进程，不离开你的电脑。渲染层永远看不到完整 key。
          </p>
        </section>
      )}

      {/* 测试连接 */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300">测试连接</h3>
          <button
            onClick={handleTest}
            disabled={testing}
            data-testid="test-connection-btn"
            className="text-body btn-3d-neutral px-3 py-2 text-body disabled:opacity-40"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>
        {testResult && (
          <div
            className={`text-body rounded p-2 ${testResult.ok ? "bg-brand/10 text-brand" : "bg-warning/10 text-warning"}`}
            data-testid="test-result"
          >
            {testResult.ok ? "✅" : "❌"} {testResult.detail}
            {testResult.errorKind && testResult.errorKind !== "unknown" && (
              <span className="block text-label mt-1 opacity-70">错误类型：{testResult.errorKind}</span>
            )}
          </div>
        )}
      </section>

      {/* 每日目标 */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">每日学习目标（XP）</h3>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={dailyGoal}
            onChange={(e) => setDailyGoal(e.target.value)}
            min="1"
            max="500"
            data-testid="daily-goal-input"
            className="w-24 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-body rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
          />
          <span className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400">XP / 天（每答对一题 +10 XP）</span>
        </div>
      </section>

      {/* 语言选择 */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">语言 / Language</h3>
        <div className="flex gap-2">
          {(["zh-CN", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => {
                try { localStorage.setItem("lookatstudy-lang", l); } catch { /* 忽略 */ }
                window.location.reload();
              }}
              data-testid={`lang-${l}`}
              className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${
                currentLang === l
                  ? "bg-brand text-white shadow-sm"
                  : "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-600 dark:text-neutral-400 hover:bg-neutral-300 dark:hover:bg-neutral-700 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              {l === "zh-CN" ? "中文" : "English"}
            </button>
          ))}
        </div>
      </section>

      {/* 主题切换(v0.7 浅色模式):三态 auto/light/dark */}
      <section className="surface-card p-4">
        <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">外观 / Theme</h3>
        <div className="flex gap-2">
          {([
            { mode: "auto" as ThemeMode, label: "跟随系统" },
            { mode: "light" as ThemeMode, label: "浅色" },
            { mode: "dark" as ThemeMode, label: "深色" },
          ]).map(({ mode: m, label }) => (
            <button
              key={m}
              onClick={() => theme.setMode(m)}
              data-testid={`theme-${m}`}
              className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${
                theme.mode === m
                  ? "bg-brand text-white shadow-sm"
                  : "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-600 dark:text-neutral-400 hover:bg-neutral-300 dark:hover:bg-neutral-700 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-label text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 mt-2">
          {theme.mode === "auto" ? `当前跟随系统: ${theme.resolved === "dark" ? "深色" : "浅色"}` : null}
        </p>
      </section>

      {/* 多模态:图片识别导入 + AI 看图 */}
      <MultimodalSection
        activeProvider={activeProvider}
        activeModel={activeModel}
        presets={presets}
        customProviders={customProviders}
      />

      {/* 保存按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          data-testid="settings-save"
          className="btn-3d-brand px-6 py-2.5 text-body"
        >
          保存设置
        </button>
        {saved && <span className="text-body text-brand font-bold">✅ 已保存</span>}
      </div>

      {/* 删除自定义 provider 的内联确认(替代 native confirm()) */}
      {confirmDelete && (
        <ConfirmCard
          anchorRect={confirmDelete.rect}
          message={`删除自定义 Provider「${confirmDelete.label}」?无法撤销。`}
          danger
          confirmLabel="删除"
          testid="custom-provider-delete-confirm"
          onConfirm={() => { handleDeleteCustom(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
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
      <h3 className="text-body font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
        多模态 / Multimodal
      </h3>
      {/* 图片下载开关(默认 on) —— md/ipynb 里的图片引用直接下载,不涉及 AI */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleImgToggle}
          data-testid="image-download-toggle"
          className={`relative w-12 h-6 rounded-full transition-colors ${
            imgDownload ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              imgDownload ? "translate-x-6" : "translate-x-0.5"
            }`}
          />
        </button>
        <div className="flex-1">
          <div className="text-body font-medium text-neutral-700 dark:text-neutral-300">
            图片下载
          </div>
          <div className="text-label text-neutral-500 dark:text-neutral-400">
            导入课程时自动下载 md/notebook 里引用的图片(默认开启)
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleToggle}
          data-testid="multimodal-toggle"
          className={`relative w-12 h-6 rounded-full transition-colors ${
            enabled ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-0.5"
            }`}
          />
        </button>
        <div className="flex-1">
          <div className="text-body font-medium text-neutral-700 dark:text-neutral-300">
            图片识别导入 + AI 看图
          </div>
          <div className="text-label text-neutral-500 dark:text-neutral-400">
            开启后:导入课程时收集图片(.png/.jpg) + PDF 图片;聊天时 AI 可以看图讲解
          </div>
        </div>
      </div>
      {enabled && (
        <div className="space-y-3">
          {/* 当前主模型 vision 能力提示 */}
          <div className="text-label text-neutral-500 dark:text-neutral-400 bg-ink/5 dark:bg-ink/10 rounded-lg p-3">
            <div className="font-medium mb-1">当前主模型:{activeModel || "(未选)"}</div>
            <div>
              {activeProvider.startsWith("custom-")
                ? "自定义 provider — 视觉能力未知。如不支持看图,在下方覆盖一个 vision 模型。"
                : "如当前模型不支持 vision,可在下方配置专门的 vision 模型。常见:GLM-4V / GPT-4o / Claude 3.5 / Gemini。"}
            </div>
          </div>
          {/* Vision 模型覆盖 */}
          <div className="bg-ink/5 dark:bg-ink/10 rounded-lg p-3">
            <div className="text-label font-medium text-neutral-600 dark:text-neutral-300 mb-2">
              Vision 模型覆盖(可选 — 留空则复用主模型)
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
                className="w-full px-3 py-2 rounded-lg bg-surface-1 text-body border border-neutral-200 dark:border-neutral-700"
              >
                <option value="">(不覆盖 — 用主模型)</option>
                <optgroup label="预设 Provider">
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                {customProviders.length > 0 && (
                  <optgroup label="自定义 Provider">
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
                      className="w-full px-3 py-2 rounded-lg bg-surface-1 text-body border border-neutral-200 dark:border-neutral-700"
                    >
                      {overridePreset!.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}{(m.capabilities ?? []).includes("vision") ? " ✅ vision" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={overrideModel}
                      onChange={(e) => setOverrideModel(e.target.value)}
                      placeholder={overrideCustom?.defaultModel ?? "模型 ID"}
                      className="w-full px-3 py-2 rounded-lg bg-surface-1 text-body border border-neutral-200 dark:border-neutral-700"
                    />
                  )}
                  <button
                    onClick={handleSaveOverride}
                    data-testid="vision-override-save"
                    className="btn-3d-brand px-4 py-1.5 text-label self-start"
                  >
                    保存覆盖配置
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
