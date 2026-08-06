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

type ViewTab = "tree" | "dashboard";

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
const SKILL_LABELS: Record<string, string> = {
  "socratic-mode": "苏格拉底",
  "exam-prep-mode": "考试冲刺",
  "project-mode": "项目实战",
  "review-mode": "复习",
};

const DEFAULT_CHAT_WIDTH_PCT = 38;
const MIN_CHAT_WIDTH_PCT = 20;
const MAX_CHAT_WIDTH_PCT = 60;

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

  // 点 lesson：标记 attempted + 设为当前选中节点（联动聊天栏）
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
      <Header streak={streak} />
      <SkillPicker
        skills={orderedSkills}
        activeSkill={activeSkill}
        onPick={handleSkillPick}
      />

      {/* 双栏区：左聊天 + Divider + 右技能树 */}
      <div className="flex-1 flex min-h-0">
        <div
          style={chatCollapsed ? undefined : { width: `${chatWidth}%` }}
          className={chatCollapsed ? undefined : "shrink-0 min-w-0"}
        >
          <Sidebar
            collapsed={chatCollapsed}
            onToggleCollapse={() => setChatCollapsed((c) => !c)}
            selectedNode={selectedNode}
          />
        </div>

        {!chatCollapsed && (
          <Divider
            onResize={handleResize}
            onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH_PCT)}
          />
        )}

        {/* 右栏：技能树 / 仪表盘 */}
        <main className="flex-1 overflow-auto px-6 py-6 min-w-0">
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          <ViewTabs view={view} onChange={setView} />

          {view === "tree" ? (
            <div className="max-w-2xl mx-auto mt-4" data-testid="skill-tree">
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
                      selectedNodeId={selectedNodeId}
                      onLessonClick={handleLessonClick}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <DashboardView dashboard={dashboard} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- 顶部栏 ---------- */

function Header({ streak }: { streak: Streak | null }) {
  return (
    <header className="border-b border-neutral-800 px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <Logo />
        <h1 className="text-lg font-bold tracking-tight">LookatStudy</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
          v0.1.0
        </span>
      </div>
      {streak && <StreakBadge streak={streak} />}
    </header>
  );
}

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
      className="border-b border-neutral-800 bg-neutral-900/50 px-6 py-2 flex items-center gap-2 overflow-x-auto shrink-0"
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

function ViewTabs({
  view,
  onChange,
}: {
  view: ViewTab;
  onChange: (v: ViewTab) => void;
}) {
  return (
    <div
      className="flex gap-1 shrink-0"
      data-testid="view-tabs"
    >
      <TabButton active={view === "tree"} onClick={() => onChange("tree")} label="技能树" testid="tab-tree" />
      <TabButton active={view === "dashboard"} onClick={() => onChange("dashboard")} label="仪表盘" testid="tab-dashboard" />
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

  const theme =
    status === "locked"
      ? "bg-neutral-800 border-neutral-700 text-neutral-600"
      : status === "mastered"
        ? "bg-gradient-to-br from-yellow-500/30 to-amber-600/20 border-yellow-500/50 text-yellow-200"
        : status === "in_progress"
          ? "bg-gradient-to-br from-brand/30 to-brand/10 border-brand/60 text-brand"
          : "bg-gradient-to-br from-brand/25 to-brand/5 border-brand/50 text-brand";

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
        } ${isSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-neutral-950 scale-105" : ""} ${status === "available" ? "animate-pulse" : ""}`}
        title={lesson.title}
      >
        <div className="absolute inset-0 flex items-center justify-center text-2xl">
          {isLocked ? (
            <span aria-label="locked">🔒</span>
          ) : status === "mastered" ? (
            <span aria-label="mastered">👑</span>
          ) : (
            <span aria-label={status}>⭐</span>
          )}
        </div>
        {status === "mastered" && crown > 0 && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-yellow-500 text-neutral-900 px-1.5 rounded-full">
            Lv.{crown}
          </span>
        )}
      </button>
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

/* ---------- 仪表盘 ---------- */

function DashboardView({ dashboard }: { dashboard: DashboardData | null }) {
  if (!dashboard) {
    return <div className="text-neutral-500 text-center py-12">仪表盘加载中…</div>;
  }
  const masteryPct = Math.round(dashboard.overallMastery * 100);
  return (
    <div className="max-w-2xl mx-auto" data-testid="dashboard">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard testid="stat-streak" icon="🔥" value={String(dashboard.currentStreak)} label="连续天数" sub={`freeze ${dashboard.freezeCount}`} />
        <StatCard testid="stat-due" icon="📖" value={String(dashboard.dueToday)} label="今日待复习" sub={dashboard.dueToday > 0 ? "去复习" : "已清空"} />
        <StatCard testid="stat-mastery" icon="🎯" value={`${masteryPct}%`} label="整体掌握度" sub={masteryPct >= 70 ? "不错" : masteryPct >= 40 ? "进行中" : "刚开始"} />
      </div>
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        掌握度热力图（按章节）
      </h3>
      <div className="space-y-2" data-testid="mastery-heatmap">
        {dashboard.sections.length === 0 ? (
          <div className="text-neutral-500 text-sm">暂无章节数据</div>
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3" data-testid={testid}>
      <div className="text-xs text-neutral-500 mb-1">{icon} {label}</div>
      <div className="text-2xl font-bold text-neutral-100">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function HeatmapRow({ section }: { section: DashboardData["sections"][number] }) {
  const pct = Math.round(section.avgMastery * 100);
  const barColor = pct >= 70 ? "bg-brand" : pct >= 30 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-xs text-neutral-300 truncate" title={section.sectionTitle}>{section.sectionTitle}</div>
      <div className="flex-1 h-6 bg-neutral-800 rounded overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="w-16 text-xs text-neutral-400 text-right">{pct}% · {section.masteredCount}/{section.lessonCount}</div>
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
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30" data-testid="streak-badge">
      <span className="text-orange-400">🔥</span>
      <span className="text-sm font-bold text-orange-300">{streak.currentStreak}</span>
      <span className="text-xs text-orange-400/70">天</span>
    </div>
  );
}

function Logo() {
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-accent flex items-center justify-center text-white font-bold text-sm">R</div>
  );
}

function setErrorFromThrow(e: unknown) {
  // eslint-disable-next-line no-console
  console.error(e);
}
