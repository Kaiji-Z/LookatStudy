/**
 * ProfileEditForm —— 学习者画像编辑表单(共享组件, v0.36 profile-window)。
 *
 * 单一真源:BootGuidePanel 的就绪教室编辑卡与 PersonalProfileModal 的
 * "我声明的"区共用同一表单(不复制代码);保存走调用方回调(各自走 profile:set)。
 * MBTI 选择收敛为 16 宫格+翻卡(场景题兜底已退役:不知道 MBTI 直接跳过,
 * 风格四维由 expandMbtiToStyle 在选中时展开,不为此加全局认知负担)。
 * 保存时刷新 updatedAt("用户手改 > AI 提议"仲裁依赖它)。
 */
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import {
  MBTI_TYPES,
  expandMbtiToStyle,
  mbtiDisplay,
  motiveDisplay,
  MOTIVE_STAGES,
  parseInterestsInput,
  type LearnerProfile,
  type MbtiType,
} from "@shared/learner-profile";
import { companionNodePoint } from "../lib/companion/bus.js";

type TFn = (k: string, v?: Record<string, string | number>) => string;

export interface ProfileEditFormProps {
  t: TFn;
  locale: string;
  profile: LearnerProfile;
  onSave: (p: LearnerProfile) => void;
  onCancel?: () => void;
  /** testid 前缀:boot 就绪教室沿用 boot-*(既有 ui-test 锚);个人资料弹窗用 pf- */
  testIdPrefix?: string;
}

export function ProfileEditForm({ t, locale, profile, onSave, onCancel, testIdPrefix = "boot" }: ProfileEditFormProps) {
  const tid = (k: string) => `${testIdPrefix}-edit-${k}`;
  const [p, setP] = useState<LearnerProfile>({ ...profile, style: { ...profile.style } });
  const isEn = locale === "en";
  const patch = (next: Partial<LearnerProfile>) => setP((cur) => ({ ...cur, ...next }));
  /* 兴趣输入的原始文本态:显示不再从 parse→join 重导出(旧实现每敲一个分隔符就被吞掉) */
  const [interestsText, setInterestsText] = useState(() => profile.interests?.join(isEn ? ", " : "、") ?? "");
  const interestsSep = isEn ? ", " : "、";

  return (
    <section className="flex flex-col gap-4" data-testid={`${testIdPrefix}-editcard`}>
      <div>
        <div className="text-title font-bold text-ink mb-1">{t("boot.profile_quiz.title")}</div>
        <div className="text-label text-ink-muted">{t("boot.profile_quiz.desc")}</div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-label text-ink-faint">{t("boot.card.name.label")}</span>
        <input
          className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
          placeholder={t("boot.card.name.placeholder")}
          value={p.name ?? ""}
          onChange={(e) => patch({ name: e.target.value || null })}
          data-testid={tid("name")}
        />
      </label>

      <MbtiPickerInline
        t={t}
        locale={locale}
        value={p.mbti}
        onPick={(mbti) => { companionNodePoint(); patch({ mbti, style: expandMbtiToStyle(mbti) }); }}
      />

      <div className="flex flex-col gap-1">
        <span className="text-label text-ink">{t("boot.card.motive.label")}</span>
        <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label={t("boot.card.motive.label")}>
          {MOTIVE_STAGES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={p.motiveStage === m}
              className={p.motiveStage === m ? "btn-3d-brand text-left px-3 py-2.5" : "btn-3d-neutral text-left px-3 py-2.5"}
              onClick={() => patch({ motiveStage: m })}
              data-testid={tid(`motive-${m}`)}
            >
              {motiveDisplay(m, locale).name}
            </button>
          ))}
        </div>
        {p.motiveStage && (
          <div className="reveal-enter rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid={tid("motive-flip")}>
            <div className="text-label text-ink-muted">{motiveDisplay(p.motiveStage, locale).tagline}</div>
            <div className="text-label text-accent">{motiveDisplay(p.motiveStage, locale).bot}</div>
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-label text-ink-faint">{t("boot.card.interests.label")}</span>
        <input
          className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
          placeholder={t("boot.card.interests.placeholder")}
          value={interestsText}
          onChange={(e) => {
            setInterestsText(e.target.value);
            patch({ interests: parseInterestsInput(e.target.value) });
          }}
          onBlur={() => setInterestsText(p.interests?.join(interestsSep) ?? "")}
          data-testid={tid("interests")}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-label text-ink-faint">{t("boot.card.free.label")}</span>
        <textarea
          className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent resize-none"
          rows={2}
          placeholder={t("boot.card.free.placeholder")}
          value={p.freeNote ?? ""}
          onChange={(e) => patch({ freeNote: e.target.value || null })}
          data-testid={tid("free")}
        />
      </label>

      <div className="flex gap-2">
        <button
          className="btn-3d-brand inline-flex items-center gap-1.5 px-4 py-2"
          onClick={() => onSave({ ...p, interests: parseInterestsInput(interestsText), updatedAt: new Date().toISOString() })}
          data-testid={tid("save")}
        >
          <ArrowRight size={16} />
          {t("boot.profile.save")}
        </button>
        {onCancel && (
          <button className="btn-3d-neutral inline-flex items-center gap-1.5 px-4 py-2" onClick={onCancel}>
            <X size={16} />
            {t("boot.profile.cancel")}
          </button>
        )}
      </div>
    </section>
  );
}

/* ================= MBTI 内联选择(向导卡1 与编辑表单共用):16 宫格+翻卡,不知道就跳过 ================= */

export function MbtiPickerInline({ t, locale, value, onPick }: {
  t: TFn;
  locale: string;
  value: MbtiType | null;
  onPick: (mbti: MbtiType) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-ink">{t("boot.card.mbti.label")}</span>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t("boot.card.mbti.label")} data-testid="boot-mbti-grid">
        {MBTI_TYPES.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={value === m}
            className={value === m ? "btn-3d-brand text-label px-1 py-2.5" : "btn-3d-neutral text-label px-1 py-2.5"}
            onClick={() => onPick(m)}
            data-testid={`boot-mbti-${m}`}
          >
            {m}
          </button>
        ))}
      </div>
      {/* 翻卡在选项下方:确认反馈不把选项推走 */}
      {value && (
        <div className="reveal-enter rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-mbti-flip">
          <div className="text-label font-bold text-ink">{value} · {mbtiDisplay(value, locale).name}</div>
          <div className="text-label text-ink-muted">{mbtiDisplay(value, locale).tagline}</div>
          <div className="text-label text-accent">{mbtiDisplay(value, locale).bot}</div>
        </div>
      )}
    </div>
  );
}
