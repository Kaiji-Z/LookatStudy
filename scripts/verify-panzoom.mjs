/**
 * verify-panzoom.mjs —— 画布 pan/zoom 纯数学验证(panzoom.ts)。
 *
 * 这是"点开放大会抖动/放大不动"事故的数学根:滚动视口方案里缩放改内容尺寸,
 * 滚动补偿和重排互相打架。画布方案的两大不变量在这里锁死:
 *   1. 锚点不变量:zoomAt 后锚点对准的内容点不动(手指下的点不动)
 *   2. 平移钳制:内容不会被拖出视口;内容小于视口时锁定居中
 *
 * 跑法: npx tsx scripts/verify-panzoom.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { fitScale, fitTransform, zoomAt, clampPan, zoomAtClamped } from "../src/renderer/lib/panzoom.ts";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

test("fitScale:contain 适配宽高取小,不超 1", () => {
  assert.equal(+fitScale(800, 400, 400, 400).toFixed(3), 0.44); // 宽受限(默认 padding 24:(400-48)/800)
  assert.equal(+fitScale(400, 800, 400, 400).toFixed(3), 0.44); // 高受限
  assert.equal(fitScale(200, 100, 400, 400, 24), 1); // 内容小:原大(不放大)
  assert.equal(fitScale(0, 100, 400, 400), 1); // 防崩
});

test("fitTransform:适屏位姿居中", () => {
  const t = fitTransform(800, 400, 400, 400);
  assert.equal(t.scale, 0.44);
  assert.equal(t.x, 24); // (400 - 800*0.44)/2,恰等于 padding
  assert.equal(t.y, 112); // (400 - 400*0.44)/2
});

test("锚点不变量:zoomAt 后锚点下的内容点不动(放大的意义)", () => {
  const t0 = { x: 100, y: 50, scale: 1 };
  const anchor = { x: 220, y: 90 }; // 视口坐标
  const t1 = zoomAt(t0, 2, anchor.x, anchor.y);
  // 锚点在 t0 下对准的内容点:content = (anchor - t0)/scale = (120, 40)
  // 放大后该内容点的视口位置应仍是 anchor
  const vpX = t1.x + 120 * t1.scale;
  const vpY = t1.y + 40 * t1.scale;
  assert.ok(Math.abs(vpX - anchor.x) < 1e-9);
  assert.ok(Math.abs(vpY - anchor.y) < 1e-9);
});

test("zoomAt 反向往返:回到原位姿(无累计漂移 = 不抖)", () => {
  const t0 = { x: 30, y: -20, scale: 0.8 };
  const a = { x: 200, y: 300 };
  const t1 = zoomAt(zoomAt(t0, 1.7, a.x, a.y), 1 / 1.7, a.x, a.y);
  assert.ok(Math.abs(t1.x - t0.x) < 1e-9 && Math.abs(t1.y - t0.y) < 1e-9 && Math.abs(t1.scale - 0.8) < 1e-9);
});

test("clampPan:内容比视口宽时,至少留 keep 可见", () => {
  // 内容 2000*scale=2000 > 视口 400:x ∈ [400-2000-64, 64]
  const t = clampPan({ x: -3000, y: 0, scale: 1 }, 2000, 100, 400, 400, 64);
  assert.equal(t.x, 400 - 2000 - 64);
  const t2 = clampPan({ x: 500, y: 0, scale: 1 }, 2000, 100, 400, 400, 64);
  assert.equal(t2.x, 64);
});

test("clampPan:内容比视口小 → 锁定居中(拖不动)", () => {
  const t = clampPan({ x: -999, y: 999, scale: 0.5 }, 400, 400, 800, 800);
  assert.equal(t.x, (800 - 400 * 0.5) / 2);
  assert.equal(t.y, (800 - 400 * 0.5) / 2);
});

test("zoomAtClamped:scale 夹在 [min,max],factor 抵消不出界", () => {
  const bounds = { min: 0.5, max: 4, contentW: 1000, contentH: 1000, viewW: 400, viewH: 400 };
  const t0 = { x: 0, y: 0, scale: 3.9 };
  const t1 = zoomAtClamped(t0, 10, 200, 200, bounds);
  assert.equal(t1.scale, 4);
  const t2 = zoomAtClamped({ x: 0, y: 0, scale: 0.6 }, 0.01, 200, 200, bounds);
  assert.equal(t2.scale, 0.5);
  // 已在边界:factor 抵消后返回原位姿(factor=1)
  const t3 = zoomAtClamped({ x: 10, y: 10, scale: 4 }, 2, 100, 100, bounds);
  assert.equal(t3.scale, 4);
  assert.equal(t3.x, 10);
});

test("zoomAtClamped:钳后锚点不变量仍近似成立(钳平移只动 x/y)", () => {
  const bounds = { min: 0.2, max: 4, contentW: 2000, contentH: 2000, viewW: 400, viewH: 400 };
  const t0 = { x: -300, y: -300, scale: 1 };
  const t1 = zoomAtClamped(t0, 1.5, 200, 200, bounds);
  // 内容点 (500,500) 在 t0 的视口位置 = -300+500 = 200(锚点)
  const vp = { x: t1.x + 500 * t1.scale, y: t1.y + 500 * t1.scale };
  assert.ok(Math.abs(vp.x - 200) < 1e-6 && Math.abs(vp.y - 200) < 1e-6);
});

console.log(`\n${passed} passed`);
