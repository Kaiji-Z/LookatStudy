/**
 * NotebookPanel —— v0.3 康奈尔式学习笔记本。
 *
 * 两标签:
 *   - 讲解(默认):当前节点 markdown 内容,选区可"提问这段"或"加到笔记"
 *   - 笔记:康奈尔笔记法三区
 *     · 🗺️ 理解区(线索区):AI 产物(概念图/对比表/流程图/代码讲解)—— 知识结构
 *     · ✏️ 记录区(笔记区):用户画线笔记(user_note,带溯源跳转)—— 个人内化
 *     · 📝 练习区(总结区):quiz 产物,可重做,显示上次答对/答错 —— 检验
 *
 * 砍掉了"全部"tab —— 笔记跟随节点,跨节点靠左侧地图切换。
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode, type ComponentType, Suspense, lazy } from "react";
import type { ContentNode, CanvasItem, NoteSourceAnchor, NodeAsset } from "@shared/types";
import ReactMarkdown from "react-markdown";
import { useMarkdownPipeline } from "../lib/math-plugins.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { api } from "../lib/api.js";
import { applyPersistentMarksByText, flashMark, getTextModel, rangeToOffsets, markReadingSentence, clearReadingMark, resetReadingCursor, setLastNoteMark, centerReadingRangeInView } from "../lib/highlightText.js";
import { normalizeMathNotation } from "../lib/math-normalize.js";
import { playedSentencePrefix } from "@shared/speech-text";
import { selectionPopoverPosition } from "../lib/selection-popover.js";
import { Pin, Trash, ChevronDown, Pencil, Check, X, BookOpen, NotebookPen, MessageCircle, Image as ImageIcon, Lightbulb, Share2, ListChecks, Table2, GitBranch, Code2, Puzzle, Quote , Presentation, Volume2, Square, Brain } from "lucide-react";
import { useLang } from "../lib/i18n.js";
import { useSpeech } from "../lib/useSpeech.js";
import { useToast } from "./Toast.js";
import { CodeBlock } from "./CodeBlock.js";
import { companionNote } from "../lib/companion/bus.ts";

// 脑图视图按需加载(入口包瘦身):仅点 Brain 按钮时才拉 chunk(markmap 库本就动态导入)
const MindmapView = lazy(() => import("./MindmapView.js").then((m) => ({ default: m.MindmapView })));
// 产物渲染器/画布舞台/复习自评卡同批按需加载:黑板 tab、产物卡、复习模式打开时才拉 chunk
const ArtifactRenderer = lazy(() => import("./artifacts/index.js").then((m) => ({ default: m.ArtifactRenderer })));
const CanvasStage = lazy(() => import("./CanvasStage.js").then((m) => ({ default: m.CanvasStage })));
const SelfRatingCard = lazy(() => import("./ReviewPanel.js").then((m) => ({ default: m.SelfRatingCard })));

export type NotebookTab = "content" | "notes" | "board";

/** Translate function shape returned by useLang(). */
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/** AI 产物类型 → lucide 图标(组件, 非 emoji)。CanvasItemCard 卡顶用。 */
const ARTIFACT_ICON: Record<string, ComponentType<{ className?: string }>> = {
  concept_map: Share2,
  quiz: ListChecks,
  compare_table: Table2,
  diagram: GitBranch,
  code_walkthrough: Code2,
};

/** 已知 AI 产物类型白名单(用于在 i18n 字典里命中 artifact.type.{type})。 */
const KNOWN_ARTIFACT_TYPES = new Set([
  "concept_map",
  "quiz",
  "compare_table",
  "diagram",
  "code_walkthrough",
]);

/** 产物类型显示名(走 i18n, 复用 artifact.type.* key;未知类型回退到 artifact.type.unknown)。 */
function artifactLabel(t: TranslateFn, type: string): string {
  return KNOWN_ARTIFACT_TYPES.has(type) ? t(`artifact.type.${type}`) : t("artifact.type.unknown");
}

interface NotebookPanelProps {
  selectedNode: ContentNode | null;
  items: CanvasItem[];
  loading: boolean;
  forceTab?: NotebookTab | null;
  /** 黑板(canvas):当前对话里最新一件重产物(概念图/流程图/对比表/代码讲解),
   *  大画布实时渲染;App 在流式中出现新重产物时 forceTab 切到 board。 */
  canvasArtifact?: { id: string; toolName: string; output: unknown } | null;
  /** 用户从复习抽屉选了课 → 讲解底部显示自评卡 */
  isReviewing?: boolean;
  /** 自评完成或退出复习模式 */
  onReviewDone?: () => void;
  onUserTabChange: () => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** quiz 重做后更新 last_result */
  onRecordQuizResult: (id: string, correct: boolean) => void;
  /** 用户从讲解区画线加笔记 */
  onSaveContentNote: (text: string, anchor: NoteSourceAnchor) => void;
  /** 更新 user_note 的用户注释(空串=删除) */
  onUpdateNoteComment?: (id: string, comment: string) => void;
  /** 笔记卡溯源跳转:点击 → 切到讲解/对话定位高亮。noteText 用于消息内文字级定位,noteId 用于画线定位 */
  onJumpToSource?: (anchor: NoteSourceAnchor, noteText?: string, noteId?: string) => void;
  /** 选中文字后"提问这段"→ 插入聊天框(哪里不会点哪里) */
  onQuoteToChat?: (text: string) => void;
  /** 当前显示语言（null = 原文） */
  locale?: string | null;
}

