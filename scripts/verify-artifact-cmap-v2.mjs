/**
 * verify-artifact-cmap-v2 —— 概念图 ELK 布局回归(v0.21 重设计的守卫)。
 *
 * 背景:v0.12 径向布局视觉评审五宗罪(空白与拥挤并存/边交叉/无层级/单色调/
 * 标签弱),v0.21 换 elkjs(draw.io 新版同款引擎):复合分组 + 正交路由。
 *
 *   T1 文本度量:CJK 全宽/ASCII 窄;wrapLabel ≤2 行且行宽在预算内(迁移自旧套)
 *   T2 resolveGroups:LLM groups 净化(未知 id/跨组重复/<2 成员丢弃;单组全覆盖
 *      视为无效);缺省 → clusterByAdjacency 兜底(1-3 组、每组 ≥2、确定性、
 *      孤立节点不归组、小组太少不分组)
 *   T3 buildElkGraph:复合结构(组盒 g: 前缀挂 children)、节点尺寸=cmNodeBox
 *      取整、正交路由选项、悬空边/自环/重复边防御
 *   T4 端到端(真 elkjs):确定性(两次运行逐字节一致)/节点两两零重叠(含跨组)/
 *      组容器包含全部成员盒(含标题栏留白)/全节点界内/边折线与标签锚点界内/
 *      hub=最大度数节点
 *   T5 边界:空图/1 节点/2 节点/15 节点密集(20 边含交叉)/孤立节点 —— 不炸且不变量成立
 *
 * 闭环:破坏 flattenElkResult(组内子节点丢组偏移)→ T4 包含断言红;
 *      破坏 resolveGroups(永远单组全覆盖)→ T2 兜底断言红。
 */
import assert from "node:assert/strict";
import {
  estTextWidth,
  wrapLabel,
  cmNodeBox,
  resolveGroups,
  clusterByAdjacency,
  buildElkGraph,
  layoutConceptMap,
  GROUP_TITLE_PX,
} from "../src/renderer/lib/cmap-elk-layout.ts";

// ---------------------------------------------------------------- T1 文本度量
assert.ok(estTextWidth("递归") > estTextWidth("ab") * 1.5, "T1 CJK(1.0em/字)应明显宽于 ASCII(0.58em/字)");
assert.ok(Math.abs(estTextWidth("a") - 13 * 0.58) < 0.01, "T1 ASCII ≈ 0.58em");
{
  const one = wrapLabel("递归");
  assert.equal(one.length, 1, "T1 短标签单行");
  const two = wrapLabel("transformer attention 机制对比");
  assert.equal(two.length, 2, "T1 长标签两行");
  const overflow = wrapLabel("特别特别特别特别特别特别特别特别特别长的中文概念标签无法两行装下的时候怎么办呢");
  assert.equal(overflow.length, 2, "T1 兜底仍两行");
  for (const set of [two, overflow]) {
    assert.ok(set.every((l) => estTextWidth(l) <= 118 + 13), `T1 行宽都在预算内(实际 ${set.map((l) => Math.round(estTextWidth(l)))})`);
  }
  const box = cmNodeBox("梯度下降", true);
  assert.ok(box.width >= 92 && box.height >= 30, "T1 hub 盒有下限");
}
console.log("T1 文本度量(CJK 估宽/两行包裹/盒下限)✓");

// ---------------------------------------------------------------- 测试数据
const NODES = [
  { id: "gd", label: "梯度下降" },
  { id: "lr", label: "学习率" },
  { id: "loss", label: "损失函数" },
  { id: "grad", label: "梯度" },
  { id: "conv", label: "收敛" },
  { id: "local_min", label: "局部最优" },
  { id: "decay", label: "学习率衰减" },
];
const EDGES = [
  { from: "gd", to: "loss", label: "最小化" },
  { from: "gd", to: "grad", label: "沿负方向" },
  { from: "gd", to: "conv", label: "目标" },
  { from: "lr", to: "gd", label: "步长" },
  { from: "lr", to: "local_min", label: "过大陷入" },
  { from: "decay", to: "lr", label: "动态调整" },
  { from: "grad", to: "loss", label: "是…的斜率" },
  { from: "local_min", to: "conv", label: "可能停在" },
];
const GROUPS = [
  { id: "core", label: "核心循环", nodeIds: ["gd", "grad", "loss"] },
  { id: "lr_family", label: "学习率家族", nodeIds: ["lr", "decay"] },
  { id: "bad", label: "无效组", nodeIds: ["conv", "ghost"] }, // ghost 不存在 → 净化后剩 1 人 → 丢弃
];

