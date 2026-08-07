/**
 * NavRail —— v0.2 左栏导航(M1)。
 *
 * 职责:
 *   - 顶部 Logo + 应用名
 *   - 视图切换(学习路径 / 仪表盘 / 导入)
 *   - 当前课程的迷你路径缩略图(只读,点击跳转)
 *   - 复习入口(overdue 红点)
 *
 * 设计(product register):工具消失于任务。导航栏始终可见提供方向感,
 * 但不抢主视觉。active 项用绿底,非 active 用中性灰。
 *
 * 注意:这是 M1 的最小可用版本——PathOverview 在 M3 路径线性化时完善。
 * 现在用简化版:列出 sections 让用户感知课程结构。
 */
import type { ContentNode, Progress } from "@shared/types";
import { translate } from "../lib/i18n.js";

export type NavView = "tree" | "dashboard" | "import";

interface NavRailProps {
  view: NavView;
  onViewChange: (v: NavView) => void;
  courseTitle: string | null;
  sections: ContentNode[];
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  dueCount: number;
  /** M3: overdue 的节点 id 集合(供路径上标记复习节点) */
  dueNodeIds?: Set<string>;
  onJumpNode: (nodeId: string) => void;
  onOpenReview?: () => void;
}

export function NavRail({
  view,
  onViewChange,
  courseTitle,
  sections,
  tree,
  progressMap,
  selectedNodeId,
  dueCount,
  dueNodeIds,
  onJumpNode,
  onOpenReview,
}: NavRailProps) {
  return (
    <nav
      className="h-full flex flex-col bg-neutral-100 dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800/50 w-[220px] shrink-0"
      data-testid="nav-rail"
    >
      {/* Logo + 应用名 */}
      <div className="px-4 py-3 flex items-center gap-2 shrink-0">
        <div
          className="w-7 h-7 rounded-xl bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-white font-extrabold text-xs shadow-md"
          style={{ boxShadow: "0 2px 8px rgba(88, 204, 2, 0.3)" }}
        >
          L
        </div>
        <span className="text-sm font-extrabold tracking-tight text-neutral-900 dark:text-neutral-100">
          Lookat<span className="text-brand">Study</span>
        </span>
      </div>

      {/* 视图切换 */}
      <div className="px-2 py-1 flex flex-col gap-0.5 shrink-0" data-testid="nav-view-switcher">
        <NavItem
          icon="▣"
          label={translate("view.tree")}
          active={view === "tree"}
          onClick={() => onViewChange("tree")}
          testid="nav-tree"
        />
        <NavItem
          icon="◫"
          label={translate("view.dashboard")}
          active={view === "dashboard"}
          onClick={() => onViewChange("dashboard")}
          testid="nav-dashboard"
        />
        <NavItem
          icon="⊕"
          label={translate("view.import")}
          active={view === "import"}
          onClick={() => onViewChange("import")}
          testid="nav-import"
        />
      </div>

      <div className="h-px bg-neutral-200 dark:bg-neutral-800/60 my-2 mx-3 shrink-0" />

      {/* 当前课程 + 迷你路径 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0" data-testid="nav-path-overview">
        {courseTitle && (
          <div className="text-[10px] font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-2 truncate">
            {courseTitle}
          </div>
        )}
        {sections.length === 0 ? (
          <div className="text-[11px] text-neutral-400 dark:text-neutral-600 px-1">
            {courseTitle ? "加载路径中…" : "未选择课程"}
          </div>
        ) : (
          <div className="space-y-2.5">
            {sections.map((section, sIdx) => {
              const lessons = tree
                .filter((n) => n.parentId === section.id)
                .sort((a, b) => a.orderIdx - b.orderIdx);
              return (
                <div key={section.id}>
                  <div className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 mb-1 px-1">
                    {sIdx + 1}. {section.title}
                  </div>
                  <ol className="space-y-0.5">
                    {lessons.map((lesson) => (
                      <PathNodeRow
                        key={lesson.id}
                        lesson={lesson}
                        progress={progressMap[lesson.id]}
                        isSelected={lesson.id === selectedNodeId}
                        isDue={dueNodeIds?.has(lesson.id) ?? false}
                        onClick={() => onJumpNode(lesson.id)}
                      />
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 复习入口(底部,overdue 红点,点击进复习面板) */}
      {dueCount > 0 && (
        <button
          onClick={onOpenReview}
          className="w-full px-3 py-2 border-t border-neutral-200 dark:border-neutral-800/60 shrink-0 flex items-center gap-2 text-xs text-orange-500 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
          data-testid="nav-review-badge"
        >
          <span>📖</span>
          <span className="font-bold">{dueCount} 待复习</span>
          <span className="ml-auto w-2 h-2 rounded-full bg-orange-500" />
        </button>
      )}
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  testid,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
        active
          ? "bg-brand/15 text-brand"
          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/40 hover:text-neutral-900 dark:hover:text-neutral-200"
      }`}
    >
      <span className="text-base leading-none w-5 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function PathNodeRow({
  lesson,
  progress,
  isSelected,
  isDue,
  onClick,
}: {
  lesson: ContentNode;
  progress?: Progress;
  isSelected: boolean;
  isDue: boolean;
  onClick: () => void;
}) {
  const status = progress?.status ?? "locked";
  const isLocked = status === "locked";

  // 状态点:locked 灰圈,available 绿空心,in_progress 蓝实心,mastered 金实心
  // M3: overdue(待复习)节点叠一个橙色外环——复习交错插入路径的视觉体现
  const dotClass = isDue
    ? "border-orange-500 bg-orange-500 ring-2 ring-orange-500/30"
    : status === "locked"
      ? "border-neutral-300 dark:border-neutral-700 bg-transparent"
      : status === "available"
        ? "border-brand bg-transparent"
        : status === "in_progress"
          ? "border-accent bg-accent"
          : "border-gold bg-gold"; // mastered

  return (
    <li>
      <button
        onClick={() => !isLocked && onClick()}
        disabled={isLocked}
        data-testid={`nav-node-${lesson.id.slice(0, 8)}`}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition-colors duration-150 ${
          isSelected
            ? "bg-brand/10 text-brand"
            : isDue
              ? "bg-orange-500/5 text-orange-600 dark:text-orange-400"
              : isLocked
                ? "text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/40"
        }`}
        title={isLocked ? `🔒 ${lesson.title}` : isDue ? `📖 ${lesson.title}(待复习)` : lesson.title}
      >
        <span className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${dotClass}`} />
        <span className="text-[11px] truncate flex-1">{lesson.title}</span>
        {isDue && <span className="text-[9px] text-orange-500 shrink-0">复习</span>}
      </button>
    </li>
  );
}
