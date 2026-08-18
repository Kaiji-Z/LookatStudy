/**
 * conceptmap-layout —— 概念图径向布局(纯函数,v0.12 重设计)。
 *
 * 为什么放弃 dagre TB 分层:概念图的数据形态是"以一个中心概念展开的网",
 * dagre 是 DAG 流程图布局,对星形/网状会产出宽扁层 + 大量交叉边。
 * yFiles《知识图可视化指南》的选型规则:焦点实体的图用**径向(radial)**布局。
 * LLM 产物 ≤ 10 节点(harness 上限),径向树 + 交叉边曲线完全够用且确定可测。
 *
 * 设计规则(yFiles + impeccable Playful Product):
 *   - 节点大小 = 重要度:中心/高度数节点更大更粗(accent 描边),叶子节点收敛
 *   - 颜色只承载语义:hub 用 accent(交互/关联),其余中性面;不装饰
 *   - 文字两行自适应包裹(替代"14 字截断"),宽度按字符类别估算(中文宽/ASCII 窄)
 *   - 边 = 二次贝塞尔(轻弧度),标签胶囊宽度与文字同源估算,不再溢出
 *
 * 全部确定性(节点顺序驱动),verify-conceptmap-layout 直接断言。
 */

export interface CmNode {
  id: string;
  label: string;
}
export interface CmEdge {
  from: string;
  to: string;
  label?: string;
}

/** 字符宽度估算:text-label ≈13px;CJK 全宽,ASCII 约 0.58em,其余(BBOP…)同 ASCII。 */
export function estTextWidth(text: string, fontSize = 13): number {
  let w = 0;
  for (const ch of text) w += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? fontSize : fontSize * 0.58;
  return w;
}

const LINE_MAX_PX = 118; // 单行目标宽度(两行包裹的触发线)

/** 标签包裹:一行放得下 → 单行;否则在最接近中点的自然断点(空格/斜杠/连字符)拆两行;
 *  第二行仍超宽才截断加省略号。返回 ≤2 行。 */
export function wrapLabel(label: string): string[] {
  if (estTextWidth(label) <= LINE_MAX_PX) return [label];
  // 找自然断点(空格、/、-)位置集合
  const breaks: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (/[\s/\-—·]/.test(label[i] ?? "")) breaks.push(i);
  }
  const mid = label.length / 2;
  let split = -1;
  let best = Infinity;
  for (const b of breaks) {
    const d = Math.abs(b + 1 - mid);
    if (d < best) {
      best = d;
      split = b;
    }
  }
  let l1: string;
  let l2: string;
  if (split >= 0) {
    l1 = label.slice(0, split + 1).trim();
    l2 = label.slice(split + 1).trim();
  } else {
    // 无断点(CJK 连续):按宽度一半的字符数硬拆
    let acc = 0;
    let idx = 0;
    for (const ch of label) {
      acc += estTextWidth(ch);
      idx++;
      if (acc >= estTextWidth(label) / 2) break;
    }
    l1 = label.slice(0, idx);
    l2 = label.slice(idx);
  }
  // 单行就放得下的部分不再强行两行
  if (estTextWidth(l1) <= LINE_MAX_PX && estTextWidth(l2) <= LINE_MAX_PX) return [l1, l2];
  // 仍有超宽:截到放得下 + 省略号(这是兜底,QUALITY_GUIDE 已要求 label ≤ 8 字)
  const fit = (s: string) => {
    let out = "";
    for (const ch of s) {
      if (estTextWidth(out + ch + "…") > LINE_MAX_PX) break;
      out += ch;
    }
    return out + "…";
  };
  return [estTextWidth(l1) > LINE_MAX_PX ? fit(l1) : l1, estTextWidth(l2) > LINE_MAX_PX ? fit(l2) : l2];
}

export interface NodeBox {
  width: number;
  height: number;
  lines: string[];
  /** hub = 中心/高度数节点(视觉放大档) */
  hub: boolean;
}

/** 节点盒尺寸:按包裹后的行宽取最大行 + padding;hub 档更大。 */
export function nodeBox(label: string, hub: boolean): NodeBox {
  const lines = wrapLabel(label);
  const fs = hub ? 14 : 13;
  const textW = Math.max(...lines.map((l) => estTextWidth(l, fs)));
  const padX = hub ? 32 : 24;
  const lh = 17;
  const padY = hub ? 20 : 16;
  return {
    width: Math.min(hub ? 196 : 170, Math.max(hub ? 92 : 76, textW + padX)),
    height: padY + lines.length * lh,
    lines,
    hub,
  };
}

