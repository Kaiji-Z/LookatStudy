/**
 * PersonalProfileModal —— 个人资料窗口(v0.36 profile-window, SPEC §2)。
 *
 * 三区结构:我声明的(可编辑, ProfileEditForm 共享)/ AI 建议的(画像提议消费点,
 * pending 建议卡 + 历史可追溯)/ AI 记住的(memory 三槽显式化, flag 默认关 +
 * 一键开启 + 可删除)。信任分级视觉:声明=正常卡,记忆=弱化底+"待核实"标注。
 *
 * lazy chunk(App 按需加载);Propose→Apply 红线不动——apply 走既有 proposal:apply。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, Lightbulb, Brain, Trash2, History, ArrowRight, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useLang, useLangValue } from "../lib/i18n.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { ProfileEditForm } from "./ProfileEditForm.js";
import {
  mbtiDisplay,
  styleDimLabel,
  goalLabel,
  emptyProfile,
  type LearnerProfile,
  type LearnerProfilePatch,
  type StyleDim,
} from "@shared/learner-profile";
import type { ProfileProposalItem, MemoryInventoryView } from "@shared/types";

export interface PersonalProfileModalProps {
  onClose: () => void;
  /** 画像保存后通知宿主(标题栏头像名刷新) */
  onProfileSaved?: () => void;
}

/** patch → 人话(field 名 + 建议值),建议卡与历史行共用。 */
function describePatch(patch: LearnerProfilePatch, locale: string, t: (k: string) => string): { field: string; value: string } | null {
  if (patch.mbti) {
    const d = mbtiDisplay(patch.mbti, locale);
    return { field: t("boot.profile.field.mbti"), value: `${patch.mbti} · ${d.name}` };
  }
  if (patch.name) return { field: t("boot.profile.field.name"), value: patch.name };
  if (patch.goal) return { field: t("boot.profile.field.goal"), value: goalLabel(patch.goal, locale) };
  if (patch.goalNote) return { field: t("profile.field.goalNote"), value: patch.goalNote };
  if (patch.freeNote) return { field: t("boot.profile.field.free"), value: patch.freeNote };
  const st = patch.style;
  if (st) {
    const dims: Array<[StyleDim, string]> = [["start", "start"], ["interaction", "interaction"], ["feedback", "feedback"], ["pacing", "pacing"]];
    for (const [dim] of dims) {
      const v = st[dim];
      if (v) return { field: `${t("boot.profile.field.style")} · ${t(`profile.style.${dim}`)}`, value: styleDimLabel(dim, v, locale) };
    }
  }
  return null;
}

