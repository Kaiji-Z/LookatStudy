import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Settings, Flame, Zap, PanelLeft, PanelRight, BookOpen, Shield, Shuffle, ChevronDown, ChevronRight, AlertTriangle, Map as MapIcon, MessageSquare, PenLine } from "lucide-react";
import { api } from "./lib/api.js";
import type {
  Course,
  ContentNode,
  Progress,
  Streak,
  Soul,
  DashboardData,
  StarterPrompt,
  NoteSourceAnchor,
  XpStatus,
  ChatAttachmentInput,
} from "@shared/types";
import { estimateTokens } from "@shared/token-estimate";
import { MapRail, type MapView } from "./components/MapRail.js";
import { GlobalTooltip } from "./components/GlobalTooltip.js";
import { NotebookPanel, type NotebookTab } from "./components/NotebookPanel.js";
import { useCanvas } from "./lib/useCanvas.js";
import { useFontSize } from "./lib/useFontSize.js";
import { ChatStream, extractArtifacts } from "./components/ChatStream.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ExamView } from "./components/ExamView.js";
import { CommandPalette } from "./components/CommandPalette.js";
// ReviewPanel component no longer used — SelfRatingCard is imported by NotebookPanel directly
import { SettingsView } from "./components/SettingsView.js";
import { useChatStream } from "./lib/useChatStream.js";
import { buildQuizHookLabel, buildQuizHookMessage } from "./lib/quiz-hook.js";
import { useThreads } from "./lib/useThreads.js";
import { useToast } from "./components/Toast.js";
import { ThreadSwitcher } from "./components/ThreadSwitcher.js";
import { useLang, useLangValue } from "./lib/i18n.js";
import { useWindowTier } from "./lib/useWindowTier.js";
import { t2SideFromT3, swipeTarget, type T2Side, type T3Pane } from "./lib/paneTiers.js";
import { useFocusTrap } from "./lib/useFocusTrap.js";
import { CelebrationLayer } from "./components/CelebrationLayer.js";
import { celebrate } from "./lib/celebration.js";

/**
 * v0.2 三栏布局(M1 重构):
 *   左 MapRail(选关地图 + 复习入口)
 *   中 AI 对话流(ChatStream parts-based + ChatComposer)
 *   右 NotebookPanel(讲解 / 笔记 / 全部)
 *
 * - Header 简化:课程选择器移左栏,设置移齿轮
 * - "💬对话/📝练习/⚙️设置"三 tab 拆解:设置移 Header,练习并入对话流(M2),对话用 ChatStream
 * - 仪表盘/导入 作为左栏视图切换,不再占主展示区
 *
 * testid 兼容:保留 skill-tree/section-unit/lesson-bubble/xp-bar/streak-badge/chat-panel 等
 * 供 ui-test 不破。新增 nav-rail/artifact-panel/chat-stream/composer。
 */
const BUILTIN_SOUL_ORDER = ["direct", "guide", "practice"];