export interface Pt {
  x: number;
  y: number;
}
export interface RadialNode {
  id: string;
  center: Pt;
  box: NodeBox;
  degree: number;
  depth: number;
}
export interface RadialEdgeGeo {
  edge: CmEdge;
  /** 贝塞尔路径(SVG d) */
  d: string;
  /** 标签锚点(曲线 t=0.5) */
  labelPt: Pt;
}
export interface RadialLayout {
  nodes: Map<string, RadialNode>;
  edges: RadialEdgeGeo[];
  rootId: string;
  width: number;
  height: number;
}

const MARGIN = 28;
const RING_GAP = 52; // 相邻环之间净空(弧向)
const NODE_SEP = 34; // 同环节点间弧向净空

/** 径向布局:hub 居中,BFS 深度成环,子节点在父节点扇区内按叶数分角。 */
export function radialLayout(nodes: CmNode[], edges: CmEdge[]): RadialLayout {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  // 无向邻接(布局用);边去重(无向意义下)
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  const seenPair = new Set<string>();
  const drawEdges: CmEdge[] = [];
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
    drawEdges.push(e);
    const key = [e.from, e.to].sort().join("→");
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  const degree = (id: string) => adj.get(id)?.size ?? 0;

  // hub = 度数最大(平手取先出现)
  let rootId = nodes[0]?.id ?? "";
  for (const n of nodes) if (degree(n.id) > degree(rootId)) rootId = n.id;

  // BFS 生成树(确定性:邻居按节点表顺序)
  const order = new Map(ids.map((id, i) => [id, i] as const));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const n of nodes) children.set(n.id, []);
  const depth = new Map<string, number>();
  if (rootId) {
    depth.set(rootId, 0);
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of [...(adj.get(cur) ?? [])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
        if (depth.has(nb)) continue;
        depth.set(nb, (depth.get(cur) ?? 0) + 1);
        parent.set(nb, cur);
        children.get(cur)!.push(nb);
        queue.push(nb);
      }
    }
  }
  // 孤立节点(不连通):挂在最外环,扇区独立分配
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const orphans = nodes.filter((n) => !depth.has(n.id)).map((n) => n.id);
  for (const o of orphans) {
    depth.set(o, maxDepth + 1);
    parent.set(o, rootId);
    children.get(rootId)!.push(o);
  }
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);

  // 叶子数(扇区配重)
  const leafCount = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const cached = leafCount.get(id);
    if (cached != null) return cached;
    const kids = children.get(id) ?? [];
    const c = kids.length === 0 ? 1 : kids.reduce((s, k) => s + countLeaves(k), 0);
    leafCount.set(id, c);
    return c;
  };
  if (rootId) countLeaves(rootId);

  // 扇区分配:根的子节点平分整圆(起点 -90°=正上);深层在父扇区内按叶数分角
  const angle = new Map<string, number>();
  const assign = (id: string, start: number, span: number) => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const total = kids.reduce((s, k) => s + (leafCount.get(k) ?? 1), 0);
    let cur = start;
    for (const k of kids) {
      const childSpan = ((leafCount.get(k) ?? 1) / total) * span;
      angle.set(k, cur + childSpan / 2);
      assign(k, cur, childSpan);
      cur += childSpan;
    }
  };
  if (rootId) assign(rootId, -Math.PI / 2, Math.PI * 2);

  // 环半径:弧长容纳 + 环间距,取大
  const boxes = new Map<string, NodeBox>();
  for (const n of nodes) boxes.set(n.id, nodeBox(n.label, n.id === rootId || degree(n.id) >= 4));
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }
  const radii = new Map<number, number>();
  radii.set(0, 0);
  for (let d = 1; d <= maxDepth; d++) {
    const ring = byDepth.get(d) ?? [];
    if (ring.length === 0) {
      radii.set(d, radii.get(d - 1) ?? 0);
      continue;
    }
    const circ = ring.reduce((s, id) => s + (boxes.get(id)?.width ?? 0) + NODE_SEP, 0);
    const fit = circ / (Math.PI * 2);
    // 相邻角距的弦长约束:不同父的子节点扇区中心可能相邻,半径必须让相邻节点的
    // 弦距 ≥ 两盒半宽和 + 净空(仅按周长估弧长在节点少时不够 —— 弦 < 弧)
    const ringAngles = ring
      .map((id) => ({ id, a: angle.get(id) ?? 0 }))
      .sort((p, q) => p.a - q.a);
    let angularNeed = 0;
    if (ringAngles.length > 1) {
      for (let k = 0; k < ringAngles.length; k++) {
        const p = ringAngles[k];
        const q = ringAngles[(k + 1) % ringAngles.length];
        let dθ = q.a - p.a;
        if (k === ringAngles.length - 1) dθ += Math.PI * 2;
        if (dθ <= 0.01) continue; // 完全同角(极端兜底:交给周长约束)
        const D = ((boxes.get(p.id)?.width ?? 0) + (boxes.get(q.id)?.width ?? 0)) / 2 + NODE_SEP;
        angularNeed = Math.max(angularNeed, D / (2 * Math.sin(Math.min(Math.PI, dθ) / 2)));
      }
    }
    const prevR = radii.get(d - 1) ?? 0;
    const prevHalfH = Math.max(...(byDepth.get(d - 1) ?? []).map((id) => (boxes.get(id)?.height ?? 0) / 2), 0);
    const halfH = Math.max(...ring.map((id) => (boxes.get(id)?.height ?? 0) / 2));
    const single = ring.length === 1 ? 60 : 0;
    radii.set(d, Math.max(prevR + prevHalfH + halfH + RING_GAP, fit, angularNeed + single));
  }

  // 位置(先以原点为中心;extent 定边后整体平移,保证 hub 恒在画布正中)
  const layoutNodes = new Map<string, RadialNode>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const r = radii.get(d) ?? 0;
    const a = d === 0 ? 0 : (angle.get(n.id) ?? 0);
    layoutNodes.set(n.id, {
      id: n.id,
      center: { x: r * Math.cos(a), y: r * Math.sin(a) },
      box: boxes.get(n.id)!,
      degree: degree(n.id),
      depth: d,
    });
  }
  let extent = 0;
  for (const n of layoutNodes.values()) {
    extent = Math.max(extent, Math.abs(n.center.x) + n.box.width / 2, Math.abs(n.center.y) + n.box.height / 2);
  }
  const side = Math.ceil(2 * (extent + MARGIN));
  const shift = side / 2;
  for (const n of layoutNodes.values()) {
    n.center = { x: n.center.x + shift, y: n.center.y + shift };
  }

  // 边几何:矩形边框交点出发/到达,二次贝塞尔(轻弧),标签在曲线中点
  const edgeGeos: RadialEdgeGeo[] = [];
  const usedLabels: Array<{ pt: Pt; w: number }> = [];
  for (const e of drawEdges) {
    const a = layoutNodes.get(e.from);
    const b = layoutNodes.get(e.to);
    if (!a || !b) continue;
    const p0 = borderPoint(a, b.center);
    const p1 = borderPoint(b, a.center);
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bow = Math.min(34, Math.max(10, dist * 0.16));
    const ctrl = { x: mid.x + (dy / dist) * bow, y: mid.y - (dx / dist) * bow };
    let labelPt = { x: (p0.x + 2 * ctrl.x + p1.x) / 4, y: (p0.y + 2 * ctrl.y + p1.y) / 4 };
    // 标签避让:与已放置标签过近时沿法线挪开(≤10 边,一次线性扫描够)
    if (e.label) {
      const w = estTextWidth(e.label, 12) + 14;
      for (const used of usedLabels) {
        if (Math.hypot(labelPt.x - used.pt.x, labelPt.y - used.pt.y) < (w + used.w) / 2 + 6) {
          labelPt = { x: labelPt.x + (dy / dist) * 22, y: labelPt.y - (dx / dist) * 22 };
          break;
        }
      }
      usedLabels.push({ pt: labelPt, w });
    }
    edgeGeos.push({
      edge: e,
      d: `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
      labelPt,
    });
  }

  return {
    nodes: layoutNodes,
    edges: edgeGeos,
    rootId,
    width: Math.ceil(side),
    height: Math.ceil(side),
  };
}

/** 从节点中心指向 target 方向、与节点矩形边框的交点(边从框缘出发,不压字)。 */
function borderPoint(n: RadialNode, target: Pt): Pt {
  const dx = target.x - n.center.x;
  const dy = target.y - n.center.y;
  const hw = n.box.width / 2 + 3;
  const hh = n.box.height / 2 + 3;
  if (dx === 0 && dy === 0) return { x: n.center.x, y: n.center.y - hh };
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: n.center.x + dx * s, y: n.center.y + dy * s };
}

/** 边标签胶囊尺寸(与 estTextWidth 同源,修掉旧版 8px/字的溢出)。 */
export function labelPillSize(label: string): { width: number; height: number } {
  return { width: estTextWidth(label, 12) + 16, height: 19 };
}
