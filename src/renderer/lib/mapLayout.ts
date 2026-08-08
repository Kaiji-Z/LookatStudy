/**
 * mapLayout —— 选关地图节点布局引擎(纯函数,易测易调)。
 *
 * v0.3.5:从 MapRail 的 inline `index % 2` 之字形抽出来,支持多布局模式。
 * 返回每个节点(相对章节容器的)相对坐标 + 连接路径定义,SVG 用绝对像素绘制
 * (修原 bug:旧代码把 % 拼进 SVG path d 值,非法单位,节点与路径对不齐)。
 *
 * 三种布局(用户可切,按 lessons 数量自动选默认):
 *   - zigzag(默认,≥5 课):左右交替蜿蜒,Duolingo 经典
 *   - linear(≤4 课或手动选):中轴直线,短章节清晰
 *   - compact(手动选):双列紧凑,章节内课多时省纵向空间
 *
 * 坐标系:相对章节容器左上角(0,0),x 横向 y 纵向,单位 px。
 * 节点尺寸:球 56px(w-14 h-14),卡片宽 110px(含名字)。
 * MapSection 用 useLayoutEffect 测量实际 DOM 后画 SVG(见 mapLayoutToPaths)。
 */

export type MapLayoutMode = "zigzag" | "linear" | "compact";

/** 单个节点的布局结果(相对章节容器)。 */
export interface NodeLayout {
  /** 节点中心 x(px,相对章节容器左上) */
  x: number;
  /** 节点中心 y(px) */
  y: number;
  /** 该节点在 lessons 数组里的索引 */
  index: number;
}

/** 两节点间的连接段(供 SVG path 绘制)。 */
export interface PathSegment {
  /** 起点(上一节点中心) */
  from: { x: number; y: number };
  /** 终点(下一节点中心) */
  to: { x: number; y: number };
  /** 段索引(from 节点的 index) */
  index: number;
}

export interface SectionLayout {
  nodes: NodeLayout[];
  segments: PathSegment[];
}

/** 容器宽度(章节内可用宽度,扣除 padding)。MapRail 章节容器 px-2。 */
const CONTAINER_WIDTH = 268; // 300px rail - padding
const NODE_RADIUS = 28; // w-14 h-14 = 56px,半径 28
const NODE_SPACING_Y = 84; // 节点间纵向间距(含名字行 ~20px)
const ZIGZAG_MARGIN = 40; // 之字形左右留白

/**
 * 算某布局下某 section 的节点坐标 + 连接路径。
 * 容器高度由 nodes 数量决定(调用方据此设容器 min-height)。
 */
export function computeSectionLayout(
  lessonCount: number,
  mode: MapLayoutMode,
  containerWidth: number = CONTAINER_WIDTH,
): SectionLayout {
  const nodes: NodeLayout[] = [];
  const centerX = containerWidth / 2;

  for (let i = 0; i < lessonCount; i++) {
    const y = NODE_RADIUS + i * NODE_SPACING_Y + 10; // 顶部 10px 留白
    let x = centerX;
    if (mode === "zigzag") {
      // 左右交替:偶数偏左,奇数偏右(对称于中轴)
      const offset = (containerWidth / 2) - ZIGZAG_MARGIN - NODE_RADIUS;
      x = i % 2 === 0 ? centerX - offset : centerX + offset;
    } else if (mode === "linear") {
      x = centerX; // 全在中轴
    } else {
      // compact:双列紧凑(左列偶数,右列奇数),纵向间距减半
      const compactY = NODE_RADIUS + Math.floor(i / 2) * (NODE_SPACING_Y * 0.7) + 10;
      const offset = (containerWidth / 2) - ZIGZAG_MARGIN - NODE_RADIUS;
      x = i % 2 === 0 ? centerX - offset : centerX + offset;
      nodes.push({ x, y: compactY, index: i });
      continue;
    }
    nodes.push({ x, y, index: i });
  }

  // 连接段:相邻节点
  const segments: PathSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segments.push({ from: nodes[i]!, to: nodes[i + 1]!, index: i });
  }

  return { nodes, segments };
}

/** 容器需要的最小高度(供 MapSection 设 min-height,SVG 撑满)。 */
export function sectionHeight(lessonCount: number, mode: MapLayoutMode): number {
  if (lessonCount === 0) return 40;
  if (mode === "compact") {
    const rows = Math.ceil(lessonCount / 2);
    return NODE_RADIUS * 2 + (rows - 1) * (NODE_SPACING_Y * 0.7) + 40;
  }
  return NODE_RADIUS * 2 + (lessonCount - 1) * NODE_SPACING_Y + 40;
}

/**
 * 两点间平滑贝塞尔路径(S 形过渡)。
 * 控制点:取两点 y 中点,水平方向用各自 x → 平滑 S 曲线。
 */
export function segmentToPath(seg: PathSegment): string {
  const { from, to } = seg;
  const midY = (from.y + to.y) / 2;
  // 三次贝塞尔:两个控制点都在中点 y,x 分别用起终点 x
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}

/** 按 lessons 数量推荐默认布局(用户可手动覆盖,持久化在 localStorage)。 */
export function recommendMode(lessonCount: number): MapLayoutMode {
  if (lessonCount <= 4) return "linear";
  return "zigzag";
}

/** 布局模式中文标签 + 图标标识(供切换 UI)。 */
export const LAYOUT_MODES: { mode: MapLayoutMode; label: string; icon: string }[] = [
  { mode: "zigzag", label: "蜿蜒", icon: "〰️" },
  { mode: "linear", label: "直线", icon: "│" },
  { mode: "compact", label: "紧凑", icon: "▦" },
];
