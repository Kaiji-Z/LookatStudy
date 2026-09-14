/**
 * 开屏导师（Boot Guide）状态机 —— 纯函数，输入全为现成数据源（SPEC §2.1）。
 *
 * 定位：
 *   - 每次启动未选课态中栏渲染的开屏建议：初次走欢迎向导（bot 主持），
 *     回访按"继续上次/复习到期 > 火焰 > 考试 > 快毕业 > 卡点 > 就绪教室"排序。
 *   - 台词全部由渲染层按 i18n key + vars 解析（本地模板，零 LLM，瞬时确定性）。
 *   - 引导屏不是 gate：actions 是一键入口（继续/复习/选课），点击即恢复正常态。
 */

export type BootScene =
  | "welcome_intro"
  | "key_setup"
  | "profile_quiz"
  | "course_pick"
  | "resume_last"
  | "review_due"
  | "streak_danger"
  | "friction_revisit"
  | "near_mastery"
  | "exam_suspended"
  | "ready_room";

export type BootActionKind =
  | "wizard_next"    // 向导下一步
  | "settings_llm"   // 直达设置页 LLM 配置区
  | "pick_course"    // 去左栏选课/导入
  | "resume"         // 一键恢复上次课程+节点
  | "review"         // 打开复习
  | "goto_node"      // 跳到指定节点（卡点/快毕业/考试各带 target）
  | "edit_profile";  // 编辑/补全画像

export interface BootAction {
  kind: BootActionKind;
  /** i18n key（boot.action.*） */
  labelKey: string;
  /** goto_node 的目标语义：friction | near_mastery | exam */
  target?: "friction" | "near_mastery" | "exam";
}

export interface BootGuideLine {
  key: string;
  vars?: Record<string, string | number>;
}

export type BootMood = "wave" | "thinking" | "cheer" | "star" | "idle";

export interface BootGuideInputs {
  /** LLM key 已配置（agent:isReady） */
  hasKey: boolean;
  /** boot 向导已走完（settings boot_done；看完即置位，全跳过也置位，永不重播） */
  bootDone: boolean;
  /** 向导步进（0=welcome 1=key 2=quiz 3=pick；组件持有，每步喂回重算） */
  wizardStep: number;
  /** key 主动提示已被用户关掉（key_prompt_count ≥ 2 后不再提） */
  keyPromptDismissed: boolean;
  /** 画像有任何可用内容 */
  profileFilled: boolean;
  /** 称呼（开场行插值） */
  name: string | null;
  hasCourses: boolean;
  /** 上次会话（last_session 存在且课程仍在；nodeTitle 可空） */
  lastSession: { courseTitle: string; nodeTitle: string | null } | null;
  /** SRS 到期复习数 */
  dueCount: number;
  /** streak 状态（getStreak 推导） */
  streak: { todayDone: boolean; atRisk: boolean; hoursLeft: number } | null;
  topFrictionNodeTitle: string | null;
  nearMasteryNodeTitle: string | null;
  suspendedExamNodeTitle: string | null;
  /** 隔天回归（lastActiveDate < 今天；叠加开场行 + 星星眼） */
  returningAfterDays: boolean;
}

export interface BootGuideState {
  scene: BootScene;
  /** companion 场景表情提示（bus 剧本消费） */
  mood: BootMood;
  lines: BootGuideLine[];
  actions: BootAction[];
  welcomeBack: boolean;
}

