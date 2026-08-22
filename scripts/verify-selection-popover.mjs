/**
 * verify-selection-popover.mjs —— 选区浮钮定位纯函数验证(selection-popover.ts)。
 *
 * 定位策略:fine 指针(桌面)右侧优先(末行行盒锚"最后一个字");
 * coarse 指针(手机)直接落选区下方(避开拖选手柄与上方原生菜单)。
 * 显示时机=松手/选区稳定(拖选途中一律隐藏,coarse settle 600ms),
 * 组件层接线由本套件守卫。
 *
 * 跑法: npx tsx scripts/verify-selection-popover.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("多行选区(带 endRect):右侧锚末行行盒=最后一个字右侧,非外接框右缘", () => {
  const selRect = sel(0, 100, 390, 60); // 外接框满宽(拖了三行)
  const endRect = sel(0, 140, 120, 20); // 末行只选到 x=120
  const p = selectionPopoverPosition(selRect, 390, 200, endRect);
  assert.equal(p.left, 128); // 120+8
  assert.equal(p.top, 150); // 末行垂直中心 140+10
  assert.equal(p.transform, "translate(0, -50%)");
});

test("多行选区末行恰好压线(末行右缘+8+宽==容器宽) → 仍走右侧", () => {
  const selRect = sel(0, 100, 390, 60);
  const endRect = sel(100, 140, 82, 20); // 100+82+8+200=390
  const p = selectionPopoverPosition(selRect, 390, 200, endRect);
  assert.equal(p.transform, "translate(0, -50%)");
});

test("多行选区末行也到行尾放不下 → 左侧(midY 取末行中心)", () => {
  const selRect = sel(0, 100, 390, 60);
  const endRect = sel(240, 140, 150, 20); // 末行右缘 390 放不下;外接左缘 0-8-200<0 → 落下方
  const p = selectionPopoverPosition(selRect, 390, 200, endRect);
  assert.equal(p.transform, "translate(0, 0)");
  assert.equal(p.top, 168); // 末行 bottom 160 + 8(不是外接框 bottom)
});

test("无 endRect=旧行为(外接框右缘),签名向后兼容", () => {
  const p = selectionPopoverPosition(sel(20, 100, 120, 20), 390, 200);
  assert.equal(p.left, 148); // 20+120+8
});

test("coarse(preferBelow):右侧明明放得下也直接落选区下方(避开拖选手柄)", () => {
  const p = selectionPopoverPosition(sel(20, 100, 120, 20), 390, 150, undefined, true);
  assert.equal(p.transform, "translate(0, 0)");
  assert.equal(p.left, 20);
  assert.equal(p.top, 128); // bottom 120 + 8
});

test("coarse(preferBelow):下方左缘钳制不溢出容器", () => {
  const p = selectionPopoverPosition(sel(300, 100, 80, 20), 390, 150, undefined, true);
  assert.equal(p.left, 240); // 300 → 钳到 390-150
  assert.equal(p.top, 128);
});

test("coarse(preferBelow):多行选区取末行 bottom(不是外接框)", () => {
  const selRect = sel(0, 100, 390, 60);
  const endRect = sel(0, 140, 120, 20);
  const p = selectionPopoverPosition(selRect, 390, 150, endRect, true);
  assert.equal(p.top, 168); // 末行 bottom 160 + 8
});

test("接线守卫:两容器 松手才现+coarse 下方锚 全链在源码", () => {
  for (const f of ["NotebookPanel.tsx", "ChatStream.tsx"]) {
    const src = readFileSync(new URL(`../src/renderer/components/${f}`, import.meta.url), "utf8");
    assert.ok(src.includes("data-selection-popover"), `${f}: 浮层带 data 锚(CSS 钩+豁免判定)`);
    assert.ok(src.includes('const SETTLE = coarsePointer ? 600 : 250;'), `${f}: 手机稳定窗口 600ms(拖柄停顿不弹)`);
    assert.ok(src.includes("settleTimer = setTimeout"), `${f}: 选区稳定才落位`);
    assert.ok(src.includes("if (!gesture && selectionHasText()) evaluateSelection();"), `${f}: 稳定落位受手势门控(桌面拖选中不放行)`);
    assert.ok(src.includes("if (!hideTimer && selectionHasText()) evaluateSelection(); // 松开立即落位"), `${f}: pointerup 松手即落位`);
    assert.ok(src.includes('closest?.("[data-selection-popover]")'), `${f}: 按下点在浮钮自身不算拖选`);
    assert.ok(src.includes("pointercancel"), `${f}: 指针中断(触屏滚动取消)恢复`);
    assert.ok(src.includes("rects[rects.length - 1]"), `${f}: 末行行盒锚最后一个字`);
    assert.ok(/coarsePointer,\s*\);?\s*\n\s*(setQuoteBtn|setChatNoteBtn)/.test(src) || src.includes("      coarsePointer,\n    );"), `${f}: coarse 传入 preferBelow`);
    assert.ok(!src.includes("popoverSelecting"), `${f}: 旧穿透机制已撤(显示时机改松手后冗余)`);
    assert.ok(!src.includes("onMouseUp={"), `${f}: 旧 mouseup 通道已并入 pointerup`);
  }
});

test("接线守卫:CSS 单行铁律+分端尺寸", () => {
  const css = readFileSync(new URL("../src/renderer/index.css", import.meta.url), "utf8");
  assert.ok(css.includes("[data-selection-popover] { white-space: nowrap; }"), "浮钮固定单行永不换行");
  assert.ok(/@media \(pointer: coarse\)\s*\{\s*\[data-selection-popover\] button\s*\{[^}]*min-height: 44px/.test(css), "粗指针 44px 命中底线");
});

console.log(`\n${passed} passed`);
