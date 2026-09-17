/**
 * next-lesson —— 下一课排序(v0.37 课程推进边界卡)。
 *
 * 边界卡设计(用户拍板 2026-09-17):一课掌握毕业(!wasMastered 过渡)时出卡,
 * 点「开始下一课」伴学飞到左栏下一颗球旁指向+虚线环标记,由学习者自己点球
 * 进入——bot 指路、用户开车,仪式感留在地图。本模块是"下一课是谁"的唯一
 * 真源(纯函数,verify-next-lesson 直测):同 section 按 orderIdx 顺延,段末
 * 接下一段首课,最后一课毕业返回 null(终点态卡)。
 *
 * 排序权在系统不在 LLM:agent 不参与节点排序(防跳过复习/自作主张跳章)。
 */

/** 树节点最小形状(App 的课程树节点子集,只取排序要用的字段)。 */
export interface NextLessonNode {
  id: string;
  type: string;
  parentId: string | null;
  orderIdx: number;
}

/**
 * 毕业节点的下一课(同段顺延→下一段首课→null 终点)。
 * - completedId 不在树里(切课竞态/异课程事件)→ null,不出卡;
 * - 段间跳跃只落向**有课的下一段**(空段跳过),段序按 orderIdx。
 */
export function nextLessonAfter<T extends NextLessonNode>(nodes: T[], completedId: string): T | null {
  const completed = nodes.find((n) => n.id === completedId && n.type !== "section");
  if (!completed) return null;

  const sections = nodes
    .filter((n) => n.type === "section")
    .sort((a, b) => a.orderIdx - b.orderIdx);
  const lessonsOf = (sectionId: string | null) =>
    nodes
      .filter((n) => n.type !== "section" && n.parentId === sectionId)
      .sort((a, b) => a.orderIdx - b.orderIdx);

  // 同段顺延
  const sibling = lessonsOf(completed.parentId).find((l) => l.orderIdx > completed.orderIdx);
  if (sibling) return sibling;

  // 段末:接下一段(跳过空段)的首课
  const secIdx = sections.findIndex((s) => s.id === completed.parentId);
  for (let i = secIdx + 1; i < sections.length; i++) {
    const first = lessonsOf(sections[i].id)[0];
    if (first) return first;
  }
  return null;
}