function wizardScene(inputs: BootGuideInputs): BootGuideState {
  const step = inputs.wizardStep;
  // key 步每步重查 isReady：已有 key 自动跳过（SPEC "可续走"）
  if (step <= 1 && inputs.hasKey && step === 1) {
    return {
      scene: "profile_quiz",
      mood: "cheer",
      lines: [{ key: "boot.profile_quiz.title" }, { key: "boot.profile_quiz.desc" }],
      actions: [
        { kind: "wizard_next", labelKey: "boot.action.wizard_next" },
      ],
      welcomeBack: false,
    };
  }
  if (step <= 0) {
    return {
      scene: "welcome_intro",
      mood: "wave",
      lines: [
        { key: "boot.welcome.title" },
        { key: "boot.welcome.desc", vars: { name: inputs.name ?? "" } },
        { key: "boot.welcome.forms" },
      ],
      actions: [{ kind: "wizard_next", labelKey: "boot.action.hello" }],
      welcomeBack: false,
    };
  }
  if (step === 1) {
    return {
      scene: "key_setup",
      mood: "thinking",
      lines: [
        { key: "boot.key.title" },
        { key: "boot.key.desc" },
      ],
      actions: [
        { kind: "settings_llm", labelKey: "boot.action.go_settings" },
        { kind: "wizard_next", labelKey: "boot.action.later" },
      ],
      welcomeBack: false,
    };
  }
  if (step === 2) {
    return {
      scene: "profile_quiz",
      mood: "cheer",
      lines: [
        { key: "boot.profile_quiz.title" },
        { key: "boot.profile_quiz.desc" },
      ],
      actions: [
        { kind: "wizard_next", labelKey: inputs.profileFilled ? "boot.action.done_quiz" : "boot.action.wizard_next" },
      ],
      welcomeBack: false,
    };
  }
  return {
    scene: "course_pick",
    mood: "star",
    lines: [
      { key: "boot.pick.title" },
      { key: "boot.pick.desc" },
    ],
    actions: [
      { kind: "pick_course", labelKey: "boot.action.pick_course" },
      { kind: "wizard_next", labelKey: "boot.action.finish" },
    ],
    welcomeBack: false,
  };
}