export default function App() {
  const t = useLang();
  const [courses, setCourses] = useState<Course[]>([]);
  const [tree, setTree] = useState<ContentNode[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [streak, setStreak] = useState<Streak | null>(null);
  const [xp, setXp] = useState<XpStatus | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 统一的异步错误处理:上屏 ErrorBanner(role=alert,用户可见)+ console 保留堆栈。
  // 原 setErrorFromThrow 只 console.error,异步失败对用户完全不可见(audit P1 修复)。
  const setErrorFromThrow = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    console.error(e);
  }, []);
  // 多语言:当前课程的可用翻译语言 + 选定语言
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [currentLocale, setCurrentLocale] = useState<string | null>(null);

  // Soul 系统（教学人设/persona）
  const [souls, setSouls] = useState<Soul[]>([]);
  const [activeSoul, setActiveSoul] = useState<string | null>(null);

  // 视图 + 仪表盘
  const [view, setView] = useState<MapView>("map");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  // M3: overdue 的 nodeId 集合(供 MapRail 在路径上标记复习节点)
  const [dueNodeIds, setDueNodeIds] = useState<Set<string>>(new Set());

  // 选中节点(联动三栏)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // 章节考试会话(ExamView 上报;active 时导航需先弹离开警告——未答=错计分)
  const examSessionRef = useRef<{ active: boolean; terminate: (() => Promise<void>) | null }>({ active: false, terminate: null });
  // 离开考试警告模态:pendingAction = 确认终止后要执行的导航
  const [examLeave, setExamLeave] = useState<{ open: boolean; pendingAction: (() => void) | null }>({ open: false, pendingAction: null });
  const examLeaveModalRef = useRef<HTMLDivElement>(null);
  // 右栏强制 tab(如导航复习入口 → review)
  const [forceArtifactTab, setForceArtifactTab] = useState<NotebookTab | null>(null);
  // 设置弹窗(M1:设置从 tab 改为 modal/抽屉)
  const [showSettings, setShowSettings] = useState(false);
  // 布局切换:左栏/右栏显隐(Cursor 风格)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);
  /* ── 响应式三档布局(v0.11)─────────────────────────────────────────
     T1 ≥1240 三栏;T2 920~1239 双栏(中+一侧,侧栏互斥);T3 <920 单栏+顶部按钮组。
     拉宽自动弹回:进 T1 三栏全恢复。窄化自动收:T2 左栏隐、T3 只剩中栏(默认)。
     T2 侧栏选择 / T3 当前栏 是会话级用户偏好,跨档往返保留(T3→T2 承接)。 */
  const tier = useWindowTier();
  const [t2Side, setT2Side] = useState<T2Side>("notebook");
  const [t3Pane, setT3Pane] = useState<T3Pane>("chat");
  const t3PaneRef = useRef(t3Pane);
  t3PaneRef.current = t3Pane;
  const prevTierRef = useRef(tier);
  useEffect(() => {
    if (prevTierRef.current === tier) return;
    if (tier === 1) {
      // 弹回:回三栏档恢复三栏(不记 T1 里的手动收起 —— 用户拍板"拉宽自动弹回")
      setLeftPaneVisible(true);
      setRightPaneVisible(true);
    } else if (tier === 2 && prevTierRef.current === 3) {
      // T3→T2:单栏正在看哪侧,双栏就保留哪侧
      setT2Side(t2SideFromT3(t3PaneRef.current));
    }
    prevTierRef.current = tier;
  }, [tier]);

  // 实际可见性(档位 + 用户选择合成)
  const showLeft = tier === 3 ? t3Pane === "rail" : tier === 2 ? t2Side === "rail" : leftPaneVisible;
  const showRight = tier === 3 ? t3Pane === "notebook" : tier === 2 ? t2Side === "notebook" : rightPaneVisible;
  const showChat = tier !== 3 || t3Pane === "chat";

  // 侧栏切换(T1=手动显隐;T2=互斥侧栏:显示左则隐右;T3=切单栏)
  const toggleLeftPane = () => {
    if (tier === 1) setLeftPaneVisible((v) => !v);
    else if (tier === 2) setT2Side((s2) => (s2 === "rail" ? "notebook" : "rail"));
    else setT3Pane((p) => (p === "rail" ? "chat" : "rail"));
  };
  const toggleRightPane = () => {
    if (tier === 1) setRightPaneVisible((v) => !v);
    else if (tier === 2) setT2Side((s2) => (s2 === "notebook" ? "rail" : "notebook"));
    else setT3Pane((p) => (p === "notebook" ? "chat" : "notebook"));
  };

  /* T3 手势滑屏切栏:水平滑动(判定在纯函数 swipeTarget,verify-pane-tiers 覆盖)
     * 切换 地图↔对话↔笔记。起点在 data-noswipe 元素(地图球/概念图视口等自带
     * 横向交互)或多指时不接管。 */
  const swipeStartRef = useRef<{ x: number; y: number; multi: boolean; noswipe: boolean } | null>(null);
  const onPanesTouchStart = (e: React.TouchEvent) => {
    if (tier !== 3) return;
    const t = e.touches[0];
    swipeStartRef.current = {
      x: t.clientX,
      y: t.clientY,
      multi: e.touches.length > 1,
      noswipe: !!(e.target as HTMLElement).closest?.("[data-noswipe]"),
    };
  };
  const onPanesTouchEnd = (e: React.TouchEvent) => {
    const st = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!st || st.multi || st.noswipe || tier !== 3) return;
    const t = e.changedTouches[0];
    const target = swipeTarget(t3PaneRef.current, t.clientX - st.x, t.clientY - st.y);
    if (target) setT3Pane(target);
  };
  // Cmd+K 命令面板(M2)
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // 当前在右栏聚焦的产物 index(M2)

  // AI 就绪状态 + starter prompts
  const [agentReady, setAgentReady] = useState<{ ready: boolean; provider?: string; model?: string; missing?: string } | null>(null);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);

  // v0.4: thread 模型—— useThreads 管 thread 列表, useChatStream 管当前 thread 消息
  const thread = useThreads(selectedCourseId, selectedNodeId);
  // AI 输出语言 = 界面语言(用户偏好什么界面就偏好什么输出),不是课程 🌐 显示语言
  const uiLang = useLangValue();
  const chat = useChatStream(thread.activeId, uiLang);

  // 哪里不会点哪里:右栏选中文字 → 注入聊天框。用自增 key 触发 ChatComposer 的 effect(同一段话连点两次也要触发)。
  const [quoteText, setQuoteText] = useState<string>("");
  const handleQuoteToChat = useCallback((text: string) => {
    setQuoteText(text); // 新值会触发 ChatComposer insertText effect
  }, []);

  // 笔记卡溯源跳转:点击 → 切到讲解/对话原位 + 高亮
  const handleJumpToSource = useCallback((anchor: NoteSourceAnchor, _noteText?: string, noteId?: string) => {
    if (anchor.type === "content") {
      // 切到讲解 tab,发 noteId 让 ContentTab 跳到对应的持久画线 mark(直接定位,不搜索)
      setForceArtifactTab("content");
      if (noteId) {
        // 轮询等 ContentTab mount + 画线渲染完,再发跳转事件
        const tryJump = (attempts: number) => {
          const mark = document.querySelector(`mark[data-note-id="${noteId}"]`);
          if (mark) {
            window.dispatchEvent(new CustomEvent("lookatstudy-jump-to-note", { detail: noteId }));
          } else if (attempts > 0) {
            setTimeout(() => tryJump(attempts - 1), 150);
          }
        };
        setTimeout(() => tryJump(10), 100);
      }
    } else {
      // chat 源:切到对应 thread(如果不同)+ 发 noteId 让 ChatStream 跳到对应持久画线 mark
      if (anchor.threadId !== thread.activeId) {
        thread.setActiveId(anchor.threadId);
      }
      if (noteId) {
        const tryJump = (attempts: number) => {
          const mark = document.querySelector(`mark[data-note-id="${noteId}"]`);
          if (mark) {
            window.dispatchEvent(new CustomEvent("lookatstudy-jump-to-chat-note", { detail: noteId }));
          } else if (attempts > 0) {
            setTimeout(() => tryJump(attempts - 1), 150);
          }
        };
        setTimeout(() => tryJump(10), 120);
      }
    }
  }, [thread]);

  // 当前节点摘要(空会话时中栏显示,导入时生成)
  const [nodeSummary, setNodeSummary] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedNodeId) { setNodeSummary(null); return; }
    let cancelled = false;
    // 摘要随界面语言取版本(en 优先英文摘要,历史节点主进程自动补齐)
    api.getNodeSummary(selectedNodeId, uiLang).then((s) => { if (!cancelled) setNodeSummary(s); }).catch(() => { if (!cancelled) setNodeSummary(null); });
    return () => { cancelled = true; };
  }, [selectedNodeId, uiLang]);

  const selectedNode = useMemo(
    () => tree.find((n) => n.id === selectedNodeId) ?? null,
    [tree, selectedNodeId],
  );

  // starter prompts 按界面语言本地化:服务端返回的 label/hint/message 是中文默认值,
  // 这里用 starter.{key}.* 字典覆盖(标题取当前课程语言下的节点标题,和界面显示一致)。
  const localizedStarterPrompts = useMemo(
    () =>
      starterPrompts.map((p) => ({
        ...p,
        label: t(`starter.${p.key}.label`),
        hint: t(`starter.${p.key}.hint`),
        message: t(`starter.${p.key}.message`, { title: selectedNode?.title ?? "" }),
      })),
    [starterPrompts, selectedNode, t],
  );

  // "开始学习"→ hook + 无风险猜测,不是讲义+计分题。
  // 动机层:用户点进来时往往"提不起劲"(streak 断了 / 冷启动)。"讲概念+出题"是作业形状,
  // 在意志力最低的瞬间堆两次摩擦(吸收讲座 + 被评估)。改成 hook(好奇心缺口 = 内驱)+
  // 二选一猜测(玩,不是考试)——零失败风险,先把人勾进来,动量起来再讲、再测。
  // 实际的 sendMessage 定义在 toast 声明之后(下面),通过 ref 桥接避免 TDZ。
  const sendRef = useRef<((t: string, displayText?: string) => Promise<void>) | null>(null);
  const handleStartLearning = useCallback(() => {
    if (!selectedNode) return;
    // 气泡只显示「🚀 开始学习「X」」这个动作;完整开场指令是发给 LLM 的提示词,不在聊天窗展示。
    void sendRef.current?.(
      t("chat.action.startLearningPrompt", { title: selectedNode.title }),
      t("chat.action.startLearning", { title: selectedNode.title }),
    );
  }, [selectedNode, t]);

  const refreshAll = useCallback(async () => {
    try {
      const [courseList, streakData, soulList, currentSoul, xpData, due] = await Promise.all([
        api.listCourses(),
        api.getStreak(),
        api.listSouls(),
        api.getActiveSoul(),
        api.getXpStatus(),
        api.getDueReviews(),
      ]);
      setCourses(courseList);
      setStreak(streakData);
      setSouls(soulList);
      setXp(xpData);
      setActiveSoul(currentSoul);
      setDueNodeIds(new Set(due));
      // 不自动选课:每次启动落在"未选课"初始状态,用户手动选择或导入。
      // 已选课程在列表中消失(被删除)→ 清空课程维度状态,回到未选课初始态。
      if (selectedCourseId && !courseList.some((c) => c.id === selectedCourseId)) {
        setSelectedCourseId(null);
        setSelectedNodeId(null);
        setTree([]);
        setProgressMap({});
        setDashboard(null);
        setAvailableLanguages([]);
        setCurrentLocale(null);
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
      setAgentReady({ ready: false, missing: t("error.checkReadyFailed") });
    }
  }, [t]);
  useEffect(() => {
    checkReady();
    const handler = () => checkReady();
    window.addEventListener("llm-config-changed", handler);
    return () => window.removeEventListener("llm-config-changed", handler);
  }, [checkReady]);

  // Phase 0/1(游戏感动效):订阅 main 进程状态变化推送,重拉对应数据 + 触发高光庆祝。
  // 修原 bug:能量条/连击以前只在启动拉一次,答题后 main 写 DB 但 renderer 不知道 → 能量条从不动。
  const prevXpRef = useRef(0);
  const prevStreakRef = useRef(0);
  // 同步 prev ref:每次 xp/streak state 变(含首次加载),记录为下一轮比较基准,防误触发。
  useEffect(() => {
    prevXpRef.current = xp?.todayXp ?? 0;
  }, [xp]);
  useEffect(() => {
    prevStreakRef.current = streak?.currentStreak ?? 0;
  }, [streak]);
  // 重新拉取整个课程的 progress(解锁后 UI 实时更新用)。
  // markNodeAttempted 可能解锁同章下一课 + 下一章第一课(双线推进),
  // 这些被解锁的节点 progress 变化需要刷新才能在地图上亮起。
  // 也用于 state:changed:"mastery" 事件——答题毕业/proposal apply 后实时刷新地图。
  const reloadCourseProgress = useCallback(async () => {
    const lessons = tree.filter((n) => n.type === "lesson" || n.type === "exam");
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
  }, [tree]);

  useEffect(() => {
    const off = api.on("state:changed", (kind: "xp" | "streak" | "mastery") => {
      if (kind === "xp") {
        api.getXpStatus().then((x) => {
          setXp(x);
          // 首次跨越 100 → 能量充满庆祝(prev<100 防已超 100 后重复触发)
          if (prevXpRef.current < 100 && x.todayXp >= 100) celebrate("energy-full");
        }).catch(() => {});
      } else if (kind === "streak") {
        api.getStreak().then((s) => {
          setStreak(s);
          if (s.currentStreak > prevStreakRef.current) celebrate("streak");
        }).catch(() => {});
      } else if (kind === "mastery") {
        // mastery 变化(答题毕业/proposal apply)→ 加冕庆祝 + 刷新 xp/streak/due + 重载进度图
        celebrate("mastery");
        refreshAll();
        reloadCourseProgress();
      }
    });
    return off;
  }, [refreshAll, reloadCourseProgress]);

  useEffect(() => {
    if (!selectedCourseId) return;
    // 拉可用语言 + 当前语言
    api.getCourseLanguages(selectedCourseId).then(setAvailableLanguages).catch(() => setAvailableLanguages([]));
    api.getCourseLanguage(selectedCourseId).then(setCurrentLocale).catch(() => setCurrentLocale(null));
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId) return;
    api.getCourseTree(selectedCourseId, currentLocale ?? undefined).then(async (nodes) => {
      setTree(nodes);
      const lessons = nodes.filter((n) => n.type === "lesson" || n.type === "exam");
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
  }, [selectedCourseId, currentLocale, setErrorFromThrow]);

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
      if (e.key === "Escape" && thread.activeId) {
        api.abortAgentChatThread(thread.activeId).catch(() => {});
        setShowSettings(false);
        setShowCommandPalette(false);
      }
      // Cmd+K / Ctrl+K → 命令面板
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((s) => !s);
      }
      // Ctrl+B → 切换左栏(布局切换;T2 互斥侧栏 / T3 切单栏)
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleLeftPane();
      }
      // Ctrl+Tab → 切换 thread(下一个)。考试进行中拦截(离开需走警告确认)。
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        if (examSessionRef.current.active) return;
        const list = thread.threads;
        if (list.length > 1) {
          const curIdx = list.findIndex((t) => t.id === thread.activeId);
          const nextIdx = e.shiftKey
            ? (curIdx - 1 + list.length) % list.length
            : (curIdx + 1) % list.length;
          thread.setActiveId(list[nextIdx]!.id);
        }
      }
      // 数字键切换视图(非输入框焦点)
      if (!e.target || !(e.target as HTMLElement).matches("input, textarea, select")) {
        if (e.key === "1") setView("map");
        if (e.key === "2") setView("import");
        if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setShowSettings(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId]);

  // 点 lesson 的实际执行(解锁下一课 + 设选中,联动三栏)
  const proceedLessonClick = useCallback(async (node: ContentNode) => {
    try {
      // 考试节点:只选中,不走 markNodeAttempted(考试不走 BKT/解锁),中栏渲染 ExamView
      if (node.type === "exam") {
        setSelectedNodeId(node.id);
        setForceArtifactTab("content");
        return;
      }
      // 跳关守卫(渲染层):locked 节点拒绝点击。UI 已 disabled,这里是兜底
      // (防键盘/deep link 绕过)。主进程 markNodeAttempted 还有第二道守卫。
      if (progressMap[node.id]?.status === "locked") {
        setSelectedNodeId(null);
        return;
      }
      await api.markNodeAttempted(node.id);
      const newStreak = await api.getStreak();
      // 刷新整个课程的 progress(markNodeAttempted 双线解锁了其他节点,
      // 需要让地图实时显示新解锁的球,而不是等 Ctrl+R)
      await reloadCourseProgress();
      setStreak(newStreak);
      setSelectedNodeId(node.id);
      setForceArtifactTab("content");
      setIsReviewing(false); // 正常切节点 → 退出复习自评模式
      // v0.5: 点节点 → selectedNodeId 变化 → useThreads(selectedCourseId, selectedNodeId) 自动 reload 该节点的 thread
    } catch (e) {
      setErrorFromThrow(e);
    }
  }, [progressMap, reloadCourseProgress, setErrorFromThrow]);

  /** 导航守卫:考试进行中 → 弹离开警告(未答=错计分);否则直接执行 */
  const guardedNav = useCallback((action: () => void) => {
    if (examSessionRef.current.active) {
      setExamLeave({ open: true, pendingAction: action });
      return;
    }
    action();
  }, []);

  // 点 lesson:套考试离开守卫后执行
  const handleLessonClick = useCallback(
    (node: ContentNode) => {
      if (examSessionRef.current.active && node.id !== selectedNodeId) {
        setExamLeave({ open: true, pendingAction: () => void proceedLessonClick(node) });
        return;
      }
      void proceedLessonClick(node);
    },
    [proceedLessonClick, selectedNodeId],
  );

  // ExamView 上报考试会话(active 时导航被 guardedNav 拦截)
  const handleExamSessionChange = useCallback(
    (s: { active: boolean; terminate: (() => Promise<void>) | null }) => {
      examSessionRef.current = s;
    },
    [],
  );

  // 离开警告确认:先终止考试(未答=错),再执行被拦截的导航。
  // 会话在此消费:清掉 examSessionRef,否则残留 active:true 会让之后每次切节点都误弹警告
  // (用户实测:终止离开后警告框反复弹,直到切回考试节点重新挂载才被 effect 清掉)。
  const confirmExamLeave = useCallback(async () => {
    const action = examLeave.pendingAction;
    setExamLeave({ open: false, pendingAction: null });
    const s = examSessionRef.current;
    examSessionRef.current = { active: false, terminate: null };
    if (s.active && s.terminate) {
      try {
        await s.terminate();
      } catch {
        /* 尽力而为:导航不因提交失败阻塞 */
      }
    }
    action?.();
  }, [examLeave.pendingAction]);

  // 离开警告模态:焦点圈禁 + Esc 取消
  useFocusTrap(examLeaveModalRef, examLeave.open);
  useEffect(() => {
    if (!examLeave.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExamLeave({ open: false, pendingAction: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [examLeave.open]);

  const handleSoulPick = async (name: string) => {
    try {
      await api.setActiveSoul(name);
      setActiveSoul(name);
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
    [chat, setErrorFromThrow],
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
    [chat, setErrorFromThrow],
  );

  const currentCourse = courses.find((c) => c.id === selectedCourseId);
  // due 按当前课程过滤:getDueReviews 返回全局 due,切换到无 due 的课程时徽章/nudge 不该显示。
  // 派生 dueInCourseIds = 全局 due ∩ 当前课程 tree 的 nodeId。
  const dueInCourseIds = useMemo(() => {
    const treeIds = new Set(tree.map((n) => n.id));
    return new Set([...dueNodeIds].filter((id) => treeIds.has(id)));
  }, [dueNodeIds, tree]);
  const dueInCourseCount = dueInCourseIds.size;
  const sections = useMemo(
    () =>
      tree
        .filter((n) => n.type === "section")
        .sort((a, b) => a.orderIdx - b.orderIdx),
    [tree],
  );

  const orderedSouls = useMemo(() => {
    const builtin = BUILTIN_SOUL_ORDER.map((name) =>
      souls.find((s) => s.name === name),
    ).filter((s): s is Soul => !!s);
    const custom = souls.filter((s) => !BUILTIN_SOUL_ORDER.includes(s.name));
    return [...builtin, ...custom];
  }, [souls]);

  // v0.3: 黑板笔记本(canvas_items 持久化)
  const canvas = useCanvas(selectedCourseId);
  const font = useFontSize();
  const toast = useToast();

  // 章节考试:后台生成完成 → 人在别的节点时 toast 通知(在考试节点上 ExamView 自己会切就绪态)
  useEffect(() => {
    const off = api.on("exam:status", (st) => {
      if (st.status !== "ready" || st.nodeId === selectedNodeId) return;
      const node = tree.find((n) => n.id === st.nodeId);
      if (node) toast.show(t("exam.ready.toast", { title: node.title }), { duration: 4000 });
    });
    return off;
  }, [selectedNodeId, tree, toast, t]);

  // 删除课程(当前课也可删):MapRail 的 ConfirmCard 确认后调用。
  // 删除后 refreshAll 检测选中课程消失 → 自动清空选中态(回到未选课初始态)。
  const handleDeleteCourse = useCallback(
    async (courseId: string) => {
      const course = courses.find((c) => c.id === courseId);
      try {
        await api.deleteCourse(courseId);
        toast.show(t("import.deleted", { title: course?.title ?? courseId }), { duration: 3000 });
        refreshAll();
      } catch (e) {
        setErrorFromThrow(e);
      }
    },
    [courses, refreshAll, setErrorFromThrow, toast, t],
  );

  // 统一的"发送一条消息"流程:首次发送自动建 thread,之后直接发。
  // ChatComposer 的 onSend 和 handleStartLearning 都走这条,避免重复逻辑和"忘了建 thread"的坑。
  // displayText:按钮触发的消息传短动作标签(气泡只显示它);手打输入不传=原样展示。
  // attachments(v0.10):随消息上传的图片/文本附件,透传给 useChatStream → main。
  const sendMessage = useCallback(
    async (text: string, displayText?: string, attachments?: ChatAttachmentInput[]) => {
      if (!text.trim() || chat.streaming) return;
      if (!thread.activeId) {
        const newId = await thread.ensureThreadForSend(text, displayText);
        if (newId) {
          chat.send(text, newId, displayText, attachments);
          return;
        }
        toast.show(t("toast.threadCreateFailed"));
        return;
      }
      // 当前 thread 标题为空(如"+ 新建会话"建的空 thread)→ 用首条消息截断自动命名,
      // 与 ensureThreadForSend 的命名逻辑一致:标题=首条完整输入(不截断)。
      // 按钮触发的消息标题用短动作标签——tab 里不该出现整段提示词。
      const cur = thread.activeThread;
      if (cur && !cur.title) {
        thread.update(cur.id, { title: (displayText ?? text).trim() });
      }
      chat.send(text, undefined, displayText, attachments);
    },
    [chat, thread, toast, t],
  );
  // 答题完成自动 hook:最后一题提交后点「完成」即把成绩单发给 AI(气泡只显示短标签,完整判定只给 LLM),
  // 由 AI 决定下一步(讲错题/放行/换角度)—— 用户不再手动点"下一步动作"。
  // AI 还在流式输出时等它结束再发(答题时上一轮可能仍在生成),最多等 20s。
  // 两处都必须走 ref,不能信闭包:答题发生在上一轮流式收尾时,handleQuizCompleted
  // 捕获的 sendMessage 闭包里 chat.streaming 冻结为 true,重试 10 次都被它自己的
  // 守卫静默吞掉 → 永远不发(真实 E2E 连续踩中两层)。chatStreamingRef 读实时流态,
  // sendRef.current 每渲染都指向最新 sendMessage(其守卫读的也是最新 chat)。
  const chatStreamingRef = useRef(chat.streaming);
  chatStreamingRef.current = chat.streaming;
  const handleQuizCompleted = useCallback(
    (r: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => {
      const content = buildQuizHookMessage(r, t);
      const label = buildQuizHookLabel(r, t);
      const trySend = (left: number) => {
        if (!chatStreamingRef.current) {
          void sendRef.current?.(content, label);
          return;
        }
        if (left > 0) setTimeout(() => trySend(left - 1), 2000);
      };
      trySend(10);
    },
    [t],
  );

  // ref 桥接:让 handleStartLearning(定义在 toast 之前)能调用 sendMessage(定义在 toast 之后)
  sendRef.current = sendMessage;

  // 黑板(canvas):对话里最新一件重产物 → 右栏黑板 tab 大画布渲染;
  // 流式中出现新重产物时自动把右栏切到黑板(ChatGPT canvas 式联动,仅桌面双/三栏——
  // T3 单栏时右栏未挂载,切 tab 无副作用)。
  const HEAVY_ARTIFACTS = new Set(["concept_map", "diagram", "compare_table", "code_walkthrough"]);
  const canvasArtifact = useMemo(() => {
    const heavy = extractArtifacts(chat.messages).filter((a) =>
      HEAVY_ARTIFACTS.has((a.output as { artifactType?: string } | null)?.artifactType ?? ""),
    );
    if (heavy.length) return heavy[heavy.length - 1];
    // 回退:当前节点理解区里最新一件持久重产物(历史会话存的图也能上黑板,不至于空态)
    const saved = canvas.items
      .filter((i) => HEAVY_ARTIFACTS.has(i.artifactType))
      .map((i) => {
        try {
          return { id: i.id, toolName: i.artifactType, output: JSON.parse(i.data) as unknown };
        } catch {
          return null;
        }
      })
      .filter((x): x is { id: string; toolName: string; output: unknown } => x !== null);
    return saved.length ? saved[saved.length - 1] : null;
  }, [chat.messages, canvas.items]);
  const seenArtifactIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!canvasArtifact || seenArtifactIdsRef.current.has(canvasArtifact.id)) return;
    seenArtifactIdsRef.current.add(canvasArtifact.id);
    if (chat.streaming) setForceArtifactTab("board");
  }, [canvasArtifact, chat.streaming]);

  // v0.10 上下文表的"历史段":当前 thread 全部消息文本(text parts)的估算 token。
  // LLM 历史重放只带 content(文本),reasoning/tool 产物不进上下文,这里只算 text。
  const historyTokens = useMemo(
    () =>
      chat.messages.reduce(
        (sum, m) => sum + m.parts.reduce((s, p) => (p.type === "text" ? s + estimateTokens(p.text) : s), 0),
        0,
      ),
    [chat.messages],
  );

  // P2.3: session 开始若有待复习,弹一次 nudge(每进程生命周期最多一次,避免刷屏)。
  // 持久 surface 是 MapRail 的 map-review-badge;这里是"拉你回来练"的主动提示。
  const reviewNudgedRef = useRef(false);
  useEffect(() => {
    if (dueInCourseCount > 0 && !reviewNudgedRef.current) {
      reviewNudgedRef.current = true;
      toast.show(t("review.nudge", { n: dueInCourseCount }), { duration: 4000 });
    }
  }, [dueInCourseCount, toast, t]);

  // M2: 从对话流提取展示型 tool 产物 → 自动持久化到 canvas_items
  const artifacts = useMemo(() => extractArtifacts(chat.messages), [chat.messages]);
  const savedArtifactKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // 对每个新产物(未持久化的),自动 save 到 canvas
    for (const art of artifacts) {
      const output = art.output as { artifactType?: string; title?: string } | null;
      if (!output || !output.artifactType) continue;
      // 稳定内容 key:artifactType + output 序列化。
      // 不用 art.id(msgId-partIdx),因为 chat:done 会把临时 msg id 替换成 DB uuid,
      // 导致同一产物产生两个 id → 被 saveCanvasItem 写两次。内容 key 跨 id 漂移保持稳定,
      // 配合后端 (courseId,nodeId,type,data) 去重,根治重复保存。
      const key = `${output.artifactType}:${JSON.stringify(output)}`;
      if (savedArtifactKeysRef.current.has(key)) continue;
      savedArtifactKeysRef.current.add(key);
      // 自动持久化(不让用户决定,全存)。后端按内容幂等去重,重复调用安全。
      canvas.save({
        nodeId: selectedNodeId,
        artifactType: output.artifactType,
        title: output.title ?? null,
        data: output,
      });
      // 不自动切 tab——保持用户当前 tab,笔记 tab 的数字 badge 实时反映新增。
      // toast 提示用户"有新笔记了",想看再自己点过去。
      toast.show(t("toast.artifactSaved"), { duration: 3000 });
    }
  }, [artifacts, canvas, selectedNodeId, toast, t]);

  // 视图切换时清除强制 tab
  useEffect(() => {
    if (view !== "map") setForceArtifactTab(null);
  }, [view]);

  // 复习抽屉(v0.3:复习作为 overlay,不占右栏标签)
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);
  /** 用户从复习抽屉选了课 → true,讲解底部显示自评卡。正常切节点 → false */
  const [isReviewing, setIsReviewing] = useState(false);

  return (
    <div className="h-[var(--app-height,100vh)] flex flex-col bg-surface-1 text-neutral-900 dark:text-neutral-100 overflow-hidden">
      <Header
        streak={streak}
        xp={xp}
        fontSize={font.size}
        onFontBump={font.bump}
        onOpenSettings={() => setShowSettings(true)}
        leftVisible={showLeft}
        rightVisible={showRight}
        onToggleLeft={toggleLeftPane}
        onToggleRight={toggleRightPane}
        tier={tier}
        bottomBar={tier === 3 ? (
          /* T3 单行标题栏的居中切换器:紧凑 icon button group(容器底色+内描边,
             与两侧裸露的 XP/设置图标区分成组)。无文字,名称走 aria-label +
             tooltip(桌面 hover / 触屏长按,GlobalTooltip 双通道)。 */
          <nav
            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-ink/5 ring-1 ring-inset ring-[var(--border)]"
            data-testid="t3-pane-switcher"
            role="tablist"
            aria-label={t("pane.switcher")}
          >
            {([
              { k: "rail" as const, icon: MapIcon, label: t("pane.map"), testid: "t3-btn-rail" },
              { k: "chat" as const, icon: MessageSquare, label: t("pane.chat"), testid: "t3-btn-chat" },
              { k: "notebook" as const, icon: PenLine, label: t("pane.notes"), testid: "t3-btn-notebook" },
            ]).map(({ k, icon: Icon, label, testid }) => (
              <button
                key={k}
                role="tab"
                aria-selected={t3Pane === k}
                aria-label={label}
                data-testid={testid}
                data-tooltip={label}
                onClick={() => setT3Pane(k)}
                className={`w-8 h-7 flex items-center justify-center rounded-md transition-colors ${
                  t3Pane === k ? "bg-brand/20 text-brand" : "text-ink-muted active:bg-ink/10"
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </nav>
        ) : undefined}
      />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div
        className="flex-1 flex min-h-0 min-w-0"
        onTouchStart={onPanesTouchStart}
        onTouchEnd={onPanesTouchEnd}
      >


      {/* 左栏:MapRail(header 下方首栏,tab 切换地图/导入;T3 单栏全宽) */}
      {showLeft && (
        <MapRail
          fullWidth={tier === 3}
          view={view}
          onViewChange={setView}
          courseTitle={currentCourse?.title ?? null}
          courseId={selectedCourseId}
          courses={courses}
          sections={sections}
          tree={tree}
          progressMap={progressMap}
          selectedNodeId={selectedNodeId}
          dueCount={dueInCourseCount}
          dueNodeIds={dueInCourseIds}
          overallMastery={dashboard?.overallMastery ?? 0}
          streak={streak?.currentStreak ?? 0}
          streaming={chat.streaming}
          onJumpNode={(id) => {
            if (chat.streaming) return;
            const node = tree.find((n) => n.id === id);
            if (node) handleLessonClick(node);
            // T3 单栏:选完球自动切到对话栏(手机习惯:地图是选择器,内容在对话里看)
            if (tier === 3) setT3Pane("chat");
          }}
          onOpenReview={() => setShowReviewDrawer(true)}
          onSelectCourse={(id) => guardedNav(() => { setSelectedCourseId(id); refreshAll(); })}
          onDeleteCourse={(id) => guardedNav(() => { void handleDeleteCourse(id); })}
          onCoursesChanged={() => { refreshAll(); }}
          availableLanguages={availableLanguages}
          currentLocale={currentLocale}
          onLocaleChange={async (locale) => {
            if (!selectedCourseId) return;
            await api.setCourseLanguage(selectedCourseId, locale);
            setCurrentLocale(locale);
          }}
        />
      )}

      {/* 右半区:顶栏 + 中右栏(顶栏只在中右栏上方,左栏全高独立) */}
        {/* 视图层:AI 对话 + 笔记本 */}
        <>
            {/* 中栏:AI 对话流(ChatStream + ChatComposer) / 考试节点(ExamView)。
                v0.6 分栏:无描边,色差划分。
                v0.7 宽度:弹性 min/max——clamp(480px, 40vw, 720px)。每个屏宽拿到能拿到的最佳:
                  1366 屏 → ~470px(下限 480 兜底,表格/代码不挤崩)
                  1920 屏 → ~680px(阅读黄金区,AI 长讲解舒服)
                  2560+  → 720px 上限(不浪费,对话不失紧凑)
                右栏隐藏时 flex:1 撑满。 */}
            {showChat && (
            <div
              className="flex flex-col h-full bg-surface-1 shrink-0 min-w-0 motion-safe:transition-[width] motion-safe:duration-200"
              style={
                tier === 3
                  ? { flex: 1 } // 单栏档:对话占满
                  : showRight
                    ? { width: "clamp(480px, 36vw, 800px)" } // 右侧有栏:阅读黄金宽(36vw/上限 800)
                    : { flex: 1 } // 右侧无栏(T1 手动收起 / T2 显示了左栏):撑满
              }
              data-testid="chat-panel"
            >
              {!selectedCourseId ? (
                /* 未选课程(启动初始态 / 删除已选课程后):中栏显示选课引导,不渲染对话 UI */
                <div className="flex-1 flex items-center justify-center px-6" data-testid="chat-no-course">
                  <div className="text-center max-w-sm">
                    <div className="text-5xl mb-4 opacity-30">📚</div>
                    <div className="text-title font-bold text-ink mb-2">{t("course.empty.title")}</div>
                    <div className="text-body text-ink-muted leading-relaxed">{t("course.empty.desc")}</div>
                  </div>
                </div>
              ) : selectedNode?.type === "exam" ? (
                /* 考试节点:渲染 ExamView 替代 chat(关底 boss,独立 UI) */
                <ExamView
                  examNode={selectedNode}
                  locale={uiLang}
                  onSessionChange={handleExamSessionChange}
                  paused={examLeave.open}
                  onExamCompleted={() => {
                    // 考试完成 → 刷新该考试节点的 progress(更新地图星数)
                    api.getProgress(selectedNode.id).then((p) => {
                      if (p) setProgressMap((m) => ({ ...m, [selectedNode.id]: p }));
                    });
                  }}
                />
              ) : (
                <>
              {/* v0.4 顶栏:thread 切换条(焦点节点 + 会话切换) */}
              <ThreadSwitcher
                threads={thread.threads}
                activeThread={thread.activeThread}
                focusNodeTitle={selectedNode?.title ?? null}
                onPickThread={(id) => {
                  if (chat.streaming) return; // 输出中拒绝切换
                  thread.setActiveId(id);
                }}
                onCreate={() => {
                  if (chat.streaming) return;
                  thread.create({ title: null });
                  toast.show(t("toast.threadCreated"));
                }}
                onRename={(id, title) => {
                  thread.update(id, { title });
                  toast.show(t("toast.threadRenamed"));
                }}
                onArchive={(id) => {
                  thread.update(id, { status: "archived" });
                  toast.show(t("toast.threadArchived"), {
                    duration: 5000,
                    action: { label: t("action.undo"), onClick: () => thread.update(id, { status: "active" }) },
                  });
                }}
                onDelete={(id) => {
                  const removed = thread.removeWithUndo(id);
                  if (removed) {
                    toast.show(`${t("toast.threadDeleted")}${removed.title ? `「${removed.title}」` : ""}`, {
                      duration: 5000,
                      action: {
                        label: t("action.undo"),
                        onClick: () => {
                          thread.restore(removed);
                          toast.show(t("toast.restored"));
                        },
                      },
                    });
                    // 5 秒后真删(若未 undo)
                    setTimeout(() => {
                      api.threadDelete(removed.id).catch(() => {});
                    }, 5500);
                  }
                }}
              />
              <ChatStream
                messages={chat.messages}
                streaming={chat.streaming}
                onApplyProposal={handleApplyProposal}
                onRejectProposal={handleRejectProposal}
                summary={nodeSummary}
                onStartLearning={agentReady?.ready ? handleStartLearning : undefined}
                agentReady={agentReady?.ready ?? false}
                onGotoSettings={() => setShowSettings(true)}
                hasNode={!!selectedNode}
                selectedNodeId={selectedNodeId}
                threadId={thread.activeId}
                onPickQuizAction={(msg) => {
                  void sendMessage(msg);
                }}
                onQuizCompleted={handleQuizCompleted}
                cardMode={tier === 3}
                chatNotes={canvas.items.filter(
                  (i) => i.artifactType === "user_note" && i.sourceAnchor,
                )}
                onSaveChatNote={(text, msgId, startOffset, endOffset) => {
                  if (!selectedNode || !thread.activeId) return;
                  canvas.saveUserNote({
                    nodeId: selectedNode.id,
                    text,
                    sourceType: "chat",
                    sourceAnchor: { type: "chat", threadId: thread.activeId, msgId, startOffset, endOffset },
                  });
                  toast.show(t("toast.noteSaved"), { duration: 2000 });
                }}
              />
              <ChatComposer
                nodeId={selectedNodeId}
                agentReady={agentReady?.ready ?? false}
                streaming={chat.streaming}
                souls={orderedSouls}
                activeSoul={activeSoul}
                starterPrompts={chat.messages.length > 0 ? localizedStarterPrompts : []}
                onPickSoul={handleSoulPick}
                onSend={sendMessage}
                onStop={chat.stop}
                onLogFriction={
                  selectedNodeId
                    ? (category, summary) => {
                        void api.logFriction(selectedNodeId, category, summary);
                        toast.show(t("chat.friction.saved"), { duration: 2500 });
                      }
                    : undefined
                }
                onGotoSettings={() => setShowSettings(true)}
                insertText={quoteText}
                historyTokens={historyTokens}
              />
                </>
              )}
            </div>
            )}

            {/* 右栏:NotebookPanel 康奈尔笔记本(讲解/笔记)。布局切换可隐藏。
                v0.6 分栏:无描边,色差划分(底色由 NotebookPanel 内部 bg-surface-2 控制)。
                v0.7 宽度:flex-1 弹性吃中栏剩余,加 min-w 防内容(笔记卡/表格)被挤。 */}
            {showRight && (
            <main className={tier === 3 ? "flex-1 min-w-0 bg-surface-2" : "flex-1 min-w-[440px] bg-surface-2"} data-testid={tier === 3 ? "notebook-pane-full" : undefined}>
              <NotebookPanel
                selectedNode={selectedNode}
                items={canvas.items}
                loading={canvas.loading}
                forceTab={forceArtifactTab}
                canvasArtifact={canvasArtifact}
                onUserTabChange={() => setForceArtifactTab(null)}
                onRemove={(id) => {
                  canvas.remove(id);
                  toast.show(t("toast.noteDeleted"));
                }}
                onTogglePin={(id) => {
                  canvas.togglePin(id);
                }}
                onRecordQuizResult={(id, correct) => {
                  canvas.recordQuizResult(id, correct);
                }}
                onUpdateNoteComment={(id, comment) => {
                  canvas.updateUserNoteComment(id, comment);
                }}
                onSaveContentNote={(text, anchor) => {
                  if (!selectedNode) return;
                  canvas.saveUserNote({
                    nodeId: selectedNode.id,
                    text,
                    sourceType: "content",
                    sourceAnchor: anchor,
                  });
                  toast.show(t("toast.noteSaved"), { duration: 2000 });
                }}
                onJumpToSource={handleJumpToSource}
                onQuoteToChat={handleQuoteToChat}
                locale={currentLocale}
                isReviewing={isReviewing}
                onReviewDone={() => setIsReviewing(false)}
              />
            </main>
            )}
        </>
      </div>

      {/* 课程切换/导入已整合进左栏 tab */}

      {/* 设置抽屉(从 tab 改为 overlay,M1) */}
      {showSettings && (
        <SettingsDrawer onClose={() => setShowSettings(false)} />
      )}

      {/* v0.3: 复习抽屉(从地图徽章唤起) */}
      {showReviewDrawer && (
        <ReviewDrawer
          onClose={() => setShowReviewDrawer(false)}
          tree={tree}
          dashboard={dashboard}
          progressMap={progressMap}
          onPickNode={(id) => {
            guardedNav(() => {
              setSelectedNodeId(id);
              setForceArtifactTab("content");
              setShowReviewDrawer(false);
              setIsReviewing(true);
            });
          }}
        />
      )}

      {/* 章节考试:离开警告模态(考试进行中切换节点/课程时弹出;确认 = 终止考试并导航) */}
      {examLeave.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="exam-leave-modal"
        >
          <div
            ref={examLeaveModalRef}
            className="w-[min(400px,90vw)] rounded-2xl bg-surface-0 p-6 shadow-elevated border-l-2 border-l-warning"
            role="dialog"
            aria-modal="true"
            aria-label={t("exam.leave.title")}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              <span className="text-title font-bold text-ink">{t("exam.leave.title")}</span>
            </div>
            <div className="text-body text-ink-muted mb-5 leading-relaxed">{t("exam.leave.message")}</div>
            <div className="flex justify-end gap-2">
              <button
                className="btn-3d-neutral px-4 py-1.5 text-body"
                onClick={() => setExamLeave({ open: false, pendingAction: null })}
                data-testid="exam-leave-cancel"
              >
                {t("exam.leave.cancel")}
              </button>
              <button
                className="btn-3d-brand px-4 py-1.5 text-body"
                style={{ background: "var(--warning)", boxShadow: "0 3px 0 0 var(--warning-dark)" }}
                onClick={() => void confirmExamLeave()}
                data-testid="exam-leave-confirm"
              >
                {t("exam.leave.confirm")}
              </button>
            </div>
          </div>
        </div>
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

      {/* 全局悬浮提示(Portal 到 body,脱离所有 stacking context,永远最上层) */}
      <GlobalTooltip />
      {/* Phase 0:庆祝渲染层(粒子爆发/高光时刻,reduced-motion 自动降级)。根级 fixed,z-[60]。 */}
      <CelebrationLayer />
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
  fontSize,
  onFontBump,
  onOpenSettings,
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
  tier,
  bottomBar,
}: {
  streak: Streak | null;
  xp: XpStatus | null;
  fontSize: "small" | "medium" | "large";
  onFontBump: (dir: "up" | "down") => void;
  onOpenSettings: () => void;
  leftVisible: boolean;
  rightVisible: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  /** 布局档位(1/2/3):T3 单栏时隐藏视图切换组(顶部 switcher 已覆盖)与字号控制,header 才塞得进窄窗 */
  tier?: 1 | 2 | 3;
  /** T3 居中切换器:有值时标题栏切到单行窄版(左 XP / 中切换器 / 右设置),不占第二行 */
  bottomBar?: React.ReactNode;
}) {
  const t = useLang();
  if (bottomBar) {
    /* T3 单行标题栏(48px):左 XP 紧凑数字、中三栏切换器(真居中,两侧 flex-1 对称)、右设置。
       应用名不上栏 —— 引导器/浏览器标签已可见,省下的高度全给内容(滑屏手势兜底切换)。 */
    return (
      <header className="app-header shrink-0">
        <div className="flex items-center h-12 px-4">
          <div className="flex-1 flex items-center min-w-0">
            {xp && (
              <div className="flex items-center gap-1 shrink-0" data-testid="xp-bar" title={t("header.energy")}>
                <Zap
                  className={`w-3.5 h-3.5 text-brand ${xp.todayXp >= 100 ? "energy-breathe" : ""}`}
                  fill={xp.todayXp >= 100 ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                <span className="text-label font-bold tabular-nums text-brand">{xp.todayXp}</span>
              </div>
            )}
          </div>
          {bottomBar}
          <div className="flex-1 flex items-center justify-end">
            <button
              onClick={onOpenSettings}
              data-testid="header-settings"
              aria-label={t("header.settings")}
              className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50 transition-colors"
              title={t("header.settings")}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>
    );
  }
  return (
    <header className="app-header shrink-0 flex flex-col">
      {/* 行1:宽屏(T1/T2)标题栏 */}
      <div className="flex items-center pt-2.5 pb-3 px-6 justify-between">
      {/* 左:项目名 */}
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-body font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100 select-none min-w-0 truncate">
          Lookat<span className="text-brand">Study</span>
        </h1>
      </div>

      {/* 右:控件按"视图 → 阅读 → 进度 → 配置"分组 */}
      <div className="flex items-center gap-3">
        {/* 视图:左右栏显隐 */}
        {tier !== 3 && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={onToggleLeft}
            data-testid="layout-toggle-left"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              leftVisible ? "text-neutral-500 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-600 bg-neutral-200 dark:bg-neutral-800"
            }`}
            title={t("header.toggleLeft")}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleRight}
            data-testid="layout-toggle-right"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              rightVisible ? "text-neutral-500 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-600 bg-neutral-200 dark:bg-neutral-800"
            }`}
            title={t("header.toggleRight")}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
        )}

        {/* 阅读:全局字号(A-/A+,三档,影响整个应用 rem 基准) */}
        {tier !== 3 && (
        <div className="flex items-center gap-0.5" data-testid="font-size-control">
          <button
            onClick={() => onFontBump("down")}
            disabled={fontSize === "small"}
            data-testid="font-smaller"
            className="text-label w-7 h-7 flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-ink/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title={t("header.font.smaller")}
          >A-</button>
          <button
            onClick={() => onFontBump("up")}
            disabled={fontSize === "large"}
            data-testid="font-larger"
            className="text-body w-7 h-7 flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-ink/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title={t("header.font.larger")}
          >A+</button>
        </div>
        )}

        {/* 进度:今日学习能量(= todayXp,软参考 100 满条,无配置目标)+ 连击。
            绿色(brand)= 进度/能量(PRODUCT.md);gold 留给 mastery/crown,这里不用。
            ≥100 时填充 Zap 图标(实心闪电)表示"充满",颜色不变。 */}
        {xp && (
          <div
            className="flex items-center gap-1.5"
            data-testid="xp-bar"
            title={t("header.energy")}
          >
            <Zap
              className={`w-3.5 h-3.5 text-brand ${xp.todayXp >= 100 ? "energy-breathe" : ""}`}
              fill={xp.todayXp >= 100 ? "currentColor" : "none"}
              aria-hidden="true"
            />
            <div className="w-16 h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(3, xp.todayXp))}%` }}
              />
            </div>
            <span className="text-label font-bold tabular-nums text-brand">
              {xp.todayXp}
            </span>
          </div>
        )}
        {xp && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/10"
            data-testid="level-badge"
            title={t("header.level.title")}
          >
            <span className="text-label font-bold text-brand">Lv.{xp.level}</span>
          </div>
        )}
        {streak && <StreakBadge streak={streak} />}

        {/* 配置:设置(最右,惯例位置) */}
        <button
          onClick={onOpenSettings}
          data-testid="header-settings"
          className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50 transition-colors"
          title={t("header.settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
      </div>
    </header>
  );
}