export default function PersonalProfileModal({ onClose, onProfileSaved }: PersonalProfileModalProps) {
  const t = useLang();
  const lang = useLangValue();
  const locale = lang === "en" ? "en" : "zh-CN";
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [proposals, setProposals] = useState<ProfileProposalItem[] | null>(null);
  const [memoryOn, setMemoryOn] = useState<boolean | null>(null);
  const [memory, setMemory] = useState<MemoryInventoryView | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshProposals = useCallback(() => {
    void api.profileListProposals().then(setProposals).catch(() => setProposals([]));
  }, []);

  const refreshMemory = useCallback((flagOn: boolean) => {
    setMemoryOn(flagOn);
    if (flagOn) void api.memoryListAll().then(setMemory).catch(() => setMemory(null));
  }, []);

  useEffect(() => {
    void api.profileGet().then(setProfile).catch(() => setProfile(emptyProfile()));
    refreshProposals();
    void api.hasSetting("flag_memory_system").then((on) => refreshMemory(on)).catch(() => refreshMemory(false));
  }, [refreshProposals, refreshMemory]);

  const saveProfile = useCallback(
    (p: LearnerProfile) => {
      setProfile(p);
      void api.profileSet(p).then(() => onProfileSaved?.()).catch(() => {});
    },
    [onProfileSaved],
  );

  const actProposal = useCallback(
    async (id: string, kind: "apply" | "reject") => {
      setBusy(true);
      try {
        if (kind === "apply") await api.applyProposal(id);
        else await api.rejectProposal(id);
        refreshProposals();
        // apply 可能改画像 → 拉新
        void api.profileGet().then(setProfile).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [refreshProposals],
  );

  const enableMemory = useCallback(async () => {
    setBusy(true);
    try {
      await api.setSetting("flag_memory_system", "true");
      refreshMemory(true);
    } finally {
      setBusy(false);
    }
  }, [refreshMemory]);

  const deleteMemory = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await api.memoryDeleteSlot(id);
        void api.memoryListAll().then(setMemory).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const pending = (proposals ?? []).filter((x) => x.status === "pending");
  const history = (proposals ?? []).filter((x) => x.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="profile-modal">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("profile.title")}
        className="w-[min(560px,94vw)] max-h-[86vh] overflow-y-auto rounded-2xl bg-surface-0 shadow-elevated p-6 flex flex-col gap-6"
      >
        <div className="flex items-center justify-between">
          <div className="text-hero font-bold text-ink">{t("profile.title")}</div>
          <button className="btn-3d-neutral inline-flex items-center gap-1" onClick={onClose} data-testid="profile-close">
            <X size={16} />
            {t("action.close")}
          </button>
        </div>

        {/* ── 区1:我声明的(可编辑) ── */}
        <section className="flex flex-col gap-3" data-testid="profile-section-declared">
          <SectionTitle icon={<Sparkles size={16} className="text-accent" />} label={t("profile.section.declared")} />
          {profile ? (
            <ProfileEditForm t={t} locale={locale} profile={profile} onSave={saveProfile} testIdPrefix="pf" />
          ) : (
            <div className="text-label text-ink-faint">…</div>
          )}
        </section>

        {/* ── 区2:AI 建议的(提议消费点) ── */}
        <section className="flex flex-col gap-3" data-testid="profile-section-suggestions">
          <SectionTitle icon={<Lightbulb size={16} className="text-accent" />} label={t("profile.section.suggestions")} />
          {proposals === null ? (
            <div className="text-label text-ink-faint">…</div>
          ) : pending.length === 0 ? (
            <div className="rounded-xl bg-surface-1 p-3 text-label text-ink-muted" data-testid="profile-suggest-empty">
              {t("profile.suggest.empty")}
            </div>
          ) : (
            pending.map((item) => {
              const d = describePatch(item.patch, locale, t);
              return (
                <div key={item.id} className="rounded-xl border border-accent/30 bg-accent/5 p-3 flex flex-col gap-2" data-testid="profile-suggest-card">
                  <div className="text-label text-ink leading-relaxed">
                    {t("profile.suggest.title", { field: d?.field ?? "", value: d?.value ?? "" })}
                  </div>
                  {item.rationale && (
                    <div className="text-label text-ink-muted leading-relaxed">
                      {t("profile.suggest.reason")}{item.rationale}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      className="btn-3d-brand inline-flex items-center gap-1"
                      disabled={busy}
                      onClick={() => void actProposal(item.id, "apply")}
                      data-testid="profile-suggest-apply"
                    >
                      <ArrowRight size={14} />
                      {t("profile.suggest.apply", { value: d?.value ?? "" })}
                    </button>
                    <button
                      className="btn-3d-neutral"
                      disabled={busy}
                      onClick={() => void actProposal(item.id, "reject")}
                      data-testid="profile-suggest-keep"
                    >
                      {t("profile.suggest.keep")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
          {history.length > 0 && (
            <details className="rounded-xl bg-surface-1 p-3" data-testid="profile-suggest-history">
              <summary className="text-label font-bold text-ink cursor-pointer inline-flex items-center gap-1.5">
                <History size={14} />
                {t("profile.suggest.history")}（{history.length}）
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {history.map((h) => {
                  const d = describePatch(h.patch, locale, t);
                  return (
                    <div key={h.id} className="text-caption text-ink-muted flex items-start gap-1.5">
                      <span className="shrink-0">{h.status === "applied" ? "✅" : h.status === "rejected" ? "⚪" : "⊘"}</span>
                      <span>
                        {t("profile.suggest.title", { field: d?.field ?? "", value: d?.value ?? "" })}
                        {h.rationale ? ` — ${h.rationale}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </section>

        {/* ── 区3:AI 记住的(memory 显式化, flag 默认关) ── */}
        <section className="flex flex-col gap-3" data-testid="profile-section-memory">
          <SectionTitle icon={<Brain size={16} className="text-accent" />} label={t("profile.section.memory")} />
          {memoryOn === null ? (
            <div className="text-label text-ink-faint">…</div>
          ) : !memoryOn ? (
            <div className="rounded-xl bg-surface-1 p-4 flex flex-col gap-3" data-testid="profile-memory-off">
              <div>
                <div className="text-label font-bold text-ink mb-1">{t("profile.memory.off.title")}</div>
                <div className="text-label text-ink-muted leading-relaxed">{t("profile.memory.off.desc")}</div>
              </div>
              <button className="btn-3d-brand self-start" disabled={busy} onClick={() => void enableMemory()} data-testid="profile-memory-enable">
                {t("profile.memory.enable")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3" data-testid="profile-memory-on">
              <div className="text-caption text-ink-faint">{t("profile.memory.disclaimer")}</div>
              <MemoryGroup
                t={t}
                label={t("profile.memory.global")}
                items={memory?.global ? [{ id: memory.global.id, text: memory.global.summary }] : []}
                onDelete={(id) => void deleteMemory(id)}
                busy={busy}
              />
              <MemoryGroup
                t={t}
                label={t("profile.memory.pattern")}
                items={(memory?.patterns ?? []).map((m) => ({ id: m.id, text: m.summary }))}
                onDelete={(id) => void deleteMemory(id)}
                busy={busy}
              />
              <MemoryGroup
                t={t}
                label={t("profile.memory.nodes")}
                items={(memory?.nodes ?? []).slice(0, 8).map((m) => ({ id: m.id, text: m.summary }))}
                extra={(memory?.nodes?.length ?? 0) > 8 ? t("profile.memory.more", { n: (memory?.nodes.length ?? 0) - 8 }) : undefined}
                onDelete={(id) => void deleteMemory(id)}
                busy={busy}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-label font-bold text-ink">
      {icon}
      {label}
    </div>
  );
}

function MemoryGroup({ t, label, items, extra, onDelete, busy }: {
  t: (k: string, v?: Record<string, string | number>) => string;
  label: string;
  items: Array<{ id: string; text: string }>;
  extra?: string;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-1 p-3 flex flex-col gap-2">
      <div className="text-caption font-bold text-ink-faint">{label}</div>
      {items.length === 0 ? (
        <div className="text-caption text-ink-faint">{t("profile.memory.empty")}</div>
      ) : (
        items.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <span className="flex-1 text-caption text-ink-muted leading-relaxed">{m.text}</span>
            <button
              className="shrink-0 text-ink-faint hover:text-warning transition-colors"
              disabled={busy}
              onClick={() => onDelete(m.id)}
              aria-label={t("profile.memory.delete")}
              data-testid="profile-memory-delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
      {extra && <div className="text-caption text-ink-faint">{extra}</div>}
    </div>
  );
}
