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
import { Sparkles, KeyRound, GraduationCap, Play, BookOpen, Flame, ClipboardList, Trophy, LifeBuoy, FileText, PencilLine, ArrowRight, Import, Bot } from "lucide-react";
import { api } from "../lib/api.js";
import { useLang, useLangValue } from "../lib/i18n.js";
import { celebrate } from "../lib/celebration.js";
import { companionZoneFocus, companionNodePoint } from "../lib/companion/bus.js";
import { ProfileEditForm, MbtiPickerInline } from "./ProfileEditForm.js";
import {
  computeBootGuide,
  BOOT_WIZARD_STEPS,
  type BootStateResult,
} from "@shared/boot-guide";
import {
  expandMbtiToStyle,
  mbtiDisplay,
  styleLeaningLine,
  motiveDisplay,
  MOTIVE_STAGES,
  emptyProfile,
  hasProfileContent,
  parseInterestsInput,
  type LearnerProfile,
} from "@shared/learner-profile";
import { pickBootQuiz } from "@shared/boot-quiz";

export interface BootGuidePanelProps {
  /** 一键恢复上次课程(+节点) */
  onResume: (courseId: string, nodeId: string | null) => void;
  /** 打开复习抽屉(带到期项最多的课程 id——未选课时宿主先切课再开,否则抽屉是空的) */
  onOpenReview: (reviewCourseId: string | null) => void;
  /** 打开设置(带定位区段:如 "companion" → 滚动到伴学伙伴区) */
  onOpenSettings: (section?: string) => void;
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
  start_import: <Import size={16} />,
  companion_settings: <Bot size={16} />,
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
  streak_danger: <Flame size={22} className="text-review" />,
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

  // 向导语义保持:一旦走进步进(step≥1)就以向导场景渲染直到离场——quiz 完成即置
  // boot_done(重开 app 不重播),但 course_pick 收尾步仍然展示;离场后 step 归零走回访逻辑。
  const guide = useMemo(
    () => (boot ? computeBootGuide({ ...boot, bootDone: boot.bootDone && wizardStep === 0, wizardStep }) : null),
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
      } else if (kind === "start_import") {
        // 向导末步主动作:左栏开导入页,伴学解除中栏召唤飞回左栏老家指引
        companionZoneFocus(false);
        companionNodePoint();
        props.onPickCourse();
      } else if (kind === "companion_settings") {
        props.onOpenSettings("companion");
      } else if (kind === "pick_course") {
        finishBoot();
        props.onPickCourse();
      } else if (kind === "resume" && boot.targets.resume) {
        finishBoot();
        props.onResume(boot.targets.resume.courseId, boot.targets.resume.nodeId);
      } else if (kind === "review") {
        props.onOpenReview(boot.targets.reviewCourseId);
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
    [boot, guide, finishBoot, props],
  );

