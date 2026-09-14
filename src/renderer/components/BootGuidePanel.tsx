/**
 * BootGuidePanel —— 未选课态中栏的「开屏导师」(v0.36)。
 *
 * 职责(SPEC .goal/SPEC.md §2.2/§2.3):
 *   - mount 时一次 boot:getState 聚合,渲染 computeBootGuide 的场景卡;
 *   - 初次(!boot_done)走 bot 主持的向导:欢迎 → key → 三问卡流(称呼+MBTI/
 *     场景题兜底/目标分支/试玩题)→ 选课;每题即答即存(profile:set);
 *   - 回访渲染建议卡(resume/review/streak/…)+ 就绪教室(画像摘要+补全邀请);
 *   - 引导屏不是 gate:actions 一键进正常态;卡流可随时离场(去左栏选课),
 *     已答入库、不阻拦;boot_done 在走完向导或选课时置位,永不重播。
 *   - 台词全部本地 i18n(零 LLM,瞬时);companion 坐镇卡旁(bus 事件驱动,见 Creature)。
 *
 * 首屏组件不 lazy(AGENTS.md 规则);主束增量来自 shared 展开表(~10KB,已接受)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sparkles, KeyRound, GraduationCap, Play, BookOpen, Flame, ClipboardList, Trophy, LifeBuoy, FileText, PencilLine, ArrowRight, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useLang, useLangValue } from "../lib/i18n.js";
import { celebrate } from "../lib/celebration.js";
import { companionZoneFocus, companionNodePoint } from "../lib/companion/bus.js";
import {
  computeBootGuide,
  BOOT_WIZARD_STEPS,
  type BootStateResult,
} from "@shared/boot-guide";
import {
  MBTI_TYPES,
  STYLE_SCENE_QUESTIONS,
  expandMbtiToStyle,
  mbtiDisplay,
  styleLeaningLine,
  goalLabel,
  emptyProfile,
  hasProfileContent,
  type LearnerProfile,
  type MbtiType,
  type StyleDim,
} from "@shared/learner-profile";
import { pickBootQuiz } from "@shared/boot-quiz";

export interface BootGuidePanelProps {
  /** 一键恢复上次课程(+节点) */
  onResume: (courseId: string, nodeId: string | null) => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
  /** 跳节点:卡点/快毕业/考试 */
  onGotoNode: (nodeId: string, target: "friction" | "near_mastery" | "exam") => void;
  /** 去左栏选课/导入(含 T3 切栏) */
  onPickCourse: () => void;
  /** 画像变化(向导答完/编辑保存)后通知宿主(注入/回顾卡刷新) */
  onProfileChanged?: () => void;
}

const ACTION_ICON: Record<string, ReactNode> = {
  wizard_next: <ArrowRight size={16} />,
  settings_llm: <KeyRound size={16} />,
  pick_course: <BookOpen size={16} />,
  resume: <Play size={16} />,
  review: <ClipboardList size={16} />,
  goto_node: <LifeBuoy size={16} />,
  edit_profile: <PencilLine size={16} />,
};

const SCENE_ICON: Record<string, ReactNode> = {
  welcome_intro: <Sparkles size={22} className="text-accent" />,
  key_setup: <KeyRound size={22} className="text-warning" />,
  profile_quiz: <GraduationCap size={22} className="text-accent" />,
  course_pick: <BookOpen size={22} className="text-brand" />,
  resume_last: <Play size={22} className="text-brand" />,
  review_due: <ClipboardList size={22} className="text-accent" />,
  streak_danger: <Flame size={22} className="text-warning" />,
  friction_revisit: <LifeBuoy size={22} className="text-accent" />,
  near_mastery: <Trophy size={22} className="text-gold" />,
  exam_suspended: <FileText size={22} className="text-warning" />,
  ready_room: <Sparkles size={22} className="text-accent" />,
};

