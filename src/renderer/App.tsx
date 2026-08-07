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
import { NavRail, type NavView } from "./components/NavRail.js";
import { ArtifactPanel, type ArtifactTab } from "./components/ArtifactPanel.js";
import { ChatStream, extractArtifacts } from "./components/ChatStream.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ArtifactRenderer } from "./components/artifacts/index.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ReviewPanel } from "./components/ReviewPanel.js";
import { SettingsView } from "./components/SettingsView.js";
import { ImportView } from "./components/ImportView.js";
import { useChatStream } from "./lib/useChatStream.js";
import { translate } from "./lib/i18n.js";

/**
 * v0.2 三栏布局(M1 重构):
 *   左 NavRail(导航 + 迷你路径 + 复习入口)
 *   中 AI 对话流(ChatStream parts-based + ChatComposer)
 *   右 ArtifactPanel(内容 / 产物 / 复习)
 *
 * - Header 简化:课程选择器移左栏,设置移齿轮
 * - "💬对话/📝练习/⚙️设置"三 tab 拆解:设置移 Header,练习并入对话流(M2),对话用 ChatStream
 * - 仪表盘/导入 作为左栏视图切换,不再占主展示区
 *
 * testid 兼容:保留 skill-tree/section-unit/lesson-bubble/xp-bar/streak-badge/chat-panel 等
 * 供 ui-test 不破。新增 nav-rail/artifact-panel/chat-stream/composer。
 */
const BUILTIN_SKILL_ORDER = [
  "socratic-mode",
  "exam-prep-mode",
  "project-mode",
  "review-mode",
];

/** 产物 tab 的中文标签(对齐 tool name) */
const ARTIFACT_TAB_LABEL: Record<string, string> = {
  show_concept_map: "🗺️ 概念图",
  generate_quiz: "📝 练习",
  compare_table: "📊 对比表",
  draw_diagram: "📐 流程图",
  show_code_walkthrough: "🔍 代码讲解",
};

