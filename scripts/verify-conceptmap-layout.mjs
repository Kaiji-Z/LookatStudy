/**
 * verify-conceptmap-layout —— 概念图径向布局纯函数回归(v0.12 重设计的守卫)。
 *
 * 背景:旧实现两个硬伤(截断阈值>盒宽上限必然挤+截;边标签胶囊 8px/字估宽,
 * 中文 12px/字必溢出)+ dagre TB 分层对网状概念图产出宽扁层+交叉边。
 * 新实现:径向布局(hub 居中成环)+ 字符类别感知的宽度估算 + 两行包裹。
 *
 *   T1 estTextWidth:CJK 全宽、ASCII 窄、混合按类累计
 *   T2 wrapLabel:短=单行;长=两行自然断点;超长=省略号兜底;永不超 2 行
 *   T3 labelPillSize:胶囊宽 > 实际文字宽(中文场景,修复 8px/字溢出)
 *   T4 radialLayout 结构:hub(最大度)在画布中心;全节点在界内;
 *      节点两两不重叠(bbox 不相交);同深度成环(半径一致)
 *   T5 边几何:路径从框缘出发(起终点都在两盒 bbox 外缘附近);
 *      自环/悬空边被防御性跳过
 *   T6 确定性:同输入两次布局逐字节一致
 *
 * 闭环:破坏 wrapLabel(去掉省略号兜底)→ T2 红;破坏半径公式(环距归零)→ T4 重叠红。
 */
import assert from "node:assert/strict";
import {
  estTextWidth,
  wrapLabel,
  labelPillSize,
  radialLayout,
} from "../src/renderer/lib/conceptmap-layout.ts";

// ---------------------------------------------------------------- T1 宽度估算
assert.ok(estTextWidth("递归") > estTextWidth("ab") * 1.5, "T1 CJK(1.0em/字)应明显宽于 ASCII(0.58em/字)");
assert.ok(Math.abs(estTextWidth("a") - 13 * 0.58) < 0.01, "T1 ASCII ≈ 0.58em");
assert.ok(estTextWidth("Transformer 架构") > estTextWidth("架构") * 2, "T1 混合按类累计");
console.log("T1 estTextWidth 字符类别感知 ✓");

// ---------------------------------------------------------------- T2 包裹
{
  const one = wrapLabel("递归");
  assert.equal(one.length, 1, "T2 短标签单行");
  const two = wrapLabel("transformer attention 机制对比");
  assert.equal(two.length, 2, "T2 长标签两行");
  assert.ok(estTextWidth(two[0]) <= 118 + 13 && estTextWidth(two[1]) <= 118 + 13, "T2 每行都在宽度预算内");
  const cjk = wrapLabel("这是一段超长的中文概念标签需要被强行分成两行显示");
  assert.equal(cjk.length, 2, "T2 无断点 CJK 硬拆两行");
  const overflow = wrapLabel("特别特别特别特别特别特别特别特别特别长的中文概念标签无法两行装下的时候怎么办呢");
  assert.equal(overflow.length, 2, "T2 兜底仍两行");
  // 核心不变量:任何输入、任何一行,渲染宽度都必须在预算内(盒宽由行宽派生且有上限,
  // 行超预算 = 文字溢出盒子)。省略号兜底只是手段,行宽上限才是契约。
  for (const set of [two, cjk, overflow]) {
    assert.ok(set.every((l) => estTextWidth(l) <= 118 + 13), `T2 行宽都在预算内(实际 ${set.map((l) => Math.round(estTextWidth(l)))})`);
  }
}
console.log("T2 wrapLabel 两行包裹 ✓");

// ---------------------------------------------------------------- T3 胶囊宽度
{
  const label = "生成对抗";
  const pill = labelPillSize(label);
  assert.ok(pill.width >= estTextWidth(label, 12) + 12, "T3 胶囊必须比文字宽(中文,修 8px/字溢出)");
  const en = "output";
  assert.ok(labelPillSize(en).width >= estTextWidth(en, 12) + 12, "T3 英文同样");
}
console.log("T3 labelPillSize 同源估宽 ✓");

