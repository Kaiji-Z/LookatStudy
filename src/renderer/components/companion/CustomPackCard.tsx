/**
 * CustomPackCard —— 设置页伴学区的「自定义纸偶」卡(CompanionPack M2,SPEC §16)。
 *
 * 流程:选 PNG(<input type=file>,web/桌面同路)→ companionPackCutFromImage
 * (降级链恒成功,部件已带白描边)→ 部件预览条 → 应用(写盘 + settings 行,
 * companion_form 切 custom + companion-config-changed 让 bus 重读)→ 删除回落。
 * 预览是纯本地态,应用才落盘——取消零副作用。
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useLang } from "../../lib/i18n.js";
import { refreshActivePack } from "../../lib/companion/custom-pack-store.js";
import type { CutPackManifest } from "@shared/companion-cut.ts";

interface CutPreview {
  route: string;
  failure?: string;
  /** 识图通道失败原因(空=未尝试或成功);几何降级时导入卡可见 */
  visionError?: string;
  manifest: CutPackManifest;
  parts: Array<{ name: string; file: string; box: { x: number; y: number; w: number; h: number }; pngBase64: string }>;
}

/** 大文件分块转 base64(避免 String.fromCharCode 爆栈)。 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const ROUTE_KEY: Record<string, string> = {
  vision: "companion.custom.routeVision",
  geometric: "companion.custom.routeGeometric",
  l1: "companion.custom.routeL1",
};

export function CustomPackCard() {
  const t = useLang();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CutPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 识图调用实测 ~7s:无过程的等待看起来像卡死——秒表让"在工作"可见
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const iv = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(iv);
  }, [busy]);

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
      if (out.visionError) {
        setMsg(`${t("companion.custom.visionFallback")} · ${out.visionError}`);
      } else {
        setMsg(`${t("companion.custom.cutDone")} · ${t(ROUTE_KEY[out.route] ?? "companion.custom.routeL1")}`);
      }
    } catch (e) {
      setMsg(`${t("companion.custom.fail")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await window.api.companionPackApplyPack({
        name: fileName || "My Bot",
        manifest: preview.manifest,
        parts: preview.parts.map((p) => ({ name: p.name, pngBase64: p.pngBase64 })),
      });
      await refreshActivePack();
      await window.api.setSetting("companion_form", "custom");
      window.dispatchEvent(new Event("companion-config-changed"));
      setMsg(t("companion.custom.applied"));
      setPreview(null);
    } catch (e) {
      setMsg(`${t("companion.custom.fail")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await window.api.companionPackDeleteActive();
      await refreshActivePack();
      if (r.formReset) window.dispatchEvent(new Event("companion-config-changed"));
      setMsg(t("companion.custom.deleted"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="companion-custom-card" className="mt-3 rounded-xl border border-[var(--border-faint)] p-3">
      <div className="text-label font-medium text-ink-strong mb-2">{t("companion.custom.title")}</div>
      <div className="flex flex-wrap items-center gap-2">
        {busy && (
          <span className="flex items-center gap-1.5 text-label text-ink-muted" data-testid="companion-custom-busy">
            <Loader2 size={14} className="animate-spin" />
            {t(preview ? "companion.custom.applying" : "companion.custom.locating")}
            <span className="tabular-nums">{elapsed}s</span>
          </span>
        )}
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
          data-testid="companion-custom-import"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label hover:bg-surface-2 disabled:opacity-50"
        >
          {t("companion.custom.import")}
        </button>
        <button
          type="button"
          data-testid="companion-custom-delete"
          disabled={busy}
          onClick={() => void remove()}
          className="rounded-lg border border-[var(--border-faint)] px-3 py-1.5 text-label text-warning hover:bg-surface-2 disabled:opacity-50"
        >
          {t("companion.custom.delete")}
        </button>
        {msg && <span className="text-caption text-ink-muted" data-testid="companion-custom-msg">{msg}</span>}
      </div>
      {preview && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="companion-custom-preview">
          {preview.parts.map((p) => (
            <img
              key={p.name}
              src={`data:image/png;base64,${p.pngBase64}`}
              alt={p.name}
              title={p.name}
              className="h-14 w-14 object-contain rounded-lg bg-surface-2"
            />
          ))}
          <button
            type="button"
            data-testid="companion-custom-apply"
            disabled={busy}
            onClick={() => void apply()}
            className="rounded-lg bg-brand px-3 py-1.5 text-label text-white hover:opacity-90 disabled:opacity-50"
          >
            {t("companion.custom.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