  if (!boot || !guide) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="boot-guide-loading">
        <div className="text-label text-ink-faint">{t("boot.welcome.title")}</div>
      </div>
    );
  }

  /* 称呼插值:无条件喂 name 槽——有称呼填称呼(en 半角逗号),无名清空。
     旧写法只在场景行自带 name 变量时才填,孤立渲染的 "{name}欢迎回来!" 对
     有名用户漏字面量;而多余变量对不含 {name} 的模板无副作用,恒填最稳。 */
  const namePrefix = (boot.name ?? "").trim();
  const decorateVars = (key: string, vars?: Record<string, string | number>) => {
    return t(key, { name: namePrefix ? (locale === "en" ? `${namePrefix}, ` : `${namePrefix}，`) : "", ...vars });
  };

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8"
      data-testid="boot-guide"
      data-scene={guide.scene}
      data-boot-done={boot.bootDone ? "1" : "0"}
    >
      <div className="mx-auto max-w-md flex flex-col gap-4" data-companion-anchor="boot-guide">
        {guide.welcomeBack && !editing && (
          <div className="text-center text-body text-accent font-bold" data-testid="boot-welcome-back">
            {decorateVars("boot.welcome_back")}
          </div>
        )}

        {/* ===== 场景主卡 ===== */}
        {/* 向导三问步(profile_quiz):场景卡只留题面,动作行与外层步进点让位给子卡流
            (此前双卡双主按钮,且上卡"继续"实为跳过整场问答——语义错位) */}
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

            {!(guide.scene === "profile_quiz" && wizardStep === 2) && (
              <div className="flex flex-wrap gap-2 mt-1">
                {guide.actions.map((a) => (
                  <button
                    key={a.kind + (a.target ?? "")}
                    className={a === guide.actions[0]
                      ? "btn-3d-brand inline-flex items-center gap-1.5 px-4 py-2"
                      : "btn-3d-neutral inline-flex items-center gap-1.5 px-4 py-2"}
                    onClick={() => runAction(a.kind, a.target)}
                    data-testid={`boot-action-${a.kind}`}
                  >
                    {ACTION_ICON[a.kind]}
                    {t(a.labelKey, a.kind === "review" && boot.dueCount > 0 ? { n: boot.dueCount } : undefined)}
                  </button>
                ))}
              </div>
            )}

            {/* 向导步进指示(三问步隐藏:子卡有自己的 1/3→3/3 子步进,避免外层点冻结在原位) */}
            {!boot.bootDone && !(guide.scene === "profile_quiz" && wizardStep === 2) && (
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
          <div className="surface-card rounded-2xl p-6 shadow-card">
          <ProfileEditForm
            t={t}
            locale={locale}
            profile={profile}
            onSave={(p) => { saveProfile(p); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
          </div>
        ) : !boot.bootDone && wizardStep === 2 ? (
          <>
            <WizardQuizCards
              t={t}
              locale={locale}
              profile={profile}
              onPatch={(patch) => saveProfile({ ...profile, ...patch, style: { ...profile.style, ...patch.style }, updatedAt: new Date().toISOString() })}
              onFinish={() => { finishBoot(); setWizardStep(3); }}
            />
            {/* 诚实出口:整场三问可整体跳过(此前藏在场景卡"继续"里,语义错位) */}
            <button
              className="self-start text-label text-ink-faint hover:text-ink transition-colors px-1 py-1.5"
              onClick={() => runAction("wizard_next")}
              data-testid="boot-wizard-skip-quiz"
            >
              {t("boot.action.skip_quiz")}
            </button>
          </>
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
    !profile.name, !profile.mbti, !profile.motiveStage, !(profile.interests?.length),
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
        <dt className="text-ink-faint">{t("boot.profile.field.motive")}</dt>
        <dd className="text-ink">
          {profile.motiveStage
            ? `${motiveDisplay(profile.motiveStage, locale).name}——${motiveDisplay(profile.motiveStage, locale).tagline}`
            : t("boot.profile.field.unset")}
        </dd>
        <dt className="text-ink-faint">{t("profile.field.interests")}</dt>
        <dd className="text-ink">
          {profile.interests?.length ? profile.interests.join(locale === "en" ? ", " : "、") : t("boot.profile.field.unset")}
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
  /* 兴趣输入的原始文本态:显示不再从 parse→join 重导出(旧实现每敲一个分隔符就被吞掉) */
  const [interestsText, setInterestsText] = useState(() => profile.interests?.join(locale === "en" ? ", " : "、") ?? "");
  const interestsSep = locale === "en" ? ", " : "、";

  /* 子步进 1/3→3/3(三问步隐藏外层四步点,进度语义由子卡自己承载) */
  const subDots = (
    <div className="flex gap-1.5" data-testid="boot-wizard-subdots">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all ${i === card ? "w-6 bg-brand" : "w-2 bg-neutral-300 dark:bg-neutral-700"}`} />
      ))}
    </div>
  );

  /* 卡 1:称呼 + MBTI(滚轮/场景题/跳过) */
  if (card === 0) {
    return (
      <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card1">
        {subDots}
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
          onPick={(mbti) => { companionNodePoint(); onPatch({ mbti, style: expandMbtiToStyle(mbti) }); }}
        />
        <button className="btn-3d-brand self-start px-4 py-2" onClick={() => setCard(1)} data-testid="boot-wizard-next1">
          {profile.mbti ? t("boot.card.mbti.next") : t("boot.card.mbti.skip")}
        </button>
      </section>
    );
  }

  /* 卡 2:动机阶段诊断(五选一单选+翻卡确认;兴趣) */
  if (card === 1) {
    return (
      <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card2">
        {subDots}
        <div className="text-title font-bold text-ink">
          {profile.name ? t("boot.card.motive.named", { name: profile.name }) : t("boot.card.motive.label")}
        </div>
        <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label={t("boot.card.motive.label")} data-testid="boot-motive-grid">
          {MOTIVE_STAGES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={profile.motiveStage === m}
              className={profile.motiveStage === m ? "btn-3d-brand text-left px-3 py-2.5" : "btn-3d-neutral text-left px-3 py-2.5"}
              onClick={() => { companionNodePoint(); onPatch({ motiveStage: m }); }}
              data-testid={`boot-wizard-motive-${m}`}
            >
              {motiveDisplay(m, locale).name}
            </button>
          ))}
        </div>
        {profile.motiveStage && (
          <div className="reveal-enter rounded-xl bg-surface-0 p-3 flex flex-col gap-1" data-testid="boot-motive-flip">
            <div className="text-label text-ink-muted">{motiveDisplay(profile.motiveStage, locale).tagline}</div>
            <div className="text-label text-accent">{motiveDisplay(profile.motiveStage, locale).bot}</div>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-faint">{t("boot.card.interests.label")}</span>
          <input
            className="bg-surface-0 rounded-lg px-3 py-2 text-body text-ink outline-none focus:ring-2 focus:ring-accent"
            placeholder={t("boot.card.interests.placeholder")}
            value={interestsText}
            onChange={(e) => {
              setInterestsText(e.target.value);
              onPatch({ interests: parseInterestsInput(e.target.value) });
            }}
            onBlur={() => setInterestsText(profile.interests?.join(interestsSep) ?? "")}
            data-testid="boot-wizard-interests"
          />
        </label>
        <button className="btn-3d-brand self-start px-4 py-2" onClick={() => setCard(2)} data-testid="boot-wizard-next2">
          {t("boot.card.motive.next")}
        </button>
      </section>
    );
  }

  /* 卡 3:来,过一招(试玩题,不计分;庆祝粒子只在更站得住的一侧触发——
     旧版两侧都放 correct,与 reveal 文案"差一点!"矛盾) */
  return (
    <section className="surface-card rounded-2xl p-6 shadow-card flex flex-col gap-4" data-testid="boot-wizard-card3">
      {subDots}
      <div className="text-title font-bold text-ink">{t("boot.card.quiz.label")}</div>
      <div className="text-body text-ink">{quiz.q}</div>
      {quizPicked === null ? (
        <div className="flex gap-2" role="radiogroup" aria-label={quiz.q}>
          <button
            role="radio"
            aria-checked={false}
            className="btn-3d-neutral flex-1 px-3 py-2.5"
            onClick={() => { setQuizPicked("a"); if (quiz.better === "a") celebrate("correct"); }}
            data-testid="boot-wizard-quiz-a"
          >
            {quiz.a}
          </button>
          <button
            role="radio"
            aria-checked={false}
            className="btn-3d-neutral flex-1 px-3 py-2.5"
            onClick={() => { setQuizPicked("b"); if (quiz.better === "b") celebrate("correct"); }}
            data-testid="boot-wizard-quiz-b"
          >
            {quiz.b}
          </button>
        </div>
      ) : (
        <>
          <div className="reveal-enter rounded-xl bg-surface-0 p-3 text-label text-ink leading-relaxed" data-testid="boot-wizard-quiz-reveal">
            {quizPicked === "a" ? quiz.revealA : quiz.revealB}
          </div>
          <button className="btn-3d-brand self-start inline-flex items-center gap-1.5 px-4 py-2" onClick={onFinish} data-testid="boot-wizard-finish">
            <ArrowRight size={16} />
            {t("boot.card.quiz.next")}
          </button>
        </>
      )}
    </section>
  );
}