export function NotebookPanel({
  selectedNode,
  items,
  loading,
  forceTab,
  canvasArtifact,
  isReviewing,
  onReviewDone,
  onUserTabChange,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onSaveContentNote,
  onUpdateNoteComment,
  onJumpToSource,
  onQuoteToChat,
  locale,
}: NotebookPanelProps) {
  const t = useLang();
  const [internalTab, setInternalTab] = useState<NotebookTab>("content");
  const tab = forceTab ?? internalTab;

  const handleTabClick = (t: NotebookTab) => {
    setInternalTab(t);
    onUserTabChange?.();
  };

  // 当前节点的笔记数(用于 tab badge)
  const nodeItems = selectedNode
    ? items.filter((i) => i.nodeId === selectedNode.id)
    : [];

  // 讲解区滚动容器:切节点时回到顶部(key={tab} 只管 tab 切换的 remount,
  // 同 tab 切节点不会 remount → 滚动位置残留,用户会看到上一个节点滚到底的位置)。
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selectedNode?.id]);

  return (
    <div
      className="relative h-full flex flex-col bg-surface-2"
      data-testid="notebook-panel"
    >
      {/* 标签栏:与左栏 MapRail tab 同一语言(等分胶囊容器 + brand/20 高亮 +
          中性非当前 + lucide 图标)。容器底色用稳定深色(surface-3/60)替代
          左栏的毛玻璃——右栏底色不是动态天空,不需要 blur,但语法形态对齐。 */}
      <div className="px-3 pt-3 pb-1 shrink-0" data-testid="notebook-tabs">
        <div className="flex p-1 rounded-lg gap-1 bg-ink/[0.08]" role="tablist" aria-label="Notebook">
          <TabBtn
            label={t("notebook.tab.explain")}
            icon={BookOpen}
            active={tab === "content"}
            onClick={() => handleTabClick("content")}
            testid="tab-content"
          />
          <TabBtn
            label={t("notebook.tab.notes")}
            icon={NotebookPen}
            active={tab === "notes"}
            onClick={() => handleTabClick("notes")}
            testid="tab-notes"
            badge={nodeItems.length > 0 ? String(nodeItems.length) : undefined}
          />
          <TabBtn
            label={t("notebook.tab.board")}
            icon={Presentation}
            active={tab === "board"}
            onClick={() => handleTabClick("board")}
            testid="tab-board"
          />
        </div>
      </div>

      {/* 内容区:tab 切换时内容滑入(PROPERTY.md motion: 状态传达,150-250ms) */}
      <div className="flex-1 overflow-y-auto min-h-0 animate-tab-slide" key={tab} ref={scrollRef} role="tabpanel">
        {tab === "board" ? (
          /* 黑板:全宽画布(CanvasStage)—— 大幅产物自适应容器宽高(contain 适屏),
             与笔记区的内联卡片区分;点阵底纹 + 底部缩放工具条;只显示最新一件。 */
          <div className="h-full flex flex-col" data-testid="board-tab-content">
            {canvasArtifact ? (
              <>
                <div className="px-4 pt-3 pb-2 shrink-0 flex items-center gap-2 min-w-0">
                  <Presentation className="w-4 h-4 text-ink-muted shrink-0" />
                  <span className="text-label font-bold text-ink truncate">
                    {(canvasArtifact.output as { title?: string })?.title ?? canvasArtifact.toolName}
                  </span>
                </div>
                <div className="flex-1 min-h-0 px-2 pb-2">
                  <div className="h-full rounded-xl overflow-hidden bg-surface-0/60 border border-[var(--border-faint)]">
                    <Suspense fallback={null}>
                      <CanvasStage testid="board-canvas-stage">
                        <ArtifactRenderer data={canvasArtifact.output} variant="canvas" />
                      </CanvasStage>
                    </Suspense>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <Presentation className="w-10 h-10 mb-3 text-ink-muted opacity-30" />
                <div className="text-body text-ink-muted max-w-sm leading-relaxed">
                  {t("notebook.board.empty")}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* v0.11:内容居中封顶 960 —— 宽屏/单栏档笔记本不空旷,栏宽仍弹性。
                flex-col 让空态可用 flex-1 垂直居中(min-h-full 父级下 h-full 百分比
                会塌缩,空态曾贴顶;黑板分支不受影响,它有自己的 h-full 结构)。 */}
            <div className="mx-auto w-full max-w-[960px] min-h-full flex flex-col">
              {tab === "content" ? (
                <ContentTab
                  selectedNode={selectedNode}
                  contentNotes={nodeItems.filter(
                    (i) => i.artifactType === "user_note" && i.sourceAnchor,
                  )}
                  onQuoteToChat={onQuoteToChat}
                  onSaveContentNote={onSaveContentNote}
                  locale={locale}
                  isReviewing={isReviewing}
                  onReviewDone={onReviewDone}
                />
              ) : (
                <NotesTab
                  items={nodeItems}
                  loading={loading}
                  selectedNode={selectedNode}
                  onRemove={onRemove}
                  onTogglePin={onTogglePin}
                  onRecordQuizResult={onRecordQuizResult}
                  onUpdateNoteComment={onUpdateNoteComment}
                  onJumpToSource={onJumpToSource}
                />
              )}
            </div>
          </>
        )}
      </div>
      {/* v3 伴学单生物:右栏助教形态由根层 CompanionCreature 负责(朗读口型+记笔记),
          不再在栏内分身。 */}
    </div>
  );
}

