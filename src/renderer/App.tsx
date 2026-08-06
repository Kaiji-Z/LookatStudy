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
import { Sidebar } from "./components/Sidebar.js";
import { Divider } from "./components/Divider.js";
import { ImportView } from "./components/ImportView.js";

type ViewTab = "tree" | "dashboard" | "settings" | "import";

/**
 * 双栏布局：左聊天 + 右技能树（可拖拽分隔线，可折叠）。
 *
 * - 顶部：Header + SkillPicker（横跨全宽）
 * - 下方 flex 横向：Sidebar(聊天) + Divider + 右栏(技能树/仪表盘)
 * - 点右栏 lesson → 设 selectedNodeId → 左栏 ChatPanel 联动该节点的 AI 对话
 */

const BUILTIN_SKILL_ORDER = [
  "socratic-mode",
  "exam-prep-mode",
  "project-mode",
  "review-mode",
];

const DEFAULT_CHAT_WIDTH_PCT = 38;
const MIN_CHAT_WIDTH_PCT = 20;
const MAX_CHAT_WIDTH_PCT = 60;

export default function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tree, setTree] = useState<ContentNode[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [streak, setStreak] = useState<Streak | null>(null);
  const [xp, setXp] = useState<{ todayXp: number; dailyGoal: number; achieved: boolean; pct: number } | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Skill 系统（M1）
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  // M3：视图切换 + 仪表盘数据
  const [view, setView] = useState<ViewTab>("tree");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  // 双栏布局态
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH_PCT);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  // 当前选中的 lesson（供 ChatPanel 联动）
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => tree.find((n) => n.id === selectedNodeId) ?? null,
    [tree, selectedNodeId],
  );

  const refreshAll = useCallback(async () => {
    try {
      const [courseList, streakData, skillList, currentSkill, xpData] = await Promise.all([
        api.listCourses(),
        api.getStreak(),
        api.listSkills(),
        api.getActiveSkill(),
        api.getXpStatus(),
      ]);
      setCourses(courseList);
      setStreak(streakData);
      setSkills(skillList);
      setXp(xpData);
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

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Esc → 停止正在流的回复（如果有 selectedNodeId）
      if (e.key === "Escape" && selectedNodeId) {
        api.abortAgentChat(selectedNodeId).catch(() => {});
      }
      // Ctrl+K / Cmd+K → 切换到技能树视图
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setView("tree");
      }
      // 数字键 1/2/3 → 切换右栏视图（非输入框焦点时）
      if (!e.target || !(e.target as HTMLElement).matches("input, textarea, select")) {
        if (e.key === "1") setView("tree");
        if (e.key === "2") setView("dashboard");
        if (e.key === "3") setView("import");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!selectedCourseId) return;
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
    api.getDashboard(selectedCourseId).then(setDashboard).catch(setErrorFromThrow);
  }, [selectedCourseId]);

  // 点 lesson：标记 attempted + 解锁下一课 + 设为当前选中节点（联动聊天栏）+ 展开左栏
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
      setSelectedNodeId(node.id); // 联动聊天栏
      setChatCollapsed(false); // 点 lesson 自动展开左栏，让用户看到对话/练习入口
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

  const handleResize = useCallback(
    (deltaPct: number) => {
      setChatWidth((w) => {
        const next = w + deltaPct;
        return Math.max(MIN_CHAT_WIDTH_PCT, Math.min(MAX_CHAT_WIDTH_PCT, next));
      });
    },
    [],
  );

  const currentCourse = courses.find((c) => c.id === selectedCourseId);
  const sections = useMemo(
    () =>
      tree
        .filter((n) => n.type === "section")
        .sort((a, b) => a.orderIdx - b.orderIdx),
    [tree],
  );

  const orderedSkills = useMemo(() => {
    const builtin = BUILTIN_SKILL_ORDER.map((name) =>
      skills.find((s) => s.name === name),
    ).filter((s): s is Skill => !!s);
    const custom = skills.filter((s) => !BUILTIN_SKILL_ORDER.includes(s.name));
    return [...builtin, ...custom];
  }, [skills]);

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-100 overflow-hidden">
      <Header streak={streak} xp={xp} />

      {/* 双栏区：左聊天(AI 全部操作) + Divider + 右技能树(显示+点击) */}
      <div className="flex-1 flex min-h-0">
        <div
          style={chatCollapsed ? undefined : { width: `${chatWidth}%` }}
          className={chatCollapsed ? undefined : "shrink-0 min-w-0"}
        >
          <Sidebar
            collapsed={chatCollapsed}
            onToggleCollapse={() => setChatCollapsed((c) => !c)}
            selectedNode={selectedNode}
            skills={orderedSkills}
            activeSkill={activeSkill}
            onPickSkill={handleSkillPick}
          />
        </div>

        {!chatCollapsed && (
          <Divider
            onResize={handleResize}
            onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH_PCT)}
          />
        )}

        {/* 右栏：技能树 / 仪表盘 / 导入（纯显示 + 点击操作，无 AI 配置） */}
        <main className="flex-1 overflow-auto px-6 py-6 min-w-0">
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          <ViewTabs view={view} onChange={setView} />

          {view === "tree" ? (
            <div className="max-w-xl mx-auto mt-4" data-testid="skill-tree">
              {/* 课程选择器 */}
              {courses.length > 1 && (
                <select
                  value={selectedCourseId ?? ""}
                  onChange={(e) => {
                    setSelectedCourseId(e.target.value);
                    setSelectedNodeId(null);
                  }}
                  data-testid="course-selector"
                  className="mb-3 bg-neutral-900 text-neutral-300 text-xs rounded-lg px-3 py-1.5 border border-neutral-700 focus:border-brand focus:outline-none"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              )}
              <h2 className="text-xl font-extrabold mb-0.5 text-neutral-100 tracking-tight">
                {currentCourse?.title ?? "加载中..."}
              </h2>
              <p className="text-neutral-500 text-xs mb-8 leading-relaxed">
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
                      selectedNodeId={selectedNodeId}
                      onLessonClick={handleLessonClick}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : view === "dashboard" ? (
            <div className="mt-4">
              <DashboardView dashboard={dashboard} onReviewDue={async () => {
                // 跳到第一个待复习的节点
                try {
                  const dueIds = await api.getDueReviews();
                  if (dueIds.length > 0) {
                    setSelectedNodeId(dueIds[0]);
                    setView("tree");
                  }
                } catch { /* 忽略 */ }
              }} />
            </div>
          ) : (
            <div className="max-w-2xl mx-auto mt-4">
              <ImportView onImported={() => { refreshAll(); setView("tree"); }} courses={courses} selectedCourseId={selectedCourseId} onSelectCourse={setSelectedCourseId} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- 顶部栏 ---------- */

function Header({ streak, xp }: { streak: Streak | null; xp: { todayXp: number; dailyGoal: number; achieved: boolean; pct: number } | null }) {
  return (
    <header className="border-b border-neutral-800/50 px-6 py-2.5 flex items-center justify-between shrink-0 bg-neutral-950/80 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <Logo />
        <h1 className="text-base font-extrabold tracking-tight text-neutral-100">
          Lookat<span className="text-brand">Study</span>
        </h1>
      </div>
      <div className="flex items-center gap-4">
        {xp && (
          <div className="flex items-center gap-2" data-testid="xp-bar">
            <div className="w-24 h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${xp.achieved ? "bg-gold" : "bg-brand"}`}
                style={{ width: `${Math.max(3, xp.pct)}%` }}
              />
            </div>
            <span className={`text-xs font-bold tabular-nums ${xp.achieved ? "text-gold" : "text-neutral-400"}`}>
              {xp.todayXp}/{xp.dailyGoal} XP
            </span>
          </div>
        )}
        {streak && <StreakBadge streak={streak} />}
      </div>
    </header>
  );
}

function ViewTabs({
  view,
  onChange,
}: {
  view: ViewTab;
  onChange: (v: ViewTab) => void;
}) {
  return (
    <div
      className="flex gap-1 shrink-0 items-center"
      data-testid="view-tabs"
    >
      <TabButton active={view === "tree"} onClick={() => onChange("tree")} label="技能树" testid="tab-tree" />
      <TabButton active={view === "dashboard"} onClick={() => onChange("dashboard")} label="仪表盘" testid="tab-dashboard" />
      <TabButton active={view === "import"} onClick={() => onChange("import")} label="导入课程" testid="tab-import" />
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
      className={`px-4 py-2 text-sm font-bold rounded-xl transition-all duration-150 ${
        active
          ? "bg-brand/15 text-brand"
          : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
      }`}
    >
      {label}
    </button>
  );
}

/* ---------- 技能树（右栏） ---------- */

function SectionUnit({
  section,
  sectionIndex,
  tree,
  progressMap,
  selectedNodeId,
  onLessonClick,
}: {
  section: ContentNode;
  sectionIndex: number;
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  onLessonClick: (n: ContentNode) => void;
}) {
  const lessons = tree
    .filter((n) => n.parentId === section.id)
    .sort((a, b) => a.orderIdx - b.orderIdx);

  return (
    <section data-testid={`section-unit-${sectionIndex}`}>
      <div className="flex items-center gap-2 mb-6">
        <span className="text-[10px] font-extrabold text-brand uppercase tracking-wider bg-brand/10 px-2 py-1 rounded-md">
          UNIT {sectionIndex + 1}
        </span>
        <h3 className="text-sm font-bold text-neutral-300">
          {section.title}
        </h3>
      </div>
      <div className="relative">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          {lessons.slice(0, -1).map((_, i) => {
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
              isSelected={lesson.id === selectedNodeId}
              onClick={onLessonClick}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function LessonBubble({
  lesson,
  index,
  progress,
  isSelected,
  onClick,
}: {
  lesson: ContentNode;
  index: number;
  progress?: Progress;
  isSelected: boolean;
  onClick: (n: ContentNode) => void;
}) {
  const status = progress?.status ?? "locked";
  const crown = progress?.crownLevel ?? 0;
  const alignLeft = index % 2 === 0;
  const isLocked = status === "locked";

  const bubbleClass =
    status === "locked"
      ? "lesson-bubble lesson-bubble-locked"
      : status === "mastered"
        ? "lesson-bubble lesson-bubble-mastered"
        : status === "in_progress"
          ? "lesson-bubble lesson-bubble-in-progress"
          : "lesson-bubble lesson-bubble-available";

  return (
    <li
      className={`relative flex flex-col items-center ${alignLeft ? "self-start" : "self-end"}`}
      data-testid={`lesson-bubble-${lesson.id.slice(0, 8)}`}
      style={{ width: "96px" }}
    >
      <button
        onClick={() => !isLocked && onClick(lesson)}
        disabled={isLocked}
        className={`group relative w-20 h-20 flex items-center justify-center text-2xl ${bubbleClass} ${
          isLocked ? "cursor-not-allowed" : "cursor-pointer"
        } ${isSelected ? "ring-4 ring-accent ring-offset-2 ring-offset-neutral-950" : ""}`}
        title={isLocked ? `🔒 ${lesson.title}（完成上一课解锁）` : lesson.title}
      >
        {isLocked ? (
          <span aria-label="locked" className="opacity-50">🔒</span>
        ) : status === "mastered" ? (
          <span aria-label="mastered" className="drop-shadow-lg">👑</span>
        ) : status === "in_progress" ? (
          <span aria-label="in-progress">📘</span>
        ) : (
          <span aria-label="available" className="drop-shadow">⭐</span>
        )}
        {status === "mastered" && crown > 0 && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-gold text-neutral-900 px-1.5 py-0.5 rounded-full shadow-md whitespace-nowrap">
            Lv.{crown}
          </span>
        )}
        {/* Selected indicator dot */}
        {isSelected && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full ring-2 ring-neutral-950" />
        )}
      </button>
      <div
        className={`mt-3 text-[11px] text-neutral-400 max-w-[120px] leading-tight text-center font-medium ${
          isSelected ? "text-brand" : ""
        } ${isLocked ? "opacity-40" : ""}`}
      >
        {lesson.title}
      </div>
    </li>
  );
}

/* ---------- 仪表盘 ---------- */

function DashboardView({ dashboard, onReviewDue }: { dashboard: DashboardData | null; onReviewDue?: () => void }) {
  if (!dashboard) {
    return <div className="text-neutral-500 text-center py-12">仪表盘加载中…</div>;
  }
  const masteryPct = Math.round(dashboard.overallMastery * 100);
  return (
    <div className="max-w-2xl mx-auto" data-testid="dashboard">
      <h2 className="text-xl font-extrabold mb-6 text-neutral-100">学习仪表盘</h2>
      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard testid="stat-streak" icon="🔥" value={String(dashboard.currentStreak)} label="连续天数" sub={`freeze ${dashboard.freezeCount}`} />
        <StatCard testid="stat-due" icon="📖" value={String(dashboard.dueToday)} label="今日待复习" sub={dashboard.dueToday > 0 ? "去复习" : "已清空"} />
        <StatCard testid="stat-mastery" icon="🎯" value={`${masteryPct}%`} label="整体掌握度" sub={masteryPct >= 70 ? "不错" : masteryPct >= 40 ? "进行中" : "刚开始"} />
      </div>
      {dashboard.dueToday > 0 && onReviewDue && (
        <button
          onClick={onReviewDue}
          data-testid="review-due-btn"
          className="btn-3d-brand mb-8 px-6 py-2.5 text-sm w-full"
        >
          📖 去复习 {dashboard.dueToday} 个待复习节点 →
        </button>
      )}
      <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">
        按章节掌握度
      </h3>
      <div className="space-y-2.5" data-testid="mastery-heatmap">
        {dashboard.sections.length === 0 ? (
          <div className="text-neutral-600 text-sm">暂无章节数据</div>
        ) : (
          dashboard.sections.map((s) => <HeatmapRow key={s.sectionId} section={s} />)
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon, value, label, sub, testid,
}: {
  icon: string; value: string; label: string; sub?: string; testid: string;
}) {
  return (
    <div className="surface-card p-4 text-center" data-testid={testid}>
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-2xl font-extrabold text-neutral-100">{value}</div>
      <div className="text-[11px] text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-neutral-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function HeatmapRow({ section }: { section: DashboardData["sections"][number] }) {
  const pct = Math.round(section.avgMastery * 100);
  const barColor = pct >= 70 ? "bg-brand" : pct >= 30 ? "bg-orange-500" : "bg-neutral-700";
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-xs text-neutral-400 truncate font-medium" title={section.sectionTitle}>{section.sectionTitle}</div>
      <div className="flex-1 h-7 bg-neutral-850 rounded-lg overflow-hidden bg-neutral-800/50">
        <div
          className={`h-full ${barColor} rounded-lg transition-all duration-500`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
      <div className="w-20 text-xs text-neutral-500 text-right tabular-nums">{pct}% · {section.masteredCount}/{section.lessonCount}</div>
    </div>
  );
}

/* ---------- 杂项 ---------- */

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-900 text-red-200 text-sm">
      ⚠️ {message}
      <button className="ml-3 underline text-red-300" onClick={onClose}>关闭</button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-neutral-500 text-center py-12">
      <p>课程树为空。</p>
      <p className="text-xs mt-2">检查主进程 ensureSeedCourse() 是否执行。</p>
    </div>
  );
}

function StreakBadge({ streak }: { streak: Streak }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20"
      data-testid="streak-badge"
      title={`连续学习 ${streak.currentStreak} 天 · 最长 ${streak.longestStreak} 天`}
    >
      <span className="streak-flame text-sm">🔥</span>
      <span className="text-sm font-extrabold text-orange-400">{streak.currentStreak}</span>
    </div>
  );
}

function Logo() {
  return (
    <div
      className="w-7 h-7 rounded-xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-white font-extrabold text-xs shadow-md"
      style={{ boxShadow: "0 2px 8px rgba(88, 204, 2, 0.3)" }}
    >
      L
    </div>
  );
}

function setErrorFromThrow(e: unknown) {
  // eslint-disable-next-line no-console
  console.error(e);
}