function returningScene(inputs: BootGuideInputs): BootGuideState {
  // 排序（SPEC §2.1）："继续上次/复习到期"优先于一切个性化问候；
  // 其后 火焰告急 > 考试中断 > 快毕业 > 卡点回访 > 就绪教室。
  const secondary: BootAction[] = [];

  if (inputs.lastSession && inputs.hasCourses) {
    if (inputs.dueCount > 0) secondary.push({ kind: "review", labelKey: "boot.action.review_n" });
    if (!inputs.profileFilled) secondary.push({ kind: "edit_profile", labelKey: "boot.action.edit_profile" });
    return {
      scene: "resume_last",
      mood: "wave",
      lines: [
        {
          key: "boot.resume.title",
          vars: {
            course: inputs.lastSession.courseTitle,
            node: inputs.lastSession.nodeTitle ?? "",
          },
        },
        { key: "boot.resume.desc" },
        ...(inputs.dueCount > 0 ? [{ key: "boot.resume.due", vars: { n: inputs.dueCount } }] : []),
      ],
      actions: [
        { kind: "resume", labelKey: "boot.action.resume" },
        ...secondary.slice(0, 2),
      ],
      welcomeBack: false,
    };
  }

  if (inputs.dueCount > 0) {
    const s: BootAction[] = [];
    if (!inputs.profileFilled) s.push({ kind: "edit_profile", labelKey: "boot.action.edit_profile" });
    return {
      scene: "review_due",
      mood: "cheer",
      lines: [
        { key: "boot.review.title", vars: { n: inputs.dueCount } },
        { key: "boot.review.desc" },
      ],
      actions: [
        { kind: "review", labelKey: "boot.action.review" },
        ...s.slice(0, 2),
      ],
      welcomeBack: false,
    };
  }

  if (inputs.streak && !inputs.streak.todayDone && inputs.streak.atRisk) {
    return {
      scene: "streak_danger",
      mood: "star",
      lines: [
        { key: "boot.streak.title", vars: { hours: Math.max(1, Math.round(inputs.streak.hoursLeft)) } },
        { key: "boot.streak.desc" },
      ],
      actions: [
        { kind: "review", labelKey: "boot.action.keep_flame" },
        { kind: "pick_course", labelKey: "boot.action.pick_course" },
      ],
      welcomeBack: false,
    };
  }

  if (inputs.suspendedExamNodeTitle) {
    return {
      scene: "exam_suspended",
      mood: "thinking",
      lines: [
        { key: "boot.exam.title", vars: { node: inputs.suspendedExamNodeTitle } },
        { key: "boot.exam.desc" },
      ],
      actions: [
        { kind: "goto_node", labelKey: "boot.action.continue_exam", target: "exam" },
        { kind: "review", labelKey: "boot.action.review" },
      ],
      welcomeBack: false,
    };
  }

  if (inputs.nearMasteryNodeTitle) {
    return {
      scene: "near_mastery",
      mood: "star",
      lines: [
        { key: "boot.mastery.title", vars: { node: inputs.nearMasteryNodeTitle } },
        { key: "boot.mastery.desc" },
      ],
      actions: [
        { kind: "goto_node", labelKey: "boot.action.finish_it", target: "near_mastery" },
        { kind: "review", labelKey: "boot.action.review" },
      ],
      welcomeBack: false,
    };
  }

  if (inputs.topFrictionNodeTitle) {
    return {
      scene: "friction_revisit",
      mood: "thinking",
      lines: [
        { key: "boot.friction.title", vars: { node: inputs.topFrictionNodeTitle } },
        { key: "boot.friction.desc" },
      ],
      actions: [
        { kind: "goto_node", labelKey: "boot.action.retry", target: "friction" },
        { kind: "review", labelKey: "boot.action.review" },
      ],
      welcomeBack: false,
    };
  }

  // 就绪教室（默认态）：画像摘要 + 引导选课；无 key 时带一行小字提示（可被关掉）。
  return {
    scene: "ready_room",
    mood: "idle",
    lines: [
      { key: "boot.ready.title", vars: { name: inputs.name ?? "" } },
      { key: inputs.profileFilled ? "boot.ready.profile_done" : "boot.ready.profile_empty" },
      ...(inputs.hasCourses ? [{ key: "boot.ready.has_courses" }] : [{ key: "boot.ready.desc" }]),
      ...(!inputs.hasKey && !inputs.keyPromptDismissed ? [{ key: "boot.ready.key_hint" }] : []),
    ],
    actions: [
      ...(inputs.hasCourses
        ? [{ kind: "pick_course", labelKey: "boot.action.pick_course" } as BootAction]
        : [{ kind: "pick_course", labelKey: "boot.action.import_course" } as BootAction]),
      { kind: "edit_profile", labelKey: inputs.profileFilled ? "boot.action.view_profile" : "boot.action.meet_me" },
    ],
    welcomeBack: false,
  };
}

/**
 * 计算启动引导态。初次（!bootDone）走向导；回访按优先级出主场景 + 次 action（≤2）。
 * welcomeBack 单独置位（叠加开场行 + companion 星星眼），不改场景排序。
 */
export function computeBootGuide(inputs: BootGuideInputs): BootGuideState {
  const state = inputs.bootDone ? returningScene(inputs) : wizardScene(inputs);
  if (!inputs.bootDone) return { ...state, welcomeBack: false };
  return { ...state, welcomeBack: inputs.returningAfterDays };
}

/** boot 向导总步数（渲染层进度条用）。 */
export const BOOT_WIZARD_STEPS = 4;

/* ---------- 主进程聚合结果(boot:getState 单往返) ---------- */

/** 引导动作需要的目标 id(渲染层执行 resume/goto_node 用;与展示用标题分离)。 */
export interface BootTargets {
  resume: { courseId: string; nodeId: string | null } | null;
  frictionNodeId: string | null;
  nearMasteryNodeId: string | null;
  examNodeId: string | null;
}

/** gatherBootState 的返回:状态机输入 + 执行目标。 */
export interface BootStateResult extends BootGuideInputs {
  targets: BootTargets;
}
