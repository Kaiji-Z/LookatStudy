/**
 * verify-map-physics.mjs —— 左栏物理地图(mapPhysics.ts v2:重力场+浮力+粒子链绳+天气环境)。
 *
 * 覆盖:
 * 1. 纯函数:指针分类(点击/拖拽阈值)、绳链 path、squash 衰减与 transform、
 *    视口门控、风场确定性、天气→环境物理映射。
 * 2. 物理岛(真 Matter.js,Node 无头跑):
 *    - 结构:绳链 = 锚绳 + n-1 球间绳(粒子链),无"回位弹簧";
 *    - 墙约束(球出不了 section 盒);
 *    - 绳物理:重力下垂坠(松弛时中点低于连线),拉紧后绷直(受拉有弹力);
 *    - 碰撞:产生脉冲事件 + squash;命中点必须在容器内(球-墙也用支撑点——
 *      中心连线中点会飞到容器外的墙刚体中心,实测反馈过位置错);
 *    - 软拖拽(球跟随指针)+ 无弹簧回位(释放后不回布局原点);
 *    - 天气环境:storm 有阵风扰动 > clear;snow 雪载增重压坠。
 *
 * 锁定球不可拖是渲染层门控(progress 判定),由 ui-test 真实指针探针覆盖。
 *
 * 跑法: npx tsx scripts/verify-map-physics.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  ANCHOR_KNOT_Y,
  BALL_RADIUS,
  DRAG_THRESHOLD_PX,
  ROPE_SLACK,
  activeIslandIds,
  classifyPointer,
  createSectionIsland,
  decaySquash,
  ropeChainPathD,
  squashTransform,
  swirlAt,
  weatherPhysFor,
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
const M = async () => ((await import("matter-js")).default ?? (await import("matter-js")));

/* ══════════════ Part 1: 纯函数 ══════════════ */

await test("T1 classifyPointer:位移阈值区分点击/拖拽", () => {
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 102, 103), "click");
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 100 + DRAG_THRESHOLD_PX - 1, 100), "click");
  assert.equal(classifyPointer({ startX: 100, startY: 100 }, 100 + DRAG_THRESHOLD_PX + 2, 100), "drag");
  assert.equal(classifyPointer({ startX: 0, startY: 0 }, 3, DRAG_THRESHOLD_PX), "drag");
});

