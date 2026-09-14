/**
 * BootRecapPanel —— 未选课态右栏的「学习回顾」(v0.36, SPEC §3)。
 *
 * 用户拍板方案:主卡=学习回顾(累积学了什么 + 最近学了什么,让用户看到
 * 自己知识在增加的显化);空数据新用户 → 学习 tips 兜底卡(按日轮换)。
 * 克制原则:右栏是配角(中栏 bot 是主角),卡片少量、留白充分。
 * 有课状态右栏仍是 NotebookPanel(本组件只在未选课态挂载)。
 */
import { useEffect, useState } from "react";
import { Zap, Crown, Flame, BookOpen, Lightbulb } from "lucide-react";
import { api } from "../lib/api.js";
import { useLang, useLangValue } from "../lib/i18n.js";
import type { BootStateResult } from "@shared/boot-guide";
import { pickBootTip } from "@shared/boot-tips";

export function BootRecapPanel() {
  const t = useLang();
  const lang = useLangValue();
  const locale = lang === "en" ? "en" : "zh-CN";
  const [boot, setBoot] = useState<BootStateResult | null>(null);

  useEffect(() => {
    let alive = true;
    api.bootGetState().then((st) => { if (alive) setBoot(st); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const tip = pickBootTip(new Date().toISOString().slice(0, 10), locale);
  const recap = boot?.recap ?? null;
  const hasData = !!recap && (recap.totalXp > 0 || recap.masteredCount > 0 || recap.streakDays > 0);

  return (
    <div className="h-full overflow-y-auto px-5 py-8" data-testid="boot-recap" data-mode={hasData ? "recap" : "tips"}>
      <div className="mx-auto max-w-sm flex flex-col gap-4">
        {hasData && recap ? (
          <section className="surface-card rounded-2xl p-5 shadow-card flex flex-col gap-4" data-testid="boot-recap-card">
            <div className="text-label font-bold text-ink">{t("boot.recap.title")}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-recap-xp">
                <Zap size={18} className="text-gold self-center" />
                <div className="text-title font-bold text-ink">{recap.totalXp}</div>
                <div className="text-caption text-ink-faint">{t("boot.recap.total_xp")}</div>
              </div>
              <div className="rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-recap-mastered">
                <Crown size={18} className="text-gold self-center" />
                <div className="text-title font-bold text-ink">{recap.masteredCount}</div>
                <div className="text-caption text-ink-faint">{t("boot.recap.mastered")}</div>
              </div>
              <div className="rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-recap-streak">
                <Flame size={18} className="text-warning self-center" />
                <div className="text-title font-bold text-ink">{recap.streakDays}</div>
                <div className="text-caption text-ink-faint">{t("boot.recap.streak_days")}</div>
              </div>
            </div>
            {boot?.lastSession && (
              <div className="flex items-start gap-2 text-label text-ink-muted" data-testid="boot-recap-recent">
                <BookOpen size={15} className="shrink-0 mt-0.5 text-accent" />
                <span>
                  {t("boot.recap.recent")}:「{boot.lastSession.courseTitle}」
                  {boot.lastSession.nodeTitle ? ` · ${boot.lastSession.nodeTitle}` : ""}
                </span>
              </div>
            )}
          </section>
        ) : (
          <section className="surface-card rounded-2xl p-5 shadow-card flex flex-col gap-3" data-testid="boot-tips-card">
            <div className="flex items-center gap-2">
              <Lightbulb size={18} className="text-gold" />
              <div className="text-label font-bold text-ink">{t("boot.recap.tips_title")}</div>
            </div>
            <p className="text-body text-ink-muted leading-relaxed" data-testid="boot-tip-text">
              {tip.text}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
