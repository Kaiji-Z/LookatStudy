/**
 * verify-composer-touch-menu.mjs —— 手机端输入框弹出菜单排版守卫。
 *
 * 2026-08-22 回归:coarse 触屏块的 `.composer-toolbar button { max-width:44px; … }`
 * 是后代选择器,把思考/模型菜单的菜单项(按钮 DOM 挂在 toolbar 里)一并钳成
 * 44px 窄条,手机端打开菜单即"排版错乱"。修复=选择器 :not([role=…]) 排除菜单项
 * (触发钮无 role,菜单项带 role=menuitemradio/menuitem,两者恰好可分)。
 *
 * 本套件守三件事(全源码级断言,防将来重构静默丢掉):
 * 1. index.css coarse 块的 toolbar 按钮规则必须带 :not 排除;
 * 2. EffortPicker/ModelPicker 菜单项必须带 role(排除法的前提,删 role 即回归);
 * 3. 两个菜单容器必须有视口宽度保护(max-w-[calc(100vw-1.5rem)])。
 *
 * 跑法: npx tsx scripts/verify-composer-touch-menu.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "../src/renderer/index.css"), "utf8");
const effortSrc = readFileSync(join(__dirname, "../src/renderer/components/EffortPicker.tsx"), "utf8");
const modelSrc = readFileSync(join(__dirname, "../src/renderer/components/ModelPicker.tsx"), "utf8");

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

test("coarse 块 toolbar 按钮规则带 :not(role) 排除(菜单项不被钳 44px)", () => {
  const EXCL = '.composer-toolbar button:not([role="menuitemradio"]):not([role="menuitem"])';
  // 带排除的选择器必须恰好两处(按钮规则 + svg 规则)
  const notClauses = css.match(/\.composer-toolbar button:not\(\[role="menuitemradio"\]\):not\(\[role="menuitem"\]\)/g) ?? [];
  assert.equal(notClauses.length, 2, `index.css: 按钮规则+svg 规则两处都要带排除(实际 ${notClauses.length} 处)`);
  // 挖掉带排除的选择器后,不允许再出现裸 `.composer-toolbar button`(裸选择器=菜单项被钳回归)
  const sentinel = css.split(EXCL).join("@@EXCLUDED@@");
  assert.ok(
    !/\.composer-toolbar button(?![\w-])/.test(sentinel),
    "index.css: 存在不带 :not 排除的裸 `.composer-toolbar button` 选择器(菜单项会被钳成 44px 窄条)",
  );
});

test("coarse 块 44px 命中规则本体仍在(触发钮图标化不被误删)", () => {
  const m = css.match(/\.composer-toolbar button:not\(\[role="menuitemradio"\]\):not\(\[role="menuitem"\]\),\s*\n\s*\.touch-lift\s*\{[^}]*max-width:\s*44px/s);
  assert.ok(m, "index.css: `.composer-toolbar button:not(…) , .touch-lift { … max-width:44px }` 规则缺失");
});

test("EffortPicker 菜单项带 role(排除法前提)", () => {
  assert.ok(effortSrc.includes('role="menuitemradio"'), "EffortPicker.tsx: 菜单项缺 role=menuitemradio");
  assert.ok(effortSrc.includes('aria-haspopup="menu"'), "EffortPicker.tsx: 触发钮应保留 aria-haspopup(无 role,不进排除分支)");
});

test("ModelPicker 菜单项带 role(排除法前提)", () => {
  assert.ok(modelSrc.includes('role="menuitemradio"'), "ModelPicker.tsx: 菜单项缺 role=menuitemradio");
  assert.ok(modelSrc.includes('role="menuitem"'), "ModelPicker.tsx: 底部「管理模型」钮缺 role=menuitem");
});

test("两菜单容器都有视口宽度保护", () => {
  assert.ok(effortSrc.includes("max-w-[calc(100vw-1.5rem)]"), "EffortPicker.tsx: 菜单缺 max-w 视口保护");
  assert.ok(modelSrc.includes("max-w-[calc(100vw-1.5rem)]"), "ModelPicker.tsx: 菜单缺 max-w 视口保护");
});

console.log(`\n${passed === 5 ? "ALL PASS" : "FAILED"}: ${passed}/5`);
if (passed !== 5) process.exit(1);
