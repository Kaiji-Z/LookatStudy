/**
 * 设置页 —— v0.8 重构为分组设置(iOS / Linear 式);v0.38 模型配置整体迁入
 * 模型管理弹窗(ModelManagerModal),抽屉只留两张紧凑卡(模型卡/看图状态卡)。
 *
 * 设计语汇:
 *   - 单标题:抽屉头已有"设置 + 关闭",本组件不再重复标题。
 *   - 分组:模型 / 看图状态 / 语音模型 / 学习者记忆 / 伴学伙伴 / 外观与语言 / 数据 / 关于。
 *   - 卡内用发丝线(border-t border-faint)分行。
 *   - 无页脚:模型/看图配置在弹窗内即时生效;其余设置本来就是改动即存。
 *
 * 密钥边界:key 输入框只在弹窗内出现,password 类型;保存只走 setSetting,
 * 渲染层永不留全量 key(抽屉两卡只见 hasSetting 布尔)。
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useSyncExternalStore } from "react";
import { getCompanionSnapshot, subscribeCompanion } from "../lib/companion/bus.ts";
import { COMPANION_FORM_IDS } from "../lib/companion/forms-index.js";
import { CompanionBotWizard } from "./companion/CompanionBotWizard.js";
import { ShimejiImportDialog } from "./ShimejiImportDialog.js";
import { refreshActiveShimeji } from "../lib/companion/shimeji-pack-store.js";
import { refreshActivePack } from "../lib/companion/custom-pack-store.js";
import { VEH_PICKABLE, VEH_THEMES } from "../lib/companion/veh-themes.ts";
import type { CompanionVehicleId } from "@shared/companion-cut.ts";
import { Mascot } from "./companion/Mascot.js";
import { Plus, CheckCircle2, XCircle, Wrench, X } from "lucide-react";
import { api } from "../lib/api.js";
import type { ProviderPresetInfo, CustomProvider, DshImportSummary } from "@shared/types";
import { ConfirmCard } from "./ConfirmCard.js";
import { CustomProviderForm } from "./CustomProviderForm.js";
import { Toggle } from "./Toggle.js";
import { useTheme, type ThemeMode } from "../lib/useTheme.js";
import { useLang, setLang, getLang } from "../lib/i18n.js";
import { sortVoicesZhFirst, systemVoiceLabel, TTS_SETTINGS_CHANGED_EVENT } from "../lib/system-tts.ts";
import pkg from "../../../package.json";

type SystemVoiceOption = SpeechSynthesisVoice;

/** 已保存纸偶包(形象栏卡片;thumb=主件缩略图 dataURL,vehicle=载具主题)。 */
interface ShimejiPackSummary {
  id: string;
  name: string;
  format: string;
  frameCount: number;
  actionCount: number;
  iconBase64: string | null;
  active: boolean;
  vehicle?: CompanionVehicleId;
}

interface PackSummary {
  id: string;
  name: string;
  active: boolean;
  route: string;
  thumb?: string;
  vehicle?: CompanionVehicleId;
}

/** 语音设置落库后广播:useSpeech 实例重拉档位缓存(system 档点击时同步判定) */
function notifyTtsSettingsChanged(): void {
  window.dispatchEvent(new Event(TTS_SETTINGS_CHANGED_EVENT));
}

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