// ---------------------------------------------------------------- T2 分组解析
{
  const r = resolveGroups(NODES, EDGES, GROUPS);
  assert.equal(r.fallback, false, "T2 有效输入不走兜底");
  assert.equal(r.groups.length, 2, "T2 无效组被丢弃(ghost 净化后 <2)");
  assert.deepEqual(
    r.groups[0]?.nodeIds,
    ["gd", "grad", "loss"],
    "T2 未知 nodeId 被剔除,合法组保序",
  );
  // 跨组重复:先到先得;被榨干(<2)的组整体丢弃
  const dup = resolveGroups(NODES, EDGES, [
    { id: "a", label: "甲", nodeIds: ["gd", "lr"] },
    { id: "b", label: "乙", nodeIds: ["gd", "loss", "conv"] },
  ]);
  assert.equal(dup.groups.length, 2, "T2 两组都活");
  assert.deepEqual(dup.groups[1]?.nodeIds, ["loss", "conv"], "T2 跨组重复成员被剔除(先到先得)");
  const starved = resolveGroups(NODES, EDGES, [
    { id: "a", label: "甲", nodeIds: ["gd", "lr"] },
    { id: "b", label: "乙", nodeIds: ["gd", "loss"] },
  ]);
  assert.equal(starved.groups.length, 1, "T2 被榨干的组(<2 成员)整体丢弃");
  // 单组全覆盖 = 无效 → 兜底
  const single = resolveGroups(NODES, EDGES, [{ id: "all", label: "全部", nodeIds: NODES.map((n) => n.id) }]);
  assert.equal(single.fallback, true, "T2 单组全覆盖触发兜底");
  // 缺省 → 兜底聚类
  const fb = resolveGroups(NODES, EDGES, null);
  assert.equal(fb.fallback, true, "T2 缺省走兜底");
  assert.ok(fb.groups.length >= 1 && fb.groups.length <= 3, "T2 兜底组数 1-3");
  for (const g of fb.groups) assert.ok(g.nodeIds.length >= 2, `T2 兜底组 ${g.id} ≥2 成员`);
  // 兜底确定性
  assert.deepEqual(clusterByAdjacency(NODES, EDGES), clusterByAdjacency(NODES, EDGES), "T2 聚类确定性");
  // 孤立节点不归组
  const withOrphan = [...NODES, { id: "orphan", label: "孤立概念" }];
  const fb2 = resolveGroups(withOrphan, EDGES, null);
  assert.ok(fb2.groups.every((g) => !g.nodeIds.includes("orphan")), "T2 孤立节点不归组");
  // 太小不分组
  assert.deepEqual(clusterByAdjacency(NODES.slice(0, 3), EDGES), [], "T2 <4 节点不分组");
  // 全孤立 → 无组
  const loners = [
    { id: "a", label: "甲" },
    { id: "b", label: "乙" },
    { id: "c", label: "丙" },
    { id: "d", label: "丁" },
  ];
  assert.deepEqual(clusterByAdjacency(loners, []), [], "T2 全孤立无组");
}
console.log("T2 分组解析(LLM 净化/兜底聚类/确定性/孤立防御)✓");

