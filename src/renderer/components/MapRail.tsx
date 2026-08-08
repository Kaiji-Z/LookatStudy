/**
 * MapRail —— v0.3 选关地图(替代 v0.2 的 NavRail 列表)。
 *
 * 核心隐喻:游戏选关界面。打开应用第一眼看到的是地图,不是菜单。
 *   - 顶部:课程总进度条(合并仪表盘的 overallMastery)+ 连击
 *   - 主体:蜿蜒垂直路径,每个节点是多邻国式 3D 大圆球(56px)
 *   - 节点状态:锁(灰)/ 可学(绿脉冲)/ 进行中(蓝)/ 已掌握(金+皇冠)
 *   - 节点下:星星进度(0-3)+ 节点名
 *   - 底部:今日待复习徽章(可点)+ 折叠按钮
 *
 * 折叠态:48px 窄条,只显示 🗺️ + 当前节点小圆球。
 *
 * 多邻国路径:节点左右交替(zig-zag),用 SVG 贝塞尔曲线连接。
 * 与 v0.1 的技能树不同:这里节点更大、有星星、有路径感、有总进度。
 */
import type { ContentNode, Progress } from "@shared/types";
import { UNLOCK_MASTERY_THRESHOLD } from "@shared/types";
import { useState, useCallback, useEffect, useRef } from "react";
import { Map as MapIcon, FileText, ChevronLeft, ChevronRight, BookOpen, Target } from "lucide-react";
import {
  computeSectionLayout,
  sectionHeight,
  segmentToPath,
  LAYOUT_MODES,
  type MapLayoutMode,
} from "../lib/mapLayout.js";

export type MapView = "map" | "import";

interface MapRailProps {
  view: MapView;
  onViewChange: (v: MapView) => void;
  courseTitle: string | null;
  sections: ContentNode[];
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  dueCount: number;
  dueNodeIds: Set<string>;
  overallMastery: number; // 0-1,顶部进度条
  streak: number; // 连击天数
  collapsed: boolean;
  streaming: boolean; // AI 输出中(锁定节点切换)
  onToggleCollapse: () => void;
  onJumpNode: (nodeId: string) => void;
  onOpenReview: () => void;
}

export function MapRail(props: MapRailProps) {
  if (props.collapsed) {
    return <MapRailCollapsed {...props} />;
  }
  return <MapRailExpanded {...props} />;
}