export function SettingsView({ onOpenModelManager }: { onOpenModelManager?: (tab?: "main" | "vision") => void }) {
  const t = useLang();
  const [presets, setPresets] = useState<ProviderPresetInfo[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("glm");
  const [activeModel, setActiveModel] = useState<string>("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [visionOverride, setVisionOverride] = useState<{ providerId: string; modelId: string }>({ providerId: "", modelId: "" });
  const theme = useTheme();

  const load = useCallback(async () => {
    try {
      const [ps, cps, provider, model, vProv, vModel] = await Promise.all([
        api.getProviderPresets(),
        api.listCustomProviders(),
        api.getSetting("active_provider"),
        api.getSetting("active_model"),
        api.getSetting("vision_provider_override"),
        api.getSetting("vision_model_override"),
      ]);
      setPresets(ps);
      setCustomProviders(cps);
      const p = provider ?? "glm";
      setActiveProvider(p);
      if (p.startsWith("custom-")) {
        const cp = cps.find((c) => c.id === p);
        setActiveModel(model ?? cp?.defaultModel ?? "");
        setKeyConfigured(cp?.hasApiKey ?? false);
      } else {
        const preset = ps.find((x) => x.id === p);
        setActiveModel(model ?? preset?.defaultModel ?? "");
        setKeyConfigured(preset ? await api.hasSetting(preset.apiKeySetting as Parameters<typeof api.hasSetting>[0]) : false);
      }
      setVisionOverride({ providerId: vProv ?? "", modelId: vModel ?? "" });
    } catch (e) {
      console.error("[SettingsView] load() failed:", e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => {
      // 弹窗里改了配置(key/模型/覆盖) → 两张卡跟着刷新
      const onCfg = () => void load();
      window.addEventListener("llm-config-changed", onCfg);
      return () => window.removeEventListener("llm-config-changed", onCfg);
    },
    [load],
  );

  /* ---------- 两张卡的数据派生 ---------- */

  const activePreset = !activeProvider.startsWith("custom-")
    ? presets.find((p) => p.id === activeProvider) ?? null
    : null;
  const activeCustom = activeProvider.startsWith("custom-")
    ? customProviders.find((c) => c.id === activeProvider) ?? null
    : null;
  const providerLabel = activePreset?.label ?? activeCustom?.label ?? activeProvider;
  const modelEntry = activePreset
    ? activePreset.models.find((m) => m.id === activeModel || m.id.toLowerCase() === activeModel.toLowerCase()) ?? null
    : activeCustom?.models.find((m) => m.id === activeModel || m.id.toLowerCase() === activeModel.toLowerCase()) ?? null;

  // 模型元数据小注(窗口/价格/能力;与 ModelPicker 徽标同口径)
  const modelNote = (() => {
    if (!modelEntry) return null;
    const parts: string[] = [];
    if (modelEntry.contextWindow) parts.push(`${Math.round(modelEntry.contextWindow / 1000)}k`);
    if (modelEntry.free) parts.push(t("model.picker.free"));
    else if (modelEntry.pricing && modelEntry.pricing.input !== null) {
      parts.push(`$${String(Number(modelEntry.pricing.input.toFixed(2)))}`);
    }
    if ((modelEntry.capabilities ?? []).includes("vision")) parts.push("👁");
    if ((modelEntry.capabilities ?? []).includes("reasoning")) parts.push("🧠");
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  // 看图状态:覆盖在身 → 转译 by X;主模型带 vision 能力 → 直看;否则提示可配转译
  const bridgeCustom = visionOverride.providerId.startsWith("custom-")
    ? customProviders.find((c) => c.id === visionOverride.providerId) ?? null
    : null;
  const visionStatusLine = bridgeCustom
    ? t("settings.modelcard.vision_bridge", { model: visionOverride.modelId || bridgeCustom.defaultModel })
    : (modelEntry?.capabilities ?? []).includes("vision")
      ? t("settings.modelcard.vision_direct")
      : t("settings.modelcard.vision_none");

  return (
    <>
      <div className="px-5 pt-5 space-y-6">
        {/* ========== 模型卡(AI 模型区已迁模型管理弹窗,v0.38;整卡可点开窗) ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.ai")}</h3>
          <div className="surface-card overflow-hidden">
            <button
              type="button"
              onClick={() => onOpenModelManager?.("main")}
              data-testid="model-card-manage"
              className="w-full text-left px-4 py-3.5 hover:bg-ink/[0.03] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${keyConfigured ? "bg-brand" : "bg-ink/15"}`} aria-hidden />
                <span className="text-body font-medium text-ink-strong truncate">{providerLabel}</span>
                <span className="text-label text-ink-muted font-mono truncate">{activeModel}</span>
                <span className="flex-1" />
                <span className="text-label text-accent shrink-0">{t("settings.modelcard.manage")}</span>
              </div>
              {modelNote && <div className="text-caption text-ink-faint mt-1 tabular-nums">{modelNote}</div>}
              <div className="text-caption text-ink-faint mt-0.5">{visionStatusLine}</div>
            </button>
          </div>
        </section>

        {/* ========== 看图状态卡(配置在模型管理弹窗·看图 tab) ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.vision")}</h3>
          <div className="surface-card px-4 py-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-label font-medium text-ink-strong">{visionStatusLine}</div>
              <div className="text-caption text-ink-faint">{t("settings.modelcard.vision_hint")}</div>
            </div>
            <button
              onClick={() => onOpenModelManager?.("vision")}
              data-testid="model-card-vision"
              className="btn-3d-neutral px-3 py-1.5 text-label shrink-0"
            >
              {t("settings.modelcard.configure")}
            </button>
          </div>
        </section>

                {/* ========== 模型区 3:语音模型 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.speech")}</h3>
          <div className="surface-card overflow-hidden">
            <SpeechContent />
          </div>
        </section>

        {/* ========== 学习者记忆 ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.memory")}</h3>
          <div className="surface-card overflow-hidden">
            <MemoryContent />
          </div>
        </section>

        {/* ========== 伴学伙伴(id 锚:开屏"更换伴学伙伴"定位滚动用) ========== */}
        <section id="settings-section-companion">
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.companion")}</h3>
          <div className="surface-card overflow-hidden">
            <CompanionContent />
          </div>
        </section>

        {/* ========== 外观与语言 ========== */}
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

        {/* ========== 数据迁移(dsh 插件进度;全平台) ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.data")}</h3>
          <div className="surface-card overflow-hidden">
            <DshImportContent />
          </div>
        </section>

        {/* ========== 关于(版本随构建走,随时知道在用的是哪个版本) ========== */}
        <section>
          <h3 className="text-label font-bold text-ink-muted mb-2 px-1">{t("settings.group.about")}</h3>
          <div className="surface-card overflow-hidden">
            <div className={rowCls(false)}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-label font-medium text-ink-strong">{t("settings.row.version")}</div>
                <a
                  href="https://github.com/Kaiji-Z/LookatStudy/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-label font-mono text-brand hover:underline"
                  data-testid="settings-version"
                >
                  v{pkg.version}
                </a>
              </div>
              <p className="text-label text-ink-muted mt-2">{t("settings.version.hint")}</p>
            </div>
          </div>
        </section>
      </div>

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
 * 伴学伙伴:开关(companion_enabled,默认开)+ 形象选择器(companion_form)。
 * 选择卡用真 Mascot 实时预览(换肤即所见);切换写设置 + 广播
 * companion-config-changed,bus 重读 → 三处栖息地即时换形象。
 */
function CompanionContent() {
  const t = useLang();
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);

  const [sfx, setSfx] = useState(true);
  const [pet, setPet] = useState(false);
  // 桌宠=Electron 透明窗,web 运行时(手机/浏览器)没有这个窗:入口直接不出现
  const isWebRuntime = typeof window !== "undefined" && !!(window as { __lookatstudyWeb?: boolean }).__lookatstudyWeb;

  useEffect(() => {
    api.getSetting("companion_enabled").then((v) => {
      setEnabled(v !== "false" && v !== "0");
      setLoaded(true);
    });
    api.getSetting("companion_sfx").then((v) => {
      setSfx(v !== "false" && v !== "0");
    });
    api.getSetting("companion_pet_mode").then((v) => {
      setPet(v === "1");
    });
  }, []);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await api.setSetting("companion_enabled", String(next));
    // bus 侧重读设置(与 llm-config-changed 同一模式)
    window.dispatchEvent(new Event("companion-config-changed"));
  };

  const handleSfxToggle = async () => {
    const next = !sfx;
    setSfx(next);
    await api.setSetting("companion_sfx", String(next));
    window.dispatchEvent(new Event("companion-config-changed"));
  };

  const handlePetToggle = async () => {
    const next = !pet;
    setPet(next);
    await api.setSetting("companion_pet_mode", next ? "1" : "0");
    // 主进程 settings:set 钩子开/关桌宠窗;bus 重读让主窗 Creature 隐身/复现
    window.dispatchEvent(new Event("companion-config-changed"));
  };

  const pickForm = async (id: string) => {
    if (id === snap.form) return;
    await api.setSetting("companion_form", id);
    window.dispatchEvent(new Event("companion-config-changed"));
  };

  /* 多 bot 形象卡(2026-09-11):每张已保存包一张卡,"+"卡进制作向导。
     选中=当前激活包(form=custom 且包 active);点卡片=切换激活包。 */
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmingPack, setConfirmingPack] = useState<{ id: string; rect: DOMRect } | null>(null);
  // 设置页整合(2026-09-12 用户拍板):入口统一到「新建 +」卡 → 选择 自制/Shimeji;
  // shimeji 包卡与纸偶包卡混排进同一形象区,点卡=激活包+切形态
  const [createOpen, setCreateOpen] = useState(false);
  const [customPickOpen, setCustomPickOpen] = useState(false);
  const [shimejiPickOpen, setShimejiPickOpen] = useState(false);
  const [createHover, setCreateHover] = useState<"self" | "shimeji" | null>(null);
  const [shimejiImportOpen, setShimejiImportOpen] = useState(false);
  const [shimejiPacks, setShimejiPacks] = useState<ShimejiPackSummary[]>([]);
  const [confirmingShimeji, setConfirmingShimeji] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [shimejiVehPicker, setShimejiVehPicker] = useState<string | null>(null);
  // 换载具入口(2026-09-11):点卡片左上色点 → 行下方面板选主题;激活包实时刷新
  const [vehPickerPack, setVehPickerPack] = useState<string | null>(null);
  const loadPacks = useCallback(async () => {
    try {
      setPacks((await window.api.companionPackList()).packs);
    } catch {
      /* 列表读失败保持现状 */
    }
  }, []);
  const loadShimejiPacks = useCallback(async () => {
    try {
      setShimejiPacks((await window.api.shimejiList()).packs);
    } catch {
      /* lab 环境:静默 */
    }
  }, []);
  useEffect(() => {
    void loadPacks();
    void loadShimejiPacks();
    const onChange = () => {
      void loadPacks();
      void loadShimejiPacks();
    };
    window.addEventListener("companion-config-changed", onChange);
    return () => window.removeEventListener("companion-config-changed", onChange);
  }, [loadPacks, loadShimejiPacks]);

  /** 点 shimeji 包卡 = 激活包 + 切形态(与纸偶包卡同款一步到位) */
  const pickShimejiPack = async (id: string) => {
    await api.shimejiActivate({ id });
    if (snap.form !== "shimeji") await api.setSetting("companion_form", "shimeji");
    window.dispatchEvent(new Event("companion-config-changed"));
    await loadShimejiPacks();
    await refreshActiveShimeji();
  };
  const setShimejiVehicle = async (id: string, vehicle: CompanionVehicleId) => {
    await window.api.shimejiSetVehicle({ id, vehicle });
    await loadShimejiPacks();
    // 激活包换装实时生效(refresh 拉 manifest,ShimejiArt 即刻换肤)
    await refreshActiveShimeji();
  };
  const removeShimejiPack = async (id: string) => {
    await window.api.shimejiDelete({ id });
    setConfirmingShimeji(null);
    await loadShimejiPacks();
    await refreshActiveShimeji();
  };

  const pickPack = async (id: string) => {
    await window.api.companionPackActivate({ id });
    if (snap.form !== "custom") await api.setSetting("companion_form", "custom");
    await refreshActivePack();
    window.dispatchEvent(new Event("companion-config-changed"));
  };

  const removePack = async (id: string) => {
    const r = await window.api.companionPackDelete({ id });
    if (r.formReset) window.dispatchEvent(new Event("companion-config-changed"));
    setConfirmingPack(null);
    setVehPickerPack(null);
    void loadPacks();
  };

  /** 换载具主题:写 manifest.vehicle;是激活包就同步刷 active 缓存(伴学即时换装)。 */
  const setPackVehicle = async (id: string, vehicle: CompanionVehicleId) => {
    await window.api.companionPackSetVehicle({ id, vehicle });
    await loadPacks();
    if (packs.find((q) => q.id === id)?.active) {
      await refreshActivePack();
      window.dispatchEvent(new Event("companion-config-changed"));
    }
  };

  if (!loaded) return null;

  return (
    <div className="px-4 py-3.5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={handleToggle} label={t("settings.companion.toggle")} testid="companion-toggle" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-medium text-ink-strong">{t("settings.companion.toggle")}</div>
          <div className="text-label text-ink-muted">{t("settings.companion.toggle.desc")}</div>
        </div>
      </div>
      {enabled && (
        <>
        <div className="flex items-center gap-3">
          <Toggle checked={sfx} onChange={handleSfxToggle} label={t("settings.companion.sfx")} testid="companion-sfx-toggle" />
          <div className="flex-1 min-w-0">
            <div className="text-body font-medium text-ink-strong">{t("settings.companion.sfx")}</div>
            <div className="text-label text-ink-muted">{t("settings.companion.sfx.desc")}</div>
          </div>
        </div>
        {!isWebRuntime && (
          <div className="flex items-center gap-3">
            <Toggle checked={pet} onChange={handlePetToggle} label={t("settings.companion.pet")} testid="companion-pet-toggle" />
            <div className="flex-1 min-w-0">
              <div className="text-body font-medium text-ink-strong">{t("settings.companion.pet")}</div>
              <div className="text-label text-ink-muted">{t("settings.companion.pet.desc")}</div>
            </div>
          </div>
        )}
        <div>
          <div className="text-label text-ink-muted mb-2">{t("settings.companion.form")}</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("settings.companion.form")}>
            {COMPANION_FORM_IDS.filter((id) => id !== "custom" && id !== "shimeji").map((id) => {
              const selected = snap.form === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`companion-form-${id}`}
                  onClick={() => { void pickForm(id); }}
                  className={`flex flex-col items-center gap-0.5 rounded-xl p-1.5 border motion-safe:transition-colors
                    ${selected
                      ? "border-[var(--accent)] bg-surface-2 shadow-card"
                      : "border-[var(--border-faint)] hover:bg-surface-2"}`}
                  title={t(`companion.form.${id}.desc`)}
                >
                  <Mascot form={id} expression="happy" pose="float" size={64} />
                  <span className={`text-label ${selected ? "text-ink-strong font-medium" : "text-ink-muted"}`}>
                    {t(`companion.form.${id}.name`)}
                  </span>
                </button>
              );
            })}
            {/* 自制来源卡(2026-09-12 二次整合):一张卡代表"自制"形态,点击弹出
                已制作包列表选择,选中即激活持久化;卡面显示当前激活包 */}
            <button
              type="button"
              role="radio"
              aria-checked={snap.form === "custom" && packs.some((p) => p.active)}
              data-testid="companion-card-custom"
              onClick={() => setCustomPickOpen(true)}
              title={t("companion.pick.custom.title")}
              className={`flex flex-col items-center gap-0.5 rounded-xl p-1.5 border motion-safe:transition-colors
                ${snap.form === "custom" && packs.some((p) => p.active)
                  ? "border-[var(--accent)] bg-surface-2 shadow-card"
                  : "border-[var(--border-faint)] hover:bg-surface-2"}`}
            >
              {(() => {
                const act = packs.find((p) => p.active);
                return act?.thumb ? (
                  <img src={act.thumb} alt="" className="h-14 w-14 object-contain" />
                ) : (
                  <span className="h-14 w-14 flex items-center justify-center">
                    <span className="h-9 w-9 rounded-full bg-[#c8a06e]" />
                  </span>
                );
              })()}
              <span className={`text-label max-w-20 truncate ${snap.form === "custom" && packs.some((p) => p.active) ? "text-ink-strong font-medium" : "text-ink-muted"}`}>
                {packs.find((p) => p.active)?.name ?? t("companion.create.self.name")}
              </span>
            </button>
            {/* Shimeji 来源卡:一张卡代表"Shimeji"形态,点击弹出已导入包列表选择 */}
            <button
              type="button"
              role="radio"
              aria-checked={snap.form === "shimeji" && shimejiPacks.some((p) => p.active)}
              data-testid="companion-card-shimeji"
              onClick={() => setShimejiPickOpen(true)}
              title={t("companion.pick.shimeji.title")}
              className={`flex flex-col items-center gap-0.5 rounded-xl p-1.5 border motion-safe:transition-colors
                ${snap.form === "shimeji" && shimejiPacks.some((p) => p.active)
                  ? "border-[var(--accent)] bg-surface-2 shadow-card"
                  : "border-[var(--border-faint)] hover:bg-surface-2"}`}
            >
              {(() => {
                const act = shimejiPacks.find((p) => p.active);
                return act?.iconBase64 ? (
                  <img src={`data:image/png;base64,${act.iconBase64}`} alt="" className="h-14 w-14 object-contain" />
                ) : (
                  <span className="h-14 w-14 flex items-center justify-center text-caption text-ink-muted">Shimeji</span>
                );
              })()}
              <span className={`text-label max-w-20 truncate ${snap.form === "shimeji" && shimejiPacks.some((p) => p.active) ? "text-ink-strong font-medium" : "text-ink-muted"}`}>
                {shimejiPacks.find((p) => p.active)?.name ?? "Shimeji"}
              </span>
            </button>
            {/* "+"卡:空=进制作;非空=追加新 bot,每保存一个持久化一张卡 */}
            <button
              type="button"
              role="radio"
              aria-checked={false}
              data-testid="companion-form-add"
              aria-label={t("companion.bots.add")}
              onClick={() => setCreateOpen(true)}
              className="flex flex-col items-center gap-0.5 rounded-xl p-1.5 border border-dashed border-[var(--border-faint)] hover:bg-surface-2"
            >
              <span className="h-14 w-14 flex items-center justify-center text-ink-muted">
                <Plus className="w-6 h-6" />
              </span>
              <span className="text-label text-ink-muted">{t("companion.bots.add")}</span>
            </button>
          </div>
          {confirmingPack && (
            <ConfirmCard
              anchorRect={confirmingPack.rect}
              message={t("companion.bots.deleteConfirm")}
              danger
              testid="companion-pack-delete-confirm"
              onConfirm={() => void removePack(confirmingPack.id)}
              onCancel={() => setConfirmingPack(null)}
            />
          )}
          {/* 自制包选择弹窗:点项=激活+切形态;色点=换载具(面板在弹窗内);×=删除 */}
          {customPickOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              data-noswipe=""
              role="dialog"
              aria-modal="true"
              aria-label={t("companion.pick.custom.title")}
              onClick={() => setCustomPickOpen(false)}
            >
              <div
                className="relative w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-surface-0 border border-[var(--border)] shadow-elevated p-4"
                data-testid="custom-pack-list"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-body font-medium text-ink-strong mb-3">{t("companion.pick.custom.title")}</div>
                <div className="min-h-0 overflow-y-auto">
                {packs.length === 0 ? (
                  <p className="text-label text-ink-muted py-4 text-center">{t("companion.pick.empty.custom")}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {packs.map((p) => (
                      <div key={p.id} className="relative">
                        <button
                          type="button"
                          data-testid={`custom-pack-option-${p.id}`}
                          onClick={() => { void pickPack(p.id); setCustomPickOpen(false); }}
                          className={`w-full flex items-center gap-2.5 rounded-xl border p-2 text-left motion-safe:transition-colors
                            ${p.active && snap.form === "custom" ? "border-[var(--accent)] bg-surface-2" : "border-[var(--border-faint)] hover:bg-surface-2"}`}
                        >
                          {p.thumb ? (
                            <img src={p.thumb} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface-2" />
                          ) : (
                            <span className="w-10 h-10 rounded-lg bg-surface-2 inline-block" />
                          )}
                          <span className="text-body text-ink-strong flex-1 truncate">{p.name}</span>
                          {p.active && snap.form === "custom" && (
                            <span className="text-caption text-brand font-medium">{t("settings.shimeji.active")}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={t("companion.bots.veh")}
                          data-tooltip={t("companion.bots.veh")}
                          data-testid={`companion-pack-veh-${p.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setVehPickerPack((cur) => (cur === p.id ? null : p.id));
                          }}
                          className="absolute top-1.5 -left-1.5 w-5 h-5 rounded-full border border-black/25 shadow-card hover:scale-110 motion-safe:transition-transform"
                          style={{ background: VEH_THEMES[p.vehicle ?? "silver"].dot }}
                        />
                        <button
                          type="button"
                          aria-label={t("companion.custom.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingPack({ id: p.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-ink-faint hover:text-warning"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {vehPickerPack && (
                  <div className="mt-2.5 rounded-xl border border-[var(--border-faint)] bg-surface-0 p-2.5" data-testid="companion-veh-picker">
                    <div className="text-caption text-ink-muted mb-1.5">{t("companion.wizard.vehicle")}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("companion.wizard.vehicle")}>
                      {(["silver", ...VEH_PICKABLE] as CompanionVehicleId[]).map((vid) => {
                        const sel = (packs.find((q) => q.id === vehPickerPack)?.vehicle ?? "silver") === vid;
                        return (
                          <button
                            key={vid}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            data-testid={`companion-veh-pick-${vid}`}
                            onClick={() => void setPackVehicle(vehPickerPack, vid)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-label motion-safe:transition-colors
                              ${sel
                                ? "border-[var(--accent)] bg-surface-2 text-ink-strong font-medium"
                                : "border-[var(--border-faint)] hover:bg-surface-2 text-ink-muted"}`}
                          >
                            <span aria-hidden="true" className="w-3 h-3 rounded-full border border-black/20" style={{ background: VEH_THEMES[vid].dot }} />
                            {vid === "silver" ? t("companion.veh.silver") : t(`companion.form.${vid}.name`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}
          {/* Shimeji 包选择弹窗:点项=激活+切形态;×=删除 */}
          {shimejiPickOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              data-noswipe=""
              role="dialog"
              aria-modal="true"
              aria-label={t("companion.pick.shimeji.title")}
              onClick={() => setShimejiPickOpen(false)}
            >
              <div
                className="relative w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-surface-0 border border-[var(--border)] shadow-elevated p-4"
                data-testid="shimeji-pack-list"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-body font-medium text-ink-strong mb-3">{t("companion.pick.shimeji.title")}</div>
                <div className="min-h-0 overflow-y-auto">
                {shimejiPacks.length === 0 ? (
                  <p className="text-label text-ink-muted py-4 text-center">{t("companion.pick.empty.shimeji")}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {shimejiPacks.map((p) => (
                      <div key={p.id} className="relative">
                        <button
                          type="button"
                          data-testid={`shimeji-pack-option-${p.id}`}
                          onClick={() => { void pickShimejiPack(p.id); setShimejiPickOpen(false); }}
                          className={`w-full flex items-center gap-2.5 rounded-xl border p-2 text-left motion-safe:transition-colors
                            ${p.active && snap.form === "shimeji" ? "border-[var(--accent)] bg-surface-2" : "border-[var(--border-faint)] hover:bg-surface-2"}`}
                        >
                          {p.iconBase64 ? (
                            <img src={`data:image/png;base64,${p.iconBase64}`} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface-2" />
                          ) : (
                            <span className="w-10 h-10 rounded-lg bg-surface-2 inline-block" />
                          )}
                          <span className="flex flex-col flex-1 min-w-0">
                            <span className="text-body text-ink-strong truncate">{p.name}</span>
                            <span className="text-caption text-ink-muted">{p.format} · {p.frameCount}f · {p.actionCount}</span>
                          </span>
                          {p.active && snap.form === "shimeji" && (
                            <span className="text-caption text-brand font-medium">{t("settings.shimeji.active")}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={t("companion.bots.veh")}
                          data-tooltip={t("companion.bots.veh")}
                          data-testid={`shimeji-pack-veh-${p.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShimejiVehPicker((cur) => (cur === p.id ? null : p.id));
                          }}
                          className="absolute top-1.5 -left-1.5 w-5 h-5 rounded-full border border-black/25 shadow-card hover:scale-110 motion-safe:transition-transform"
                          style={{ background: VEH_THEMES[p.vehicle ?? "silver"].dot }}
                        />
                        <button
                          type="button"
                          aria-label={t("settings.shimeji.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingShimeji({ id: p.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-ink-faint hover:text-warning"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {shimejiVehPicker && (
                  <div className="mt-2.5 rounded-xl border border-[var(--border-faint)] bg-surface-0 p-2.5" data-testid="shimeji-veh-picker">
                    <div className="text-caption text-ink-muted mb-1.5">{t("companion.wizard.vehicle")}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("companion.wizard.vehicle")}>
                      {(["silver", ...VEH_PICKABLE] as CompanionVehicleId[]).map((vid) => {
                        const sel = (shimejiPacks.find((q) => q.id === shimejiVehPicker)?.vehicle ?? "silver") === vid;
                        return (
                          <button
                            key={vid}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            data-testid={`shimeji-veh-pick-${vid}`}
                            onClick={() => void setShimejiVehicle(shimejiVehPicker, vid)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-label motion-safe:transition-colors
                              ${sel
                                ? "border-[var(--accent)] bg-surface-2 text-ink-strong font-medium"
                                : "border-[var(--border-faint)] hover:bg-surface-2 text-ink-muted"}`}
                          >
                            <span aria-hidden="true" className="w-3 h-3 rounded-full border border-black/20" style={{ background: VEH_THEMES[vid].dot }} />
                            {vid === "silver" ? t("companion.veh.silver") : t(`companion.form.${vid}.name`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}
          {createOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              data-noswipe=""
              role="dialog"
              aria-modal="true"
              aria-label={t("companion.create.title")}
              onClick={() => setCreateOpen(false)}
            >
              <div
                className="relative w-full max-w-md rounded-2xl bg-surface-0 border border-[var(--border)] shadow-elevated p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-body font-medium text-ink-strong mb-3">{t("companion.create.title")}</div>
                <div className="grid grid-cols-2 gap-2.5">
                  {([
                    { key: "self" as const, testid: "companion-create-self", name: t("companion.create.self.name"), hover: t("companion.create.self.hover"), open: () => { setCreateOpen(false); setWizardOpen(true); } },
                    { key: "shimeji" as const, testid: "companion-create-shimeji", name: t("companion.create.shimeji.name"), hover: t("companion.create.shimeji.hover"), open: () => { setCreateOpen(false); setShimejiImportOpen(true); } },
                  ]).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={opt.testid}
                      onMouseEnter={() => setCreateHover(opt.key)}
                      onMouseLeave={() => setCreateHover((cur) => (cur === opt.key ? null : cur))}
                      onFocus={() => setCreateHover(opt.key)}
                      onBlur={() => setCreateHover((cur) => (cur === opt.key ? null : cur))}
                      onClick={opt.open}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-4 motion-safe:transition-colors
                        ${createHover === opt.key
                          ? "border-[var(--accent)] bg-surface-2 shadow-card"
                          : "border-[var(--border-faint)] hover:bg-surface-2"}`}
                    >
                      <span className="text-body font-medium text-ink-strong">{opt.name}</span>
                      {/* 悬停介绍两者区别(2026-09-12 用户拍板):hover/focus 展开描述 */}
                      <span className={`text-caption text-ink-muted text-center leading-snug ${createHover === opt.key ? "" : "opacity-0 h-0 overflow-hidden"} motion-safe:transition-all`}>
                        {opt.hover}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-caption text-ink-faint mt-3 text-center">{t("companion.create.hint")}</p>
              </div>
            </div>
          )}
          {shimejiImportOpen && (
            <ShimejiImportDialog
              onClose={() => setShimejiImportOpen(false)}
              onImported={async () => { await loadShimejiPacks(); }}
            />
          )}
          {confirmingShimeji && (
            <ConfirmCard
              anchorRect={confirmingShimeji.rect}
              message={t("settings.shimeji.deleteConfirm", { name: shimejiPacks.find((p) => p.id === confirmingShimeji.id)?.name ?? "" })}
              danger
              testid="shimeji-delete-confirm"
              onConfirm={() => void removeShimejiPack(confirmingShimeji.id)}
              onCancel={() => setConfirmingShimeji(null)}
            />
          )}
          {wizardOpen && (
            <CompanionBotWizard
              onClose={() => setWizardOpen(false)}
              onSaved={() => {
                setWizardOpen(false);
                void loadPacks();
              }}
            />
          )}
        </div>
        </>
      )}
    </div>
  );
}

/* ---------- v0.15 语音模型:朗读(Edge/本地/自定义) + 听写(本地/自定义) ----------
 * 与主模型区同范式:内置选项 + 自定义 provider 逃生舱(CustomProviderForm)。
 * 引擎值 = 内置 id 或 custom-<id>(active_provider 式);azure/groq 为旧库遗留,
 * 后端仍解析,UI 只显示"(旧配置,仍生效)"禁用项,不再提供新入口。
 * 模型管理融入上下文:kokoro 行在 朗读·本地离线 下方;所选 Whisper 行在
 * 听写·本地离线 下方(独立"模型管理"列表已取消)。 */

interface SpeechModelRow {
  id: string;
  state: string;
  progress: number;
  totalBytes: number;
}

/** Edge 音色表(ShortName);本地档用 kokoro sid,自定义档音色是自由文本 */
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

  // v0.15 引擎值:内置 id("edge"/"local")或 "custom-<id>";旧库可能残留 azure
  // v0.18 增 "system"(浏览器/系统 speechSynthesis,渲染层管线)
  const [engine, setEngine] = useState<string>("edge");
  const [voiceEdge, setVoiceEdge] = useState("zh-CN-XiaoxiaoNeural");
  const [sidLocal, setSidLocal] = useState("48");
  const [speed, setSpeed] = useState("1.0");
  const [customVoice, setCustomVoice] = useState("");
  const [systemVoice, setSystemVoice] = useState("");
  const [systemVoices, setSystemVoices] = useState<SystemVoiceOption[]>([]);
  const systemTtsAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  // 听写:"local" 或 "custom-<id>";旧库可能残留 groq/azure
  const [asrEngine, setAsrEngine] = useState<string>("local");
  const [asrLocalModel, setAsrLocalModel] = useState("asr-whisper-turbo");
  const [asrAutoStop, setAsrAutoStop] = useState(true);

  // 自定义 provider(tts/asr 分区)+ 展开块/表单/测试态
  const [customs, setCustoms] = useState<CustomProvider[]>([]);
  const [ttsExpanded, setTtsExpanded] = useState(false);
  const [asrExpanded, setAsrExpanded] = useState(false);
  const [showTtsForm, setShowTtsForm] = useState(false);
  const [showAsrForm, setShowAsrForm] = useState(false);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [ttsTestResult, setTtsTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [asrTesting, setAsrTesting] = useState(false);
  const [asrTestResult, setAsrTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [confirmDelCustom, setConfirmDelCustom] = useState<string | null>(null);

  const refreshCustoms = useCallback(() => {
    void api
      .listCustomProviders()
      .then((all) => setCustoms(all.filter((c) => c.kind === "tts" || c.kind === "asr")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void Promise.all([
      api.getSetting("tts_engine"),
      api.getSetting("tts_voice_edge"),
      api.getSetting("tts_sid_local"),
      api.getSetting("tts_speed"),
      api.getSetting("tts_custom_voice"),
      api.getSetting("tts_system_voice"),
      api.getSetting("asr_engine"),
      api.getSetting("asr_local_model"),
      api.getSetting("asr_auto_stop"),
    ]).then(([e, ve, sid, sp, cv, sv, ae, alm, autoStopRaw]) => {
      if (e) setEngine(e);
      if (ve) setVoiceEdge(ve);
      if (sid) setSidLocal(sid);
      if (sp) setSpeed(sp);
      if (cv) setCustomVoice(cv);
      if (sv) setSystemVoice(sv);
      if (ae) setAsrEngine(ae);
      if (alm === "asr-whisper-turbo" || alm === "asr-whisper-small") setAsrLocalModel(alm);
      setAsrAutoStop(autoStopRaw !== "0");
    });
    refreshCustoms();
  }, [refreshCustoms]);

  // system 档音色表(getVoices 异步,voiceschanged 后重拉;中文优先排序)
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => setSystemVoices(sortVoicesZhFirst(window.speechSynthesis.getVoices()));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

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
        : t("settings.speech.model.asr_small");
  /** 模型下拉里的紧凑名(完整名留给管理行,防手机端 select 被长选项撑爆) */
  const shortLabel = (id: string) =>
    id === "asr-whisper-turbo" ? t("settings.speech.model.turbo_short") : t("settings.speech.model.small_short");
  const licenseOf = (id: string) =>
    id.startsWith("asr-whisper") ? t("settings.speech.license_mit") : t("settings.speech.license");
  const stateLabel = (state: string) =>
    state === "ready" ? t("settings.speech.state.ready") : state === "error" ? t("settings.speech.state.error") : t("settings.speech.state.absent");
  const rowState = (id: string) => rows.find((m) => m.id === id)?.state ?? "absent";

  const saveEngine = (next: string) => {
    setEngine(next);
    setTtsTestResult(null);
    void api.setSetting("tts_engine", next);
    notifyTtsSettingsChanged();
  };
  const saveSystemVoice = (next: string) => {
    setSystemVoice(next);
    void api.setSetting("tts_system_voice", next);
    notifyTtsSettingsChanged();
  };
  const saveAsrEngine = (next: string) => {
    setAsrEngine(next);
    setAsrTestResult(null);
    void api.setSetting("asr_engine", next);
  };

  const ttsCustoms = customs.filter((c) => c.kind === "tts");
  const asrCustoms = customs.filter((c) => c.kind === "asr");
  const activeTtsCustom = engine.startsWith("custom-") ? ttsCustoms.find((c) => c.id === engine) ?? null : null;
  const activeAsrCustom = asrEngine.startsWith("custom-") ? asrCustoms.find((c) => c.id === asrEngine) ?? null : null;
  const ttsLegacy = engine === "azure";
  const asrLegacyGroq = asrEngine === "groq";
  const asrLegacyAzure = asrEngine === "azure";

  const testTtsCustom = async () => {
    if (!activeTtsCustom || ttsTesting) return;
    setTtsTesting(true);
    setTtsTestResult(null);
    try {
      setTtsTestResult(await api.testCustomTts({ providerId: activeTtsCustom.id }));
    } catch (e) {
      setTtsTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTtsTesting(false);
    }
  };
  const testAsrCustom = async () => {
    if (!activeAsrCustom || asrTesting) return;
    setAsrTesting(true);
    setAsrTestResult(null);
    try {
      setAsrTestResult(await api.testCustomAsr({ providerId: activeAsrCustom.id }));
    } catch (e) {
      setAsrTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setAsrTesting(false);
    }
  };

  /** 删自定义 provider:若正被用,回落内置档(朗读=edge,听写=local) */
  const deleteCustom = async (id: string, which: "tts" | "asr") => {
    setConfirmDelCustom(null);
    try {
      await api.deleteCustomProvider(id);
      if (which === "tts" && engine === id) saveEngine("edge");
      if (which === "asr" && asrEngine === id) saveAsrEngine("local");
      refreshCustoms();
    } catch {
      /* 忽略 */
    }
  };

  /** 模型管理行(下载/进度/两步删除),嵌入所选档位下方 */
  const modelRow = (id: string) => {
    const m = rows.find((r) => r.id === id);
    const state = m?.state ?? "absent";
    return (
      <div key={id} className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-label font-medium text-ink-strong truncate">{labelOf(id)}</div>
          <div className="text-caption text-ink-muted">
            {stateLabel(state)} · {licenseOf(id)}
          </div>
          {busy === id && prog?.id === id && (
            <div className="mt-1.5 h-1.5 rounded-full bg-ink/[0.08] overflow-hidden" data-testid={`speech-dl-bar-${id}`}>
              <div className="h-full bg-brand transition-all" style={{ width: `${prog.pct}%` }} />
            </div>
          )}
          {busy === id && prog?.id === id && (
            <div className="text-caption text-ink-faint mt-0.5" data-testid={`speech-dl-pct-${id}`}>
              {prog.pct}%{prog.label ? ` · ${prog.label}` : ""}
            </div>
          )}
        </div>
        {state === "ready" ? (
          confirmDelete === id ? (
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-warning">{t("settings.speech.confirm_del")}</span>
              <button onClick={() => remove(id)} className="text-label text-warning hover:underline" data-testid={`speech-del-confirm-${id}`}>
                {t("settings.speech.delete")}
              </button>
              <button onClick={() => setConfirmDelete(null)} className="text-label text-ink-muted hover:text-ink-strong">
                {t("action.cancel")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(id)}
              disabled={busy === id}
              className="text-label text-ink-muted hover:text-warning disabled:opacity-40"
              data-testid={`speech-del-${id}`}
            >
              {t("settings.speech.delete")}
            </button>
          )
        ) : (
          <button
            onClick={() => download(id)}
            disabled={busy != null || state === "downloading"}
            className="btn-3d-brand px-3 py-1 text-label disabled:opacity-40"
            data-testid={`speech-dl-${id}`}
          >
            {busy === id || state === "downloading" ? t("settings.speech.downloading") : t("settings.speech.download")}
          </button>
        )}
      </div>
    );
  };

  /** 已启用自定义 provider 的摘要行(名字/模型/端点 + 测试/删除) */
  const customSummary = (
    c: CustomProvider,
    which: "tts" | "asr",
    testing: boolean,
    result: { ok: boolean; detail: string } | null,
    onTest: () => void,
  ) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-label">
        <Wrench className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden="true" />
        <span className="font-medium text-ink-strong">{c.label}</span>
        <code className="text-ink-faint font-mono break-all">{c.defaultModel}</code>
        <span className="text-ink-faint break-all min-w-0">{c.baseUrl}</span>
        {c.hasApiKey && (
          <span className="text-brand shrink-0 inline-flex items-center gap-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t("settings.speech.key_saved")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void onTest()} disabled={testing} className="btn-3d-neutral px-3 py-1 text-label disabled:opacity-40" data-testid={`${which}-custom-test`}>
          {testing ? t("settings.testing") : t("settings.test")}
        </button>
        {confirmDelCustom === c.id ? (
          <>
            <span className="text-caption text-warning">{t("settings.speech.confirm_del_custom")}</span>
            <button onClick={() => void deleteCustom(c.id, which)} className="text-label text-warning hover:underline" data-testid={`${which}-custom-del-confirm`}>
              {t("settings.speech.delete")}
            </button>
            <button onClick={() => setConfirmDelCustom(null)} className="text-label text-ink-muted hover:text-ink-strong">
              {t("action.cancel")}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmDelCustom(c.id)} className="text-label text-ink-muted hover:text-warning" data-testid={`${which}-custom-del`}>
            {t("settings.speech.delete")}
          </button>
        )}
        {result && (
          <span className={`text-label inline-flex items-center gap-1 ${result.ok ? "text-brand" : "text-warning"}`}>
            {result.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <XCircle className="w-4 h-4" aria-hidden="true" />}
            {result.detail}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div data-testid="settings-speech">
      {/* ===== 朗读:按钮组(Edge 在线 / 本地离线 / 自定义) ===== */}
      <div className={rowCls(false)}>
        <div className="text-label font-medium text-ink-strong mb-2">{t("settings.speech.tts_title")}</div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              saveEngine("edge");
              setTtsExpanded(false);
              setShowTtsForm(false);
            }}
            data-testid="tts-engine-edge"
            aria-pressed={engine === "edge"}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${engine === "edge" ? pillActiveCls : pillInactiveCls}`}
          >
            {t("settings.speech.engine.edge")}
          </button>
          <button
            onClick={() => {
              saveEngine("local");
              setTtsExpanded(false);
              setShowTtsForm(false);
            }}
            data-testid="tts-engine-local"
            aria-pressed={engine === "local"}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${engine === "local" ? pillActiveCls : pillInactiveCls}`}
          >
            {t("settings.speech.engine.local")}
            {rowState("tts-kokoro") !== "ready" ? ` · ${t("settings.speech.state.absent")}` : ""}
          </button>
          <button
            onClick={() => {
              saveEngine("system");
              setTtsExpanded(false);
              setShowTtsForm(false);
            }}
            disabled={!systemTtsAvailable}
            data-testid="tts-engine-system"
            aria-pressed={engine === "system"}
            title={systemTtsAvailable ? undefined : t("settings.speech.engine.system_unavailable")}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${
              engine === "system" ? pillActiveCls : pillInactiveCls
            } ${systemTtsAvailable ? "" : "opacity-40 cursor-not-allowed"}`}
          >
            {t("settings.speech.engine.system")}
          </button>
          <button
            onClick={() => {
              setTtsExpanded((s) => !s);
              if (!ttsExpanded) setShowTtsForm(false);
            }}
            data-testid="tts-engine-custom"
            aria-pressed={engine.startsWith("custom-") || ttsExpanded}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${
              engine.startsWith("custom-") || ttsExpanded ? pillActiveCls : pillInactiveCls
            }`}
          >
            {t("settings.speech.engine.custom")}
          </button>
          {ttsLegacy && (
            <button
              disabled
              data-testid="tts-engine-azure"
              className="px-4 py-2 rounded-xl text-body font-bold opacity-50 cursor-not-allowed"
            >
              Azure · {t("settings.speech.legacy")}
            </button>
          )}
        </div>
        {engine === "edge" && <p className="text-label text-ink-muted mt-2">{t("settings.speech.engine.edge_note")}</p>}
      </div>

      {engine === "edge" && (
        <div className={rowCls(false)}>
          <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.speech.voice")}</div>
          <select
            value={voiceEdge}
            onChange={(e) => {
              setVoiceEdge(e.target.value);
              void api.setSetting("tts_voice_edge", e.target.value);
            }}
            data-testid="tts-voice-select"
            className={`${fieldCls} w-full min-w-0 px-2.5 py-1.5`}
          >
            {TTS_VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      )}

      {engine === "local" && (
        <>
          <div className={rowCls(false)}>
            <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.speech.voice")}</div>
            <select
              value={sidLocal}
              onChange={(e) => {
                setSidLocal(e.target.value);
                void api.setSetting("tts_sid_local", e.target.value);
              }}
              data-testid="tts-sid-select"
              className={`${fieldCls} w-full min-w-0 px-2.5 py-1.5`}
            >
              {TTS_LOCAL_SID_OPTIONS.map((v) => (
                <option key={v.sid} value={v.sid}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className={rowCls(false)}>{modelRow("tts-kokoro")}</div>
        </>
      )}

      {/* system 档:音色随设备引擎(中文优先列出);"自动"=pickSystemVoice 挑中文 */}
      {engine === "system" && (
        <>
          <div className={rowCls(false)}>
            <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.speech.voice")}</div>
            <select
              value={systemVoice}
              onChange={(e) => saveSystemVoice(e.target.value)}
              data-testid="tts-system-voice-select"
              className={`${fieldCls} w-full min-w-0 px-2.5 py-1.5`}
            >
              <option value="">{t("settings.speech.voice_auto")}</option>
              {systemVoices.map((v) => (
                <option key={v.voiceURI} value={v.name}>{systemVoiceLabel(v)}</option>
              ))}
            </select>
            <p className="text-label text-ink-muted mt-2">{t("settings.speech.engine.system_note")}</p>
          </div>
        </>
      )}

      {/* 朗读·自定义展开块:摘要/选用已有/新建 */}
      {ttsExpanded && (
        <div className={rowCls(false)}>
          <div className="space-y-3">
            {activeTtsCustom && customSummary(activeTtsCustom, "tts", ttsTesting, ttsTestResult, testTtsCustom)}
            {activeTtsCustom && (
              <div>
                <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.speech.voice")}</div>
                <input
                  type="text"
                  value={customVoice}
                  onChange={(e) => setCustomVoice(e.target.value)}
                  onBlur={() => void api.setSetting("tts_custom_voice", customVoice.trim())}
                  placeholder={t("settings.speech.custom_voice_ph")}
                  data-testid="tts-custom-voice"
                  className={`${fieldCls} w-full min-w-0 px-2.5 py-1.5 font-mono`}
                />
              </div>
            )}
            {!activeTtsCustom &&
              ttsCustoms.map((c) => (
                <button
                  key={c.id}
                  onClick={() => saveEngine(c.id)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 transition-colors"
                  data-testid={`tts-pick-${c.id}`}
                >
                  <span className="text-label font-medium text-ink-strong">{c.label}</span>
                  <span className="text-label text-ink-faint font-mono break-all ml-2">{c.defaultModel}</span>
                </button>
              ))}
            {(showTtsForm || (!activeTtsCustom && ttsCustoms.length === 0)) && (
              <CustomProviderForm
                kind="tts"
                showProtocol={false}
                testPrefix="tts-custom"
                titleKey="settings.custom.form_title_tts"
                modelPhKey="settings.custom.model_ph_tts"
                testOverride={(i) => api.testCustomTts({ baseUrl: i.baseUrl, apiKey: i.apiKey || undefined, model: i.model })}
                onSaved={(p) => {
                  saveEngine(p.id);
                  setShowTtsForm(false);
                  refreshCustoms();
                }}
                onCancel={() => setShowTtsForm(false)}
              />
            )}
            {(activeTtsCustom || ttsCustoms.length > 0) && (
              <button onClick={() => setShowTtsForm((s) => !s)} className="text-label text-accent hover:underline">
                {showTtsForm ? t("action.cancel") : t("settings.custom.new")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className={rowCls(true)}>
        <div className="flex items-center gap-2">
          <span className="text-label font-medium text-ink-strong shrink-0 w-14">{t("settings.speech.speed")}</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            onPointerUp={() => {
              void api.setSetting("tts_speed", speed);
              notifyTtsSettingsChanged();
            }}
            onKeyUp={() => {
              void api.setSetting("tts_speed", speed);
              notifyTtsSettingsChanged();
            }}
            data-testid="tts-speed-range"
            className="flex-1 min-w-0 accent-[var(--brand)]"
          />
          <span className="text-label text-ink-muted tabular-nums w-10 text-right" data-testid="tts-speed-value">
            {Number(speed).toFixed(2)}x
          </span>
        </div>
      </div>

      {/* ===== 听写:按钮组(本地离线 / 自定义) ===== */}
      <div className={rowCls(true)}>
        <div className="text-label font-medium text-ink-strong mb-2">{t("settings.speech.asr_title")}</div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              saveAsrEngine("local");
              setAsrExpanded(false);
              setShowAsrForm(false);
            }}
            data-testid="asr-engine-local"
            aria-pressed={asrEngine === "local"}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${asrEngine === "local" ? pillActiveCls : pillInactiveCls}`}
          >
            {t("settings.speech.asr_engine.local")}
          </button>
          <button
            onClick={() => {
              setAsrExpanded((s) => !s);
              if (!asrExpanded) setShowAsrForm(false);
            }}
            data-testid="asr-engine-custom"
            aria-pressed={asrEngine.startsWith("custom-") || asrExpanded}
            className={`px-4 py-2 rounded-xl text-body font-bold transition-all ${
              asrEngine.startsWith("custom-") || asrExpanded ? pillActiveCls : pillInactiveCls
            }`}
          >
            {t("settings.speech.engine.custom")}
          </button>
          {asrLegacyGroq && (
            <button
              disabled
              data-testid="asr-engine-groq"
              className="px-4 py-2 rounded-xl text-body font-bold opacity-50 cursor-not-allowed"
            >
              Groq · {t("settings.speech.legacy")}
            </button>
          )}
          {asrLegacyAzure && (
            <button
              disabled
              data-testid="asr-engine-azure"
              className="px-4 py-2 rounded-xl text-body font-bold opacity-50 cursor-not-allowed"
            >
              Azure · {t("settings.speech.legacy")}
            </button>
          )}
        </div>
        {asrEngine === "local" ? (
          <p className="text-label text-ink-muted mt-2">{t("settings.speech.asr_engine.local_note")}</p>
        ) : (
          asrEngine.startsWith("custom-") && (
            <p className="text-label text-ink-muted mt-2">{t("settings.speech.asr_engine.custom_note")}</p>
          )
        )}
      </div>

      {asrEngine === "local" && (
        <>
          <div className={rowCls(false)}>
            <div className="text-label font-medium text-ink-strong mb-1.5">{t("settings.model")}</div>
            <select
              value={asrLocalModel}
              onChange={(e) => {
                setAsrLocalModel(e.target.value);
                void api.setSetting("asr_local_model", e.target.value);
              }}
              data-testid="asr-model-select"
              className={`${fieldCls} w-full min-w-0 px-2.5 py-1.5`}
            >
              {(["asr-whisper-turbo", "asr-whisper-small"] as const).map((id) => (
                <option key={id} value={id}>
                  {shortLabel(id)} · {stateLabel(rowState(id))}
                </option>
              ))}
            </select>
          </div>
          <div className={rowCls(false)}>{modelRow(asrLocalModel)}</div>
        </>
      )}

      {/* 听写·自定义展开块 */}
      {asrExpanded && (
        <div className={rowCls(false)}>
          <div className="space-y-3">
            {activeAsrCustom && customSummary(activeAsrCustom, "asr", asrTesting, asrTestResult, testAsrCustom)}
            {!activeAsrCustom &&
              asrCustoms.map((c) => (
                <button
                  key={c.id}
                  onClick={() => saveAsrEngine(c.id)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-surface-1 hover:bg-surface-3 transition-colors"
                  data-testid={`asr-pick-${c.id}`}
                >
                  <span className="text-label font-medium text-ink-strong">{c.label}</span>
                  <span className="text-label text-ink-faint font-mono break-all ml-2">{c.defaultModel}</span>
                </button>
              ))}
            {(showAsrForm || (!activeAsrCustom && asrCustoms.length === 0)) && (
              <CustomProviderForm
                kind="asr"
                showProtocol={false}
                testPrefix="asr-custom"
                titleKey="settings.custom.form_title_asr"
                modelPhKey="settings.custom.model_ph_asr"
                testOverride={(i) => api.testCustomAsr({ baseUrl: i.baseUrl, apiKey: i.apiKey || undefined, model: i.model })}
                onSaved={(p) => {
                  saveAsrEngine(p.id);
                  setShowAsrForm(false);
                  refreshCustoms();
                }}
                onCancel={() => setShowAsrForm(false)}
              />
            )}
            {(activeAsrCustom || asrCustoms.length > 0) && (
              <button onClick={() => setShowAsrForm((s) => !s)} className="text-label text-accent hover:underline">
                {showAsrForm ? t("action.cancel") : t("settings.custom.new")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 听写 UX:静音自动停(v0.14 飞书式复查浮层,auto-send 已废) */}
      <div className={rowCls(true)}>
        <div className="flex items-center gap-3">
          <Toggle
            checked={asrAutoStop}
            onChange={() => {
              const next = !asrAutoStop;
              setAsrAutoStop(next);
              void api.setSetting("asr_auto_stop", next ? "1" : "0");
            }}
            label={t("settings.speech.asr_auto_stop")}
            testid="asr-auto-stop-toggle"
          />
          <div className="text-body font-medium text-ink-strong">{t("settings.speech.asr_auto_stop")}</div>
        </div>
        <p className="text-label text-ink-muted mt-2">{t("settings.speech.asr_ux_note")}</p>
      </div>

      {err && (
        <div className="px-4 py-3 text-label text-warning break-all" role="alert">
          {err === "engine-unavailable" ? t("chat.speech.engine_unavailable") : err}
        </div>
      )}
    </div>
  );
}

/** dsh 插件进度迁移:自动探测(桌面一键)+ 文件上传(全平台同路,含 web/手机)。
 *  导入语义见 dsh-import-service(幂等/自动备份/同结构课程直写);成功后
 *  import:done 事件驱动课程列表刷新,抽屉里即时给结果摘要。 */
function DshImportContent() {
  const t = useLang();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [detect, setDetect] = useState<{ found: boolean; path: string | null; version: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DshImportSummary | null>(null);

  useEffect(() => {
    api.dshImportDetect().then(setDetect).catch(() => setDetect({ found: false, path: null, version: null }));
  }, []);

  const run = (p: Promise<DshImportSummary>) => {
    setBusy(true);
    setResult(null);
    p.then(setResult)
      .catch((e: unknown) => setResult({ ok: false, error: String(e) } as DshImportSummary))
      .finally(() => setBusy(false));
  };

  return (
    <div className="p-4 space-y-3" data-testid="settings-dsh-import">
      <div className="text-label font-medium text-ink-strong">{t("settings.dsh.title")}</div>
      <p className="text-label text-ink-muted leading-relaxed">{t("settings.dsh.desc")}</p>

      {detect == null ? null : detect.found ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="settings-dsh-detected">
          <span className="text-label text-ink-strong">
            {t("settings.dsh.detectFound", { v: detect.version ?? "?" })}
          </span>
          <button
            onClick={() => run(api.dshImportFromPath(detect.path ?? ""))}
            disabled={busy}
            data-testid="settings-dsh-import-btn"
            className="px-3 py-1.5 rounded-xl text-label font-bold btn-3d-brand disabled:opacity-50"
          >
            {busy ? t("settings.dsh.importing") : t("settings.dsh.import")}
          </button>
        </div>
      ) : (
        <div className="text-label text-ink-muted" data-testid="settings-dsh-none">
          {t("settings.dsh.detectNone")}
        </div>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-testid="settings-dsh-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then((text) => run(api.dshImportFromText(text)));
            e.target.value = ""; // 同文件可重复选择(失败重试)
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-3 py-1.5 rounded-xl text-label font-bold btn-3d-neutral disabled:opacity-50"
        >
          {t("settings.dsh.pickFile")}
        </button>
      </div>

      {busy && !result ? <div className="text-label text-ink-muted">{t("settings.dsh.importing")}</div> : null}

      {result?.ok ? (
        <div
          className="text-label text-brand leading-relaxed break-all"
          role="status"
          data-testid="settings-dsh-result"
        >
          {t("settings.dsh.done", {
            courses: result.coursesCreated + result.coursesMapped + result.coursesRefreshed,
            nodes: result.nodes,
            progress: result.progressRows,
            srs: result.srsRows,
            xp: result.xpDelta,
          })}
          {result.skippedCourses.length > 0 ? ` · ${t("settings.dsh.skipped", { n: result.skippedCourses.length })}` : ""}
        </div>
      ) : result ? (
        <div className="text-label text-warning break-all" role="alert" data-testid="settings-dsh-error">
          {t("settings.dsh.failed")}: {result.error ?? "unknown"}
        </div>
      ) : null}
    </div>
  );
}
