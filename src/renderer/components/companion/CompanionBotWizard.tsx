/**
 * CompanionBotWizard —— 新建纸偶向导(设置页形象栏「+」卡点开,2026-09-11)。
 *
 * 三步:①准备角色原图(不上传给 LookatStudy);②去免费生成站:一键复制
 * 管线优化的 chibi Prompt + 豆包/即梦直达;③导入生成图 → cutFromImage 切分
 * 预览 → 命名保存(applyPack + companion_form=custom,新卡片即出现在形象栏)。
 *
 * 复制实现:优先 navigator.clipboard(Electron 里可能因 clipboard-sanitized
 * 权限被拒),失败回退 execCommand(textarea + 用户手势)——实测必成路径。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

import type { CutPackManifest, CompanionVehicleId } from "@shared/companion-cut.ts";

import { useLang } from "../../lib/i18n.js";
import { refreshActivePack } from "../../lib/companion/custom-pack-store.js";
import { VEH_PICKABLE, VEH_THEMES } from "../../lib/companion/veh-themes.ts";
import { useFocusTrap } from "../../lib/useFocusTrap.js";

interface CutPreview {
  route: string;
  failure?: string;
  visionError?: string;
  manifest: CutPackManifest;
  parts: Array<{ name: string; file: string; box: { x: number; y: number; w: number; h: number }; pngBase64: string }>;
}

const ROUTE_KEY: Record<string, string> = {
  vision: "companion.custom.routeVision",
  geometric: "companion.custom.routeGeometric",
  l1: "companion.custom.routeL1",
};

/** 大文件分块转 base64(避免 String.fromCharCode 爆栈)。 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** 剪贴板双路径:clipboard API → execCommand 兜底(Electron 权限拒也必成)。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* 落 execCommand */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function CompanionBotWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useLang();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<CutPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  // 载具主题(2026-09-11):五款对应五形态设计语言,存 manifest.vehicle 随包持久化
  const [vehicle, setVehicle] = useState<CompanionVehicleId>("ember");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // 识图调用实测 ~7s:秒表让"在工作"可见
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const iv = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(iv);
  }, [busy]);

  const copyPrompt = async () => {
    const ok = await copyText(t("companion.wizard.prompt"));
    setCopied(ok);
    if (ok) {
      setTimeout(() => setCopied(false), 2400);
    } else {
      setMsg(t("companion.wizard.copyFail"));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setPreview(null);
    setFileName(file.name.replace(/\.png$/i, ""));
    try {
      const pngBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const out = (await window.api.companionPackCutFromImage({ pngBase64 })) as CutPreview;
      setPreview(out);
      if (out.visionError) setMsg(`${t("companion.custom.visionFallback")} · ${out.visionError}`);
      else setMsg(`${t("companion.custom.cutDone")} · ${t(ROUTE_KEY[out.route] ?? "companion.custom.routeL1")}`);
    } catch (e) {
      setMsg(`${t("companion.custom.fail")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await window.api.companionPackApplyPack({
        name: name.trim() || fileName || "My Bot",
        manifest: { ...preview.manifest, vehicle },
        parts: preview.parts.map((p) => ({ name: p.name, pngBase64: p.pngBase64 })),
      });
      await refreshActivePack();
      await window.api.setSetting("companion_form", "custom");
      window.dispatchEvent(new Event("companion-config-changed"));
      onSaved();
    } catch (e) {
      setMsg(`${t("companion.custom.fail")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      data-noswipe=""
      role="dialog"
      aria-modal="true"
      aria-label={t("companion.wizard.title")}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[86vh] overflow-y-auto rounded-2xl bg-surface-1 shadow-pop p-4"
        data-testid="companion-wizard"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-body font-bold text-ink-strong">{t("companion.wizard.title")}</h3>
          <button
            onClick={onClose}
            aria-label={t("action.close")}
            className="text-ink-muted hover:text-ink-strong w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 步骤 1:原图指引 */}
        <div className="rounded-xl border border-[var(--border-faint)] p-3 mb-2">
          <div className="text-label font-medium text-ink-strong mb-1">{t("companion.wizard.s1")}</div>
          <p className="text-caption text-ink-muted leading-relaxed">{t("companion.wizard.s1body")}</p>
        </div>

        {/* 步骤 2:生成站 + Prompt */}
        <div className="rounded-xl border border-[var(--border-faint)] p-3 mb-2">
          <div className="text-label font-medium text-ink-strong mb-1">{t("companion.wizard.s2")}</div>
          <p className="text-caption text-ink-muted leading-relaxed mb-2">{t("companion.wizard.s2body")}</p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {/* 站点直达三兄弟同款样式,只有一键复制是蓝色(accent) */}
            <a
              href="https://www.doubao.com/chat/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label hover:bg-surface-2"
            >
              {t("companion.wizard.s2doubao")}
            </a>
            <a
              href="https://jimeng.jianying.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label hover:bg-surface-2"
            >
              {t("companion.wizard.s2jimeng")}
            </a>
            <a
              href="https://chatgpt.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label hover:bg-surface-2"
            >
              {t("companion.wizard.s2chatgpt")}
            </a>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              data-testid="companion-wizard-copy"
              className="rounded-lg bg-accent px-3 py-1.5 text-label text-white hover:opacity-90"
            >
              {copied ? t("companion.wizard.copied") : t("companion.wizard.copy")}
            </button>
          </div>
          <textarea
            readOnly
            value={t("companion.wizard.prompt")}
            rows={6}
            className="w-full rounded-lg bg-surface-2 border border-[var(--border-faint)] p-2 text-caption text-ink-muted font-mono resize-y select-all"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        {/* 步骤 3:载具 + 导入 + 命名 + 保存 */}
        <div className="rounded-xl border border-[var(--border-faint)] p-3">
          <div className="text-label font-medium text-ink-strong mb-1">{t("companion.wizard.s3")}</div>
          {/* 载具选择:五款对应五形态,色点即载具主色;选中=accent 描边 */}
          <div className="mb-2">
            <div className="text-caption text-ink-muted mb-1">{t("companion.wizard.vehicle")}</div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("companion.wizard.vehicle")}>
              {VEH_PICKABLE.map((id) => {
                const selected = vehicle === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`companion-wizard-veh-${id}`}
                    onClick={() => setVehicle(id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-label motion-safe:transition-colors
                      ${selected
                        ? "border-[var(--accent)] bg-surface-2 text-ink-strong font-medium"
                        : "border-[var(--border-faint)] hover:bg-surface-2 text-ink-muted"}`}
                  >
                    <span
                      aria-hidden="true"
                      className="w-3 h-3 rounded-full border border-black/20"
                      style={{ background: VEH_THEMES[id].dot }}
                    />
                    {t(`companion.form.${id}.name`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              className="hidden"
              data-testid="companion-custom-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              data-testid="companion-wizard-pick"
              className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label hover:bg-surface-2 disabled:opacity-50"
            >
              {t("companion.wizard.pick")}
            </button>
            {busy && (
              <span className="flex items-center gap-1.5 text-label text-ink-muted" data-testid="companion-custom-busy">
                <Loader2 size={14} className="animate-spin" />
                {t(preview ? "companion.custom.applying" : "companion.custom.locating")}
                <span className="tabular-nums">{elapsed}s</span>
              </span>
            )}
            {msg && <span className="text-caption text-ink-muted" data-testid="companion-custom-msg">{msg}</span>}
          </div>
          {preview && (
            <div className="flex flex-wrap items-center gap-2" data-testid="companion-custom-preview">
              {preview.parts.map((p) => (
                <img
                  key={p.name}
                  src={`data:image/png;base64,${p.pngBase64}`}
                  alt={p.name}
                  title={p.name}
                  className="h-14 w-14 object-contain rounded-lg bg-surface-2"
                />
              ))}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("companion.wizard.namePh")}
                data-testid="companion-wizard-name"
                className="rounded-lg border border-[var(--border-faint)] bg-surface-0 px-2.5 py-1.5 text-label text-ink-strong placeholder:text-ink-muted w-36"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                data-testid="companion-custom-apply"
                className="rounded-lg bg-brand px-3 py-1.5 text-label text-white hover:opacity-90 disabled:opacity-50"
              >
                {t("companion.wizard.save")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