/* ---------- 讲解标签 ---------- */
function ContentTab({
  selectedNode,
  contentNotes,
  onQuoteToChat,
  onSaveContentNote,
  locale,
  isReviewing,
  onReviewDone,
}: {
  selectedNode: ContentNode | null;
  /** 该节点的 user_note(用于持久画线渲染) */
  contentNotes: CanvasItem[];
  onQuoteToChat?: (text: string) => void;
  onSaveContentNote: (text: string, anchor: NoteSourceAnchor) => void;
  locale?: string | null;
  /** 从复习抽屉进入 → 底部显示自评卡 */
  isReviewing?: boolean;
  onReviewDone?: () => void;
}) {
  const t = useLang();
  const toast = useToast();
  // 整课朗读(v0.13):讲给耳朵听;切节点自动停(messageId 绑节点)
  const speech = useSpeech();
  useEffect(() => {
    if (speech.failReason) {
      const key =
        speech.failReason === "engine-unavailable"
          ? "chat.speech.engine_unavailable"
          : speech.failReason === "azure-key-missing"
            ? "chat.speech.azure_key_missing"
            : speech.failReason === "azure-region-missing"
              ? "chat.speech.azure_region_missing"
              : speech.failReason === "edge-failed"
                ? "chat.speech.edge_failed"
                : "chat.speech.model_missing";
      toast.show(t(key), { severity: "warning" });
      speech.clearFailReason();
    } else if (speech.onlineNotice) {
      toast.show(t("chat.speech.edge_disclosed"), { severity: "info" });
      speech.clearOnlineNotice();
    }
  }, [speech.failReason, speech.onlineNotice, toast, t, speech]);
  // 切节点/卸载:停当前课朗读(messageId 绑节点,不主动停会读串课)
  const speechStopRef = useRef(speech.stop);
  speechStopRef.current = speech.stop;
  const nodeSpeechId = selectedNode ? `content-${selectedNode.id}` : null;
  useEffect(() => {
    return () => {
      speechStopRef.current();
    };
  }, [nodeSpeechId]);
  // 伴学 talking 信号(v3)下沉到 useSpeech 引擎层(见 useSpeech.ts):
  // 谁的 speakingMessageId 谁发事件,不再按节点 id 对比(旧法在某些实例
  // 状态下静默失效——朗读在放,信号没发)。
  const [content, setContent] = useState<string | null>(null);
  // 数学插件集按需加载:含公式课文才拉 katex(入口包瘦身,见 lib/math-plugins.ts)
  const mdPipeline = useMarkdownPipeline(content ?? "");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 思维导图视图(v0.21):Brain 按钮切换 讲解 markdown ↔ markmap 脑图
  const [mindmap, setMindmap] = useState(false);
  // 多模态:当前节点的图片资源(集中插图区展示)
  const [assets, setAssets] = useState<NodeAsset[]>([]);
  // 选区浮按钮:选中文字后显示。带 offsets(Range-based 偏移,精准)和 surroundingText(legacy 回退)
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; transform?: string; text: string; surrounding: string; offsets?: { start: number; end: number } } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null); // 整个讲解容器(标题+正文+提示)
  const proseRef = useRef<HTMLDivElement>(null); // 仅 Markdown 正文(offset 计算和画线基于此,避免标题/提示污染偏移)
  /* 粗指针(手机)上浮钮按 44px 命中底线放大 → 定位的宽度估算同步放大 */
  const coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    if (!selectedNode) {
      setContent(null);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.getNodeContent(selectedNode.id, locale ?? undefined)
      .then((c) => { if (!cancelled) setContent(c); })
      .catch(() => { if (!cancelled) { setContent(null); setLoadError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNode?.id, locale]);

  // 多模态:加载当前节点的图片资源
  useEffect(() => {
    if (!selectedNode) {
      setAssets([]);
      return;
    }
    let cancelled = false;
    api.listAssetsByNode(selectedNode.id)
      .then((a) => { if (!cancelled) setAssets(a); })
      .catch(() => { if (!cancelled) setAssets([]); });
    return () => { cancelled = true; };
  }, [selectedNode?.id]);

  // 持久画线:content + contentNotes 都就绪后,按偏移在讲解区画 <mark>(像书上画线)
  // 用 setTimeout 等 ReactMarkdown 渲染完 DOM 再画
  useEffect(() => {
    if (!content || !contentRef.current) return;
    // v0.3.3:改用文本搜索方案(不依赖 DOM offset 稳定性)
    const notes: { noteId: string; text: string; surrounding?: string }[] = [];
    for (const item of contentNotes) {
      try {
        const anchor = JSON.parse(item.sourceAnchor!) as NoteSourceAnchor;
        if (anchor.type === "content") {
          const text = (JSON.parse(item.data) as { text?: string }).text ?? "";
          if (text) notes.push({ noteId: item.id, text, surrounding: anchor.surroundingText });
        }
      } catch {
        /* 跳过坏 anchor */
      }
    }
    const t = setTimeout(() => {
      if (proseRef.current) {
        applyPersistentMarksByText(proseRef.current, notes);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [content, contentNotes]);

  // 监听溯源跳转事件:按 noteId 找到对应画线 mark,scrollIntoView + 闪烁
  useEffect(() => {
    const handler = (e: Event) => {
      const noteId = (e as CustomEvent<string>).detail;
      if (!noteId) return;
      const mark = proseRef.current?.querySelector(`mark[data-note-id="${noteId}"]`) as HTMLElement | null;
      if (mark) flashMark(mark);
    };
    window.addEventListener("lookatstudy-jump-to-note", handler);
    return () => window.removeEventListener("lookatstudy-jump-to-note", handler);
  }, []);

  // v11.4 朗读句级跟随(karaoke):高亮文本 = 合成侧 ttsAudio.sentence 权威下发的
  // **已播前缀**(playedSentencePrefix 拼块)——念什么高亮什么,渲染层不再从
  // content 复算句表,两侧句表分叉(净化差异/翻译切换/切段参数漂移)从构造上消灭。
  const readingIdx =
    speech.speakingMessageId === nodeSpeechId && speech.playingSentence != null
      ? speech.playingSentence.index
      : null;
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;
    if (readingIdx == null) {
      clearReadingMark(prose);
      return;
    }
    // 已播句组前缀:强断句块(超长行被撕开的)并回同一视觉句,只亮到当前进度
    const sentence = playedSentencePrefix(speech.streamTexts, readingIdx);
    if (!sentence) return;
    if (readingIdx === 0) resetReadingCursor(prose); // 新一轮朗读从第 0 句起,游标归零
    // 等 ReactMarkdown 渲染完(content 刚到/语言切换重挂)再定位
    const timer = setTimeout(() => {
      const rg = markReadingSentence(prose, sentence);
      if (!rg) return;
      // 视野外才滚动(避免逐句连续跳);按句子行盒居中(v0.18.1:网页存档课单段
      // 可达 13k 字符/3000px 高,整段 scrollIntoView 只会顶到段首钉死不动)
      centerReadingRangeInView(rg, prose.closest(".overflow-y-auto"));
    }, 30);
    return () => clearTimeout(timer);
  }, [readingIdx, speech.streamTexts, nodeSpeechId]);
  // 停止/切节点/卸载:清掉朗读高亮
  useEffect(() => {
    if (readingIdx == null && proseRef.current) clearReadingMark(proseRef.current);
  }, [readingIdx]);
  // v0.18 卸载清高亮(修"朗读中切课/切栏 → 伴学永久隐身"):旧写法
  // `if (proseRef.current) clearReadingMark(...)` 在卸载时自废——React 先把 ref
  // 置空再跑 passive cleanup,条件永假,全局 readingRange 残留 detached Range。
  // 改记"本面板是否正被朗读"的渲染期快照;不在朗读时卸载不清(别误伤对话流的
  // 在读高亮)。
  const wasReadingRef = useRef(false);
  wasReadingRef.current = readingIdx != null;
  useEffect(
    () => () => {
      if (wasReadingRef.current) clearReadingMark(document.body);
    },
    [],
  );

  // 选区评估:检查选区有效性并给浮钮落位(pointerup 即时/选区稳定 250ms 两条路进来)
  const evaluateSelection = useCallback(() => {
    if (!onQuoteToChat && !onSaveContentNote) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text.length < 2 || text.length > 500) {
      setQuoteBtn(null);
      return;
    }
    // 选区必须在 content 区域内
    const range = sel?.getRangeAt(0);
    if (!range || !contentRef.current?.contains(range.commonAncestorContainer)) {
      setQuoteBtn(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const containerRect = contentRef.current.getBoundingClientRect();
    // 用 Range-based 偏移(精准,不依赖 indexOf 文本匹配)。
    // 选区必须在 prose 正文容器内(避免选到标题/提示的偏移污染)
    const proseEl = proseRef.current;
    let offsets: { start: number; end: number } | null = null;
    if (proseEl && proseEl.contains(range.commonAncestorContainer)) {
      const model = getTextModel(proseEl);
      offsets = rangeToOffsets(range, model);
    }
    // surroundingText 作为 legacy 回退(旧笔记搜索用),用 model.text 取(已过滤空白)
    const modelText = proseEl ? getTextModel(proseEl).text : text;
    const startIdx = offsets ? offsets.start : modelText.indexOf(text);
    const surrounding = startIdx >= 0 ? modelText.slice(Math.max(0, startIdx - 30), startIdx + text.length + 30) : text;
    // 浮钮定位:fine=右侧优先(末行行盒锚最后一个字);coarse=选区下方
    // (避开拖选手柄与上方原生菜单,见 selection-popover.ts 注释)
    const rects = range.getClientRects();
    const endRect = rects.length ? rects[rects.length - 1] : rect;
    const pos = selectionPopoverPosition(
      {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top,
        width: rect.width,
        height: rect.height,
      },
      containerRect.width,
      onQuoteToChat ? (coarsePointer ? 190 : 150) : coarsePointer ? 140 : 100,
      {
        left: endRect.left - containerRect.left,
        top: endRect.top - containerRect.top,
        right: endRect.right - containerRect.left,
        bottom: endRect.bottom - containerRect.top,
        width: endRect.width,
        height: endRect.height,
      },
      coarsePointer,
    );
    setQuoteBtn({
      x: pos.left,
      y: pos.top,
      transform: pos.transform,
      text,
      surrounding,
      offsets: offsets ?? undefined,
    });
  }, [onQuoteToChat, onSaveContentNote, coarsePointer]);

  /* 浮钮显示时机(2026-08-22 用户拍板:松开才显示,拖选途中一律隐藏——
     途中跟随会挡拖选路线,手机上还跟原生选择菜单抢位):
     - selectionchange 有文字 = 变化流(桌面拖选/手机拖手柄进行中)→ 立即隐藏,
       稳定且无按住的手势才落位;手机拖手柄松开没有页面事件可听,只能靠稳定
       窗口判定,故 coarse 放宽到 600ms(拖柄途中的短暂停顿不弹);
     - pointerup(鼠标松开/抬指)→ 立即评估落位(桌面拖选松手零等待);
     - 选区清空延迟 250ms 收按钮 —— 触屏点按钮的 tap 会先清选区再派发 click,立即隐藏会吃掉点击。 */
  useEffect(() => {
    const SETTLE = coarsePointer ? 600 : 250;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let gesture = false; // 指针按住中(拖选手势):稳定计时到点也不放行,松手的 pointerup 负责落位
    const selectionHasText = () => (window.getSelection()?.toString().trim().length ?? 0) >= 2;
    const onChange = () => {
      if (selectionHasText()) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        setQuoteBtn((cur) => (cur ? null : cur)); // 变化流中一律隐藏
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!gesture && selectionHasText()) evaluateSelection();
        }, SETTLE);
      } else if (!hideTimer) {
        hideTimer = setTimeout(() => setQuoteBtn((cur) => (cur ? null : cur)), 250);
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.("[data-selection-popover]")) return; // 按下点在浮钮自身=要点击,不算拖选
      gesture = true;
    };
    const onUp = () => {
      gesture = false;
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (!hideTimer && selectionHasText()) evaluateSelection(); // 松开立即落位
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      if (settleTimer) clearTimeout(settleTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [evaluateSelection]);

  const handleQuoteClick = useCallback(() => {
    if (!quoteBtn || !onQuoteToChat) return;
    const truncated = quoteBtn.text.length > 200 ? quoteBtn.text.slice(0, 200) + "…" : quoteBtn.text;
    onQuoteToChat(t("notebook.quote.template", { text: truncated }));
    setQuoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [quoteBtn, onQuoteToChat, t]);

  const handleSaveNoteClick = useCallback(() => {
    if (!quoteBtn || !onSaveContentNote || !selectedNode) return;
    // 截断到 200 字(画线太长意义不大)
    const text = quoteBtn.text.length > 200 ? quoteBtn.text.slice(0, 200) + "…" : quoteBtn.text;
    // 用 mouseUp 时用 Range 算好的 offsets(精准,不依赖 indexOf)
    onSaveContentNote(text, {
      type: "content",
      surroundingText: quoteBtn.surrounding,
      startOffset: quoteBtn.offsets?.start,
      endOffset: quoteBtn.offsets?.end,
    });
    // v3 伴学:用户划线记笔记 → 生物飞来右栏做记笔记动作;
    // v10:落点=这条新画线(apply 80ms 防抖后 mark 才上 DOM,稍等再登记)
    companionNote();
    setTimeout(() => {
      const marks = proseRef.current?.querySelectorAll("mark.lookatstudy-underline");
      const last = marks && marks.length > 0 ? (marks[marks.length - 1] as HTMLElement) : null;
      if (last) setLastNoteMark(last);
    }, 200);
    setQuoteBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [quoteBtn, onSaveContentNote, selectedNode]);

  if (!selectedNode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="text-4xl mb-3 opacity-30">📖</div>
        <div className="text-body text-ink-muted max-w-xs">
          {t("notebook.empty.select_node")}
        </div>
      </div>
    );
  }
  return (
    <div className="p-5 relative" data-testid="node-content" ref={contentRef}>
      {/* 整课朗读(v6):sticky 悬浮在讲解视口右上角,不随正文滚动 ——
          用户翻到后面也能一键停。吸顶行 pointer-events-none,只有按钮本身可点,
          不挡吸顶行底下的正文选区/点击。 */}
      {!loading && !loadError && content && (
        <div className="sticky top-0 z-20 flex justify-end gap-2 -mt-2 pointer-events-none">
          <button
            onClick={() => setMindmap((v) => !v)}
            data-tooltip={t("notebook.mindmap.toggle")}
            aria-label={t("notebook.mindmap.toggle")}
            aria-pressed={mindmap}
            data-testid="node-content-mindmap"
            className={`pointer-events-auto shrink-0 rounded-full p-2 bg-surface-2 shadow-elevated transition-colors ${
              mindmap ? "text-accent" : "text-ink-muted hover:text-ink-strong"
            }`}
          >
            <Brain className="w-4 h-4" />
          </button>
          <button
            onClick={() => speech.speak(nodeSpeechId ?? "content", content)}
            data-tooltip={
              speech.speakingMessageId === nodeSpeechId
                ? t("chat.speech.stop")
                : t("chat.speech.read_aloud_node")
            }
            aria-label={
              speech.speakingMessageId === nodeSpeechId
                ? t("chat.speech.stop")
                : t("chat.speech.read_aloud_node")
            }
            data-testid={speech.speakingMessageId === nodeSpeechId ? "node-content-speak-active" : "node-content-speak"}
            className={`pointer-events-auto shrink-0 rounded-full p-2 bg-surface-2 shadow-elevated transition-colors ${
              speech.speakingMessageId === nodeSpeechId
                ? "text-brand animate-pulse"
                : "text-ink-muted hover:text-ink-strong"
            }`}
          >
            {speech.speakingMessageId === nodeSpeechId ? (
              <Square className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>
      )}
      <div className="text-caption font-bold text-brand uppercase tracking-wider mb-1">
        {selectedNode.type === "section"
          ? t("notebook.node_type.section")
          : selectedNode.type === "concept"
            ? t("notebook.node_type.concept")
            : t("notebook.node_type.lesson")}
      </div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-title font-extrabold text-ink-strong tracking-tight" data-testid="node-content-title">
          {selectedNode.title}
        </h2>
      </div>
      {loading ? (
        <div className="text-body text-ink-muted flex items-center gap-2"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />{t("notebook.content.loading")}</div>
      ) : loadError ? (
        <div className="text-body text-warning">
          {t("notebook.content.load_failed")}<button className="underline ml-1" onClick={() => { setLoadError(false); setLoading(true); api.getNodeContent(selectedNode.id, locale ?? undefined).then(setContent).catch(() => setLoadError(true)).finally(() => setLoading(false)); }}>{t("notebook.content.retry")}</button>
        </div>
      ) : content ? (
        mindmap ? (
          <Suspense fallback={null}>
            <MindmapView markdown={content} />
          </Suspense>
        ) : (
        <ErrorBoundary
          key={`${selectedNode.id}-${locale ?? "orig"}`}
          fallback={(_err, retry) => (
            <div className="prose prose-sm max-w-[80ch] leading-relaxed [&_pre]:max-w-full [&_pre]:overflow-x-auto">
              <div className="text-body text-warning mb-2">
                {t("notebook.content.render_failed")}
              </div>
              <pre className="text-caption text-ink-muted whitespace-pre-wrap break-words bg-surface-1 p-3 rounded">
                {content.slice(0, 500)}
                {content.length > 500 ? "\n" + t("notebook.content.truncated") : ""}
              </pre>
              <div className="flex gap-2 mt-2">
                <button className="text-caption underline text-accent" onClick={retry}>
                  {t("notebook.content.retry_render")}
                </button>
              </div>
            </div>
          )}
        >
        <div ref={proseRef} className="prose prose-sm max-w-[80ch] leading-relaxed break-words overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_img]:max-w-full [&_video]:max-w-full [&_iframe]:max-w-full select-text">
          <ReactMarkdown
            remarkPlugins={mdPipeline.remarkPlugins}
            rehypePlugins={mdPipeline.rehypePlugins}
            urlTransform={(url) => url}
            components={{
              // 代码块(shiki 高亮)——与对话流同一共享组件(v0.21)
              pre({ children, ...props }) {
                return <CodeBlock {...props}>{children}</CodeBlock>;
              },
              // 外链强制新窗口 → setWindowOpenHandler → 系统浏览器,
              // 防止点击讲解里的链接把 electron 主窗口导航成网页。
              a({ children, ...props }) {
                return (
                  <a {...props} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
              // 多模态:内嵌图片渲染。相对路径(src 不含 http)→ 从 assets 找匹配的图加载 data-url。
              // 匹配不到则保持原 src(可能是外部 URL,浏览器直接加载)。
              img({ src, alt, ...props }) {
                return <InlineAssetImage src={src} alt={alt} assets={assets} {...props} />;
              },
              // 宽表格(如课程大纲多列表)包进 overflow 容器,横向滚动不撑爆讲解区
              table({ children }) {
                return <div className="overflow-x-auto my-4"><table>{children}</table></div>;
              },
            }}
          >
            {normalizeMathNotation(content)}
          </ReactMarkdown>
        </div>
        </ErrorBoundary>
        )
      ) : (
        <div className="text-body text-ink-muted">
          {t("notebook.content.empty")}
        </div>
      )}
      {/* 多模态:集中插图区(当前节点的全部图片缩略图网格) */}
      {assets.length > 0 && (
        <div className="mt-6 pt-4 border-t border-[var(--border-faint)]">
          <div className="text-label font-bold text-ink-muted mb-2 flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{t("notebook.images.heading", { n: assets.length })}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {assets.map((asset) => (
              <AssetThumb key={asset.id} asset={asset} />
            ))}
          </div>
        </div>
      )}
      {/* 选区浮按钮:提问 + 加到笔记;固定单行(white-space nowrap 见 index.css),松手才显示 */}
      {quoteBtn && (
        <div
          data-selection-popover
          style={{ left: quoteBtn.x, top: quoteBtn.y, transform: quoteBtn.transform }}
          className="absolute z-20 flex items-center gap-0.5 msg-enter whitespace-nowrap"
        >
          {onQuoteToChat && (
            <button
              onClick={handleQuoteClick}
              data-testid="quote-to-chat-btn"
              aria-label={t("notebook.quote.ask")}
              className="px-2 py-1.5 rounded-lg bg-brand text-white text-label font-bold shadow-elevated flex items-center gap-1 hover:bg-brand-light transition-colors"
            >
              <MessageCircle className="w-3 h-3" />
              {t("notebook.quote.ask")}
            </button>
          )}
          <button
            onClick={handleSaveNoteClick}
            data-testid="save-note-btn"
            aria-label={t("notebook.quote.add_note")}
            className="px-2 py-1.5 rounded-lg bg-accent text-white text-label font-bold shadow-elevated flex items-center gap-1 hover:brightness-110 transition"
            title={t("notebook.quote.save_note.title")}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t("notebook.quote.add_note")}
          </button>
        </div>
      )}
      {selectedNode.sourcePath && (
        <div className="mt-6 pt-3 border-t border-[var(--border-faint)] text-label text-ink-muted">
          {t("notebook.source.label", { path: selectedNode.sourcePath })}
        </div>
      )}
      {/* 笔记提示 */}
      <div className="mt-4 p-3 rounded-lg bg-accent/5 border border-accent/20 text-body text-ink-muted flex items-start gap-1.5">
        <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent" />
        <span>{t("notebook.quote.hint")}</span>
      </div>
      {/* 复习自评卡:仅从复习抽屉选课时显示。自评完 → SRS 重排 + BKT 更新 + 退出复习模式 */}
      {isReviewing && selectedNode && (
        <Suspense fallback={null}>
          <SelfRatingCard nodeId={selectedNode.id} onRated={onReviewDone} />
        </Suspense>
      )}
    </div>
  );
}

/* ---------- 笔记标签(康奈尔笔记法三区) ---------- */
function NotesTab({
  items,
  loading,
  selectedNode,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onUpdateNoteComment,
  onJumpToSource,
}: {
  items: CanvasItem[];
  loading: boolean;
  selectedNode: ContentNode | null;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRecordQuizResult: (id: string, correct: boolean) => void;
  onUpdateNoteComment?: (id: string, comment: string) => void;
  onJumpToSource?: (anchor: NoteSourceAnchor) => void;
}) {
  const t = useLang();
  if (!selectedNode) {
    return <EmptyNotebook message={t("notebook.empty.notes.title")} icon="📓" />;
  }
  if (loading) {
    return <div className="flex-1 flex items-center justify-center gap-2 text-body text-ink-muted"><span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />{t("notebook.empty.notes.title")}</div>;
  }

  // 三区筛选
  const understandItems = items.filter((i) =>
    ["concept_map", "compare_table", "diagram", "code_walkthrough"].includes(i.artifactType),
  );
  const noteItems = items.filter((i) => i.artifactType === "user_note");
  const practiceItems = items.filter((i) => i.artifactType === "quiz");
  const total = items.length;
  // 练习统计:上次答对/答错/未做
  const correctCount = practiceItems.filter((i) => i.lastResult === "correct").length;
  const wrongCount = practiceItems.filter((i) => i.lastResult === "wrong").length;

  if (total === 0) {
    return (
      <EmptyNotebook
        message={t("notebook.empty.no_notes_message")}
        icon="🧩"
      />
    );
  }

  return (
    <div className="p-4 space-y-3" data-testid="notes-list">
      {/* 理解区(线索区) */}
      <ZoneSection
        title={t("notebook.zone.understand")}
        icon={<Share2 className="w-4 h-4" />}
        subtitle={t("notebook.zone.understand.subtitle")}
        count={understandItems.length}
        testid="zone-understand"
        defaultOpen={false}
      >
        {understandItems.length === 0 ? (
          <ZoneEmpty hint={t("notebook.zone.understand.empty_hint")} />
        ) : (
          understandItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>

      {/* 记录区(笔记区:user_note) */}
      <ZoneSection
        title={t("notebook.zone.note")}
        icon={<Pencil className="w-4 h-4" />}
        subtitle={t("notebook.zone.note.subtitle")}
        count={noteItems.length}
        testid="zone-note"
        defaultOpen={false}
      >
        {noteItems.length === 0 ? (
          <ZoneEmpty hint={t("notebook.zone.note.empty_hint")} />
        ) : (
          noteItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>

      {/* 练习区(总结区) */}
      <ZoneSection
        title={t("notebook.zone.practice")}
        icon={<ListChecks className="w-4 h-4" />}
        subtitle={
          practiceItems.length > 0
            ? t("notebook.zone.practice.subtitle_stats", { total: practiceItems.length, correct: correctCount, wrong: wrongCount })
            : t("notebook.zone.practice.subtitle_empty")
        }
        count={practiceItems.length}
        testid="zone-practice"
        defaultOpen={false}
      >
        {practiceItems.length === 0 ? (
          <ZoneEmpty hint={t("notebook.zone.practice.empty_hint")} />
        ) : (
          practiceItems.map((item) => (
            <CanvasItemCard
              key={item.id}
              item={item}
              onRemove={onRemove}
              onTogglePin={onTogglePin}
              onRecordQuizResult={onRecordQuizResult}
              onUpdateNoteComment={onUpdateNoteComment}
              onJumpToSource={onJumpToSource}
            />
          ))
        )}
      </ZoneSection>
    </div>
  );
}

/** 可折叠的区域(三区共用) */
function ZoneSection({
  title,
  icon,
  subtitle,
  count,
  testid,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: ReactNode;
  subtitle: string;
  count: number;
  testid: string;
  /** 初始展开/折叠;默认展开。三区默认折叠以减少视觉噪音 */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 运行时内容新增 → 自动展开,让用户立刻看到刚加的笔记/产物。
  // 用 ref 跳过首次挂载(尊重 defaultOpen,不把历史已有内容误判为"新增")。
  const firstRun = useRef(true);
  const prevCount = useRef(count);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      prevCount.current = count;
      return;
    }
    if (count > prevCount.current) {
      setOpen(true);
    }
    prevCount.current = count;
  }, [count]);
  return (
    <section
      className="rounded-xl bg-surface-1 overflow-hidden"
      data-testid={testid}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-1/50 hover:bg-surface-3/60 transition-colors text-left"
        data-testid={`${testid}-toggle`}
      >
        <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform duration-200 ease-out-back ${open ? "" : "-rotate-90"}`} />
        <span className="text-body text-ink-strong flex items-center">{icon}</span>
        <span className="text-body font-bold text-ink">{title}</span>
        <span className="text-caption font-bold px-1.5 py-0.5 rounded-full bg-brand/15 text-brand">{count}</span>
        <span className="text-label text-ink-muted ml-auto truncate">{subtitle}</span>
      </button>
      {/*
        折叠用 grid-template-rows 0fr↔1fr 过渡(CSS 动画高度的标准技巧)。
        内容始终在 DOM(不像 {open && ...} 卸载),所以:
          - headless/隐藏 tab 也能读到内容(testid 不丢)
          - 折叠/展开是平滑过渡而非瞬时显隐
        impeccable 规则:reveal 动画必须增强"已可见的默认",不能 gate 内容可见性。
      */}
      <div
        className="grid transition-all duration-200 ease-out-expo"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="p-3 space-y-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ZoneEmpty({ hint }: { hint: string }) {
  return (
    <div className="text-center py-3 text-body text-ink-muted">{hint}</div>
  );
}

/* ---------- 单条笔记卡 ---------- */
function CanvasItemCard({
  item,
  onRemove,
  onTogglePin,
  onRecordQuizResult,
  onUpdateNoteComment,
  onJumpToSource,
}: {
  item: CanvasItem;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRecordQuizResult: (id: string, correct: boolean) => void;
  onUpdateNoteComment?: (id: string, comment: string) => void;
  onJumpToSource?: (anchor: NoteSourceAnchor, noteText?: string, noteId?: string) => void;
}) {
  const t = useLang();
  // user_note 注释编辑态(本地 state,保存/取消即退出)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.notes ?? "");
  // quiz 产物答题 → 触发 mastery 更新 + 记录 last_result
  const handleQuizAnswered = useCallback(
    (_q: { prompt: string }, _idx: number, correct: boolean) => {
      // 庆祝由 CelebrationLayer 统一处理(recordQuizAnswer 触发 mastery 状态变化 → state:changed)。
      if (item.nodeId) {
        api.recordQuizAnswer(item.nodeId, correct).catch(() => {});
      }
      onRecordQuizResult(item.id, correct);
    },
    [item.nodeId, item.id, onRecordQuizResult],
  );

  // 解析 user_note 的文字 + 溯源锚点
  const isUserNote = item.artifactType === "user_note";
  let noteText = "";
  let noteAnchor: NoteSourceAnchor | null = null;
  if (isUserNote) {
    try {
      noteText = (JSON.parse(item.data) as { text?: string }).text ?? "";
    } catch {
      noteText = item.title ?? "";
    }
    try {
      if (item.sourceAnchor) {
        const a = JSON.parse(item.sourceAnchor) as NoteSourceAnchor;
        noteAnchor = a;
      }
    } catch {
      noteAnchor = null;
    }
  }

  // 解析 AI 产物数据
  let parsed: unknown = null;
  if (!isUserNote) {
    try {
      parsed = JSON.parse(item.data);
    } catch {
      parsed = null;
    }
  }
  const created = new Date(item.createdAt);
  const timeStr = `${created.getMonth() + 1}/${created.getDate()} ${created.getHours().toString().padStart(2, "0")}:${created.getMinutes().toString().padStart(2, "0")}`;

  // user_note 卡:画线 + 溯源跳转 + 用户注释
  if (isUserNote) {
    const existingComment = item.notes && item.notes.trim().length > 0 ? item.notes : null;
    const handleStartEdit = () => {
      setDraft(existingComment ?? "");
      setEditing(true);
    };
    const handleCancelEdit = () => {
      setDraft(existingComment ?? "");
      setEditing(false);
    };
    const handleSaveComment = () => {
      onUpdateNoteComment?.(item.id, draft);
      setEditing(false);
    };
    return (
      <div
        className={`bg-surface-2 rounded-lg p-3 relative ${item.pinned ? "ring-1 ring-brand/40 bg-brand/5" : ""}`}
        data-testid={`canvas-item-${item.id.slice(0, 8)}`}
      >
        <div className="flex items-start gap-2">
          <Quote className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-body text-ink leading-relaxed whitespace-pre-wrap">
              {noteText}
            </div>
            {/* 用户注释:已有 → 显示引用块 + 编辑;编辑态 → textarea */}
            {onUpdateNoteComment && editing ? (
              <div className="mt-2 space-y-1.5" data-testid={`note-comment-edit-${item.id.slice(0, 8)}`}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder={
                    existingComment
                      ? t("notebook.note.comment.ph_edit")
                      : t("notebook.note.comment.ph_new")
                  }
                  className="w-full text-label leading-relaxed p-2 rounded-md border border-[var(--border-faint)] bg-surface-0 text-ink resize-none focus:outline-none focus:border-brand"
                  data-testid={`note-comment-textarea-${item.id.slice(0, 8)}`}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveComment}
                    className="inline-flex items-center gap-1 text-caption font-bold text-white bg-brand hover:bg-brand/90 px-2 py-0.5 rounded"
                    data-testid={`note-comment-save-${item.id.slice(0, 8)}`}
                  >
                    <Check className="w-3 h-3" /> {t("notebook.action.save")}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="inline-flex items-center gap-1 text-caption text-ink-muted hover:text-ink"
                    data-testid={`note-comment-cancel-${item.id.slice(0, 8)}`}
                  >
                    <X className="w-3 h-3" /> {t("notebook.action.cancel")}
                  </button>
                </div>
              </div>
            ) : existingComment ? (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-ink/5">
                <div className="text-label text-ink-muted italic leading-relaxed whitespace-pre-wrap">
                  {existingComment}
                </div>
                {onUpdateNoteComment && (
                  <button
                    onClick={handleStartEdit}
                    className="mt-1 inline-flex items-center gap-0.5 text-caption text-ink-muted hover:text-accent"
                    data-testid={`note-comment-edit-btn-${item.id.slice(0, 8)}`}
                    title={t("notebook.note.edit_comment")}
                  >
                    <Pencil className="w-2.5 h-2.5" /> {t("notebook.note.edit_comment")}
                  </button>
                )}
              </div>
            ) : onUpdateNoteComment ? (
              <button
                onClick={handleStartEdit}
                className="mt-2 inline-flex items-center gap-0.5 text-caption text-ink-muted hover:text-accent"
                data-testid={`note-comment-add-${item.id.slice(0, 8)}`}
                title={t("notebook.note.add_comment")}
              >
                <Pencil className="w-2.5 h-2.5" /> {t("notebook.note.add_comment")}
              </button>
            ) : null}
            {/* 溯源跳转 */}
            {noteAnchor && onJumpToSource && (
              <button
                onClick={() => onJumpToSource(noteAnchor!, noteText, item.id)}
                className="mt-2 inline-flex items-center gap-1 text-caption text-accent hover:underline font-bold"
                data-testid={`note-source-${item.id.slice(0, 8)}`}
              >
                {noteAnchor.type === "content" ? (
                  <>
                    <BookOpen className="w-3 h-3" />
                    {t("notebook.source.jump_content")}
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-3 h-3" />
                    {t("notebook.source.jump_chat")}
                  </>
                )}
              </button>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-caption text-ink-muted">{timeStr}</span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-caption text-ink-muted hover:text-warning"
                data-testid={`canvas-delete-${item.id.slice(0, 8)}`}
                title={t("notebook.note.delete")}
              >
                <Trash className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // AI 产物卡(理解区 / 练习区)
  const ArtifactIcon = ARTIFACT_ICON[item.artifactType] ?? Puzzle;
  return (
    <div
      className={`bg-surface-2 rounded-lg p-3 relative ${item.pinned ? "ring-1 ring-brand/40 bg-brand/5" : ""}`}
      data-testid={`canvas-item-${item.id.slice(0, 8)}`}
    >
      {/* 卡顶:类型 + 标题 + last_result 徽章 + 操作 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-body inline-flex items-center text-ink-strong">
          <ArtifactIcon className="w-4 h-4" />
        </span>
        <span className="text-label font-bold text-ink-muted flex-1 truncate">
          {item.title ?? artifactLabel(t, item.artifactType)}
        </span>
        {/* quiz 上次结果徽章 */}
        {item.artifactType === "quiz" && item.lastResult && (
          <span
            className={`text-caption font-bold px-1.5 py-0.5 rounded-full ${item.lastResult === "correct" ? "bg-brand/15 text-brand" : "bg-warning/15 text-warning"}`}
            data-testid={`quiz-result-${item.id.slice(0, 8)}`}
          >
            {item.lastResult === "correct" ? t("notebook.quiz.last_correct") : t("notebook.quiz.last_wrong")}
          </span>
        )}
        {item.pinned ? <span className="text-caption text-brand font-bold flex items-center gap-0.5"><Pin className="w-2.5 h-2.5" />{t("notebook.note.pinned")}</span> : null}
        <button
          onClick={() => onTogglePin(item.id)}
          className="text-caption text-ink-muted hover:text-brand"
          data-testid={`canvas-pin-${item.id.slice(0, 8)}`}
          title={item.pinned ? t("notebook.note.unpin") : t("notebook.note.pin")}
        >
          <Pin className="w-3 h-3" />
        </button>
        <button
          onClick={() => onRemove(item.id)}
          className="text-caption text-ink-muted hover:text-warning"
          data-testid={`canvas-delete-${item.id.slice(0, 8)}`}
          title={t("notebook.note.delete")}
        >
          <Trash className="w-3 h-3" />
        </button>
      </div>

      {/* 产物内容 */}
      <div className="text-label">
        {parsed ? <Suspense fallback={null}><ArtifactRenderer data={parsed} onQuizAnswered={handleQuizAnswered} /></Suspense> : <div className="text-ink-muted">{t("notebook.artifact.broken")}</div>}
      </div>

      {/* 时间 */}
      <div className="text-caption text-ink-muted mt-2">{timeStr}</div>
    </div>
  );
}

function EmptyNotebook({ message, icon }: { message: string; icon: string }) {
  // 三 tab 空态统一词汇:flex-1 真垂直居中(与讲解空态/中栏空态同款;旧 py-16 垫顶方案吊在上部 20%)
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6" data-testid="empty-notebook">
      <div className="text-4xl mb-3 opacity-30">{icon}</div>
      <div className="text-body text-ink-muted max-w-xs leading-relaxed">
        {message}
      </div>
    </div>
  );
}

function TabBtn({
  label,
  icon: Icon,
  active,
  onClick,
  testid,
  badge,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  testid: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      role="tab"
      aria-selected={active}
      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-label font-bold transition-colors ${
        active
          ? "bg-brand/20 text-brand"
          : "text-ink-muted hover:text-ink-strong"
      }`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      {badge && (
        <span className={`text-caption px-1.5 py-0.5 rounded-full font-bold ${
          active ? "bg-brand/30 text-brand" : "bg-ink/10 text-ink-faint"
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

/* ============================================================
 * 多模态:图片展示组件(内嵌渲染 + 集中插图区缩略图)
 * ============================================================ */

/**
 * 内嵌图片:ReactMarkdown 的 img renderer 用。
 * 相对路径(src 不含 http/data:)→ 从 assets 列表找匹配 → 加载 data-url。
 * 外部 URL → 保持原 src(浏览器/csp 处理)。匹配不到也保持原 src(fallback)。
 */
function InlineAssetImage({
  src,
  alt,
  assets,
  ...props
}: {
  src?: string;
  alt?: string;
  assets: NodeAsset[];
} & Record<string, unknown>) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const srcStr = src ?? "";

  // 找匹配的 asset:用 src 的 basename 匹配 asset 的 sourcePath 或 filename
  const matchedAsset = useMemo(() => {
    if (!srcStr || srcStr.startsWith("http") || srcStr.startsWith("data:")) return null;
    const srcBase = srcStr.split("/").pop() ?? srcStr;
    return (
      assets.find((a) => a.sourcePath?.endsWith(srcBase)) ??
      assets.find((a) => a.filename === srcBase) ??
      null
    );
  }, [srcStr, assets]);

  useEffect(() => {
    if (!matchedAsset) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    api.getAssetDataUrl(matchedAsset.id).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [matchedAsset]);

  if (!srcStr) return null;
  // 外部 URL 或无匹配 → 用原 src(让浏览器尝试加载)
  const finalSrc = dataUrl ?? srcStr;
  return (
    <img
      src={finalSrc}
      alt={alt ?? ""}
      data-asset-id={matchedAsset?.id}
      className="rounded-lg max-w-full h-auto my-3"
      loading="lazy"
      {...props}
    />
  );
}

/**
 * 集中插图区缩略图:点击放大查看(lightbox)。
 */
function AssetThumb({ asset }: { asset: NodeAsset }) {
  const t = useLang();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getAssetDataUrl(asset.id).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="block rounded-lg overflow-hidden bg-ink/5 dark:bg-ink/10 hover:ring-2 hover:ring-accent transition-all"
        title={asset.altText ?? asset.filename}
      >
        {dataUrl ? (
          <img src={dataUrl} alt={asset.altText ?? asset.filename} data-asset-id={asset.id} className="w-full h-24 object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-24 flex items-center justify-center text-ink-faint text-caption">{t("notebook.asset.loading")}</div>
        )}
      </button>
      {expanded && dataUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <img src={dataUrl} alt={asset.altText ?? asset.filename} data-asset-id={asset.id} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            aria-label={t("action.close")}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </>
  );
}