export function BootGuidePanel(props: BootGuidePanelProps) {
  const t = useLang();
  const lang = useLangValue();
  const locale = lang === "en" ? "en" : "zh-CN";

  const [boot, setBoot] = useState<BootStateResult | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  /** 向导卡流的画像草稿(即答即存,草稿只是乐观 UI) */
  const [draft, setDraft] = useState<LearnerProfile | null>(null);
  /** 就绪教室的编辑模式(全字段一张表单) */
  const [editing, setEditing] = useState(false);
  const keyPromptCounted = useRef(false);

  /* companion 空态剧本:挂载=召唤到中栏坐镇引导卡旁(锚点=chatAnchor 兜底),
     卸载=放手回家;答题/选 MBTI 的表情爆发走 companionNodePoint(既有 bus 命令)。 */
  useEffect(() => {
    companionZoneFocus(true);
    return () => companionZoneFocus(false);
  }, []);

  useEffect(() => {
    let alive = true;
    api.bootGetState().then((st) => {
      if (!alive) return;
      setBoot(st);
      setDraft((d) => d ?? emptyProfile());
    }).catch(() => {
      /* 聚合失败 → 引导屏退化为占位(不阻塞左栏使用) */
      if (alive) setDraft((d) => d ?? emptyProfile());
    });
    return () => { alive = false; };
  }, []);

  const guide = useMemo(
    () => (boot ? computeBootGuide({ ...boot, wizardStep }) : null),
    [boot, wizardStep],
  );

  const profile = draft ?? emptyProfile();
  const saveProfile = useCallback(
    (next: LearnerProfile) => {
      setDraft(next);
      void api.profileSet(next).then(() => props.onProfileChanged?.()).catch(() => {});
    },
    [props],
  );

  /* 就绪教室的无 key 提示:每次会话最多计一次提示(≥2 次后不再提,SPEC §2.1) */
  useEffect(() => {
    if (!boot || guide?.scene !== "ready_room") return;
    if (boot.hasKey || boot.keyPromptDismissed || keyPromptCounted.current) return;
    keyPromptCounted.current = true;
    void api.getSetting("key_prompt_count").then((v) => {
      const n = Number(v ?? "0") || 0;
      return api.setSetting("key_prompt_count", String(n + 1));
    }).catch(() => {});
  }, [boot, guide]);

  const finishBoot = useCallback(() => {
    void api.setSetting("boot_done", "1").catch(() => {});
    setBoot((b) => (b ? { ...b, bootDone: true } : b));
  }, []);

  const runAction = useCallback(
    (kind: string, target?: string) => {
      if (!boot) return;
      if (kind === "wizard_next") {
        setWizardStep((s) => Math.min(BOOT_WIZARD_STEPS - 1, s + 1));
      } else if (kind === "settings_llm") {
        props.onOpenSettings();
      } else if (kind === "pick_course") {
        finishBoot();
        props.onPickCourse();
      } else if (kind === "resume" && boot.targets.resume) {
        finishBoot();
        props.onResume(boot.targets.resume.courseId, boot.targets.resume.nodeId);
      } else if (kind === "review") {
        props.onOpenReview();
      } else if (kind === "goto_node" && target) {
        finishBoot();
        const id =
          target === "friction" ? boot.targets.frictionNodeId
          : target === "near_mastery" ? boot.targets.nearMasteryNodeId
          : boot.targets.examNodeId;
        if (id) props.onGotoNode(id, target as "friction" | "near_mastery" | "exam");
      } else if (kind === "edit_profile") {
        setEditing(true);
      }
    },
    [boot, finishBoot, props],
  );

  if (!boot || !guide) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="boot-guide-loading">
        <div className="text-label text-ink-faint">{t("boot.welcome.title")}</div>
      </div>
    );
  }

  /* 称呼插值:{name}今天… → name 为空时模板自然收干净(name 已含后缀逗号或空) */
  const namePrefix = (boot.name ?? "").trim();
  const decorateVars = (key: string, vars?: Record<string, string | number>) => {
    const v = { ...vars };
    if ("name" in v) v.name = namePrefix ? `${namePrefix}，` : "";
    return t(key, v);
  };

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8"
      data-testid="boot-guide"
      data-scene={guide.scene}
      data-boot-done={boot.bootDone ? "1" : "0"}
    >
      <div className="mx-auto max-w-md flex flex-col gap-4" data-testid="boot-guide" data-companion-anchor="boot-guide">
        {guide.welcomeBack && !editing && (
          <div className="text-center text-body text-accent font-bold" data-testid="boot-welcome-back">
            {decorateVars("boot.welcome_back")}
          </div>
        )}

        {/* ===== 场景主卡 ===== */}
        {!editing && (
          <section
            className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4"
            data-testid={`boot-card-${guide.scene}`}
          >
            <div className="flex items-center gap-3">
              {SCENE_ICON[guide.scene]}
              <div className="text-title font-bold text-ink">
                {decorateVars(guide.lines[0]?.key ?? "boot.ready.title", guide.lines[0]?.vars)}
              </div>
            </div>
            {guide.lines.slice(1).map((l) => (
              <p key={l.key} className="text-body text-ink-muted leading-relaxed">
                {decorateVars(l.key, l.vars)}
              </p>
            ))}

            {/* 就绪教室:画像摘要卡(编辑入口/补全邀请) */}
            {guide.scene === "ready_room" && hasProfileContent(profile) && (
              <ProfileSummary t={t} locale={locale} profile={profile} onEdit={() => setEditing(true)} />
            )}

            <div className="flex flex-wrap gap-2 mt-1">
              {guide.actions.map((a) => (
                <button
                  key={a.kind + (a.target ?? "")}
                  className={a === guide.actions[0]
                    ? "btn-3d-brand inline-flex items-center gap-1.5"
                    : "btn-3d-neutral inline-flex items-center gap-1.5"}
                  onClick={() => runAction(a.kind, a.target)}
                  data-testid={`boot-action-${a.kind}`}
                >
                  {ACTION_ICON[a.kind]}
                  {t(a.labelKey, a.kind === "review" && boot.dueCount > 0 ? { n: boot.dueCount } : undefined)}
                </button>
              ))}
            </div>

            {/* 向导步进指示 */}
            {!boot.bootDone && (
              <div className="flex gap-1.5" data-testid="boot-wizard-dots">
                {Array.from({ length: BOOT_WIZARD_STEPS }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${i === wizardStep ? "w-6 bg-brand" : "w-2 bg-neutral-300 dark:bg-neutral-700"}`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ===== 向导卡流(第二屏:三问)与编辑模式共用卡片 ===== */}
        {editing ? (
          <ProfileEditCard
            t={t}
            locale={locale}
            profile={profile}
            onSave={(p) => { saveProfile(p); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : !boot.bootDone && wizardStep === 2 ? (
          <WizardQuizCards
            t={t}
            locale={locale}
            profile={profile}
            onPatch={(patch) => saveProfile({ ...profile, ...patch, style: { ...profile.style, ...patch.style }, updatedAt: new Date().toISOString() })}
            onFinish={() => { finishBoot(); setWizardStep(3); }}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ================= 就绪教室:画像摘要 ================= */

function ProfileSummary({ t, locale, profile, onEdit }: {
  t: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
  profile: LearnerProfile;
  onEdit: () => void;
}) {
  const missing = [
    !profile.name, !profile.mbti, !profile.goal,
    !profile.style.start, !profile.style.interaction, !profile.style.feedback, !profile.style.pacing,
    !profile.freeNote,
  ].filter(Boolean).length;
  const leaning = styleLeaningLine(profile.style, locale);
  return (
    <div className="rounded-xl bg-surface-0 p-4 flex flex-col gap-2" data-testid="boot-profile-summary">
      <div className="flex items-center justify-between">
        <div className="text-label font-bold text-ink">{t("boot.profile.summary.title")}</div>
        <button className="btn-3d-neutral inline-flex items-center gap-1" onClick={onEdit} data-testid="boot-profile-edit">
          <PencilLine size={14} />
          {t("boot.profile.edit")}
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
        <dt className="text-ink-faint">{t("boot.profile.field.name")}</dt>
        <dd className="text-ink">{profile.name ?? t("boot.profile.field.unset")}</dd>
        <dt className="text-ink-faint">{t("boot.profile.field.mbti")}</dt>
        <dd className="text-ink">
          {profile.mbti
            ? `${profile.mbti} · ${mbtiDisplay(profile.mbti, locale).name}`
            : t("boot.profile.field.unset")}
        </dd>
        <dt className="text-ink-faint">{t("boot.profile.field.goal")}</dt>
        <dd className="text-ink">
          {profile.goal ? goalLabel(profile.goal, locale) + (profile.goalNote ? `（${profile.goalNote}）` : "") : t("boot.profile.field.unset")}
        </dd>
        <dt className="text-ink-faint">{t("boot.profile.field.style")}</dt>
        <dd className="text-ink">{leaning || t("boot.profile.field.unset")}</dd>
        {profile.freeNote && (
          <>
            <dt className="text-ink-faint">{t("boot.profile.field.free")}</dt>
            <dd className="text-ink">{profile.freeNote}</dd>
          </>
        )}
      </dl>
      {missing > 0 && (
        <div className="text-caption text-accent">{t("boot.profile.missing", { n: missing })}</div>
      )}
    </div>
  );
}

/* ================= 编辑模式:全字段一张表单 ================= */

function ProfileEditCard({ t, locale, profile, onSave, onCancel }: {
  t: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
  profile: LearnerProfile;
  onSave: (p: LearnerProfile) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<LearnerProfile>({ ...profile, style: { ...profile.style } });
  const isEn = locale === "en";
  const patch = (next: Partial<LearnerProfile>) => setP((cur) => ({ ...cur, ...next }));

  const setSceneAnswer = (dim: StyleDim, value: string) =>
    setP((cur) => ({ ...cur, style: { ...cur.style, [dim]: value } }));

  return (
    <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-profile-editcard">
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
          data-testid="boot-edit-name"
        />
      </label>

      <MbtiPickerInline
        t={t}
        locale={locale}
        value={p.mbti}
        style={p.style}
        onPick={(mbti) => { companionNodePoint(); patch({ mbti, style: expandMbtiToStyle(mbti) }); }}
        onSceneAnswer={setSceneAnswer}
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
                  data-testid={`boot-edit-scene-${q.dim}`}
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
              data-testid={`boot-edit-goal-${g}`}
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
            data-testid="boot-edit-timeline"
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
          data-testid="boot-edit-free"
        />
      </label>

      <div className="flex gap-2">
        <button
          className="btn-3d-brand inline-flex items-center gap-1.5"
          onClick={() => onSave({ ...p, updatedAt: new Date().toISOString() })}
          data-testid="boot-edit-save"
        >
          <ArrowRight size={16} />
          {t("boot.profile.save")}
        </button>
        <button className="btn-3d-neutral inline-flex items-center gap-1.5" onClick={onCancel}>
          <X size={16} />
          {t("boot.profile.cancel")}
        </button>
      </div>
    </section>
  );
}

/* ================= 场景题(向导兜底路径内联渲染) ================= */

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

/* ================= 向导三问卡流(卡1 称呼+MBTI → 卡2 目标 → 卡3 试玩) ================= */

function WizardQuizCards({ t, locale, profile, onPatch, onFinish }: {
  t: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
  profile: LearnerProfile;
  onPatch: (patch: Omit<Partial<LearnerProfile>, "style"> & { style?: Partial<LearnerProfile["style"]> }) => void;
  onFinish: () => void;
}) {
  const [card, setCard] = useState(0);
  const quiz = useMemo(() => pickBootQuiz(new Date().toISOString().slice(0, 10), locale), [locale]);
  const [quizPicked, setQuizPicked] = useState<"a" | "b" | null>(null);

  /* 卡 1:称呼 + MBTI(滚轮/场景题/跳过) */
  if (card === 0) {
    return (
      <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card1">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-faint">{t("boot.card.name.label")}</span>
          <input
            className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
            placeholder={t("boot.card.name.placeholder")}
            value={profile.name ?? ""}
            onChange={(e) => onPatch({ name: e.target.value || null })}
            data-testid="boot-wizard-name"
          />
        </label>
        <MbtiPickerInline
          t={t}
          locale={locale}
          value={profile.mbti}
          style={profile.style}
          onPick={(mbti) => { companionNodePoint(); onPatch({ mbti, style: expandMbtiToStyle(mbti) }); }}
          onSceneAnswer={(dim, value) => onPatch({ style: { [dim]: value } as Partial<LearnerProfile["style"]> })}
        />
        <button className="btn-3d-brand self-start" onClick={() => setCard(1)} data-testid="boot-wizard-next1">
          {profile.mbti || profile.style.start ? t("boot.card.mbti.next") : t("boot.card.mbti.skip")}
        </button>
      </section>
    );
  }

  /* 卡 2:为什么学(分支:面试追问时间线) */
  if (card === 1) {
    return (
      <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card2">
        <div className="text-title font-bold text-ink">{t("boot.card.goal.label")}</div>
        <div className="grid grid-cols-2 gap-2">
          {(["interview", "project", "career", "curiosity"] as const).map((g) => (
            <button
              key={g}
              className={profile.goal === g ? "btn-3d-brand" : "btn-3d-neutral"}
              onClick={() => onPatch({ goal: g })}
              data-testid={`boot-wizard-goal-${g}`}
            >
              {t(`boot.card.goal.${g}`)}
            </button>
          ))}
        </div>
        {profile.goal === "interview" && (
          <label className="flex flex-col gap-1">
            <span className="text-label text-ink-faint">{t("boot.card.goal.timeline.label")}</span>
            <input
              className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
              placeholder={t("boot.card.goal.timeline.placeholder")}
              value={profile.goalNote ?? ""}
              onChange={(e) => onPatch({ goalNote: e.target.value || null })}
              data-testid="boot-wizard-timeline"
            />
          </label>
        )}
        <button className="btn-3d-brand self-start" onClick={() => setCard(2)} data-testid="boot-wizard-next2">
          {t("boot.card.goal.next")}
        </button>
      </section>
    );
  }

  /* 卡 3:来,过一招(试玩题,不计分;答完 celebrate) */
  return (
    <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card3">
      <div className="text-title font-bold text-ink">{t("boot.card.quiz.label")}</div>
      <div className="text-body text-ink">{quiz.q}</div>
      {quizPicked === null ? (
        <div className="flex gap-2">
          <button
            className="btn-3d-brand flex-1"
            onClick={() => { setQuizPicked("a"); celebrate("correct"); }}
            data-testid="boot-wizard-quiz-a"
          >
            {quiz.a}
          </button>
          <button
            className="btn-3d-neutral flex-1"
            onClick={() => { setQuizPicked("b"); celebrate("correct"); }}
            data-testid="boot-wizard-quiz-b"
          >
            {quiz.b}
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-surface-0 p-3 text-label text-ink leading-relaxed" data-testid="boot-wizard-quiz-reveal">
            {quizPicked === "a" ? quiz.revealA : quiz.revealB}
          </div>
          <button className="btn-3d-brand self-start inline-flex items-center gap-1.5" onClick={onFinish} data-testid="boot-wizard-finish">
            <ArrowRight size={16} />
            {t("boot.card.quiz.next")}
          </button>
        </>
      )}
    </section>
  );
}

/* MBTI 内联选择(向导卡1 用:选完翻卡 + 场景题兜底同屏) */
function MbtiPickerInline({ t, locale, value, style, onPick, onSceneAnswer }: {
  t: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
  value: MbtiType | null;
  style: LearnerProfile["style"];
  onPick: (mbti: MbtiType) => void;
  onSceneAnswer: (dim: StyleDim, value: string) => void;
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
      {mode === "grid" ? (
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
          <button className="text-label text-accent underline underline-offset-2 self-start" onClick={() => setMode("scene")} data-testid="boot-mbti-dontknow">
            {t("boot.card.mbti.dontknow")}
          </button>
        </>
      ) : (
        <SceneQuestions isEn={isEn} style={style} onAnswer={onSceneAnswer} />
      )}
    </div>
  );
}