await test("T2 ropeChainPathD:折线穿全部点", () => {
  const d = ropeChainPathD([{ x: 0, y: 0 }, { x: 10.44, y: 5.01 }, { x: 20, y: 8 }]);
  assert.equal(d, "M 0.0 0.0 L 10.4 5.0 L 20.0 8.0", `折线坐标: ${d}`);
  assert.equal(ropeChainPathD([]), "");
  assert.equal(ropeChainPathD([{ x: 1.6, y: 2.4 }]), "M 1.6 2.4");
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

await test("T5 activeIslandIds:视口 ± pad 相交才活跃", () => {
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

await test("T6 swirlAt:有界且确定", () => {
  assert.ok(Math.abs(swirlAt(100, 100, 12345)) <= 1 + 1e-12, "归一有界");
  assert.equal(swirlAt(100, 100, 12345), swirlAt(100, 100, 12345), "确定");
  assert.notEqual(swirlAt(100, 100, 12345), swirlAt(200, 100, 12345), "随位置变化");
});

await test("T7 weatherPhysFor:天气→环境物理映射", () => {
  const storm = weatherPhysFor("storm");
  const clear = weatherPhysFor("clear");
  const fog = weatherPhysFor("fog");
  const snow = weatherPhysFor("snow");
  const rain = weatherPhysFor("rain");
  assert.ok(storm.wind > rain.wind && rain.wind > clear.wind, "风力:storm > rain > clear");
  assert.ok(storm.gust > 0 && clear.gust === 0, "只有 storm 级有强阵风");
  assert.ok(rain.rainRate > 0 && clear.rainRate === 0, "雨天有雨滴冲击");
  assert.ok(snow.snowRate > 0 && clear.snowRate === 0, "雪天有雪载");
  assert.ok(fog.airDrag > clear.airDrag && fog.wind < clear.wind, "雾天浓阻尼+死寂");
  assert.deepEqual(weatherPhysFor("unknown-weather"), clear, "未知天气按 clear");
});

/* ══════════════ Part 2: 物理岛(真引擎,无头) ══════════════ */

const NODES = [
  { id: "n1", x: 100, y: 60 },
  { id: "n2", x: 180, y: 160 },
  { id: "n3", x: 80, y: 260 },
  { id: "n4", x: 200, y: 330, isExam: true },
];
const H = 400;
const mkIsland = (weather = "clear") =>
  createSectionIsland({ nodes: NODES.map((n) => ({ ...n })), width: 268, height: H, weather });

await test("T8 结构:绳链 = 锚绳 + n-1 球间绳(粒子链);无回位弹簧;绳结在路牌区", () => {
  const isl = mkIsland();
  assert.equal(isl.balls.length, 4);
  assert.equal(isl.links.length, 4, "1 锚绳 + 3 球间绳");
  const [tether, ...bands] = isl.links;
  assert.equal(tether.from, "__anchor", "首条是锚绳");
  assert.equal(tether.to, "n1");
  assert.deepEqual(bands.map((l) => [l.from, l.to]), [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]], "顺序 = 课程顺序");
  assert.equal(isl.anchor.y, ANCHOR_KNOT_Y, "绳结在容器上缘上方(路牌区)");
  for (const l of isl.links) {
    // 绳是粒子链(不是两点直连的"弹力带"):有中间粒子,静止长度带垂坠松量
    assert.ok(l.particles.length >= 4, `绳粒 >= 4: ${l.particles.length}`);
    assert.ok(l.restLen >= 60 * ROPE_SLACK - 1e-9, `静止长度含松量: ${l.restLen}`);
  }
  isl.dispose();
});

await test("T9 墙约束:球永远出不了 section 盒(浮力+风+链重)", () => {
  const isl = mkIsland();
  step(isl, 240); // 4 秒
  for (const b of isl.balls) {
    const { x, y } = b.body.position;
    assert.ok(x >= BALL_RADIUS - 6 && x <= 268 - BALL_RADIUS + 6, `x 应在墙内: ${x}`);
    assert.ok(y >= BALL_RADIUS - 6 && y <= H - BALL_RADIUS + 6, `y 应在墙内: ${y}`);
  }
  isl.dispose();
});

await test("T10 绳物理:重力下垂坠——松弛绳的中点低于两端连线", () => {
  // 两球水平排布 + 富余绳长 → 绳因自重下垂
  const isl = createSectionIsland({
    nodes: [
      { id: "a", x: 60, y: 150 },
      { id: "b", x: 210, y: 150 },
    ],
    width: 268,
    height: 300,
    weather: "fog", // 死寂空气,垂坠最纯
  });
  step(isl, 240);
  const link = isl.links.find((l) => l.from === "a" && l.to === "b");
  assert.ok(link, "球间绳存在");
  const [a, b] = isl.balls;
  assert.ok(a && b);
  const midY = (a.body.position.y + b.body.position.y) / 2;
  const ropeMid = link.particles[Math.floor(link.particles.length / 2)];
  assert.ok(ropeMid, "绳中点粒子存在");
  // 绳中点显著低于两球中心连线(垂坠),且高于底墙(没有整个掉下去)
  assert.ok(ropeMid.position.y > midY + 6, `应垂坠: 绳中点 ${ropeMid.position.y.toFixed(1)} > 球连线 ${midY.toFixed(1)} + 6`);
  assert.ok(ropeMid.position.y < 300, "绳没掉出容器");
  isl.dispose();
});

await test("T11 绳物理:受拉绷直——拖远两球,绳中点逼近连线", () => {
  const isl = createSectionIsland({
    nodes: [
      { id: "a", x: 60, y: 100 },
      { id: "b", x: 210, y: 100 },
    ],
    width: 268,
    height: 300,
    weather: "fog",
  });
  // 先垂坠
  step(isl, 180);
  const link = isl.links.find((l) => l.from === "a" && l.to === "b");
  assert.ok(link);
  const [a, b] = isl.balls;
  assert.ok(a && b);
  // 拖 a 到左上角、b 到右下角,把绳拉到接近全长的极限(墙内最大对角)
  isl.beginDrag("a", 40, 60);
  isl.beginDrag("b", 230, 240);
  for (let i = 0; i < 200; i++) {
    isl.moveDrag(40, 60);
    isl.moveDrag(230, 240);
    isl.step(16.67);
  }
  isl.endDrag();
  // 基准 = 两球悬挂点(球底 y + r*0.92)连线——绳就挂在这条线上
  const midAttachY = (a.body.position.y + b.body.position.y) / 2 + BALL_RADIUS * 0.92;
  const ropeMid = link.particles[Math.floor(link.particles.length / 2)];
  assert.ok(ropeMid, "绳中点粒子存在");
  const straightDist = Math.abs(ropeMid.position.y - midAttachY);
  assert.ok(straightDist < 18, `受拉应绷直: 绳中点离悬挂点连线 ${straightDist.toFixed(1)}px`);
  isl.dispose();
});

await test("T12 碰撞:脉冲事件 + squash;命中点必须在容器内(球-墙也用支撑点)", async () => {
  const { Body } = await M();
  const isl = mkIsland();
  step(isl, 10);
  const n1 = isl.ball("n1");
  assert.ok(n1);
  // 朝右墙猛掷 → 球-墙碰撞,命中点必须在容器内(回归:v1 用中心连线中点,飞到容器外)
  Body.setVelocity(n1.body, { x: 20, y: 2 });
  const impacts = [];
  for (let i = 0; i < 60; i++) {
    isl.step(16.67);
    impacts.push(...isl.drainImpacts());
  }
  assert.ok(impacts.length >= 1, "应至少一次碰撞事件");
  for (const im of impacts) {
    assert.ok(im.x >= -4 && im.x <= 274, `墙碰撞命中点 x 应在容器内(±穿透容差): ${im.x}`);
    assert.ok(im.y >= -4 && im.y <= H + 4, `墙碰撞命中点 y 应在容器内(±穿透容差): ${im.y}`);
  }
  const maxSquash = Math.max(...isl.balls.map((b) => b.squash));
  assert.ok(maxSquash > 0.02, `碰撞应留下 squash: ${maxSquash}`);
  isl.dispose();
});

await test("T13 软拖拽:球跟随指针;释放后无弹簧回位(自由摆布)", () => {
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

await test("T14 顶墙:猛冲也压不过容器上缘", async () => {
  const { Body } = await M();
  const isl = mkIsland();
  const n2 = isl.ball("n2");
  assert.ok(n2);
  Body.setVelocity(n2.body, { x: 0, y: -40 });
  step(isl, 30);
  assert.ok(n2.body.position.y >= BALL_RADIUS - 8, `顶墙应拦住: y=${n2.body.position.y}`);
  isl.dispose();
});

await test("T15 球-球直接相撞也产生事件,drain 后清空", async () => {
  const { Body } = await M();
  const isl = mkIsland();
  step(isl, 10);
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
  isl.dispose();
});

await test("T16 天气环境:storm 比 clear 扰动大;snow 雪载压坠球", () => {
  const measure = (weather) => {
    const isl = mkIsland(weather);
    let moved = 0;
    for (let i = 0; i < 360; i++) {
      const before = isl.balls.map((b) => b.body.position.x);
      isl.step(16.67);
      // 前 120 步是开场沉降瞬态(两种天气都有),只测后 240 步的持续扰动
      if (i >= 120) moved += isl.balls.reduce((s, b, k) => s + Math.abs(b.body.position.x - (before[k] ?? b.body.position.x)), 0);
    }
    isl.dispose();
    return moved;
  };
  const storm = measure("storm");
  const clear = measure("clear");
  assert.ok(storm > clear * 1.5, `storm 扰动应显著大于 clear: ${storm.toFixed(0)} vs ${clear.toFixed(0)}`);

  // 雪载:雪天静止悬浮的球被积雪压着缓缓下沉(对比 clear 同高度球的沉降)
  const drop = (weather) => {
    const isl = createSectionIsland({
      nodes: [{ id: "x", x: 134, y: 120 }],
      width: 268,
      height: 300,
      weather,
    });
    step(isl, 600); // 10 秒
    const ball = isl.ball("x");
    assert.ok(ball, "球存在");
    const y = ball.body.position.y;
    isl.dispose();
    return y;
  };
  const ySnow = drop("snow");
  const yClear = drop("clear");
  assert.ok(ySnow > yClear, `雪载应压坠: snow y=${ySnow.toFixed(1)} > clear y=${yClear.toFixed(1)}`);
});

await test("T17 相邻球初始不叠死(球-球碰撞兜底)", () => {
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
  assert.ok(d > BALL_RADIUS, `球-球碰撞应防叠死: d=${d.toFixed(1)}`);
  isl.dispose();
});

console.log(`\n${passed} passed`);