/* ---------- 设置抽屉 ---------- */

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="settings-drawer">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="relative w-full max-w-lg h-full bg-surface-0 border-l border-[var(--border)] shadow-elevated flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h2 className="text-body font-bold">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            data-testid="settings-close"
            aria-label={t("action.close")}
            className="text-ink-muted hover:text-ink-strong w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-3"
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


/* ---------- 复习抽屉 ---------- */
function ReviewDrawer({
  onClose,
  tree,
  onPickNode,
  dashboard,
  progressMap,
}: {
  onClose: () => void;
  tree: ContentNode[];
  onPickNode: (id: string) => void;
  dashboard: DashboardData | null;
  progressMap: Record<string, Progress>;
}) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // SRS 数据(象限分类用)
  const [srsItems, setSrsItems] = useState<{ nodeId: string; intervalDays: number; repetitions: number; overdue: boolean }[]>([]);
  useEffect(() => {
    api.getAllSrsItems().then((data) => setSrsItems(data as typeof srsItems)).catch(() => setSrsItems([]));
  }, []);
  const srsMap = useMemo(() => new Map(srsItems.map((i) => [i.nodeId, i])), [srsItems]);

  // 象限分类
  const quadrants = useMemo(() => {
    const nodeMap = new Map(tree.map((n) => [n.id, n]));
    const valid = srsItems.filter((it) => nodeMap.has(it.nodeId));
    return {
      overdue: valid.filter((i) => i.overdue),
      short: valid.filter((i) => !i.overdue && i.intervalDays > 0 && i.intervalDays <= 7),
      long: valid.filter((i) => !i.overdue && i.intervalDays > 7),
      inactive: valid.filter((i) => i.repetitions === 0 && !i.overdue),
    };
  }, [srsItems, tree]);

  // 学习世界的章节 + 课时（过滤 practice）
  const studySections = useMemo(() => {
    const sections = tree.filter((n) => n.type === "section" && (n.world ?? "study") === "study")
      .sort((a, b) => a.orderIdx - b.orderIdx);
    return sections.map((sec) => ({
      section: sec,
      lessons: tree
        .filter((n) => n.parentId === sec.id && n.type === "lesson")
        .sort((a, b) => a.orderIdx - b.orderIdx),
    }));
  }, [tree]);

  // 章节掌握度（从 dashboard 查）
  const sectionMastery = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of dashboard?.sections ?? []) m.set(s.sectionId, s.avgMastery);
    return m;
  }, [dashboard]);

  // 已开始的课（用于交错复习）
  const startedLessons = useMemo(
    () => tree.filter((n) => {
      const s = progressMap[n.id]?.status;
      return n.type === "lesson" && (n.world ?? "study") === "study" && (s === "in_progress" || s === "mastered");
    }),
    [tree, progressMap],
  );

  // 手风琴展开状态
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // SRS 状态指示色
  const srsDot = (nodeId: string) => {
    const s = srsMap.get(nodeId);
    if (!s) return null;
    if (s.overdue) return { color: "bg-review", title: t("review.quadrant.overdue") };
    if (s.intervalDays > 0 && s.intervalDays <= 7) return { color: "bg-gold", title: t("review.quadrant.short") };
    if (s.intervalDays > 7) return { color: "bg-brand", title: t("review.quadrant.long") };
    return null;
  };

  const hasOverdue = quadrants.overdue.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="review-drawer">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("review.title")}
        className="relative w-full max-w-md h-full bg-surface-0 border-l border-[var(--border)] shadow-elevated flex flex-col"
      >
        {/* 头 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <h2 className="text-body font-bold flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" aria-hidden="true" /> {t("review.title")}
          </h2>
          <button
            onClick={onClose}
            data-testid="review-close"
            aria-label={t("action.close")}
            className="text-ink-muted hover:text-ink-strong w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-3"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5" data-testid="review-panel">
          {/* 交错复习 */}
          {startedLessons.length > 0 && (
            <button
              onClick={() => {
                const pick = startedLessons[Math.floor(Math.random() * startedLessons.length)];
                if (pick) onPickNode(pick.id);
              }}
              data-testid="review-interleave"
              className="btn-3d-neutral w-full py-2.5 text-body flex items-center justify-center gap-1.5"
            >
              <Shuffle className="w-4 h-4" />
              {t("review.interleave")}
            </button>
          )}

          {/* SM-2 复习提醒（象限） */}
          {srsItems.length > 0 && (
            <div>
              <div className="text-caption font-bold text-ink-muted uppercase tracking-wider mb-2">{t("review.srsHint")}</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {([
                  { items: quadrants.overdue, label: t("review.quadrant.overdue"), dot: "bg-review" },
                  { items: quadrants.short, label: t("review.quadrant.short"), dot: "bg-gold" },
                  { items: quadrants.long, label: t("review.quadrant.long"), dot: "bg-brand" },
                  { items: quadrants.inactive, label: t("review.quadrant.inactive"), dot: "bg-ink-faint" },
                ] as const).filter((q) => q.items.length > 0).map((q) => (
                  <div key={q.label} className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-3">
                    <span className={`w-2 h-2 rounded-full ${q.dot}`} />
                    <span className="text-label text-ink-muted">{q.label}</span>
                    <span className="text-label font-extrabold text-ink-strong tabular-nums">{q.items.length}</span>
                  </div>
                ))}
              </div>
              {/* 逾期项快捷按钮 */}
              {hasOverdue && (
                <>
                  <div className="text-label text-ink-faint mb-1.5">{t("review.overdueQuickHint")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {quadrants.overdue.slice(0, 8).map((item) => {
                      const node = tree.find((n) => n.id === item.nodeId);
                      if (!node) return null;
                      return (
                        <button
                          key={item.nodeId}
                          onClick={() => onPickNode(item.nodeId)}
                          data-testid={`review-overdue-${item.nodeId.slice(0, 8)}`}
                          className="px-2 py-1 rounded-full bg-review/10 ring-1 ring-review/20 text-label text-review font-bold hover:bg-review/20 transition-colors truncate max-w-[140px]"
                        >
                          {node.title}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 我的课程进度（可展开手风琴） */}
          {studySections.length > 0 && (
            <div>
              <div className="text-caption font-bold text-ink-muted uppercase tracking-wider mb-2">{t("review.myProgress")}</div>
              <div className="space-y-1">
                {studySections.map(({ section, lessons }) => {
                  const pct = Math.round((sectionMastery.get(section.id) ?? 0) * 100);
                  const isOpen = expanded.has(section.id);
                  const startedInSec = lessons.filter((l) => {
                    const s = progressMap[l.id]?.status;
                    return s === "in_progress" || s === "mastered";
                  });
                  return (
                    <div key={section.id}>
                      {/* 章节行（可点击展开） */}
                      <button
                        onClick={() => toggle(section.id)}
                        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-surface-3 transition-colors"
                      >
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-ink-muted shrink-0" />}
                        <span className="text-body text-ink-strong font-bold truncate flex-1 text-left">{section.title}</span>
                        {startedInSec.length > 0 && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 100 ? "bg-gold" : "bg-brand"}`} style={{ width: `${Math.max(3, pct)}%` }} />
                            </div>
                            <span className="text-label tabular-nums text-ink-muted w-8 text-right">{pct}%</span>
                          </div>
                        )}
                      </button>
                      {/* 展开后的课时列表 */}
                      {isOpen && (
                        <div className="ml-5 mt-0.5 mb-1 space-y-0.5" data-testid="review-lesson-list">
                          {lessons.length === 0 ? (
                            <div className="text-label text-ink-faint py-1.5 pl-1">—</div>
                          ) : lessons.map((lesson) => {
                            const lp = progressMap[lesson.id];
                            const lmastery = lp ? Math.round((lp.mastery ?? 0) * 100) : null;
                            const dot = srsDot(lesson.id);
                            const isStarted = lp?.status === "in_progress" || lp?.status === "mastered";
                            return (
                              <div
                                key={lesson.id}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${dot?.color === "bg-review" ? "bg-review/8" : "hover:bg-surface-3"}`}
                              >
                                {dot ? <span className={`w-1.5 h-1.5 rounded-full ${dot.color} shrink-0`} title={dot.title} /> : <span className="w-1.5 h-1.5 shrink-0" />}
                                <span className={`text-label truncate flex-1 ${isStarted ? "text-ink-strong" : "text-ink-faint"}`}>{lesson.title}</span>
                                {lmastery !== null && (
                                  <span className="text-label tabular-nums text-ink-muted shrink-0 w-8 text-right">{lmastery}%</span>
                                )}
                                {isStarted && (
                                  <button
                                    onClick={() => onPickNode(lesson.id)}
                                    data-testid={`review-lesson-${lesson.id.slice(0, 8)}`}
                                    className="shrink-0 px-2 py-0.5 rounded-md bg-brand/15 text-brand text-caption font-bold hover:bg-brand/25 transition-colors"
                                  >
                                    {t("review.reviewLesson")}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 卡点提示（friction） */}
          {dashboard && dashboard.frictionByNode.length > 0 && (
            <div>
              <div className="text-caption font-bold text-review uppercase tracking-wider mb-1.5">{t("dashboard.mini.struggle")}</div>
              {dashboard.frictionByNode.map((f) => (
                <button key={f.nodeId} onClick={() => onPickNode(f.nodeId)} className="flex items-center gap-2 py-0.5 w-full text-left hover:bg-surface-3 rounded px-1">
                  <span className="text-label text-review font-bold tabular-nums">{f.count}×</span>
                  <span className="text-label text-ink-strong truncate flex-1">{f.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* 空状态 */}
          {startedLessons.length === 0 && srsItems.length === 0 && studySections.length === 0 && (
            <div className="text-center py-16" data-testid="review-empty">
              <div className="text-4xl mb-3 opacity-30">📖</div>
              <div className="text-body text-ink-muted">{t("review.empty.title")}</div>
              <div className="text-label text-ink-faint mt-1">{t("review.empty.desc")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ---------- 杂项 ---------- */

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useLang();
  return (
    <div
      role="alert"
      data-testid="error-banner"
      className="px-4 py-2 border-b border-warning-tint-border text-warning text-body flex items-center justify-between"
      style={{ backgroundColor: "var(--warning-tint)" }}
    >
      <span>⚠️ {message}</span>
      <button className="ml-3 underline text-warning-light" onClick={onClose}>{t("action.close")}</button>
    </div>
  );
}

function StreakBadge({ streak }: { streak: Streak }) {
  const t = useLang();
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-review/20"
      style={{ backgroundColor: "var(--review-tint)" }}
      data-testid="streak-badge"
      title={t("streak.title", { n: streak.currentStreak, m: streak.longestStreak })}
    >
      <Flame className="w-4 h-4 text-review flame-flicker" />
      <span className="text-body font-extrabold text-review">{streak.currentStreak}</span>
      {streak.freezeCount > 0 && (
        <span
          className="flex items-center gap-0.5 ml-0.5"
          data-testid="freeze-badge"
          title={t("streak.freeze.title", { n: streak.freezeCount })}
        >
          <Shield className="w-3 h-3 text-review/80" aria-hidden="true" />
          <span className="text-label font-bold text-review/80">{streak.freezeCount}</span>
        </span>
      )}
    </div>
  );
}
