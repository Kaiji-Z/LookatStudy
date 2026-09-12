/**
 * SettingsShimejiSection —— 伴学设置里的「Shimeji 桌宠」区块(第七形态)。
 *
 * 包卡列表(头像/名字/格式/帧数/激活/删除) + +号卡片导入 zip。
 * zip 唯一入口:解析→角色勾选弹窗(默认全选)→confirmImport 落盘。
 * 应用内只放社区站点通用指引,不分发任何具体包(合规红线,SPEC §4)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useLang } from "../lib/i18n.js";
import { refreshActiveShimeji } from "../lib/companion/shimeji-pack-store.js";
import { ConfirmCard } from "./ConfirmCard.js";

interface PackSummary {
  id: string;
  name: string;
  format: string;
  frameCount: number;
  actionCount: number;
  iconBase64: string | null;
  active: boolean;
}

interface CharacterPreview {
  ref: string;
  name: string;
  iconBase64: string | null;
  frameCount: number;
  actionCount: number;
  format: string;
}

export function SettingsShimejiSection() {
  const t = useLang();
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ importId: string; characters: CharacterPreview[]; selected: Set<string> } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await window.api.shimejiList();
      setPacks(res.packs);
    } catch {
      /* lab 环境:静默 */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPickFile = () => fileRef.current?.click();

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
      await reload();
      await refreshActiveShimeji();
    } catch (err) {
      setError(String((err as Error).message ?? err).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    await window.api.shimejiActivate({ id });
    await reload();
    await refreshActiveShimeji();
  };

  const remove = async (id: string) => {
    await window.api.shimejiDelete({ id });
    setConfirmingDelete(null);
    await reload();
    await refreshActiveShimeji();
  };

  return (
    <div className="mt-4 pt-4 border-t border-[var(--border-faint)]" data-testid="shimeji-section">
      <div className="text-label text-ink-muted mb-2">{t("settings.shimeji.block")}</div>
      <p className="text-label text-ink-muted mb-3">{t("settings.shimeji.desc")}</p>
      <div className="flex flex-wrap gap-2 items-stretch">
        {packs.map((p) => (
          <div
            key={p.id}
            data-testid="shimeji-pack-card"
            className={`relative flex items-center gap-2 rounded-xl border p-2 pr-8 ${
              p.active ? "border-[var(--accent)] bg-surface-2" : "border-[var(--border-faint)]"
            }`}
          >
            {p.iconBase64 ? (
              <img src={`data:image/png;base64,${p.iconBase64}`} alt="" className="w-10 h-10 rounded-lg object-contain bg-surface-2" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-surface-2" />
            )}
            <div className="flex flex-col">
              <span className="text-body text-ink-strong">{p.name}</span>
              <span className="text-caption text-ink-muted">
                {p.format} · {p.frameCount}f · {p.actionCount}
              </span>
            </div>
            {!p.active && (
              <button type="button" className="btn-3d-neutral px-2 py-1 text-caption ml-1" onClick={() => void activate(p.id)}>
                {t("settings.shimeji.activate")}
              </button>
            )}
            {p.active && <span className="text-caption text-brand font-medium ml-1">{t("settings.shimeji.active")}</span>}
            <button
              type="button"
              aria-label={t("settings.shimeji.delete")}
              className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-ink-faint hover:text-warning"
              onClick={() => setConfirmingDelete({ id: p.id, name: p.name })}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid="shimeji-import"
          onClick={onPickFile}
          disabled={busy}
          className="w-16 min-h-[64px] rounded-xl border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1 text-ink-faint hover:text-ink-muted hover:bg-surface-2 disabled:opacity-50"
          title={t("settings.shimeji.import")}
        >
          <Plus className="w-5 h-5" />
          <span className="text-caption">{busy ? t("settings.shimeji.importing") : t("settings.shimeji.import")}</span>
        </button>
        <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => void onFile(e)} />
      </div>
      {error && <p className="text-caption text-warning mt-2">{error}</p>}
      <p className="text-caption text-ink-faint mt-2">{t("settings.shimeji.guide")}</p>

      {preview && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-surface-1 p-3" data-testid="shimeji-character-picker">
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
            <button type="button" className="btn-3d-neutral px-3 py-1.5 text-label" onClick={() => setPreview(null)}>
              {t("action.cancel")}
            </button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmCard
          anchorRect={new DOMRect(0, 0, 0, 0)}
          message={t("settings.shimeji.deleteConfirm", { name: confirmingDelete.name })}
          danger
          testid="shimeji-delete-confirm"
          onConfirm={() => void remove(confirmingDelete.id)}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
