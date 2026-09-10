/**
 * CustomBotsSection —— 设置页「自定义纸偶」区(多 bot,SPEC §16 扩展,2026-09-11)。
 *
 * 卡片网格:每个已保存包一张卡(名字+使用中徽标+使用/删除),末尾一张「+」卡。
 * 点「+」进入制作弹窗(本文件内 CompanionBotWizard),三步:
 *   ① 准备角色原图(不上传给 LookatStudy);
 *   ② 去免费生成站:一键复制管线优化的 chibi Prompt + 豆包/即梦直达;
 *   ③ 导入生成图 → cutFromImage 切分预览 → 命名保存 → 设为激活 + companion_form=custom。
 * 旧的单包「导入立绘 PNG」卡由本区取代(多包存储:包目录本就按内容哈希多实例)。
 * 删除走 ConfirmCard(内联确认,repo 红线:绝不 window.confirm)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";

import { useLang } from "../../lib/i18n.js";
import { refreshActivePack } from "../../lib/companion/custom-pack-store.js";
import { ConfirmCard } from "../ConfirmCard.js";
import { useFocusTrap } from "../../lib/useFocusTrap.js";

interface PackSummary {
  id: string;
  name: string;
  active: boolean;
  route: string;
}

type CutPreview = NonNullable<Awaited<ReturnType<NonNullable<typeof window.api.companionPackCutFromImage>>>>;

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

export function CustomBotsSection() {
  const t = useLang();
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirming, setConfirming] = useState<{ id: string; rect: DOMRect } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await window.api.companionPackList();
      setPacks(res.packs);
    } catch {
      /* 列表读失败保持现状(卡片诚实空) */
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener("companion-config-changed", onChange);
    return () => window.removeEventListener("companion-config-changed", onChange);
  }, [load]);

  const activate = async (id: string) => {
    await window.api.companionPackActivate({ id });
    await refreshActivePack();
    window.dispatchEvent(new Event("companion-config-changed"));
    setMsg(t("companion.bots.useDone"));
    void load();
  };

  const remove = async (id: string) => {
    const r = await window.api.companionPackDelete({ id });
    if (r.formReset) window.dispatchEvent(new Event("companion-config-changed"));
    setMsg(t("companion.custom.deleted"));
    setConfirming(null);
    void load();
  };

  return (
    <div data-testid="companion-custom-card" className="mt-3 rounded-xl border border-[var(--border-faint)] p-3">
      <div className="text-label font-medium text-ink-strong mb-2">{t("companion.bots.title")}</div>
      <div className="flex flex-wrap items-center gap-2">
        {packs.map((p) => (
          <div
            key={p.id}
            data-testid={`companion-bot-pack-${p.id}`}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
              p.active ? "border-[var(--accent)] bg-surface-2" : "border-[var(--border-faint)]"
            }`}
          >
            <span className={`text-label ${p.active ? "text-ink-strong font-medium" : "text-ink-muted"}`}>{p.name}</span>
            {p.active ? (
              <span className="text-caption text-accent">{t("companion.bots.inUse")}</span>
            ) : (
              <button
                type="button"
                onClick={() => void activate(p.id)}
                className="rounded-lg border border-[var(--border-faint)] px-2 py-0.5 text-caption hover:bg-surface-2"
              >
                {t("companion.bots.use")}
              </button>
            )}
            <button
              type="button"
              aria-label={t("companion.custom.delete")}
              data-tooltip={t("companion.custom.delete")}
              onClick={(e) => setConfirming({ id: p.id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
              className="text-ink-muted hover:text-warning w-6 h-6 flex items-center justify-center rounded-lg hover:bg-surface-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {/* + 卡:进入制作弹窗 */}
        <button
          type="button"
          data-testid="companion-bots-add"
          title={t("companion.bots.add")}
          aria-label={t("companion.bots.add")}
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-faint)] px-3 py-1.5 text-label text-ink-muted hover:bg-surface-2 hover:text-ink-strong"
        >
          <Plus className="w-4 h-4" />
          {t("companion.bots.add")}
        </button>
        {msg && <span className="text-caption text-ink-muted" data-testid="companion-custom-msg">{msg}</span>}
      </div>
      {confirming && (
        <ConfirmCard
          anchorRect={confirming.rect}
          message={t("companion.bots.deleteConfirm")}
          danger
          testid="companion-bot-delete-confirm"
          onConfirm={() => void remove(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {wizardOpen && (
        <CompanionBotWizard
          onClose={() => setWizardOpen(false)}
          onSaved={() => {
            setWizardOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- 制作弹窗(三步) ---------------- */

function CompanionBotWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useLang();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<CutPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // 识图调用实测 ~7s:秒表让"在工作"可见(与旧导入卡同款)
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const iv = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(iv);
  }, [busy]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(t("companion.wizard.prompt"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setMsg(t("companion.wizard.copy"));
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
        manifest: preview.manifest,
        parts: preview.parts.map((p) => ({ name: p.name, pngBase64: p.pngBase64 })),
      });
      await refreshActivePack();
      await window.api.setSetting("companion_form", "custom");
      window.dispatchEvent(new Event("companion-config-changed"));
      setMsg(t("companion.custom.applied"));
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
            <a
              href="https://www.doubao.com/chat/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-brand px-3 py-1.5 text-label text-white hover:opacity-90"
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

        {/* 步骤 3:导入 + 命名 + 保存 */}
        <div className="rounded-xl border border-[var(--border-faint)] p-3">
          <div className="text-label font-medium text-ink-strong mb-1">{t("companion.wizard.s3")}</div>
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
