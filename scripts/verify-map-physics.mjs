/**
 * verify-map-physics.mjs —— 左栏物理地图(mapPhysics.ts)验证。
 *
 * 覆盖:
 * 1. 纯函数:指针分类(点击/拖拽阈值)、弹力带路径(绷直/松弛下垂/封顶)、
 *    squash 衰减与 transform、静止长度、视口门控、风场确定性。
 * 2. 物理岛(真 Matter.js,Node 无头跑):结构(绳链=锚绳+n-1 弹力带,无"回位弹簧")、
 *    墙约束(球出不了 section 盒)、碰撞(产生脉冲+squash)、软拖拽(球跟随指针)、
 *    无弹簧回位(释放后不回布局原点)、脉冲队列 drain 语义。
 *
 * 跑法: npx tsx scripts/verify-map-physics.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  ANCHOR_KNOT_Y,
  BALL_RADIUS,
  DRAG_THRESHOLD_PX,
  ROPE_MAX_SAG,
  WIND_STRENGTH,
  activeIslandIds,
  anchorRestLength,
  classifyPointer,
  createSectionIsland,
  decaySquash,
  linkRestLength,
  ropePathD,
  squashTransform,
  windFx,
} from "../src/renderer/lib/mapPhysics.ts";

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};
const step = (isl, n, dt = 16.67) => { for (let i = 0; i < n; i++) isl.step(dt); };

/* ══════════════ Part 1: 纯函数 ══════════════ */

await test("T1 classifyPointer:位移阈值区分点击/拖拽", () => {
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 102, 103), "click");
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 100 + DRAG_THRESHOLD_PX - 1, 100), "click");
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 100 + DRAG_THRESHOLD_PX + 2, 100), "drag");
  assert.equal(classifyPointer({ startX: 0, startY: 0 }, 3, DRAG_THRESHOLD_PX), "drag");
});

await test("T2 ropePathD:绷紧变直,松弛下垂,下垂封顶", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  // 绷紧(restLen = 距离)→ 控制点在中点(sag=0,直线)
  const taut = ropePathD(a, b, 100);
  assert.ok(taut.includes("Q 50.0 0.0"), `绷紧应为直线: ${taut}`);
  // 松弛 30 → sag = 18
  const slack = ropePathD(a, b, 130);
  assert.ok(slack.includes("Q 50.0 18.0"), `松弛应下垂 18: ${slack}`);
  // 极度松弛 → 封顶 ROPE_MAX_SAG
  const very = ropePathD(a, b, 500);
  assert.ok(very.includes(`Q 50.0 ${ROPE_MAX_SAG}.0`), `下垂封顶 ${ROPE_MAX_SAG}: ${very}`);
});

await test("T3 decaySquash:指数衰减到 0,不为负", () => {
  let s = 0.3;
  for (let i = 0; i < 40; i++) s = decaySquash(s, 16.67);
  assert.ok(s < 0.005, `应衰减到近 0: ${s}`);
  assert.ok(decaySquash(0.2, 16.67) < 0.2, "单调递减");
  assert.equal(decaySquash(0, 100), 0);
});

await test("T4 squashTransform:无形变纯位移;有形变含压扁", () => {
  const plain = squashTransform(10, -5, 0.005, 1.2);
  assert.equal(plain, "translate3d(10.0px, -5.0px, 0)", `无形变应为纯位移: ${plain}`);
  const sq = squashTransform(0, 0, 0.2, 0);
  assert.ok(sq.includes("scale("), `有形变应含 scale: ${sq}`);
  assert.ok(sq.includes("rotate("), `有形变应含 rotate: ${sq}`);
});

await test("T5 静止长度:弹力带=布局距离(下限 2r+8),锚绳下限 36", () => {
  assert.equal(linkRestLength({ x: 0, y: 0 }, { x: 60, y: 80 }), 100, "距离 100 > 下限,原样");
  assert.equal(linkRestLength({ x: 0, y: 0 }, { x: 10, y: 0 }), BALL_RADIUS * 2 + 8, "过近下限");
  assert.equal(anchorRestLength({ x: 5, y: -46 }, { x: 8, y: -40 }), 36, "锚绳下限");
});

await test("T6 activeIslandIds:视口 ± pad 相交才活跃", () => {
  const secs = [
    { id: "a", top: 0, bottom: 300 },
    { id: "b", top: 300, bottom: 600 },
    { id: "c", top: 600, bottom: 900 },
  ];
  const act = activeIslandIds(secs, 250, 350, 200);
  assert.ok(act.has("a") && act.has("b"), "pad 200 应把 a/b 都算活跃");
  assert.ok(!act.has("c"), "c 不在视口+pad 内");
  assert.equal(activeIslandIds(secs, 1500, 1600, 200).size, 0, "远端全冻结");
});

await test("T7 windFx:有界且确定", () => {
  assert.ok(Math.abs(windFx(100, 100, 12345)) <= WIND_STRENGTH + 1e-12, "有界");
  assert.equal(windFx(100, 100, 12345), windFx(100, 100, 12345), "确定");
  assert.notEqual(windFx(100, 100, 12345), windFx(200, 100, 12345), "随位置变化");
});

/* ══════════════ Part 2: 物理岛(真引擎,无头) ══════════════ */