export default function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tree, setTree] = useState<ContentNode[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [streak, setStreak] = useState<Streak | null>(null);
  const [xp, setXp] = useState<{ todayXp: number; dailyGoal: number; achieved: boolean; pct: number } | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Skill 系统
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  // 视图 + 仪表盘
  const [view, setView] = useState<NavView>("tree");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dueCount, setDueCount] = useState(0);
  // M3: overdue 的 nodeId 集合(供 NavRail 在路径上标记复习节点)
  const [dueNodeIds, setDueNodeIds] = useState<Set<string>>(new Set());

  // 选中节点(联动三栏)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // 右栏强制 tab(如导航复习入口 → review)
  const [forceArtifactTab, setForceArtifactTab] = useState<ArtifactTab | null>(null);
  // 设置弹窗(M1:设置从 tab 改为 modal/抽屉)
  const [showSettings, setShowSettings] = useState(false);
  // Cmd+K 命令面板(M2)
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // 当前在右栏聚焦的产物 index(M2)
  const [activeArtifactIdx, setActiveArtifactIdx] = useState(0);

  // AI 就绪状态 + starter prompts
  const [agentReady, setAgentReady] = useState<{ ready: boolean; provider?: string; model?: string; missing?: string } | null>(null);
  const [starterPrompts, setStarterPrompts] = useState<{ icon: string; label: string; message: string }[]>([]);

  // useChatStream hook 管 parts-based 对话流
  const chat = useChatStream(selectedNodeId);

  const selectedNode = useMemo(
    () => tree.find((n) => n.id === selectedNodeId) ?? null,
    [tree, selectedNodeId],
  );

  const refreshAll = useCallback(async () => {
    try {
      const [courseList, streakData, skillList, currentSkill, xpData, due] = await Promise.all([
        api.listCourses(),
        api.getStreak(),
        api.listSkills(),
        api.getActiveSkill(),
        api.getXpStatus(),
        api.getDueReviews(),
      ]);
      setCourses(courseList);
      setStreak(streakData);
      setSkills(skillList);
      setXp(xpData);
      setActiveSkill(currentSkill);
      setDueCount(due.length);
      setDueNodeIds(new Set(due));
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

  // 检查 AI 就绪 + 监听配置变更
  const checkReady = useCallback(async () => {
    try {
      setAgentReady(await api.isAgentReady());
    } catch {
      setAgentReady({ ready: false, missing: "无法检查就绪状态" });
    }
  }, []);
  useEffect(() => {
    checkReady();
    const handler = () => checkReady();
    window.addEventListener("llm-config-changed", handler);
    return () => window.removeEventListener("llm-config-changed", handler);
  }, [checkReady]);

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

  // 节点切换时拉 starter prompts
  useEffect(() => {
    if (!selectedNodeId) {
      setStarterPrompts([]);
      return;
    }
    api.getStarterPrompts(selectedNodeId).then(setStarterPrompts).catch(() => setStarterPrompts([]));
  }, [selectedNodeId]);

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedNodeId) {
        api.abortAgentChat(selectedNodeId).catch(() => {});
        setShowSettings(false);
        setShowCommandPalette(false);
      }
      // Cmd+K / Ctrl+K → 命令面板
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((s) => !s);
      }
      // 数字键切换视图(非输入框焦点)
      if (!e.target || !(e.target as HTMLElement).matches("input, textarea, select")) {
        if (e.key === "1") setView("tree");
        if (e.key === "2") setView("dashboard");
        if (e.key === "3") setView("import");
        if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setShowSettings(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId]);

  // 点 lesson:解锁下一课 + 设选中(联动三栏)
  const handleLessonClick = useCallback(async (node: ContentNode) => {
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
      setSelectedNodeId(node.id);
      setForceArtifactTab("content");
    } catch (e) {
      setErrorFromThrow(e);
    }
  }, []);

  const handleSkillPick = async (name: string) => {
    try {
      await api.setActiveSkill(name);
      setActiveSkill(name);
    } catch (e) {
      setErrorFromThrow(e);
    }
  };

  const handleApplyProposal = useCallback(
    async (proposalId: string, msgId: string, toolCallIdx: number) => {
      try {
        await api.applyProposal(proposalId);
        chat.markProposalStatus(msgId, toolCallIdx, true);
      } catch (e) {
        setErrorFromThrow(e);
      }
    },
    [chat],
  );

  const handleRejectProposal = useCallback(
    async (proposalId: string, msgId: string, toolCallIdx: number) => {
      try {
        await api.rejectProposal(proposalId);
        chat.markProposalStatus(msgId, toolCallIdx, false);
      } catch (e) {
        setErrorFromThrow(e);
      }
    },
    [chat],
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

  // M2: 从对话流提取展示型 tool 产物(Generative UI)
  const artifacts = useMemo(() => extractArtifacts(chat.messages), [chat.messages]);
  const activeArtifact = artifacts[activeArtifactIdx] ?? artifacts[artifacts.length - 1] ?? null;

  // 当有新产物时自动聚焦最新
  useEffect(() => {
    if (artifacts.length > 0) {
      setActiveArtifactIdx(artifacts.length - 1);
      setForceArtifactTab("artifact");
    }
  }, [artifacts.length]);

  // 视图切换时清除强制 tab
  useEffect(() => {
    if (view !== "tree") setForceArtifactTab(null);
  }, [view]);

  return (
    <div className="h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden">
      <Header
        streak={streak}
        xp={xp}
        onOpenSettings={() => setShowSettings(true)}
      />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex-1 flex min-h-0">
        {/* 左栏:NavRail(导航 + 迷你路径 + 复习) */}
        <NavRail
          view={view}
          onViewChange={setView}
          courseTitle={currentCourse?.title ?? null}
          sections={sections}
          tree={tree}
          progressMap={progressMap}
          selectedNodeId={selectedNodeId}
          dueCount={dueCount}
          dueNodeIds={dueNodeIds}
          onJumpNode={(id) => {
            const node = tree.find((n) => n.id === id);
            if (node) handleLessonClick(node);
          }}
          onOpenReview={() => {
            setView("tree");
            setForceArtifactTab("review");
          }}
        />

        {/* 视图层:tree 视图 = AI 对话 + 产物;dashboard/import 视图 = 全屏展示 */}
        {view === "tree" ? (
          <>
            {/* 中栏:AI 对话流(ChatStream + ChatComposer) */}
            <div
              className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800/50"
              style={{ width: "42%" }}
              data-testid="chat-panel"
            >
              {/* 顶栏:当前节点标题 */}
              <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
                <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate" data-testid="chat-current-node">
                  {selectedNode ? `📍 ${selectedNode.title}` : "未选择节点"}
                </div>
              </div>
              <ChatStream
                messages={chat.messages}
                streaming={chat.streaming}
                onApplyProposal={handleApplyProposal}
                onRejectProposal={handleRejectProposal}
              />
              <ChatComposer
                nodeId={selectedNodeId}
                agentReady={agentReady?.ready ?? false}
                missingHint={agentReady?.missing}
                streaming={chat.streaming}
                skills={orderedSkills}
                activeSkill={activeSkill}
                starterPrompts={starterPrompts}
                onPickSkill={handleSkillPick}
                onSend={chat.send}
                onStop={chat.stop}
                onGotoSettings={() => setShowSettings(true)}
              />
            </div>

            {/* 右栏:ArtifactPanel(内容/产物/复习) */}
            <main className="flex-1 min-w-0">
              <ArtifactPanel
                selectedNode={selectedNode}
                artifact={activeArtifact ? (
                  <div className="space-y-3">
                    {artifacts.length > 1 && (
                      <div className="flex gap-1 flex-wrap">
                        {artifacts.map((a, i) => (
                          <button
                            key={a.id}
                            onClick={() => setActiveArtifactIdx(i)}
                            data-testid={`artifact-tab-${i}`}
                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                              i === activeArtifactIdx
                                ? "border-brand bg-brand/10 text-brand font-bold"
                                : "border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:border-neutral-400"
                            }`}
                          >
                            {ARTIFACT_TAB_LABEL[a.toolName] ?? a.toolName} #{i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    <ArtifactRenderer data={activeArtifact.output} />
                  </div>
                ) : null}
                reviewContent={
                  <ReviewPanel
                    tree={tree}
                    onReviewNode={(id) => {
                      setSelectedNodeId(id);
                      setForceArtifactTab("content");
                    }}
                  />
                }
                forceTab={forceArtifactTab}
                onUserTabChange={() => setForceArtifactTab(null)}
              />
            </main>
          </>
        ) : view === "dashboard" ? (
          <main className="flex-1 overflow-auto px-6 py-6">
            <DashboardView dashboard={dashboard} courseId={selectedCourseId} onReviewDue={async () => {
              try {
                const dueIds = await api.getDueReviews();
                if (dueIds.length > 0) {
                  setSelectedNodeId(dueIds[0]);
                  setView("tree");
                  setForceArtifactTab("review");
                }
              } catch { /* 忽略 */ }
            }} />
          </main>
        ) : (
          <main className="flex-1 overflow-auto px-6 py-6">
            <div className="max-w-2xl mx-auto">
              <ImportView onImported={() => { refreshAll(); setView("tree"); }} courses={courses} selectedCourseId={selectedCourseId} onSelectCourse={setSelectedCourseId} />
            </div>
          </main>
        )}
      </div>

      {/* 设置抽屉(从 tab 改为 overlay,M1) */}
      {showSettings && (
        <SettingsDrawer onClose={() => setShowSettings(false)} />
      )}

      {/* Cmd+K 命令面板(M2) */}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onPick={(action) => {
            setShowCommandPalette(false);
            handleCommandAction(action);
          }}
          hasNode={!!selectedNodeId}
        />
      )}
    </div>
  );
}

/** 命令面板动作分发。 */
function handleCommandAction(action: string): void {
  // action 值见 CommandPalette 的 onPick
  // 这些直接触发 chat.send,需要 selectedNodeId(没有则忽略)
  // 注:这里通过 window 事件让 useChatStream 接收,避免 prop 透传复杂化
  window.dispatchEvent(new CustomEvent("lookatstudy-command", { detail: action }));
}

/* ---------- Header(简化) ---------- */

function Header({
  streak,
  xp,
  onOpenSettings,
}: {
  streak: Streak | null;
  xp: { todayXp: number; dailyGoal: number; achieved: boolean; pct: number } | null;
  onOpenSettings: () => void;
}) {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "dark";
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("lookatstudy-theme", next);
  };

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800/50 px-6 py-2.5 flex items-center justify-between shrink-0 bg-neutral-50/80 dark:bg-neutral-950/80 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <h1 className="text-sm font-bold tracking-tight text-neutral-700 dark:text-neutral-300">
          {translate("view.tree")}
        </h1>
      </div>
      <div className="flex items-center gap-4">
        {xp && (
          <div className="flex items-center gap-2" data-testid="xp-bar">
            <div className="w-24 h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${xp.achieved ? "bg-gold" : "bg-brand"}`}
                style={{ width: `${Math.max(3, xp.pct)}%` }}
              />
            </div>
            <span className={`text-xs font-bold tabular-nums ${xp.achieved ? "text-gold" : "text-neutral-500 dark:text-neutral-400"}`}>
              {xp.todayXp}/{xp.dailyGoal} XP
            </span>
          </div>
        )}
        <button
          onClick={toggleTheme}
          data-testid="theme-toggle"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-sm w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50 transition-colors"
          title={theme === "dark" ? "切换到亮色" : "切换到暗色"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          onClick={onOpenSettings}
          data-testid="header-settings"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-sm w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50 transition-colors"
          title="设置 (Ctrl+S)"
        >
          ⚙️
        </button>
        {streak && <StreakBadge streak={streak} />}
      </div>
    </header>
  );
}

/* ---------- 设置抽屉 ---------- */

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="settings-drawer">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <h2 className="text-sm font-bold">{translate("settings.title")}</h2>
          <button
            onClick={onClose}
            data-testid="settings-close"
            className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SettingsView />
        </div>
      </div>
    </div>
  );
}

/* ---------- 仪表盘(保留原实现) ---------- */

function DashboardView({ dashboard, onReviewDue, courseId }: { dashboard: DashboardData | null; onReviewDue?: () => void; courseId: string | null }) {
  if (!dashboard) {
    return <div className="text-neutral-500 text-center py-12">仪表盘加载中…</div>;
  }
  const masteryPct = Math.round(dashboard.overallMastery * 100);
  return (
    <div className="max-w-2xl mx-auto" data-testid="dashboard">
      <h2 className="text-xl font-extrabold mb-6 text-neutral-900 dark:text-neutral-100">{translate("dashboard.title")}</h2>
      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard testid="stat-streak" icon="🔥" value={String(dashboard.currentStreak)} label={translate("dashboard.stat.streak")} sub={`freeze ${dashboard.freezeCount}`} />
        <StatCard testid="stat-due" icon="📖" value={String(dashboard.dueToday)} label={translate("dashboard.stat.due")} sub={dashboard.dueToday > 0 ? translate("dashboard.review") : translate("dashboard.cleared")} />
        <StatCard testid="stat-mastery" icon="🎯" value={`${masteryPct}%`} label={translate("dashboard.stat.mastery")} sub={masteryPct >= 70 ? "不错" : masteryPct >= 40 ? "进行中" : "刚开始"} />
      </div>
      {dashboard.dueToday > 0 && onReviewDue && (
        <button
          onClick={onReviewDue}
          data-testid="review-due-btn"
          className="btn-3d-brand mb-4 px-6 py-2.5 text-sm w-full"
        >
          📖 {translate("dashboard.review")} {dashboard.dueToday} →
        </button>
      )}
      <div className="flex gap-2 mb-8">
        <button
          onClick={async () => {
            try {
              const md = await api.exportCourse(courseId ?? "", "markdown");
              const blob = new Blob([md], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `lookatstudy-report.md`;
              a.click();
              URL.revokeObjectURL(url);
            } catch { /* 忽略 */ }
          }}
          data-testid="export-markdown"
          className="btn-3d-neutral flex-1 px-4 py-2 text-xs"
        >
          {translate("dashboard.export.md")}
        </button>
        <button
          onClick={async () => {
            try {
              const json = await api.exportCourse(courseId ?? "", "json");
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `lookatstudy-report.json`;
              a.click();
              URL.revokeObjectURL(url);
            } catch { /* 忽略 */ }
          }}
          data-testid="export-json"
          className="btn-3d-neutral flex-1 px-4 py-2 text-xs"
        >
          {translate("dashboard.export.json")}
        </button>
      </div>
      <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">
        {translate("dashboard.section_mastery")}
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
      <div className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100">{value}</div>
      <div className="text-[11px] text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-neutral-400 dark:text-neutral-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function HeatmapRow({ section }: { section: DashboardData["sections"][number] }) {
  const pct = Math.round(section.avgMastery * 100);
  const barColor = pct >= 70 ? "bg-brand" : pct >= 30 ? "bg-orange-500" : "bg-neutral-400 dark:bg-neutral-700";
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-xs text-neutral-600 dark:text-neutral-400 truncate font-medium" title={section.sectionTitle}>{section.sectionTitle}</div>
      <div className="flex-1 h-7 rounded-lg overflow-hidden bg-neutral-200 dark:bg-neutral-800/50">
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
    <div className="px-4 py-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-900 text-red-700 dark:text-red-200 text-sm flex items-center justify-between">
      <span>⚠️ {message}</span>
      <button className="ml-3 underline text-red-600 dark:text-red-300" onClick={onClose}>关闭</button>
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
      <span className="text-sm">🔥</span>
      <span className="text-sm font-extrabold text-orange-500 dark:text-orange-400">{streak.currentStreak}</span>
    </div>
  );
}

function setErrorFromThrow(e: unknown) {
  console.error(e);
}
