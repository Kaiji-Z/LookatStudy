import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Settings, Flame, Zap, PanelLeft, PanelRight, BookOpen, Shield } from "lucide-react";
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
} from "@shared/types";
import { MapRail, type MapView } from "./components/MapRail.js";
import { GlobalTooltip } from "./components/GlobalTooltip.js";
import { NotebookPanel, type NotebookTab } from "./components/NotebookPanel.js";
import { useCanvas } from "./lib/useCanvas.js";
import { useFontSize } from "./lib/useFontSize.js";
import { ChatStream, extractArtifacts } from "./components/ChatStream.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ExamView } from "./components/ExamView.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ReviewPanel } from "./components/ReviewPanel.js";
import { SettingsView } from "./components/SettingsView.js";
import { useChatStream } from "./lib/useChatStream.js";
import { useThreads } from "./lib/useThreads.js";
import { useToast } from "./components/Toast.js";
import { ThreadSwitcher } from "./components/ThreadSwitcher.js";
import { useLang } from "./lib/i18n.js";
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
  // 右栏强制 tab(如导航复习入口 → review)
  const [forceArtifactTab, setForceArtifactTab] = useState<NotebookTab | null>(null);
  // 设置弹窗(M1:设置从 tab 改为 modal/抽屉)
  const [showSettings, setShowSettings] = useState(false);
  // 布局切换:左栏/右栏显隐(Cursor 风格)
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);
  // Cmd+K 命令面板(M2)
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // 当前在右栏聚焦的产物 index(M2)

  // AI 就绪状态 + starter prompts
  const [agentReady, setAgentReady] = useState<{ ready: boolean; provider?: string; model?: string; missing?: string } | null>(null);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);

  // v0.4: thread 模型—— useThreads 管 thread 列表, useChatStream 管当前 thread 消息
  const thread = useThreads(selectedCourseId, selectedNodeId);
  const chat = useChatStream(thread.activeId);

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
    api.getNodeSummary(selectedNodeId).then((s) => { if (!cancelled) setNodeSummary(s); }).catch(() => { if (!cancelled) setNodeSummary(null); });
    return () => { cancelled = true; };
  }, [selectedNodeId]);

  const selectedNode = useMemo(
    () => tree.find((n) => n.id === selectedNodeId) ?? null,
    [tree, selectedNodeId],
  );

  // "开始学习"→ hook + 无风险猜测,不是讲义+计分题。
  // 动机层:用户点进来时往往"提不起劲"(streak 断了 / 冷启动)。"讲概念+出题"是作业形状,
  // 在意志力最低的瞬间堆两次摩擦(吸收讲座 + 被评估)。改成 hook(好奇心缺口 = 内驱)+
  // 二选一猜测(玩,不是考试)——零失败风险,先把人勾进来,动量起来再讲、再测。
  // 实际的 sendMessage 定义在 toast 声明之后(下面),通过 ref 桥接避免 TDZ。
  const sendRef = useRef<((t: string) => Promise<void>) | null>(null);
  const handleStartLearning = useCallback(() => {
    if (!selectedNode) return;
    void sendRef.current?.(
      `我想开始学「${selectedNode.title}」。但我现在没什么劲——别直接讲概念,也别出计分题考我。请这样开场:\n` +
        `1. 先用一两句散文抛个钩子(反直觉的、或跟我日常有关的,让我产生好奇);\n` +
        `2. 然后调用 pose_guess 工具,给我一个二选一的小猜测(就是玩,不是考试);\n` +
        `3. 我会点选项猜,你【下一回合】再揭晓,顺带把这课最核心的一点讲清楚。\n` +
        `铁律:起手不要讲座、不要用 generate_quiz 出计分题、不要计分。把我勾住是唯一目标。`,
    );
  }, [selectedNode]);

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
      // Ctrl+B → 切换左栏显隐(布局切换)
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setLeftPaneVisible((v) => !v);
      }
      // Ctrl+Tab → 切换 thread(下一个)
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
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

  // 点 lesson:解锁下一课 + 设选中(联动三栏)
  const handleLessonClick = useCallback(async (node: ContentNode) => {
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
      // v0.5: 点节点 → selectedNodeId 变化 → useThreads(selectedCourseId, selectedNodeId) 自动 reload 该节点的 thread
    } catch (e) {
      setErrorFromThrow(e);
    }
  }, [progressMap, reloadCourseProgress, setErrorFromThrow]);

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

  // 统一的"发送一条消息"流程:首次发送自动建 thread,之后直接发。
  // ChatComposer 的 onSend 和 handleStartLearning 都走这条,避免重复逻辑和"忘了建 thread"的坑。
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || chat.streaming) return;
      if (!thread.activeId) {
        const newId = await thread.ensureThreadForSend(text);
        if (newId) {
          chat.send(text, newId);
          return;
        }
        toast.show(t("toast.threadCreateFailed"));
        return;
      }
      // 当前 thread 标题为空(如"+ 新建会话"建的空 thread)→ 用首条消息截断自动命名,
      // 与 ensureThreadForSend 的命名逻辑一致:标题=首条完整输入(不截断)。
      const cur = thread.activeThread;
      if (cur && !cur.title) {
        thread.update(cur.id, { title: text.trim() });
      }
      chat.send(text);
    },
    [chat, thread, toast, t],
  );
  // ref 桥接:让 handleStartLearning(定义在 toast 之前)能调用 sendMessage(定义在 toast 之后)
  sendRef.current = sendMessage;

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

  return (
    <div className="h-screen flex bg-surface-1 text-neutral-900 dark:text-neutral-100 overflow-hidden">
      {/* 左栏:MapRail 全高(顶到底),tab 切换地图/导入 */}
      {leftPaneVisible && (
        <MapRail
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
          }}
          onOpenReview={() => setShowReviewDrawer(true)}
          onSelectCourse={(id) => { setSelectedCourseId(id); refreshAll(); }}
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
      <div className="flex-1 flex flex-col min-h-0">
      <Header
        streak={streak}
        xp={xp}
        fontSize={font.size}
        onFontBump={font.bump}
        onOpenSettings={() => setShowSettings(true)}
        leftVisible={leftPaneVisible}
        rightVisible={rightPaneVisible}
        onToggleLeft={() => setLeftPaneVisible((v) => !v)}
        onToggleRight={() => setRightPaneVisible((v) => !v)}
      />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex-1 flex min-h-0">
        {/* 视图层:AI 对话 + 笔记本 */}
        <>
            {/* 中栏:AI 对话流(ChatStream + ChatComposer) / 考试节点(ExamView)。
                v0.6 分栏:无描边,色差划分。
                v0.7 宽度:弹性 min/max——clamp(480px, 40vw, 720px)。每个屏宽拿到能拿到的最佳:
                  1366 屏 → ~470px(下限 480 兜底,表格/代码不挤崩)
                  1920 屏 → ~680px(阅读黄金区,AI 长讲解舒服)
                  2560+  → 720px 上限(不浪费,对话不失紧凑)
                右栏隐藏时 flex:1 撑满。 */}
            <div
              className="flex flex-col h-full bg-surface-1 shrink-0"
              style={rightPaneVisible ? { width: "clamp(480px, 40vw, 720px)" } : { flex: 1 }}
              data-testid="chat-panel"
            >
              {selectedNode?.type === "exam" ? (
                /* 考试节点:渲染 ExamView 替代 chat(关底 boss,独立 UI) */
                <ExamView
                  examNode={selectedNode}
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
                starterPrompts={chat.messages.length > 0 ? starterPrompts : []}
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
              />
                </>
              )}
            </div>

            {/* 右栏:NotebookPanel 康奈尔笔记本(讲解/笔记)。布局切换可隐藏。
                v0.6 分栏:无描边,色差划分(底色由 NotebookPanel 内部 bg-surface-2 控制)。
                v0.7 宽度:flex-1 弹性吃中栏剩余,加 min-w 防内容(笔记卡/表格)被挤。 */}
            {rightPaneVisible && (
            <main className="flex-1 min-w-[440px] bg-surface-2">
              <NotebookPanel
                selectedNode={selectedNode}
                items={canvas.items}
                loading={canvas.loading}
                forceTab={forceArtifactTab}
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
              />
            </main>
            )}
        </>
      </div>
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
          onPickNode={(id) => {
            setSelectedNodeId(id);
            setForceArtifactTab("content");
            setShowReviewDrawer(false);
          }}
        />
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
}) {
  const t = useLang();
  return (
    <header className="app-header px-6 pt-2.5 pb-3 flex items-center justify-between shrink-0">
      {/* 左:仅项目名(v0.8 重排 —— 图标移除,所有控件归右) */}
      <h1 className="text-body font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100 select-none">
        Lookat<span className="text-brand">Study</span>
      </h1>

      {/* 右:控件按"视图 → 阅读 → 进度 → 配置"分组 */}
      <div className="flex items-center gap-3">
        {/* 视图:左右栏显隐 */}
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

        {/* 阅读:全局字号(A-/A+,三档,影响整个应用 rem 基准) */}
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


/* ---------- 复习抽屉(v0.3) ---------- */
function ReviewDrawer({
  onClose,
  tree,
  onPickNode,
  dashboard,
}: {
  onClose: () => void;
  tree: ContentNode[];
  onPickNode: (id: string) => void;
  dashboard: DashboardData | null;
}) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
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
        <div className="flex-1 overflow-y-auto">
          {/* P3.4/P4.5 章节掌握度热力图 + 薄弱点(消费此前被丢弃的 dashboard.sections + 新增 frictionByNode) */}
          {dashboard && (dashboard.sections.length > 0 || dashboard.frictionByNode.length > 0) && (
            <div className="p-4 border-b border-[var(--border)] space-y-3" data-testid="dashboard-mini">
              {dashboard.sections.length > 0 && (
                <div>
                  <div className="text-caption font-bold text-ink-muted uppercase tracking-wider mb-1.5">{t("dashboard.mini.sections")}</div>
                  {dashboard.sections.map((s) => (
                    <div key={s.sectionId} className="flex items-center gap-2 py-0.5">
                      <span className="text-label text-ink-strong truncate flex-1">{s.sectionTitle}</span>
                      <div className="w-20 h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round(s.avgMastery * 100)}%` }} />
                      </div>
                      <span className="text-label tabular-nums text-ink-muted w-9 text-right">{Math.round(s.avgMastery * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
              {dashboard.frictionByNode.length > 0 && (
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
            </div>
          )}
          <ReviewPanel tree={tree} onReviewNode={onPickNode} />
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
