import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "./lib/api.js";
import type {
  Course,
  ContentNode,
  Progress,
  Streak,
  Skill,
  DashboardData,
} from "@shared/types";

type ViewTab = "tree" | "dashboard";

/**
 * M1 多邻国式技能树 UI —— 替换 M0 临时列表视图（HANDOFF §8.2）。
 *
 * 视觉结构：
 *   - 顶部栏：Logo + 课程名 + Streak 徽章
 *   - Skill 模式选择条（M1 核心：调 skill:list / skill:setActive / skill:getActive）
 *   - 主内容：垂直 skill tree。每个 section 是一个"单元"，
 *     section 下的 lesson 是圆形 skill 气泡（多邻国风格），
 *     左右交错排列，用 SVG 折线连接，强化"解锁路径"的视觉路径感。
 *   - 状态：locked 灰 + 锁图；available 品牌绿 + 闪烁；in_progress 蓝边；mastered 金 + 皇冠 + Lv.
 *
 * 验证：Playwright 真GUI 测试会断言这些 DOM 结构（data-testid 锚点）。
 * 保留所有 M0 的 IPC 调用逻辑（listCourses/getCourseTree/markNodeAttempted/getStreak/getProgress），
 * 只换视图层。
 */

const BUILTIN_SKILL_ORDER = [
  "socratic-mode",
  "exam-prep-mode",
  "project-mode",
  "review-mode",
];
const SKILL_LABELS: Record<string, string> = {
  "socratic-mode": "苏格拉底",
  "exam-prep-mode": "考试冲刺",
  "project-mode": "项目实战",
  "review-mode": "复习",
};