// ---------------------------------------------------------------- T3 ELK 图构建
{
  const { groups } = resolveGroups(NODES, EDGES, GROUPS);
  const g = buildElkGraph(NODES, EDGES, groups);
  assert.equal(g.id, "root", "T3 根节点");
  assert.equal(g.layoutOptions?.["elk.edgeRouting"], "ORTHOGONAL", "T3 正交路由");
  assert.equal(g.layoutOptions?.["elk.algorithm"], "layered", "T3 layered 算法");
  const groupChildren = (g.children ?? []).filter((c) => c.id.startsWith("g:"));
  assert.equal(groupChildren.length, 2, "T3 组盒复合挂载");
  const grouped = new Set(groupChildren.flatMap((c) => (c.children ?? []).map((n) => n.id)));
  assert.deepEqual([...grouped].sort(), ["decay", "gd", "grad", "loss", "lr"], "T3 组内成员正确");
  // 未分组节点在根层
  const rootNodes = (g.children ?? []).filter((c) => !c.id.startsWith("g:")).map((c) => c.id);
  assert.deepEqual(rootNodes.sort(), ["conv", "local_min"], "T3 未分组节点挂根层");
  // 节点尺寸 = cmNodeBox 取整
  const gdChild = groupChildren.flatMap((c) => c.children ?? []).find((n) => n.id === "gd");
  assert.ok(gdChild, "T3 gd 子节点存在");
  const want = cmNodeBox("梯度下降", true);
  assert.equal(gdChild.width, Math.ceil(want.width), "T3 节点宽=cmNodeBox 取整");
  assert.equal(gdChild.height, Math.ceil(want.height), "T3 节点高=cmNodeBox 取整");
  // 组盒 padding 为标题栏留白
  assert.equal(groupChildren[0]?.layoutOptions?.["elk.padding"], `[top=${GROUP_TITLE_PX},left=14,bottom=12,right=14]`, "T3 组盒标题栏 padding");
  // 防御:悬空/自环/重复边
  const g2 = buildElkGraph(
    NODES,
    [...EDGES, { from: "ghost", to: "gd" }, { from: "gd", to: "gd" }, { from: "lr", to: "gd" }],
    groups,
  );
  assert.equal((g2.edges ?? []).length, EDGES.length, "T3 悬空/自环/重复(无向)边被跳过");
}
console.log("T3 buildElkGraph(复合结构/尺寸同源/标题栏/防御)✓");

// ---------------------------------------------------------------- T4 端到端(真 elkjs)
const overlap = (a, b) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w - 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 2;

async function assertInvariants(L, tag) {
  // 全节点界内
  for (const n of L.nodes) {
    assert.ok(n.x >= -1 && n.y >= -1 && n.x + n.w <= L.width + 1 && n.y + n.h <= L.height + 1, `T4 ${tag} 节点 ${n.id} 界内`);
  }
  // 两两零重叠(含跨组)
  for (let i = 0; i < L.nodes.length; i++) {
    for (let j = i + 1; j < L.nodes.length; j++) {
      const a = L.nodes[i];
      const b = L.nodes[j];
      assert.ok(a && b, `T4 ${tag} 节点存在`);
      assert.ok(!overlap(a, b), `T4 ${tag} 节点 ${a.id} 与 ${b.id} 不重叠(a=${JSON.stringify(a)} b=${JSON.stringify(b)})`);
    }
  }
  // 组容器包含全部成员盒(容许 1px 容差)
  for (const g of L.groups) {
    const members = L.nodes.filter((n) => n.groupId === g.id);
    assert.ok(members.length >= 1, `T4 ${tag} 组 ${g.id} 非空`);
    for (const m of members) {
      assert.ok(
        m.x >= g.x - 1 && m.y >= g.y - 1 && m.x + m.w <= g.x + g.w + 1 && m.y + m.h <= g.y + g.h + 1,
        `T4 ${tag} 组 ${g.id} 包含成员 ${m.id}(组=${JSON.stringify(g)} 成员=${JSON.stringify(m)})`,
      );
    }
  }
  // 边折线与标签界内
  for (const e of L.edges) {
    assert.ok(e.pts.length >= 2, `T4 ${tag} 边 ${e.from}→${e.to} 至少起终点两段`);
    for (const p of e.pts) {
      assert.ok(p.x >= -1 && p.y >= -1 && p.x <= L.width + 1 && p.y <= L.height + 1, `T4 ${tag} 边 ${e.from} 折线界内`);
    }
    if (e.label) {
      assert.ok(e.labelPt && e.labelPt.x > 0 && e.labelPt.x < L.width && e.labelPt.y > 0 && e.labelPt.y < L.height, `T4 ${tag} 边 ${e.from} 标签锚点界内`);
    }
  }
  // 边端点贴端点节点边界:elkjs 把组内边挂根数组(container 字段声明坐标系),
  // flatten 若按树位置加偏移,组内边会整体错位 —— 此断言防该类回归(2026-08-22 实测逃逸)
  const byId = new Map(L.nodes.map((n) => [n.id, n]));
  const onBorder = (p, n) => {
    if (p.x < n.x - 1.5 || p.x > n.x + n.w + 1.5 || p.y < n.y - 1.5 || p.y > n.y + n.h + 1.5) return false;
    const d = Math.min(Math.abs(p.x - n.x), Math.abs(p.x - (n.x + n.w)), Math.abs(p.y - n.y), Math.abs(p.y - (n.y + n.h)));
    return d <= 1.5;
  };
  for (const e of L.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    assert.ok(from && to, `T4 ${tag} 边 ${e.from}→${e.to} 端点节点存在`);
    const head = e.pts[0];
    const tail = e.pts[e.pts.length - 1];
    assert.ok(onBorder(head, from), `T4 ${tag} 边 ${e.from}→${e.to} 首点贴源节点边(head=${JSON.stringify(head)} node=${JSON.stringify(from)})`);
    assert.ok(onBorder(tail, to), `T4 ${tag} 边 ${e.from}→${e.to} 尾点贴目标节点边(tail=${JSON.stringify(tail)} node=${JSON.stringify(to)})`);
  }
}

