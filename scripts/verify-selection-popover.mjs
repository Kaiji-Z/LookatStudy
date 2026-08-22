/**
 * verify-selection-popover.mjs —— 选区浮钮定位纯函数验证(selection-popover.ts)。
 *
 * 定位策略(用户拍板):选区**正上方**水平居中(两端钳制容器内);
 * 选区贴容器顶放不下 → 回退选区下方左对齐(左缘同样钳制)。
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

test("上方放得下:水平居中于选区中心,顶=选区顶-8", () => {
  const p = selectionPopoverPosition(sel(100, 100, 150, 20), 390, 200, 36);
  assert.equal(p.left, 175); // 100+150/2
  assert.equal(p.top, 92); // 100-8
  assert.equal(p.transform, "translate(-50%, -100%)");
});

test("选区靠容器右缘:中心被钳回,左半宽不溢出", () => {
  const p = selectionPopoverPosition(sel(300, 100, 80, 20), 390, 200, 36);
  assert.equal(p.left, 290); // center 340 → 钳到 390-100
});

test("选区贴容器左缘:钳到按钮半宽", () => {
  const p = selectionPopoverPosition(sel(0, 100, 60, 20), 390, 200, 36);
  assert.equal(p.left, 100); // center 30 → 钳到 200/2
});

test("上方放不下(选区贴容器顶):落选区下方左对齐", () => {
  const p = selectionPopoverPosition(sel(20, 20, 120, 20), 390, 200, 36);
  assert.equal(p.left, 20);
  assert.equal(p.top, 48); // bottom 40 + 8
  assert.equal(p.transform, "translate(0, 0)");
});

test("恰好压线:top-8-36==0 → 仍走上方(>=)", () => {
  const p = selectionPopoverPosition(sel(100, 44, 150, 20), 390, 200, 36);
  assert.equal(p.transform, "translate(-50%, -100%)");
  assert.equal(p.top, 36);
});

test("下方兜底也钳制左缘(选区横跨右侧)", () => {
  const p = selectionPopoverPosition(sel(300, 10, 80, 20), 390, 200, 36); // top 10 放不下
  assert.equal(p.left, 190); // 300 → 钳到 390-200
  assert.equal(p.top, 38); // bottom 30 + 8
});

test("多行选区:上方锚 rect.top(首行顶),不是垂直中心", () => {
  const p = selectionPopoverPosition(sel(100, 100, 150, 60), 390, 200, 36);
  assert.equal(p.top, 92);
});

test("零宽选区(光标):center=sel.left,照常钳制", () => {
  const p = selectionPopoverPosition(sel(50, 100, 0, 20), 390, 200, 36);
  assert.equal(p.left, 100); // 50 → 钳到半宽
});

test("退化:容器比按钮还窄 → 数值有限不 NaN(两侧对称溢出)", () => {
  const p = selectionPopoverPosition(sel(20, 100, 60, 20), 100, 300, 36);
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top));
  assert.equal(p.left, 150); // 两个 max 都取 150,对称溢出
});

console.log(`\n${passed} passed`);
