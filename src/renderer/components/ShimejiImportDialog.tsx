/**
 * ShimejiImportDialog —— 「导入 Shimeji 桌宠包」模态弹窗(第七形态)。
 *
 * 2026-09-12 设置页整合(用户拍板):伴学形象区入口统一到「新建 +」卡——
 * 点 + → 选择 自制/Shimeji → Shimeji 走本弹窗(原独立区块退役)。
 * 弹窗内:社区站点通用指引(不分发任何具体包,合规红线,SPEC §4)
 * → 选 zip → 角色勾选(默认全选)→ confirmImport 落盘。
 * overlay/focus-trap 与 CompanionBotWizard 同款。
 */
import { useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import { useLang } from "../lib/i18n.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { refreshActiveShimeji } from "../lib/companion/shimeji-pack-store.js";

interface CharacterPreview {
  ref: string;
  name: string;
  iconBase64: string | null;
  frameCount: number;
  actionCount: number;
  format: string;
}

// 社区分发站点(通用指引,不分发任何具体包,合规红线 SPEC §4)。
// target=_blank 由主进程 setWindowOpenHandler 接住 → shell.openExternal 系统浏览器。
const SHIMEJI_SITES = [
  { id: "shimejiorg", label: "shimeji.org", url: "https://shimeji.org/" },
  { id: "shimejisxyz", label: "shimejis.xyz", url: "https://shimejis.xyz/" },
  { id: "cachomon", label: "Cachomon", url: "https://cachomon.com/" },
  { id: "deviantart", label: "DeviantArt", url: "https://www.deviantart.com/search?q=shimeji" },
];

export function ShimejiImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> | void }) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useFocusTrap(panelRef, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ importId: string; characters: CharacterPreview[]; selected: Set<string> } | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const previewRes = await window.api.shimejiImportZip({ zipBase64: btoa(binary) });
      setPreview({
        importId: previewRes.importId,
        characters: previewRes.characters,
        selected: new Set(previewRes.characters.map((c) => c.ref)),
      });
    } catch (err) {
      setError(String((err as Error).message ?? err).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const toggleCharacter = (ref: string) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      if (selected.has(ref)) selected.delete(ref);
      else selected.add(ref);
      return { ...prev, selected };
    });
  };

  const confirmImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await window.api.shimejiConfirmImport({ importId: preview.importId, characterRefs: [...preview.selected] });
      setPreview(null);
      await refreshActiveShimeji();
      await onImported();
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      data-noswipe=""
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.shimeji.dialog.title")}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-surface-0 border border-[var(--border)] shadow-elevated p-4"
        data-testid="shimeji-dialog"
      >
        <button
          type="button"
          aria-label={t("action.close")}
          data-testid="shimeji-dialog-close"
          onClick={onClose}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink-strong hover:bg-surface-2"
        >
          <X className="w-4 h-4" />
        </button>
        {/* 手机矮屏:标题/关闭钉住,变量内容(角色清单可很长)滚 dynamically */}
        <div className="min-h-0 overflow-y-auto">
        <div className="text-body font-medium text-ink-strong mb-1">{t("settings.shimeji.dialog.title")}</div>
        <p className="text-label text-ink-muted mb-3">{t("settings.shimeji.desc")}</p>

        {!preview && (
          <>
            <button
              type="button"
              data-testid="shimeji-import"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border border-dashed border-[var(--border)] py-6 flex flex-col items-center gap-1.5 text-ink-faint hover:text-ink-muted hover:bg-surface-2 disabled:opacity-50"
            >
              <span className="text-label font-medium">{busy ? t("settings.shimeji.importing") : t("settings.shimeji.import")}</span>
              <span className="text-caption">{t("settings.shimeji.guide")}</span>
            </button>
            {/* 链接排在拖放区外——a 不能嵌进 button(嵌套交互元素,点击会先触发选文件) */}
            <div className="flex flex-wrap gap-1.5 mt-2" data-testid="shimeji-download-links">
              {SHIMEJI_SITES.map((s) => (
                <a
                  key={s.id}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`shimeji-link-${s.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-faint)] px-2 py-1 text-caption text-ink-muted hover:text-ink-strong hover:bg-surface-2 motion-safe:transition-colors"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  {s.label}
                </a>
              ))}
            </div>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={(e) => void onFile(e)} />

        {error && (
          <p className="text-caption text-warning mt-2" role="alert">
            {error}
          </p>
        )}

        {preview && (
          <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-3" data-testid="shimeji-character-picker">
            <div className="text-body text-ink-strong mb-2">{t("settings.shimeji.pick.title")}</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {preview.characters.map((c) => {
                const checked = preview.selected.has(c.ref);
                return (
                  <button
                    key={c.ref}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleCharacter(c.ref)}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-left ${
                      checked ? "border-[var(--accent)] bg-surface-2" : "border-[var(--border-faint)]"
                    }`}
                  >
                    {c.iconBase64 ? (
                      <img src={`data:image/png;base64,${c.iconBase64}`} alt="" className="w-9 h-9 rounded-lg object-contain bg-surface-2" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-surface-2" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-body text-ink-strong">{c.name}</span>
                      <span className="text-caption text-ink-muted">
                        {c.format} · {c.frameCount}f · {c.actionCount}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="shimeji-confirm-import"
                className="btn-3d-brand px-3 py-1.5 text-label"
                disabled={busy || preview.selected.size === 0}
                onClick={() => void confirmImport()}
              >
                {t("settings.shimeji.pick.confirm", { count: preview.selected.size })}
              </button>
              <button type="button" className="btn-3d-neutral px-3 py-1.5 text-label" onClick={onClose}>
                {t("action.cancel")}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