/* ---------- 折叠态:48px 窄条 ---------- */
function MapRailCollapsed({
  onToggleCollapse,
  selectedNodeId,
  tree,
  progressMap,
}: MapRailProps) {
  const currentNode = selectedNodeId ? tree.find((n) => n.id === selectedNodeId) : null;
  const status = currentNode ? (progressMap[currentNode.id]?.status ?? "available") : null;
  return (
    <nav
      className="h-full flex flex-col items-center bg-neutral-100 dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800/50 w-12 shrink-0 py-3"
      data-testid="map-rail-collapsed"
    >
      <button
        onClick={onToggleCollapse}
        className="text-neutral-500 dark:text-neutral-400 hover:text-brand mb-3"
        title="展开地图"
        data-testid="map-expand"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="mb-3"><MapIcon className="w-5 h-5 text-brand" /></div>
      {currentNode && status && (
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
            statusClass(status)
          }`}
          title={currentNode.title}
        >
          {statusIcon(status)}
        </div>
      )}
    </nav>
  );
}

/* ---------- 展开态:完整地图 ---------- */
function MapRailExpanded({
  view,
  onViewChange,
  courseTitle,
  sections,
  tree,
  progressMap,
  selectedNodeId,
  dueCount,
  dueNodeIds,
  overallMastery,
  streak,
  streaming,
  onToggleCollapse,
  onJumpNode,
  onOpenReview,
}: MapRailProps) {
  const masteryPct = Math.round(overallMastery * 100);

  // 布局模式(zigzag/linear/compact),持久化到 localStorage。
  // 默认 zigzag(Duolingo 经典);用户切换后记住选择。
  const [layoutMode, setLayoutMode] = useState<MapLayoutMode>(
    () => (typeof localStorage !== "undefined" &&
      (localStorage.getItem("lookatstudy:mapLayout") as MapLayoutMode | null)) ||
      "zigzag",
  );
  const switchLayout = useCallback((m: MapLayoutMode) => {
    setLayoutMode(m);
    try {
      localStorage.setItem("lookatstudy:mapLayout", m);
    } catch {
      /* 忽略:隐私模式/配额 */
    }
  }, []);

  return (
    <nav
      className="h-full flex flex-col bg-gradient-to-b from-brand/5 to-transparent dark:from-brand/5 dark:to-neutral-950 border-r border-neutral-200 dark:border-neutral-800/50 w-[300px] shrink-0"
      data-testid="map-rail"
    >
      {/* 顶部:课程标题 + 总进度 */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <button
            onClick={onToggleCollapse}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            title="折叠地图"
            data-testid="map-collapse"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex gap-1">
            <MapNavBtn
              active={view === "map"}
              onClick={() => onViewChange("map")}
              testid="map-view-map"
            >
              <MapIcon className="w-4 h-4" />
            </MapNavBtn>
            <MapNavBtn
              active={view === "import"}
              onClick={() => onViewChange("import")}
              testid="map-view-import"
            >
              <FileText className="w-4 h-4" />
            </MapNavBtn>
          </div>
        </div>

        {view === "map" && (
          <>
            <h2 className="text-sm font-extrabold text-neutral-900 dark:text-neutral-100 mt-2 truncate" title={courseTitle ?? ""}>
              {courseTitle ?? "未选择课程"}
            </h2>
            {/* 总进度条(合并仪表盘核心) */}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-2.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${masteryPct >= 100 ? "bg-gold" : "bg-brand"}`}
                  style={{ width: `${Math.max(3, masteryPct)}%` }}
                />
              </div>
              <span className="text-xs font-extrabold tabular-nums text-neutral-700 dark:text-neutral-300">
                {masteryPct}%
              </span>
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-neutral-500 dark:text-neutral-400">
              <span className="flex items-center gap-0.5">
                <span className="text-review">🔥</span>
                <span className="font-bold text-review">{streak}</span>
                <span>天连击</span>
              </span>
              {dueCount > 0 && (
                <button
                  onClick={onOpenReview}
                  className="flex items-center gap-1 text-review hover:underline"
                  data-testid="map-review-badge"
                >
                  <BookOpen className="w-3 h-3" />
                  <span className="font-bold">{dueCount}</span>
                  <span>待复习</span>
                </button>
              )}
            </div>
            {/* 布局模式切换:蜿蜒/直线/紧凑。克制的小段控件,不抢主视觉。 */}
            <div className="flex items-center gap-1 mt-2" data-testid="map-layout-switcher">
              {LAYOUT_MODES.map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  onClick={() => switchLayout(mode)}
                  data-testid={`map-layout-${mode}`}
                  title={`${label}布局`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    layoutMode === mode
                      ? "bg-brand/15 text-brand"
                      : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                  }`}
                >
                  <span className="mr-0.5">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 主体:地图 / 导入视图 */}
      {view === "map" ? (
        <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0" data-testid="map-path">
          {/* AI 输出中提示(专注当下,锁定节点切换) */}
          {streaming && (
            <div className="mb-3 mx-1 px-3 py-2 rounded-xl bg-brand/10 border border-brand/30 flex items-center gap-2 text-[11px] text-brand font-medium" data-testid="streaming-notice">
              <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
              AI 正在回答,完成后可切换节点
            </div>
          )}
          {sections.length === 0 ? (
            courseTitle ? (
              <div className="text-center text-xs text-neutral-500 dark:text-neutral-400 mt-8 px-4 flex items-center justify-center gap-2">
                <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
                正在生成课程路径…
              </div>
            ) : (
              <button
                onClick={() => onViewChange("import")}
                className="block w-full mt-8 mx-auto p-4 rounded-2xl border-2 border-dashed border-brand/40 hover:border-brand hover:bg-brand/5 transition-all text-center group"
                data-testid="map-empty-cta"
              >
                <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">🗺️</div>
                <div className="text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                  开始你的第一门课
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  导入一个 GitHub 学习仓库,自动生成选关路径
                </div>
                <div className="mt-2 text-[10px] text-brand font-bold">点这里导入 →</div>
              </button>
            )
          ) : (
            <div className="space-y-6 pt-2">
              {sections.map((section, sIdx) => (
                <MapSection
                  key={section.id}
                  section={section}
                  sectionIndex={sIdx}
                  tree={tree}
                  progressMap={progressMap}
                  selectedNodeId={selectedNodeId}
                  dueNodeIds={dueNodeIds}
                  layoutMode={layoutMode}
                  onJumpNode={onJumpNode}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">
          {/* 导入提示(实际导入界面在主区) */}
          <p className="leading-relaxed">
            点 ⊕ 在主区导入新课程。导入后这里会显示新课程的地图。
          </p>
        </div>
      )}
    </nav>
  );
}

/* ---------- 章节单元(含蜿蜒路径) ---------- */
function MapSection({
  section,
  sectionIndex,
  tree,
  progressMap,
  selectedNodeId,
  dueNodeIds,
  layoutMode,
  onJumpNode,
}: {
  section: ContentNode;
  sectionIndex: number;
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  dueNodeIds: Set<string>;
  layoutMode: MapLayoutMode;
  onJumpNode: (nodeId: string) => void;
}) {
  const lessons = tree
    .filter((n) => n.parentId === section.id)
    .sort((a, b) => a.orderIdx - b.orderIdx);

  // 考试解锁条件:同 section 的所有 lesson 节点 mastery 都 ≥ UNLOCK_MASTERY_THRESHOLD(整章通关感)。
  const chapterLessonNodes = lessons.filter((n) => n.type === "lesson");
  const chapterLessonsMastered =
    chapterLessonNodes.length > 0 &&
    chapterLessonNodes.every((l) => (progressMap[l.id]?.mastery ?? 0) >= UNLOCK_MASTERY_THRESHOLD);

  // 章节背景色循环(轻微区域感:浅绿/浅蓝/浅金交替)
  const SECTION_TINTS = ["bg-brand/[0.04]", "bg-accent/[0.04]", "bg-gold/[0.04]"];
  const tintClass = SECTION_TINTS[sectionIndex % SECTION_TINTS.length];

  // 测量章节路径容器宽度,供布局引擎算 x 坐标。
  // 容器宽度稳定(map-rail 固定 300px),用 ref + state 测一次即可。
  const pathRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(268);
  useEffect(() => {
    if (!pathRef.current) return;
    const measure = () => {
      const w = pathRef.current?.clientWidth ?? 268;
      setContainerW(w > 0 ? w : 268);
    };
    measure();
    // 章节折叠/展开后宽度可能变,监听 resize
    const ro = new ResizeObserver(measure);
    ro.observe(pathRef.current);
    return () => ro.disconnect();
  }, []);

  // 用布局引擎算节点坐标(像素)。修原 bug:旧代码 % 拼进 SVG path,非法单位,
  // 节点位置(margin)与路径(%)是两套独立计算,永远对不齐。现在统一像素坐标。
  const layout = computeSectionLayout(lessons.length, layoutMode, containerW);
  const pathHeight = sectionHeight(lessons.length, layoutMode);
  const NODE_W = 110; // MapNode 卡片宽(球+名字)
  const NODE_H = 76;  // 球 56 + 名字行 20

  return (
    <section
      data-testid={`map-section-${section.id.slice(0, 8)}`}
      className={`${tintClass} rounded-2xl py-3 px-2`}
    >
      {/* 章节路牌标题(像游戏关卡指示牌) */}
      <div className="flex items-center gap-2 mb-3 px-2 py-1.5 bg-white/60 dark:bg-neutral-900/50 rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 shadow-sm">
        <span className="w-6 h-6 rounded-lg bg-brand text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
          {sectionIndex + 1}
        </span>
        <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 truncate flex-1">
          {section.title}
        </span>
      </div>

      {/* 路径 + 节点:绝对定位,统一像素坐标系 */}
      <div ref={pathRef} className="relative" style={{ minHeight: pathHeight }}>
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
          style={{ height: pathHeight }}
        >
          {layout.segments.map((seg) => {
            // 路径颜色:前置节点已通过 → 走过的路(brand 实线);否则未走过(灰虚线)
            const fromLesson = lessons[seg.index];
            const fromProgress = fromLesson ? progressMap[fromLesson.id] : undefined;
            const isPassed =
              fromProgress?.status === "mastered" ||
              fromProgress?.status === "in_progress" ||
              fromProgress?.status === "available";
            return (
              <path
                key={seg.index}
                d={segmentToPath(seg)}
                stroke={isPassed ? "var(--brand)" : "var(--ink-faint)"}
                strokeWidth={isPassed ? 4 : 2.5}
                strokeOpacity={isPassed ? 0.5 : 0.6}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={isPassed ? "none" : "3 7"}
                // 走过的路渐进绘制(PROPERTY.md motion:状态传达);用 pathLength=1 归一化
                style={
                  isPassed
                    ? { pathLength: 1, animation: "path-draw 500ms var(--ease-out-expo)" }
                    : undefined
                }
              />
            );
          })}
        </svg>

        {/* 节点:绝对定位居中于 layout.x/layout.y */}
        {lessons.map((lesson, i) => {
          const node = layout.nodes[i];
          if (!node) return null;
          return (
            <div
              key={lesson.id}
              className="absolute"
              style={{
                left: node.x - NODE_W / 2,
                top: node.y - NODE_H / 2 + 12, // +12 补 SVG 顶部留白对齐球心
                width: NODE_W,
              }}
            >
              <MapNode
                lesson={lesson}
                index={i}
                progress={progressMap[lesson.id]}
                isSelected={lesson.id === selectedNodeId}
                isDue={dueNodeIds.has(lesson.id)}
                chapterLessonsMastered={chapterLessonsMastered}
                onClick={() => onJumpNode(lesson.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 单个地图节点(多邻国式大圆球) ---------- */
function MapNode({
  lesson,
  index,
  progress,
  isSelected,
  isDue,
  chapterLessonsMastered,
  onClick,
}: {
  lesson: ContentNode;
  index: number;
  progress?: Progress;
  isSelected: boolean;
  isDue: boolean;
  /** 同 section 所有 lesson mastery 都 ≥0.5(考试解锁条件)。 */
  chapterLessonsMastered: boolean;
  onClick: () => void;
}) {
  const status = progress?.status ?? "locked";
  const crown = progress?.crownLevel ?? 0;
  const isExam = lesson.type === "exam";
  // 考试节点的星数 = crownLevel(1-3,考试得分)。普通课节点不再用星(crown 只在 mastered 时=5)。
  const examStars = Math.min(3, crown);
  // 锁定逻辑:
  //   - 普通课:status === "locked"(受 mastery≥0.5 硬门控解锁)
  //   - 考试:要求同 section 所有 lesson 都 mastery≥0.5 才解锁(整章通关感)
  const isLocked = isExam ? !chapterLessonsMastered : status === "locked";
  const examLocked = isExam && isLocked; // 考试专属锁定态(用于样式/文案)
  // in_progress(仅普通课):用 mastery 算进度环(0-1 → 0-100%)
  const masteryPct = status === "in_progress" && !isExam ? Math.round((progress?.mastery ?? 0) * 100) : 0;
  // 节点位置由外层布局引擎(MapSection)绝对定位决定,这里只管自身样式。
  // index 仅用于 testid/可访问性,不参与定位(原 alignLeft/margin 逻辑已废弃)。

  return (
    <div className="relative flex flex-col items-center w-full">
      <button
        onClick={() => !isLocked && onClick()}
        disabled={isLocked}
        data-testid={`${isExam ? "exam-node" : "map-node"}-${lesson.id.slice(0, 8)}`}
        className={`group relative w-14 h-14 flex items-center justify-center text-2xl rounded-full transition-all duration-200 ${
          isExam
            ? examLocked
              ? "lesson-bubble exam-bubble-locked"
              : examBubbleClass(crown > 0)
            : bubbleClass(status)
        } ${isLocked ? "cursor-not-allowed" : "cursor-pointer hover:scale-105"} ${
          isSelected ? "ring-4 ring-accent ring-offset-2 ring-offset-neutral-50 dark:ring-offset-neutral-950" : ""
        }`}
        title={
          examLocked
            ? `🔒 ${lesson.title}(完成本章所有课时后解锁)`
            : isExam
              ? `🎯 ${lesson.title}`
              : isLocked
                ? `🔒 ${lesson.title}`
                : isDue
                  ? `📖 ${lesson.title}(待复习)`
                  : lesson.title
        }
      >
        {/* in_progress 进度环(仅普通课;考试不画进度环) */}
        {status === "in_progress" && !isExam && (
          <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="25" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="2.5" />
            <circle
              cx="28" cy="28" r="25"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(masteryPct / 100) * 157} 157`}
              className="transition-all duration-500"
            />
          </svg>
        )}
        {isExam ? (
          // 考试节点:锁定态显示 🔒,解锁后 🎯
          examLocked ? (
            <span aria-label="exam-locked" className="relative z-10 opacity-60">🔒</span>
          ) : (
            <Target aria-label="exam" className="relative z-10 w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" strokeWidth={2.5} />
          )
        ) : isLocked ? (
          <span aria-label="locked" className="relative z-10 opacity-50">🔒</span>
        ) : status === "mastered" ? (
          <span aria-label="mastered" className="relative z-10 drop-shadow-lg">👑</span>
        ) : status === "in_progress" ? (
          <BookOpen aria-label="in-progress" className="relative z-10 w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" strokeWidth={2.5} />
        ) : (
          <span aria-label="available" className="relative z-10 drop-shadow">⭐</span>
        )}
        {/* 待复习标记(仅普通课) */}
        {isDue && !isLocked && !isExam && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-review text-white text-[9px] flex items-center justify-center font-bold border-2 border-neutral-50 dark:border-neutral-950">
            !
          </span>
        )}
      </button>

      {/* 星星(仅考试节点:显示考试得分 1-3 星)。普通课节点不再显示星星。 */}
      {isExam && (
        <div className="flex gap-0.5 mt-1" data-testid={`map-stars-${lesson.id.slice(0, 8)}`}>
          {[0, 1, 2].map((s) => (
            <span
              key={s}
              className={`text-[10px] ${s < examStars ? "text-gold" : "text-neutral-300 dark:text-neutral-700"}`}
            >
              ★
            </span>
          ))}
        </div>
      )}

      {/* 节点名 */}
      <div
        className={`mt-0.5 text-[10px] text-center leading-tight max-w-[110px] font-medium ${
          isSelected
            ? "text-brand font-bold"
            : isLocked
              ? "text-neutral-400 dark:text-neutral-600"
              : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        {lesson.title}
      </div>
    </div>
  );
}

function MapNavBtn({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
        active
          ? "bg-brand/15 text-brand"
          : "text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/50 hover:text-neutral-700 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- 样式辅助 ---------- */
function statusClass(status: string): string {
  switch (status) {
    case "locked":
      return "bg-neutral-300 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400";
    case "available":
      return "bg-brand text-white";
    case "in_progress":
      return "bg-accent text-white";
    case "mastered":
      return "bg-gold text-neutral-900";
    default:
      return "bg-neutral-300 dark:bg-neutral-800";
  }
}
function statusIcon(status: string): string {
  switch (status) {
    case "locked": return "🔒";
    case "available": return "⭐";
    case "in_progress": return "📖"; // 折叠态小圆球里用书 emoji(白色书页,对比足够)
    case "mastered": return "👑";
    default: return "•";
  }
}
function bubbleClass(status: string): string {
  // 复用 v0.1 的 lesson-bubble 3D 样式(在 index.css)
  switch (status) {
    case "locked": return "lesson-bubble lesson-bubble-locked";
    case "available": return "lesson-bubble lesson-bubble-available";
    case "in_progress": return "lesson-bubble lesson-bubble-in-progress";
    case "mastered": return "lesson-bubble lesson-bubble-mastered";
    default: return "lesson-bubble lesson-bubble-locked";
  }
}
/** 考试节点气泡:紫色(关底 boss 专属色),已通过(有星)时更亮。 */
function examBubbleClass(passed: boolean): string {
  return passed ? "lesson-bubble exam-bubble-passed" : "lesson-bubble exam-bubble";
}