export default function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tree, setTree] = useState<ContentNode[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [streak, setStreak] = useState<Streak | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Skill 系统（M1）
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  // M3：视图切换 + 仪表盘数据
  const [view, setView] = useState<ViewTab>("tree");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [courseList, streakData, skillList, currentSkill] = await Promise.all([
        api.listCourses(),
        api.getStreak(),
        api.listSkills(),
        api.getActiveSkill(),
      ]);
      setCourses(courseList);
      setStreak(streakData);
      setSkills(skillList);
      setActiveSkill(currentSkill);
      if (courseList.length > 0 && !selectedCourseId) {
        setSelectedCourseId(courseList[0]!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedCourseId]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedCourseId) return;
    // 拉课程树 + 预载所有 lesson 的进度（否则气泡全显示 locked，没人点过就没状态）
    api.getCourseTree(selectedCourseId).then(async (nodes) => {
      setTree(nodes);
      const lessons = nodes.filter((n) => n.type === "lesson");
      const entries = await Promise.all(
        lessons.map(async (l) => {
          const p = await api.getProgress(l.id);
          return [l.id, p] as const;
        }),
      );
      const map: Record<string, Progress> = {};
      for (const [id, p] of entries) {
        if (p) map[id] = p;
      }
      setProgressMap(map);
    }).catch(setErrorFromThrow);
    // M3：同步拉仪表盘
    api.getDashboard(selectedCourseId).then(setDashboard).catch(setErrorFromThrow);
  }, [selectedCourseId]);

  const handleLessonClick = async (node: ContentNode) => {
    try {
      await api.markNodeAttempted(node.id);
      const [progress, newStreak] = await Promise.all([
        api.getProgress(node.id),
        api.getStreak(),
      ]);
      if (progress) {
        setProgressMap((m) => ({ ...m, [node.id]: progress }));
      }
      setStreak(newStreak);
    } catch (e) {
      setErrorFromThrow(e);
    }
  };

  const handleSkillPick = async (name: string) => {
    try {
      await api.setActiveSkill(name);
      setActiveSkill(name);
    } catch (e) {
      setErrorFromThrow(e);
    }
  };

  const currentCourse = courses.find((c) => c.id === selectedCourseId);
  const sections = useMemo(
    () =>
      tree
        .filter((n) => n.type === "section")
        .sort((a, b) => a.orderIdx - b.orderIdx),
    [tree],
  );

  // 排好序的内置 skill 优先，用户自定义在后
  const orderedSkills = useMemo(() => {
    const builtin = BUILTIN_SKILL_ORDER.map((name) =>
      skills.find((s) => s.name === name),
    ).filter((s): s is Skill => !!s);
    const custom = skills.filter((s) => !BUILTIN_SKILL_ORDER.includes(s.name));
    return [...builtin, ...custom];
  }, [skills]);

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <Header streak={streak} />

      <SkillPicker
        skills={orderedSkills}
        activeSkill={activeSkill}
        onPick={handleSkillPick}
      />

      <ViewTabs view={view} onChange={setView} />

      <main className="flex-1 overflow-auto px-6 py-6">
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

        {view === "tree" ? (
          <div className="max-w-2xl mx-auto" data-testid="skill-tree">
            <h2 className="text-2xl font-bold mb-1">
              {currentCourse?.title ?? "加载中..."}
            </h2>
            <p className="text-neutral-400 text-sm mb-6">
              {currentCourse?.description}
            </p>

            {sections.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-10">
                {sections.map((section, sIdx) => (
                  <SectionUnit
                    key={section.id}
                    section={section}
                    sectionIndex={sIdx}
                    tree={tree}
                    progressMap={progressMap}
                    onLessonClick={handleLessonClick}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <DashboardView dashboard={dashboard} />
        )}
      </main>

      <Footer
        courseCount={courses.length}
        lessonCount={tree.filter((n) => n.type === "lesson").length}
      />
    </div>
  );
}

/* ---------- 顶部栏 ---------- */

function Header({ streak }: { streak: Streak | null }) {
  return (
    <header className="border-b border-neutral-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Logo />
        <h1 className="text-lg font-bold tracking-tight">LookatStudy</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
          v0.1.0 · M1
        </span>
      </div>
      {streak && <StreakBadge streak={streak} />}
    </header>
  );
}

/* ---------- Skill 模式选择条（M1 核心 UI） ---------- */

function SkillPicker({
  skills,
  activeSkill,
  onPick,
}: {
  skills: Skill[];
  activeSkill: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <div
      className="border-b border-neutral-800 bg-neutral-900/50 px-6 py-2 flex items-center gap-2 overflow-x-auto"
      data-testid="skill-picker"
    >
      <span className="text-xs text-neutral-500 mr-2 shrink-0">学习模式：</span>
      {skills.length === 0 ? (
        <span className="text-xs text-neutral-600">加载中…</span>
      ) : (
        skills.map((s) => {
          const isActive = s.name === activeSkill;
          const label = SKILL_LABELS[s.name] ?? s.name;
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.name)}
              title={s.description}
              data-testid={`skill-pill-${s.name}`}
              className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-brand bg-brand/20 text-brand font-semibold"
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          );
        })
      )}
    </div>
  );
}

/* ---------- 视图切换 tabs（M3） ---------- */

function ViewTabs({
  view,
  onChange,
}: {
  view: ViewTab;
  onChange: (v: ViewTab) => void;
}) {
  return (
    <div
      className="border-b border-neutral-800 px-6 flex gap-1"
      data-testid="view-tabs"
    >
      <TabButton
        active={view === "tree"}
        onClick={() => onChange("tree")}
        label="技能树"
        testid="tab-tree"
      />
      <TabButton
        active={view === "dashboard"}
        onClick={() => onChange("dashboard")}
        label="仪表盘"
        testid="tab-dashboard"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? "border-brand text-brand font-semibold"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );
}

/* ---------- 仪表盘视图（M3：掌握度热力图 + SRS 到期 + streak） ---------- */