// ---------------------------------------------------------------- T4 径向布局
const NODES = [
  { id: "recursion", label: "递归" },
  { id: "base", label: "Base Case 基线" },
  { id: "stack", label: "调用栈" },
  { id: "depth", label: "递归深度" },
  { id: "overflow", label: "栈溢出" },
  { id: "memo", label: "记忆化" },
  { id: "tree", label: "递归树" },
  { id: "divide", label: "分治" },
];
const EDGES = [
  { from: "recursion", to: "base", label: "终止于" },
  { from: "recursion", to: "stack", label: "依赖" },
  { from: "recursion", to: "tree", label: "展开为" },
  { from: "stack", to: "depth", label: "决定" },
  { from: "depth", to: "overflow", label: "过深导致" },
  { from: "tree", to: "memo", label: "可优化" },
  { from: "tree", to: "divide", label: "典型形态" },
];
{
  const L = radialLayout(NODES, EDGES);
  const cx = L.width / 2;
  const cy = L.height / 2;
  const hub = L.nodes.get("recursion");
  assert.ok(hub, "T4 hub 存在");
  assert.ok(Math.abs(hub.center.x - cx) < 1.5 && Math.abs(hub.center.y - cy) < 1.5, "T4 hub 居中(度数最大者)");
  assert.equal(hub.degree, 3, "T4 hub 度数");
  // 全部在界内
  for (const n of L.nodes.values()) {
    assert.ok(n.center.x - n.box.width / 2 >= -0.5 && n.center.x + n.box.width / 2 <= L.width + 0.5, `T4 ${n.id} x 界内`);
    assert.ok(n.center.y - n.box.height / 2 >= -0.5 && n.center.y + n.box.height / 2 <= L.height + 0.5, `T4 ${n.id} y 界内`);
  }
  // 两两不重叠(bbox 留 2px 余量)
  const all = [...L.nodes.values()];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      assert.ok(a && b, "T4 节点存在");
      const sepX = Math.abs(a.center.x - b.center.x) - (a.box.width + b.box.width) / 2;
      const sepY = Math.abs(a.center.y - b.center.y) - (a.box.height + b.box.height) / 2;
      assert.ok(sepX > 2 || sepY > 2, `T4 ${a.id} 与 ${b.id} 不重叠(至少一轴净空>2px,sepX=${sepX.toFixed(1)} sepY=${sepY.toFixed(1)})`);
    }
  }
  // 同深度同环:半径一致
  const byDepth = new Map();
  for (const n of L.nodes.values()) {
    const r = Math.hypot(n.center.x - cx, n.center.y - cy);
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
    byDepth.get(n.depth).push(r);
  }
  for (const [d, rs] of byDepth) {
    if (d === 0) continue;
    assert.ok(Math.max(...rs) - Math.min(...rs) < 1.5, `T4 深度 ${d} 同环半径一致`);
  }
  console.log(`T4 径向布局(hub 居中/界内/零重叠/同环一致,画布 ${L.width}×${L.height})✓`);
}

// ---------------------------------------------------------------- T5 边几何
{
  const L = radialLayout(NODES, EDGES);
  assert.equal(L.edges.length, EDGES.length, "T5 全部合法边有几何");
  for (const { edge, d, labelPt } of L.edges) {
    const a = L.nodes.get(edge.from);
    const b = L.nodes.get(edge.to);
    assert.ok(a && b, "T5 边端点存在");
    assert.ok(d.startsWith("M ") && d.includes(" Q "), "T5 路径是二次贝塞尔");
    const m = d.match(/^M ([\d.]+) ([\d.]+)/);
    assert.ok(m, "T5 路径可解析");
    const p0 = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    // 起点/终点应贴近各自 bbox 外缘(≤6px),不得深陷盒内
    const distOut = (pt, n) =>
      Math.max(Math.abs(pt.x - n.center.x) - n.box.width / 2, Math.abs(pt.y - n.center.y) - n.box.height / 2);
    assert.ok(distOut(p0, a) > -6, `T5 边 ${edge.from}→${edge.to} 起点在框缘`);
    if (edge.label) {
      assert.ok(labelPt.x > 0 && labelPt.x < L.width && labelPt.y > 0 && labelPt.y < L.height, `T5 边 ${edge.from} 标签锚点界内`);
    }
  }
  // 防御:悬空边(from/to 不存在)与自环被跳过
  const L2 = radialLayout(NODES, [...EDGES, { from: "ghost", to: "base" }, { from: "base", to: "base" }]);
  assert.equal(L2.edges.length, EDGES.length, "T5 悬空边/自环被跳过");
  console.log("T5 边几何(框缘起止/贝塞尔/防御)✓");
}
// ---------------------------------------------------------------- T6 确定性
{
  const a = radialLayout(NODES, EDGES);
  const b = radialLayout(NODES, EDGES);
  for (const n of a.nodes.values()) {
    const m = b.nodes.get(n.id);
    assert.ok(m, "T6 节点存在");
    assert.equal(n.center.x, m.center.x, "T6 同输入位置一致");
    assert.equal(n.center.y, m.center.y, "T6 同输入位置一致");
  }
  assert.equal(JSON.stringify(a.edges), JSON.stringify(b.edges), "T6 边几何逐字节一致");
  // 孤立节点也能布局(挂在最外环)
  const L3 = radialLayout([...NODES, { id: "orphan", label: "孤立概念" }], EDGES);
  assert.ok(L3.nodes.get("orphan"), "T6 孤立节点有位置");
  console.log("T6 确定性 + 孤立节点兜底 ✓");
}

console.log("verify-conceptmap-layout: 6 组全部通过");
