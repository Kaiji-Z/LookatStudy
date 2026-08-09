import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Settings, Flame, Target, PanelLeft, PanelRight } from "lucide-react";
import { api } from "./lib/api.js";
import type {
  Course,
  ContentNode,
  Progress,
  Streak,
  Skill,
  DashboardData,
  StarterPrompt,
  NoteSourceAnchor,
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
import { translate } from "./lib/i18n.js";

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
const BUILTIN_SKILL_ORDER = [
  "socratic-mode",
  "exam-prep-mode",
  "project-mode",
  "review-mode",
];

/** 产物类型中文标签(toast 用) */
const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  concept_map: "概念图",
  quiz: "练习题",
  compare_table: "对比表",
  diagram: "流程图",
  code_walkthrough: "代码讲解",
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
  const [view, setView] = useState<MapView>("map");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dueCount, setDueCount] = useState(0);
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

  // "开始学习"→ 发学习方法请求,建立会话(空会话时点的大按钮)
  // 实际的 sendMessage 定义在 toast 声明之后(下面),通过 ref 桥接避免 TDZ。
  const sendRef = useRef<((t: string) => Promise<void>) | null>(null);
  const handleStartLearning = useCallback(() => {
    if (!selectedNode) return;
    void sendRef.current?.(
      `请给我学习「${selectedNode.title}」的方法建议:应该按什么顺序学、重点关注什么、怎么检验自己学会了。简短给出学习路径。`,
    );
  }, [selectedNode]);

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
      // v0.5: 点节点 → selectedNodeId 变化 → useThreads(selectedCourseId, selectedNodeId) 自动 reload 该节点的 thread
    } catch (e) {
      setErrorFromThrow(e);
    }
  }, [progressMap]);

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
        toast.show("会话创建失败,请重试");
        return;
      }
      // 当前 thread 标题为空(如"+ 新建会话"建的空 thread)→ 用首条消息截断自动命名,
      // 与 ensureThreadForSend 的命名逻辑一致,避免"同一节点第二个会话不重命名"的 bug。
      const cur = thread.activeThread;
      if (cur && !cur.title) {
        const autoTitle = text.trim().slice(0, 24) + (text.trim().length > 24 ? "…" : "");
        thread.update(cur.id, { title: autoTitle });
      }
      chat.send(text);
    },
    [chat, thread, toast],
  );
  // ref 桥接:让 handleStartLearning(定义在 toast 之前)能调用 sendMessage(定义在 toast 之后)
  sendRef.current = sendMessage;

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
      // 切到笔记标签让用户看到 + toast 反馈
      setForceArtifactTab("notes");
      toast.show(`已保存到笔记本 · ${ARTIFACT_TYPE_LABEL[output.artifactType] ?? "产物"}`, { duration: 3000 });
    }
  }, [artifacts, canvas, selectedNodeId, toast]);

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
          dueCount={dueCount}
          dueNodeIds={dueNodeIds}
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
        />
      )}

      {/* 右半区:顶栏 + 中右栏(顶栏只在中右栏上方,左栏全高独立) */}
      <div className="flex-1 flex flex-col min-h-0">
      <Header
        streak={streak}
        xp={xp}
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
                  toast.show("已新建会话");
                }}
                onRename={(id, title) => {
                  thread.update(id, { title });
                  toast.show("已重命名");
                }}
                onArchive={(id) => {
                  thread.update(id, { status: "archived" });
                  toast.show("已归档会话", {
                    duration: 5000,
                    action: { label: "撤销", onClick: () => thread.update(id, { status: "active" }) },
                  });
                }}
                onDelete={(id) => {
                  const removed = thread.removeWithUndo(id);
                  if (removed) {
                    toast.show(`已删除会话「${removed.title ?? "新会话"}」`, {
                      duration: 5000,
                      action: {
                        label: "撤销",
                        onClick: () => {
                          thread.restore(removed);
                          toast.show("已恢复");
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
                onStartLearning={handleStartLearning}
                hasNode={!!selectedNode}
                selectedNodeId={selectedNodeId}
                threadId={thread.activeId}
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
                  toast.show("已加到笔记 · 记录区", { duration: 2000 });
                }}
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
                onSend={sendMessage}
                onStop={chat.stop}
                onGotoSettings={() => setShowSettings(true)}
                fontSize={font.size}
                onFontBump={font.bump}
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
                  toast.show("已删除笔记");
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
                  toast.show("已加到笔记 · 记录区", { duration: 2000 });
                }}
                onJumpToSource={handleJumpToSource}
                onQuoteToChat={handleQuoteToChat}
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
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
}: {
  streak: Streak | null;
  xp: { todayXp: number; dailyGoal: number; achieved: boolean; pct: number } | null;
  onOpenSettings: () => void;
  leftVisible: boolean;
  rightVisible: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  return (
    <header className="app-header px-6 pt-2.5 pb-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2.5">
        {/* 布局切换按钮(Cursor 风格) */}
        <div className="flex items-center gap-0.5 mr-1">
          <button
            onClick={onToggleLeft}
            data-testid="layout-toggle-left"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              leftVisible ? "text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800" : "text-neutral-600 bg-neutral-200 dark:bg-neutral-800"
            }`}
            title="切换左栏 (Ctrl+B)"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleRight}
            data-testid="layout-toggle-right"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              rightVisible ? "text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800" : "text-neutral-600 bg-neutral-200 dark:bg-neutral-800"
            }`}
            title="切换右栏"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
        <div
          className="w-7 h-7 rounded-xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-white font-extrabold text-xs shadow-md"
          style={{ boxShadow: "0 2px 8px rgba(88, 204, 2, 0.3)" }}
        >
          L
        </div>
        <h1 className="text-sm font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100">
          Lookat<span className="text-brand">Study</span>
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {xp && (
          <div className="flex items-center gap-1.5" data-testid="xp-bar">
            <Target className="w-3.5 h-3.5 text-neutral-400" />
            <div className="w-20 h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${xp.achieved ? "bg-gold" : "bg-brand"}`}
                style={{ width: `${Math.max(3, xp.pct)}%` }}
              />
            </div>
            <span className={`text-xs font-bold tabular-nums ${xp.achieved ? "text-gold" : "text-neutral-500 dark:text-neutral-400"}`}>
              {xp.todayXp}/{xp.dailyGoal}
            </span>
          </div>
        )}
        <button
          onClick={onOpenSettings}
          data-testid="header-settings"
          className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50 transition-colors"
          title="设置 (Ctrl+S)"
        >
          <Settings className="w-4 h-4" />
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
      <div className="relative w-full max-w-md h-full bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-elevated flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <h2 className="text-sm font-bold">{translate("settings.title")}</h2>
          <button
            onClick={onClose}
            data-testid="settings-close"
            className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50"
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
}: {
  onClose: () => void;
  tree: ContentNode[];
  onPickNode: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="review-drawer">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-elevated flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <h2 className="text-sm font-bold">📖 复习</h2>
          <button
            onClick={onClose}
            data-testid="review-close"
            className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800/50"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ReviewPanel tree={tree} onReviewNode={onPickNode} />
        </div>
      </div>
    </div>
  );
}


/* ---------- 杂项 ---------- */

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="px-4 py-2 border-b border-warning-tint-border text-warning text-sm flex items-center justify-between" style={{ backgroundColor: "var(--warning-tint)" }}>
      <span>⚠️ {message}</span>
      <button className="ml-3 underline text-warning-light" onClick={onClose}>关闭</button>
    </div>
  );
}

function StreakBadge({ streak }: { streak: Streak }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-review/20"
      style={{ backgroundColor: "var(--review-tint)" }}
      data-testid="streak-badge"
      title={`连续学习 ${streak.currentStreak} 天 · 最长 ${streak.longestStreak} 天`}
    >
      <Flame className="w-4 h-4 text-review" />
      <span className="text-sm font-extrabold text-review">{streak.currentStreak}</span>
    </div>
  );
}

function setErrorFromThrow(e: unknown) {
  console.error(e);
}