{
  const a = await layoutConceptMap(NODES, EDGES, GROUPS);
  const b = await layoutConceptMap(NODES, EDGES, GROUPS);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "T4 确定性:同输入两次运行逐字节一致");
  assert.equal(a.nodes.length, NODES.length, "T4 全节点有几何");
  assert.equal(a.groups.length, 2, "T4 两组容器");
  assert.ok(a.groups.every((g) => g.w > 0 && g.h > GROUP_TITLE_PX), "T4 组盒尺寸为标题栏留白");
  await assertInvariants(a, "典型");
  // hub = 最大度数(gd 度 3 与 lr 度 2,grad 度 2, loss 度 2 … gd 最大)
  assert.equal(a.hubId, "gd", "T4 hub=最大度数节点");
  const hub = a.nodes.find((n) => n.id === "gd");
  assert.ok(hub?.hub, "T4 hub 标记");
  // 无 groups 输入 → 兜底聚类同样成立
  const fb = await layoutConceptMap(NODES, EDGES, null);
  assert.ok(fb.groupsFallback && fb.groups.length >= 1, "T4 兜底路径产出分组");
  await assertInvariants(fb, "兜底");
  console.log(`T4 端到端(确定性/零重叠/组包含/界内/hub,画布 ${a.width}×${a.height})✓`);
}

// ---------------------------------------------------------------- T5 边界
{
  const empty = await layoutConceptMap([], []);
  assert.equal(empty.nodes.length, 0, "T5 空图不炸");
  const single = await layoutConceptMap([{ id: "solo", label: "唯一概念" }], []);
  assert.equal(single.nodes.length, 1, "T5 单节点有位置");
  const pair = await layoutConceptMap(
    [
      { id: "a", label: "甲" },
      { id: "b", label: "乙" },
    ],
    [{ from: "a", to: "b" }],
  );
  await assertInvariants(pair, "双节点");
  assert.equal(pair.groups.length, 0, "T5 双节点无分组(聚类 <4 不分)");
}
{
  // 15 节点密集:环 + 交叉边 + 孤立节点
  const dense = [];
  for (let i = 0; i < 15; i++) dense.push({ id: `n${i}`, label: `概念模块${i}` });
  const denseEdges = [];
  for (let i = 0; i < 14; i++) denseEdges.push({ from: `n${i}`, to: `n${i + 1}`, label: i % 3 === 0 ? "顺序" : undefined });
  denseEdges.push(
    { from: "n0", to: "n7", label: "跨组" },
    { from: "n3", to: "n11" },
    { from: "n5", to: "n13", label: "远距" },
    { from: "n2", to: "n9" },
    { from: "n14", to: "n14" }, // 自环防御
    { from: "n14", to: "ghost" }, // 悬空防御
  );
  const L = await layoutConceptMap(dense, denseEdges, null);
  assert.equal(L.nodes.length, 15, "T5 15 节点全有几何");
  assert.equal(L.edges.length, 18, "T5 合法边(20 条中自环+悬空被跳过)");
  await assertInvariants(L, "密集");
  console.log(`T5 边界(空/1/2/15 密集/孤立,画布 ${L.width}×${L.height})✓`);
}

console.log("verify-artifact-cmap-v2: 5 组全部通过");
