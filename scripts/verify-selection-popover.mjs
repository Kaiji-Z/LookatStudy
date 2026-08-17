/**
 * verify-selection-popover.mjs —— 选区浮钮定位纯函数验证(selection-popover.ts)。
 *
 * 定位策略:手机 Chrome 原生 复制/分享 菜单锚在选区上方,浮钮上侧必被遮 →
 * 优先选区右侧垂直居中;右侧放不下试左侧;两侧都满落选区下方。
 *
 * 跑法: npx tsx scripts/verify-selection-popover.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { selectionPopoverPosition } from "../src/renderer/lib/selection-popover.ts";

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

const sel = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

test("右侧放得下:锚选区右缘+8,垂直居中", () => {
  const p = selectionPopoverPosition(sel(20, 100, 120, 20), 390, 200);
  assert.equal(p.left, 148); // 20+120+8
  assert.equal(p.top, 110); // 100+20/2
  assert.equal(p.transform, "translate(0, -50%)");
});

test("右侧放不下(选到行尾)→ 左侧:锚选区左缘-8", () => {
  const p = selectionPopoverPosition(sel(250, 100, 130, 20), 390, 200);
  assert.equal(p.left, 242); // 250-8
  assert.equal(p.transform, "translate(-100%, -50%)");
});

test("两侧都满(整行选满)→ 选区下方左对齐", () => {
  const p = selectionPopoverPosition(sel(0, 100, 390, 40), 390, 200);
  assert.equal(p.left, 0);
  assert.equal(p.top, 148); // bottom 140 + 8
  assert.equal(p.transform, "translate(0, 0)");
});

test("恰好压线:右缘+8+宽==容器宽 → 仍走右侧(<=)", () => {
  const p = selectionPopoverPosition(sel(100, 50, 82, 20), 390, 200);
  assert.equal(p.left, 190); // 100+82+8=190, 190+200=390 恰好放满
  assert.equal(p.transform, "translate(0, -50%)");
});

test("左侧恰好压线:left-8-宽==0 → 走左侧(>=)", () => {
  const p = selectionPopoverPosition(sel(208, 50, 174, 20), 390, 200); // 208-8-200=0
  assert.equal(p.transform, "translate(-100%, -50%)");
});

test("多行选区:midY 取选区垂直中心", () => {
  const p = selectionPopoverPosition(sel(20, 100, 100, 60), 390, 200);
  assert.equal(p.top, 130);
});

test("零宽选区(光标):右侧,不加 gap 也为 8", () => {
  const p = selectionPopoverPosition(sel(50, 100, 0, 20), 390, 200);
  assert.equal(p.left, 58);
});

console.log(`\n${passed} passed`);
