/**
 * 课程树搜索/导航纯函数 —— MapRail 搜索面板(CourseSearchPanel)用。
 *
 * 职责:分组(章节→课时,按 orderIdx)+ 多关键词 AND 过滤(章节命中→整章保留)
 * + 高亮区间 + 锁定计算(与地图球 MapNode 同一套规则,树里锁着的课时同样不可点)。
 * 纯函数:不碰 DOM/React,verify-course-search.mjs 直接测。
 */
import type { ContentNode, Progress } from "@shared/types";
import { UNLOCK_MASTERY_THRESHOLD } from "@shared/types";

/** 搜索面板的一"章":章节节点 + 排好序的子课时 + 考试解锁条件。 */
export interface CourseTreeSection {
  section: ContentNode;
  lessons: ContentNode[];
  /** 同 section 所有 lesson mastery ≥ 解锁线(考试解锁条件,与 MapSection 同规则) */
  chapterLessonsMastered: boolean;
}

/** 章节分组:sections 按 orderIdx 排,子课时(lesson+exam)按 orderIdx 排。 */
export function buildCourseTree(
  sections: ContentNode[],
  tree: ContentNode[],
  progressMap: Record<string, Progress>,
): CourseTreeSection[] {
  return [...sections]
    .sort((a, b) => a.orderIdx - b.orderIdx)
    .map((section) => {
      const lessons = tree
        .filter((n) => n.parentId === section.id)
        .sort((a, b) => a.orderIdx - b.orderIdx);
      const lessonNodes = lessons.filter((n) => n.type === "lesson");
      const chapterLessonsMastered =
        lessonNodes.length > 0 &&
        lessonNodes.every(
          (l) => (progressMap[l.id]?.mastery ?? 0) >= UNLOCK_MASTERY_THRESHOLD,
        );
      return { section, lessons, chapterLessonsMastered };
    });
}

/** 搜索行是否锁定(与 MapNode 同规则:考试看整章通关,普通课看 status)。 */
export function isSearchRowLocked(
  node: ContentNode,
  progressMap: Record<string, Progress>,
  chapterLessonsMastered: boolean,
): boolean {
  if (node.type === "exam") return !chapterLessonsMastered;
  return (progressMap[node.id]?.status ?? "locked") === "locked";
}

/**
 * 多关键词 AND 过滤(不区分大小写,子串;空格分词,与 searchContent 语义一致)。
 * 章节标题命中 → 整章(含全部课时)保留;否则只留标题命中的课时,无命中的章丢弃。
 * 空查询 → 原样返回(树状导航模式)。
 */
export function filterCourseTree(
  rows: CourseTreeSection[],
  rawQuery: string,
): CourseTreeSection[] {
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  const matchAll = (text: string) => {
    const low = text.toLowerCase();
    return terms.every((term) => low.includes(term));
  };
  return rows
    .map((row) => {
      if (matchAll(row.section.title)) return row;
      const lessons = row.lessons.filter((l) => matchAll(l.title));
      return lessons.length > 0 ? { ...row, lessons } : null;
    })
    .filter((r): r is CourseTreeSection => r !== null);
}

/** 首个关键词在标题中的命中区间(渲染高亮用);未命中/空查询返回 null。 */
export function findMatchRange(
  title: string,
  rawQuery: string,
): [number, number] | null {
  const first = rawQuery.trim().split(/\s+/).filter(Boolean)[0];
  if (!first) return null;
  const idx = title.toLowerCase().indexOf(first.toLowerCase());
  return idx >= 0 ? [idx, idx + first.length] : null;
}