function DashboardView({ dashboard }: { dashboard: DashboardData | null }) {
  if (!dashboard) {
    return (
      <div className="text-neutral-500 text-center py-12">仪表盘加载中…</div>
    );
  }
  const masteryPct = Math.round(dashboard.overallMastery * 100);
  return (
    <div className="max-w-2xl mx-auto" data-testid="dashboard">
      {/* 顶部 stat 卡 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard
          testid="stat-streak"
          icon="🔥"
          value={String(dashboard.currentStreak)}
          label="连续天数"
          sub={`freeze ${dashboard.freezeCount}`}
        />
        <StatCard
          testid="stat-due"
          icon="📖"
          value={String(dashboard.dueToday)}
          label="今日待复习"
          sub={dashboard.dueToday > 0 ? "去复习" : "已清空"}
        />
        <StatCard
          testid="stat-mastery"
          icon="🎯"
          value={`${masteryPct}%`}
          label="整体掌握度"
          sub={masteryPct >= 70 ? "不错" : masteryPct >= 40 ? "进行中" : "刚开始"}
        />
      </div>

      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        掌握度热力图（按章节）
      </h3>
      <div className="space-y-2" data-testid="mastery-heatmap">
        {dashboard.sections.length === 0 ? (
          <div className="text-neutral-500 text-sm">暂无章节数据</div>
        ) : (
          dashboard.sections.map((s) => (
            <HeatmapRow key={s.sectionId} section={s} />
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  sub,
  testid,
}: {
  icon: string;
  value: string;
  label: string;
  sub?: string;
  testid: string;
}) {
  return (
    <div
      className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3"
      data-testid={testid}
    >
      <div className="text-xs text-neutral-500 mb-1">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold text-neutral-100">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function HeatmapRow({ section }: { section: DashboardData["sections"][number] }) {
  const pct = Math.round(section.avgMastery * 100);
  // 热力色：< 30 红，< 70 橙，>= 70 绿
  const barColor =
    pct >= 70
      ? "bg-brand"
      : pct >= 30
        ? "bg-orange-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-xs text-neutral-300 truncate" title={section.sectionTitle}>
        {section.sectionTitle}
      </div>
      <div className="flex-1 h-6 bg-neutral-800 rounded overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="w-16 text-xs text-neutral-400 text-right">
        {pct}% · {section.masteredCount}/{section.lessonCount}
      </div>
    </div>
  );
}

/* ---------- 单元（section） ---------- */

function SectionUnit({
  section,
  sectionIndex,
  tree,
  progressMap,
  onLessonClick,
}: {
  section: ContentNode;
  sectionIndex: number;
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  onLessonClick: (n: ContentNode) => void;
}) {
  const lessons = tree
    .filter((n) => n.parentId === section.id)
    .sort((a, b) => a.orderIdx - b.orderIdx);

  return (
    <section data-testid={`section-unit-${sectionIndex}`}>
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
          单元 {sectionIndex + 1}
        </span>
        <span className="text-neutral-700">·</span>
        <h3 className="text-sm font-semibold text-neutral-300">
          {section.title}
        </h3>
      </div>

      <div className="relative">
        {/* SVG 连接线，画在气泡之间，强化路径感 */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          {lessons.slice(0, -1).map((_, i) => {
            // 左右交错：偶数偏左，奇数偏右
            const left = i % 2 === 0;
            const nextLeft = (i + 1) % 2 === 0;
            const x1 = left ? "32%" : "68%";
            const x2 = nextLeft ? "32%" : "68%";
            const y1 = `${(i / lessons.length) * 100 + 6}%`;
            const y2 = `${((i + 1) / lessons.length) * 100 - 6}%`;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${x1} ${(parseInt(y1) + parseInt(y2)) / 2}%, ${x2} ${(parseInt(y1) + parseInt(y2)) / 2}%, ${x2} ${y2}`}
                stroke="rgb(63 63 70)"
                strokeWidth={2}
                fill="none"
                strokeDasharray="4 4"
              />
            );
          })}
        </svg>

        <ol className="relative space-y-5">
          {lessons.map((lesson, i) => (
            <LessonBubble
              key={lesson.id}
              lesson={lesson}
              index={i}
              progress={progressMap[lesson.id]}
              onClick={onLessonClick}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- 单个 skill 气泡（多邻国风格） ---------- */

function LessonBubble({
  lesson,
  index,
  progress,
  onClick,
}: {
  lesson: ContentNode;
  index: number;
  progress?: Progress;
  onClick: (n: ContentNode) => void;
}) {
  const status = progress?.status ?? "locked";
  const crown = progress?.crownLevel ?? 0;
  const alignLeft = index % 2 === 0; // 交错布局

  // 主题色
  const theme =
    status === "locked"
      ? "bg-neutral-800 border-neutral-700 text-neutral-600"
      : status === "mastered"
        ? "bg-gradient-to-br from-yellow-500/30 to-amber-600/20 border-yellow-500/50 text-yellow-200"
        : status === "in_progress"
          ? "bg-gradient-to-br from-brand/30 to-brand/10 border-brand/60 text-brand"
          : "bg-gradient-to-br from-brand/25 to-brand/5 border-brand/50 text-brand";

  const isLocked = status === "locked";

  return (
    <li
      className={`flex ${alignLeft ? "justify-start" : "justify-end"}`}
      data-testid={`lesson-bubble-${lesson.id.slice(0, 8)}`}
    >
      <button
        onClick={() => !isLocked && onClick(lesson)}
        disabled={isLocked}
        className={`group relative w-20 h-20 rounded-full border-2 ${theme} transition-all ${
          isLocked
            ? "cursor-not-allowed"
            : "hover:scale-105 active:scale-95 shadow-lg"
        } ${status === "available" ? "animate-pulse" : ""}`}
        title={lesson.title}
      >
        {/* 皇冠 / 锁图标层 */}
        <div className="absolute inset-0 flex items-center justify-center text-2xl">
          {isLocked ? (
            <span aria-label="locked">🔒</span>
          ) : status === "mastered" ? (
            <span aria-label="mastered">👑</span>
          ) : (
            <span aria-label={status}>⭐</span>
          )}
        </div>

        {/* 皇冠等级（mastered 时显示） */}
        {status === "mastered" && crown > 0 && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-yellow-500 text-neutral-900 px-1.5 rounded-full">
            Lv.{crown}
          </span>
        )}
      </button>

      {/* lesson 标题（气泡下方） */}
      <div
        className={`absolute mt-[88px] text-xs text-neutral-500 max-w-[140px] leading-tight ${
          alignLeft ? "text-left" : "text-right"
        }`}
        style={{ width: "140px" }}
      >
        {lesson.title}
      </div>
    </li>
  );
}

/* ---------- 杂项小组件 ---------- */

function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-900 text-red-200 text-sm">
      ⚠️ {message}
      <button className="ml-3 underline text-red-300" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-neutral-500 text-center py-12">
      <p>课程树为空。M0 阶段应在启动时自动种子化 Awesome-FDE-Roadmap。</p>
      <p className="text-xs mt-2">
        如果看到这里，检查主进程 ensureSeedCourse() 是否执行。
      </p>
    </div>
  );
}

function StreakBadge({ streak }: { streak: Streak }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30"
      data-testid="streak-badge"
    >
      <span className="text-orange-400">🔥</span>
      <span className="text-sm font-bold text-orange-300">
        {streak.currentStreak}
      </span>
      <span className="text-xs text-orange-400/70">天</span>
    </div>
  );
}

function Logo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-accent flex items-center justify-center text-white font-bold text-sm">
      R
    </div>
  );
}

function Footer({
  courseCount,
  lessonCount,
}: {
  courseCount: number;
  lessonCount: number;
}) {
  return (
    <footer className="border-t border-neutral-800 px-6 py-2 text-xs text-neutral-500 flex justify-between">
      <span>
        {courseCount} 门课程 · {lessonCount} 节课
      </span>
      <span>M1 · Skill 系统 + 技能树 UI</span>
    </footer>
  );
}

function setErrorFromThrow(e: unknown) {
  // eslint-disable-next-line no-console
  console.error(e);
}
