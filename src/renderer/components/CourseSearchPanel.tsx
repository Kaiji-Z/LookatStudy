/**
 * CourseSearchPanel —— 课程搜索面板(MapRail 全栏 overlay)。
 *
 * 两种找课方式合一:
 *   ① 树状导航:空查询时展示全部章节→课时(锁定态与地图球同规则 disabled,
 *      相当于课程大纲);点行 = 点地图球(onJumpNode 带流式锁/考试离开守卫)。
 *   ② 关键词:标题多词 AND 过滤(纯函数 course-tree-filter)+ 全文内容匹配
 *      (search:content LIKE 兜底,只留本课节点,与标题命中去重,防抖 250ms)。
 * 跳转由 MapRail 处理:切到目标 world + onJumpNode + 关面板 + 滚动到球。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentNode, Progress, SearchHit } from "@shared/types";
import { Search, X, Lock, Target, BookOpen, Crown } from "lucide-react";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";
import {
  buildCourseTree,
  filterCourseTree,
  isSearchRowLocked,
  findMatchRange,
  type CourseTreeSection,
} from "../lib/course-tree-filter.js";

interface CourseSearchPanelProps {
  sections: ContentNode[];
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  onJump: (node: ContentNode) => void;
  onClose: () => void;
}

export function CourseSearchPanel(props: CourseSearchPanelProps) {
  const t = useLang();
  const [query, setQuery] = useState("");
  const [contentHits, setContentHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows = useMemo(
    () => buildCourseTree(props.sections, props.tree, props.progressMap),
    [props.sections, props.tree, props.progressMap],
  );
  const filtered = useMemo(() => filterCourseTree(rows, query), [rows, query]);

  // 内容匹配(search:content)只留本课节点;标题已命中的去重(那组优先展示)。
  const courseNodeIds = useMemo(() => new Set(props.tree.map((n) => n.id)), [props.tree]);
  const titleMatchedIds = useMemo(
    () => new Set(filtered.flatMap((r) => r.lessons.map((l) => l.id))),
    [filtered],
  );
  const nodeById = useMemo(() => new Map(props.tree.map((n) => [n.id, n])), [props.tree]);
  const sectionMasteredById = useMemo(
    () => new Map(rows.map((r) => [r.section.id, r.chapterLessonsMastered])),
    [rows],
  );

  // 全文搜索:≥2 字触发,防抖 250ms;失败静默(标题过滤不依赖它)。
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setContentHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchContent(q)
        .then((hits) => {
          setContentHits(
            hits
              .filter((h) => courseNodeIds.has(h.nodeId) && !titleMatchedIds.has(h.nodeId))
              .slice(0, 8),
          );
        })
        .catch(() => setContentHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, courseNodeIds, titleMatchedIds]);

  // Enter → 第一个可点的行(跳过锁定,锁定行 Enter 无效只会让人困惑)。
  const firstJumpable = useMemo(() => {
    for (const row of filtered) {
      const hit = row.lessons.find(
        (l) => !isSearchRowLocked(l, props.progressMap, row.chapterLessonsMastered),
      );
      if (hit) return hit;
    }
    return null;
  }, [filtered, props.progressMap]);

  const hasResults = filtered.length > 0 || contentHits.length > 0;

  return (
    <div
      data-testid="course-search-panel"
      className="absolute inset-0 z-50 flex flex-col"
      style={{
        background: "rgb(var(--surface-rail-rgb) / 0.96)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      {/* 输入行:🔍 + 输入框 + 清空 + 关闭 */}
      <div className="flex items-center gap-1.5 m-2 p-1.5 rounded-lg bg-black/40 ring-1 ring-white/15 focus-within:ring-brand/60 transition-colors">
        <Search className="w-4 h-4 text-white/50 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && firstJumpable) props.onJump(firstJumpable);
          }}
          placeholder={t("map.search.placeholder")}
          data-testid="course-search-input"
          className="flex-1 bg-transparent text-body text-white placeholder:text-white/35 outline-none min-w-0"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("map.search.clear")}
            className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={props.onClose}
          data-testid="course-search-close"
          aria-label={t("map.search.close")}
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 树/结果列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-2">
        {!hasResults && (
          <div
            data-testid="course-search-empty"
            className="text-center text-label text-white/60 mt-8 px-4"
          >
            {t("map.search.noResults")}
          </div>
        )}
        {filtered.map((row, sIdx) => (
          <SearchSectionGroup
            key={row.section.id}
            row={row}
            sectionIndex={sIdx}
            query={query}
            progressMap={props.progressMap}
            selectedNodeId={props.selectedNodeId}
            onPick={props.onJump}
          />
        ))}
        {contentHits.length > 0 && (
          <div data-testid="course-search-content-group" className="pt-1">
            <div className="px-1.5 py-1 text-caption font-bold text-white/50 uppercase tracking-wider">
              {t("map.search.contentGroup")}
            </div>
            {contentHits.map((hit) => {
              const node = nodeById.get(hit.nodeId);
              if (!node) return null;
              const locked = isSearchRowLocked(
                node,
                props.progressMap,
                sectionMasteredById.get(node.parentId ?? "") ?? false,
              );
              return (
                <button
                  key={hit.nodeId}
                  disabled={locked}
                  data-testid={`search-content-row-${node.id.slice(0, 8)}`}
                  onClick={() => !locked && props.onJump(node)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${
                    locked ? "opacity-45 cursor-not-allowed" : "hover:bg-white/10 cursor-pointer"
                  } ${node.id === props.selectedNodeId ? "bg-accent/15 ring-1 ring-accent/40" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-white/70 shrink-0" />
                    <span className="flex-1 text-label font-bold text-white truncate">
                      <Highlighted text={hit.title} query={query} />
                    </span>
                  </div>
                  <div className="text-caption text-white/55 line-clamp-2 leading-snug pl-5.5">
                    {hit.snippet}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 一章:编号路牌头(与地图 signpost 同视觉语言)+ 课时行。 */
function SearchSectionGroup({
  row,
  sectionIndex,
  query,
  progressMap,
  selectedNodeId,
  onPick,
}: {
  row: CourseTreeSection;
  sectionIndex: number;
  query: string;
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  onPick: (node: ContentNode) => void;
}) {
  const t = useLang();
  const isPractice = (row.section.world ?? "study") === "practice";
  return (
    <div data-testid={`search-section-${row.section.id.slice(0, 8)}`}>
      <div className="flex items-center gap-2 px-1.5 py-1">
        <span className="w-5 h-5 rounded-full bg-gold text-neutral-900 text-caption font-extrabold flex items-center justify-center shrink-0 ring-2 ring-gold/40">
          {sectionIndex + 1}
        </span>
        <span className="text-label font-bold text-white truncate flex-1">
          <Highlighted text={row.section.title} query={query} />
        </span>
        {isPractice && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-caption font-bold">
            {t("map.world.practice")}
          </span>
        )}
      </div>
      {row.lessons.map((lesson) => {
        const locked = isSearchRowLocked(lesson, progressMap, row.chapterLessonsMastered);
        const status = progressMap[lesson.id]?.status ?? "locked";
        const isExam = lesson.type === "exam";
        return (
          <button
            key={lesson.id}
            disabled={locked}
            data-testid={`search-row-${lesson.id.slice(0, 8)}`}
            onClick={() => !locked && onPick(lesson)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
              locked ? "opacity-45 cursor-not-allowed" : "hover:bg-white/10 cursor-pointer"
            } ${lesson.id === selectedNodeId ? "bg-accent/15 ring-1 ring-accent/40" : ""}`}
          >
            {locked ? (
              <Lock className="w-3.5 h-3.5 text-white/50 shrink-0" />
            ) : isExam ? (
              <Target className="w-3.5 h-3.5 text-accent shrink-0" />
            ) : status === "mastered" ? (
              <Crown className="w-3.5 h-3.5 text-gold shrink-0" />
            ) : (
              <BookOpen className="w-3.5 h-3.5 text-white/70 shrink-0" />
            )}
            <span className="flex-1 text-label text-white truncate">
              <Highlighted text={lesson.title} query={query} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 命中片段用 brand 色加粗(纯展示,定位逻辑在 findMatchRange)。 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const range = findMatchRange(text, query);
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <span className="text-brand font-extrabold">{text.slice(range[0], range[1])}</span>
      {text.slice(range[1])}
    </>
  );
}