const NODES = [
  { id: "n1", x: 100, y: 60 },
  { id: "n2", x: 180, y: 160 },
  { id: "n3", x: 80, y: 260 },
  { id: "n4", x: 200, y: 300 },
];
const mkIsland = () =>
  createSectionIsland({ nodes: NODES.map((n) => ({ ...n })), width: 268, height: 360 });

await test("T8 结构:绳链 = 锚绳 + n-1 弹力带;无回位弹簧;锚点在容器上缘上方", () => {
  const isl = mkIsland();
  assert.equal(isl.balls.length, 4);
  assert.equal(isl.links.length, 4, "1 锚绳 + 3 弹力带");
  const [tether, ...bands] = isl.links;
  assert.equal(tether.from, "__anchor", "首条是锚绳");
  assert.equal(tether.to, "n1");
  assert.deepEqual(bands.map((l) => [l.from, l.to]), [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]], "顺序 = 课程顺序");
  assert.equal(isl.anchor.y, ANCHOR_KNOT_Y, "绳结在容器上缘上方(路牌区)");
  assert.equal(tether.restLen, anchorRestLength(isl.anchor, NODES[0]), "锚绳静止长度");
  for (let i = 0; i < bands.length; i++) {
    assert.equal(bands[i].restLen, linkRestLength(NODES[i], NODES[i + 1]), `带 ${i} 静止长度=布局距离`);
  }
  isl.dispose();
});

await test("T9 墙约束:球永远出不了 section 盒(近中性浮力+风)", () => {
  const isl = mkIsland();
  step(isl, 240); // 4 秒
  for (const b of isl.balls) {
    const { x, y } = b.body.position;
    assert.ok(x >= BALL_RADIUS - 6 && x <= 268 - BALL_RADIUS + 6, `x 应在墙内: ${x}`);
    assert.ok(y >= BALL_RADIUS - 6 && y <= 360 - BALL_RADIUS + 6, `y 应在墙内: ${y}`);
  }
  isl.dispose();
});

await test("T10 碰撞:高速相撞产生脉冲事件 + squash 形变,drain 后清空", async () => {
  const m = await import("matter-js");
  const Body = (m.default ?? m).Body;
  const isl = mkIsland();
  step(isl, 10);
  // 把 n1 朝 n2 猛掷
  const n1 = isl.ball("n1");
  const n2 = isl.ball("n2");
  assert.ok(n1 && n2);
  Body.setVelocity(n1.body, { x: 6, y: 8 });
  let total = 0;
  for (let i = 0; i < 60; i++) {
    isl.step(16.67);
    total += isl.drainImpacts().length;
  }
  assert.ok(total >= 1, `应至少一次碰撞事件: ${total}`);
  assert.equal(isl.drainImpacts().length, 0, "drain 后清空");
  const maxSquash = Math.max(...isl.balls.map((b) => b.squash));
  assert.ok(maxSquash > 0.02, `碰撞应留下 squash: ${maxSquash}`);
  // squash 由渲染层衰减(渲染层职责,这里只验证衰减函数接得上)
  let s = maxSquash;
  for (let i = 0; i < 30; i++) s = decaySquash(s, 16.67);
  assert.ok(s < 0.01, "渲染层衰减后归零");
  isl.dispose();
});

await test("T11 软拖拽:球跟随指针;释放后无弹簧回位(自由摆布)", async () => {
  const isl = mkIsland();
  step(isl, 30);
  const n3 = isl.ball("n3");
  assert.ok(n3);
  const before = Math.hypot(n3.body.position.x - 20, n3.body.position.y - 30);
  isl.beginDrag("n3", 20, 30);
  assert.ok(isl.isDragging());
  step(isl, 40);
  const during = Math.hypot(n3.body.position.x - 20, n3.body.position.y - 30);
  assert.ok(during < before, `拖拽中应靠近指针: ${during.toFixed(1)} < ${before.toFixed(1)}`);
  isl.endDrag();
  assert.ok(!isl.isDragging());
  // 释放后:链会拉着它,但绝无"回布局原点"的弹簧 → 停点远离布局位
  step(isl, 120);
  const after = Math.hypot(n3.body.position.x - n3.layoutX, n3.body.position.y - n3.layoutY);
  assert.ok(after > 25, `无回位弹簧:释放后停点应远离布局原点(距离 ${after.toFixed(1)})`);
  isl.dispose();
});

await test("T12 顶墙:猛冲也压不过容器上缘", async () => {
  const m = await import("matter-js");
  const Body = (m.default ?? m).Body;
  const isl = mkIsland();
  const n2 = isl.ball("n2");
  assert.ok(n2);
  Body.setVelocity(n2.body, { x: 0, y: -40 });
  step(isl, 30);
  assert.ok(n2.body.position.y >= BALL_RADIUS - 8, `顶墙应拦住: y=${n2.body.position.y}`);
  isl.dispose();
});

await test("T13 静止长度下限:两球布局重叠时弹力带不把球锁死", () => {
  const isl = createSectionIsland({
    nodes: [
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 110, y: 105 },
    ],
    width: 268,
    height: 200,
  });
  step(isl, 120);
  const [a, b] = isl.balls;
  assert.ok(a && b);
  const d = Math.hypot(a.body.position.x - b.body.position.x, a.body.position.y - b.body.position.y);
  assert.ok(d > BALL_RADIUS, `下限应防叠死: d=${d.toFixed(1)}`);
  isl.dispose();
});

console.log(`\n${passed} passed`);
