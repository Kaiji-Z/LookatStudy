/**
 * ModelVisionTab —— 模型管理弹窗的「看图」tab(v0.38 自 SettingsView.MultimodalContent 迁入)。
 *
 * 内容原样保留(测试 id 不变):聊天看图开关、视觉覆盖管理(看图 custom provider
 * 选用/模型下拉/测试/删除/新建)、PDF 公式视觉转写开关。布局由弹窗容器负责,
 * 本组件只渲染卡片内容。
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Wrench, XCircle, X } from "lucide-react";
import type { CustomProvider, ProviderPresetInfo } from "@shared/types";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";
import { ConfirmCard } from "./ConfirmCard.js";
import { CustomProviderForm } from "./CustomProviderForm.js";
import { Toggle } from "./Toggle.js";

export function ModelVisionTab({
  activeProvider,
  activeModel,
  presets,
  customProviders,
  onProvidersChanged,
}: {
  activeProvider: string;
  activeModel: string;
  presets: ProviderPresetInfo[];
  customProviders: CustomProvider[];
  /** 增删 provider 后刷新父级列表(看图区删除按钮用) */
  onProvidersChanged?: () => void;
}) {
  const t = useLang();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [overrideProvider, setOverrideProvider] = useState<string>("");
  const [overrideModel, setOverrideModel] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [visionTesting, setVisionTesting] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [mathVision, setMathVision] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getSetting("flag_multimodal_import"),
      api.getSetting("vision_provider_override"),
      api.getSetting("vision_model_override"),
      api.getSetting("flag_math_vision"),
    ]).then(([flag, prov, mv, mathFlag]) => {
      setEnabled(flag === "true");
      setOverrideProvider(prov ?? "");
      setOverrideModel(mv ?? "");
      setMathVision(mathFlag === "true");
      setLoaded(true);
    });
  }, []);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await api.setSetting("flag_multimodal_import", String(next));
  };

  /** v0.20 PDF 公式视觉转写开关:开=公式密集页整页渲染交给上面配的看图模型转 LaTeX */
  const handleMathVisionToggle = async () => {
    const next = !mathVision;
    setMathVision(next);
    await api.setSetting("flag_math_vision", String(next));
  };

  /** 覆盖自定义保存:provider 行 + 模型一起写入;模型可选(models 列表>1 时),
   *  创建时仍先落 defaultModel,选了再改写 vision_model_override */
  const handleCustomSaved = async (created: CustomProvider) => {
    await api.setSetting("vision_provider_override", created.id);
    await api.setSetting("vision_model_override", created.defaultModel);
    setOverrideProvider(created.id);
    setOverrideModel(created.defaultModel);
    setShowForm(false);
  };

  /** 换识图模型(同一 custom provider 的 models 列表内切换) */
  const handleOverrideModelChange = async (modelId: string) => {
    setOverrideModel(modelId);
    await api.setSetting("vision_model_override", modelId);
  };

  const handleStopOverride = async () => {
    await api.setSetting("vision_provider_override", "");
    await api.setSetting("vision_model_override", "");
    setOverrideProvider("");
    setOverrideModel("");
    setShowForm(false);
  };

  /** 删除看图区自定义 provider(2026-09-12,手机真机反馈"没有删除按钮"):
      在身覆盖一并清掉再删行;父级列表经 onProvidersChanged 刷新。 */
  const [confirmVisionDelete, setConfirmVisionDelete] = useState<{ id: string; label: string; rect: DOMRect } | null>(null);
  const handleDeleteVisionCustom = async (id: string) => {
    try {
      if (overrideProvider === id) {
        await api.setSetting("vision_provider_override", "");
        await api.setSetting("vision_model_override", "");
        setOverrideProvider("");
      }
      await api.deleteCustomProvider(id);
    } catch {
      /* 删除失败保持现状 */
    } finally {
      onProvidersChanged?.();
    }
  };

  /** 测识图覆盖:测的就是生效链路(覆盖优先,缺省回落主模型) */
  const handleTestOverride = async () => {
    if (visionTesting) return;
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

  const visionCustoms = customProviders.filter((c) => c.kind === "vision");
  // 全表查(不限 kind):v0.15 前建的覆盖指向 kind=llm 的行,不能因分区丢了摘要
  const overrideCustom = overrideProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === overrideProvider)
    : null;
  // 旧库:覆盖指向预设 provider(v0.15 前的 UI 可选预设)—— 仍生效,展示为旧配置
  const overrideLegacyPreset = overrideProvider && !overrideProvider.startsWith("custom-")
    ? presets.find((p) => p.id === overrideProvider)
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
          {/* 看图模型来源:不配置 = 复用主模型(留空语义),配置窗口直接常显,无切换按钮 */}
          <div className="bg-ink/5 rounded-lg p-3">
            <div className="text-label font-medium text-ink-muted mb-2">
              {t("settings.multimodal.override_title")}
            </div>
            <div className="text-caption text-ink-muted mb-2">
              {t("settings.multimodal.override_bridge_hint")}
            </div>
            <div className="space-y-3 mt-1">
                {overrideCustom && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-label">
                      <Wrench className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden="true" />
                      <span className="font-medium text-ink-strong">{overrideCustom.label}</span>
                      {overrideCustom.models.length > 1 ? (
                        <select
                          value={overrideModel || overrideCustom.defaultModel}
                          onChange={(e) => void handleOverrideModelChange(e.target.value)}
                          aria-label={t("settings.multimodal.model_label")}
                          data-testid="vision-override-model-select"
                          className="bg-surface-1 text-ink text-label rounded-lg border border-[var(--border)] focus:border-brand focus:outline-none px-2 py-1 max-w-[12rem]"
                        >
                          {overrideCustom.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                              {(m.capabilities ?? []).includes("vision") ? " ✅" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <code className="text-ink-faint font-mono break-all">{overrideModel || overrideCustom.defaultModel}</code>
                      )}
                      <span className="text-ink-faint break-all min-w-0">{overrideCustom.baseUrl}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void handleTestOverride()}
                        disabled={visionTesting}
                        data-testid="vision-override-test"
                        className="btn-3d-neutral px-4 py-1.5 text-label disabled:opacity-50"
                      >
                        {visionTesting ? t("settings.testing") : t("settings.multimodal.test_override")}
                      </button>
                      <button onClick={() => setShowForm((s) => !s)} className="text-label text-accent hover:underline">
                        {t("settings.multimodal.replace_custom")}
                      </button>
                      <button onClick={() => void handleStopOverride()} className="text-label text-ink-muted hover:text-ink-strong">
                        {t("settings.multimodal.stop_override")}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmVisionDelete({ id: overrideCustom.id, label: overrideCustom.label, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                        }}
                        data-testid={`vision-delete-${overrideCustom.id}`}
                        className="text-label text-ink-muted hover:text-warning"
                      >
                        {t("action.delete")}
                      </button>
                      {visionTestResult && (
                        <span className={`text-label inline-flex items-center gap-1 ${visionTestResult.ok ? "text-brand" : "text-warning"}`}>
                          {visionTestResult.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
                          {visionTestResult.detail}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {overrideLegacyPreset && (
                  <div className="flex flex-wrap items-center gap-2 text-label">
                    <span className="text-ink-muted">{t("settings.multimodal.legacy_preset", { label: overrideLegacyPreset.label })}</span>
                    <button onClick={() => void handleStopOverride()} className="text-label text-ink-muted hover:text-ink-strong underline">
                      {t("settings.multimodal.stop_override")}
                    </button>
                  </div>
                )}

                {/* 无覆盖在身:已有 vision 自定义可一键选用;没有则直接出新建表单 */}
                {!overrideCustom && !overrideLegacyPreset && (
                  <>
                    {visionCustoms.map((c) => (
                      <span key={c.id} className="relative block">
                        <button
                          onClick={() => void handleCustomSaved(c)}
                          className="w-full text-left px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 transition-colors"
                          data-testid={`vision-pick-${c.id}`}
                        >
                          <span className="text-label font-medium text-ink-strong">{c.label}</span>
                          <span className="text-label text-ink-faint font-mono break-all ml-2">{c.defaultModel}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={t("action.delete")}
                          data-tooltip={t("action.delete")}
                          data-testid={`vision-delete-${c.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmVisionDelete({ id: c.id, label: c.label, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                          }}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full text-ink-muted hover:text-warning flex items-center justify-center hover:bg-surface-2"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                    {(showForm || visionCustoms.length === 0) && (
                      <CustomProviderForm
                        kind="vision"
                        testPrefix="vision-custom"
                        titleKey="settings.custom.form_title_vision"
                        modelPhKey="settings.custom.model_ph_vision"
                        onSaved={(p) => void handleCustomSaved(p)}
                        onCancel={() => setShowForm(false)}
                      />
                    )}
                    {visionCustoms.length > 0 && (
                      <button onClick={() => setShowForm((s) => !s)} className="text-label text-accent hover:underline">
                        {showForm ? t("action.cancel") : t("settings.custom.new")}
                      </button>
                    )}
                  </>
                )}
          </div>
          </div>
          {/* v0.20:PDF 公式视觉转写 —— 导入 PDF 时公式密集页整页渲染成图,交给上面配置的
              看图模型转成 LaTeX Markdown(实验性,按页消耗视觉模型额度;需先配好看图模型)。 */}
          <div className="bg-ink/5 rounded-lg p-3 flex items-center gap-3">
            <Toggle
              checked={mathVision}
              onChange={handleMathVisionToggle}
              label={t("settings.mathvision.toggle")}
              testid="math-vision-toggle"
            />
            <div className="flex-1 min-w-0">
              <div className="text-label font-medium text-ink-strong">{t("settings.mathvision.toggle")}</div>
              <div className="text-caption text-ink-muted">{t("settings.mathvision.desc")}</div>
            </div>
          </div>
      </div>
          {/* 删除看图自定义 provider 内联确认(与主模型区同款) */}
      {confirmVisionDelete && (
        <ConfirmCard
          anchorRect={confirmVisionDelete.rect}
          message={t("settings.delete_custom_confirm", { name: confirmVisionDelete.label })}
          danger
          confirmLabel={t("action.delete")}
          testid="vision-provider-delete-confirm"
          onConfirm={() => { void handleDeleteVisionCustom(confirmVisionDelete.id); setConfirmVisionDelete(null); }}
          onCancel={() => setConfirmVisionDelete(null)}
        />
      )}
    </>
  );
}
