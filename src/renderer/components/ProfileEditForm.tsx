/**
 * ProfileEditForm —— 学习者画像编辑表单(共享组件, v0.36 profile-window)。
 *
 * 单一真源:BootGuidePanel 的就绪教室编辑卡与 PersonalProfileModal 的
 * "我声明的"区共用同一表单(不复制代码);保存走调用方回调(各自走 profile:set)。
 * 场景题在表单内常驻展示;MbtiPickerInline 的"不知道→场景题"切换只服务向导卡1
 * (编辑表单里题就在下方,切换是冗余——hideSceneToggle 关掉)。
 * 保存时刷新 updatedAt("用户手改 > AI 提议"仲裁依赖它)。
 */
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import {
  MBTI_TYPES,
  STYLE_SCENE_QUESTIONS,
  expandMbtiToStyle,
  mbtiDisplay,
  type LearnerProfile,
  type MbtiType,
  type StyleDim,
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

  const setSceneAnswer = (dim: StyleDim, value: string) =>
    setP((cur) => ({ ...cur, style: { ...cur.style, [dim]: value } }));

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
        style={p.style}
        onPick={(mbti) => { companionNodePoint(); patch({ mbti, style: expandMbtiToStyle(mbti) }); }}
        onSceneAnswer={setSceneAnswer}
        hideSceneToggle
      />

      <div className="flex flex-col gap-2">
        {STYLE_SCENE_QUESTIONS.map((q) => (
          <div key={q.dim} className="flex flex-col gap-1">
            <div className="text-label text-ink">{isEn ? q.en : q.zh}</div>
            <div className="flex gap-2">
              {[q.a, q.b].map((opt) => (
                <button
                  key={opt.value}
                  className={p.style[q.dim] === opt.value ? "btn-3d-brand flex-1 text-left" : "btn-3d-neutral flex-1 text-left"}
                  onClick={() => setSceneAnswer(q.dim, opt.value)}
                  data-testid={tid(`scene-${q.dim}`)}
                >
                  {isEn ? opt.en : opt.zh}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-label text-ink">{t("boot.card.goal.label")}</span>
        <div className="grid grid-cols-2 gap-2">
          {(["interview", "project", "career", "curiosity"] as const).map((g) => (
            <button
              key={g}
              className={p.goal === g ? "btn-3d-brand" : "btn-3d-neutral"}
              onClick={() => patch({ goal: g })}
              data-testid={tid(`goal-${g}`)}
            >
              {t(`boot.card.goal.${g}`)}
            </button>
          ))}
        </div>
        {p.goal === "interview" && (
          <input
            className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
            placeholder={t("boot.card.goal.timeline.placeholder")}
            value={p.goalNote ?? ""}
            onChange={(e) => patch({ goalNote: e.target.value || null })}
            data-testid={tid("timeline")}
          />
        )}
      </div>

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
          className="btn-3d-brand inline-flex items-center gap-1.5"
          onClick={() => onSave({ ...p, updatedAt: new Date().toISOString() })}
          data-testid={tid("save")}
        >
          <ArrowRight size={16} />
          {t("boot.profile.save")}
        </button>
        {onCancel && (
          <button className="btn-3d-neutral inline-flex items-center gap-1.5" onClick={onCancel}>
            <X size={16} />
            {t("boot.profile.cancel")}
          </button>
        )}
      </div>
    </section>
  );
}

/* ================= MBTI 内联选择(向导卡1 与编辑表单共用) ================= */

export function MbtiPickerInline({ t, locale, value, style, onPick, onSceneAnswer, hideSceneToggle }: {
  t: TFn;
  locale: string;
  value: MbtiType | null;
  style: LearnerProfile["style"];
  onPick: (mbti: MbtiType) => void;
  onSceneAnswer: (dim: StyleDim, value: string) => void;
  /** 编辑表单场景题常驻在下,隐藏"不知道→场景题"切换(向导卡1 保留) */
  hideSceneToggle?: boolean;
}) {
  const [mode, setMode] = useState<"grid" | "scene">("grid");
  const isEn = locale === "en";
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-ink">{t("boot.card.mbti.label")}</span>
      {value && (
        <div className="rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-mbti-flip">
          <div className="text-label font-bold text-ink">{value} · {mbtiDisplay(value, locale).name}</div>
          <div className="text-label text-ink-muted">{mbtiDisplay(value, locale).tagline}</div>
          <div className="text-label text-accent">{mbtiDisplay(value, locale).bot}</div>
        </div>
      )}
      {mode === "grid" || hideSceneToggle ? (
        <>
          <div className="grid grid-cols-4 gap-1.5" data-testid="boot-mbti-grid">
            {MBTI_TYPES.map((m) => (
              <button
                key={m}
                className={value === m ? "btn-3d-brand text-label" : "btn-3d-neutral text-label"}
                onClick={() => onPick(m)}
                data-testid={`boot-mbti-${m}`}
              >
                {m}
              </button>
            ))}
          </div>
          {!hideSceneToggle && (
            <button className="text-label text-accent underline underline-offset-2 self-start" onClick={() => setMode("scene")} data-testid="boot-mbti-dontknow">
              {t("boot.card.mbti.dontknow")}
            </button>
          )}
        </>
      ) : (
        <SceneQuestions isEn={isEn} style={style} onAnswer={onSceneAnswer} />
      )}
    </div>
  );
}

/* ================= 场景题(每维一题,可逐题跳过) ================= */

function SceneQuestions({ isEn, style, onAnswer }: {
  isEn: boolean;
  style: { start: string | null; interaction: string | null; feedback: string | null; pacing: string | null };
  onAnswer: (dim: StyleDim, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="boot-scene-questions">
      {STYLE_SCENE_QUESTIONS.map((q) => (
        <div key={q.dim} className="flex flex-col gap-1">
          <div className="text-label text-ink">{isEn ? q.en : q.zh}</div>
          <div className="flex gap-2">
            {[q.a, q.b].map((opt) => (
              <button
                key={opt.value}
                className={style[q.dim] === opt.value ? "btn-3d-brand flex-1 text-left text-label" : "btn-3d-neutral flex-1 text-left text-label"}
                onClick={() => onAnswer(q.dim, opt.value)}
              >
                {isEn ? opt.en : opt.zh}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
