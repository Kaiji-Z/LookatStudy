/**
 * mapLayout —— 选关地图节点布局引擎(纯函数,易测易调)。
 *
 * v0.6:从"三布局模式 + 手动切换器"重做为单一"漂浮气球"布局。
 * 节点像飘在空中的气球,位置带轻微种子确定性抖动(用 section id 哈希),
 * 每次渲染位置完全一致,不会乱跳,但又不整齐规整。
 * 连接用下垂的贝塞尔绳子(模拟重力),不再是 S 形箭头。
 *
 * 坐标系:相对章节容器左上角(0,0),x 横向 y 纵向,单位 px。
 * 节点尺寸:球 56px(w-14 h-14),卡片宽 110px(含名字)。
 */

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
const NODE_SPACING_Y = 96; // 节点间纵向间距(含名字行 ~20px);v0.6 加大留漂浮空间
const BALLOON_MARGIN = 18; // 气球左右留白(减小让抖动幅度更明显,不再呆板直线)
/** 绳子下垂量(px,模拟重力)。让贝塞尔像被拽下来的绳子,而非 S 形箭头。 */
const ROPE_SAG = 22;
/** y 轴抖动幅度(px),让气球高低参差而非排成一列。与 NODE_SPACING_Y 协调(不超半距防重叠)。 */
const Y_JITTER = 30;

/**
 * 确定性字符串哈希(FNV-1a 变体,32-bit)。
 * 同输入永远同输出 → 同一节点 id 每次渲染算出的抖动相同 → 气球位置稳定不跳。
 * 用于气球横向抖动 + bob 相位 + 星点位置 + 天体色切。
 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 等价 h *= 16777619,用 Math.imul 避免 32-bit 溢出丢精度
    h = Math.imul(h, 0x01000193);
  }
  // 雪崩搅拌(avalanche finalizer):FNV-1a 对"末位递增"输入(seed:0, seed:1, seed:2…)
  // 输出近乎线性相关 → 相邻气球哈希接近 → 排成直线。加 xorshift + imul 搅拌彻底打散。
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 算某 section 的气球节点坐标 + 绳子连接路径。
 * 容器高度由 nodes 数量决定(调用方据此设容器 min-height)。
 *
 * 抖动算法:v0.6 同时在 x 和 y 两轴抖动 → 气球真正"飘"在空中,
 * 不再是呆板的直线/微弯列。x 大幅抖动(用满容器宽度),y 在基线上下 ±Y_JITTER。
 * 两个独立哈希(x 用 seed:i,y 用 seed:i:y)→ 抖动方向不相关,分布更自然。
 */
export function computeBalloonLayout(
  lessonCount: number,
  containerWidth: number = CONTAINER_WIDTH,
  seed: string = "",
): SectionLayout {
  const nodes: NodeLayout[] = [];
  const centerX = containerWidth / 2;
  const maxDrift = containerWidth / 2 - BALLOON_MARGIN - NODE_RADIUS;

  for (let i = 0; i < lessonCount; i++) {
    const baseY = NODE_RADIUS + i * NODE_SPACING_Y + 10; // 顶部 10px 留白
    // x 抖动:哈希归一化到 [-1,1],×maxDrift → 大幅左右飘
    const hx = hashStr(`${seed}:${i}`);
    const normX = (hx / 0xffffffff) * 2 - 1; // [-1, 1]
    const x = centerX + normX * maxDrift;
    // y 抖动:另一独立哈希,±Y_JITTER 围绕基线 → 高低参差
    const hy = hashStr(`${seed}:${i}:y`);
    const normY = (hy / 0xffffffff) * 2 - 1; // [-1, 1]
    const y = baseY + normY * Y_JITTER;
    nodes.push({ x, y, index: i });
  }

  // 绳子段:相邻节点
  const segments: PathSegment[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    segments.push({ from: nodes[i]!, to: nodes[i + 1]!, index: i });
  }

  return { nodes, segments };
}

/** 容器需要的最小高度(供 MapSection 设 min-height,SVG 撑满)。
 *  v0.6 含 y 抖动余量(顶部+底部各 Y_JITTER,防边缘节点被裁)。 */
export function sectionHeight(lessonCount: number): number {
  if (lessonCount === 0) return 40;
  return NODE_RADIUS * 2 + (lessonCount - 1) * NODE_SPACING_Y + 40 + Y_JITTER * 2;
}

/**
 * 两节点间的绳子贝塞尔(下垂)。
 * 控制点:y 中点 + ROPE_SAG(向下垂,模拟重力);x 用各自端点 x。
 * 比原 S 形软,像被拽下来的绳子。
 */
export function balloonSegmentToPath(seg: PathSegment): string {
  const { from, to } = seg;
  const controlY = (from.y + to.y) / 2 + ROPE_SAG;
  return `M ${from.x} ${from.y} C ${from.x} ${controlY}, ${to.x} ${controlY}, ${to.x} ${to.y}`;
}
