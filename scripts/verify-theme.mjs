/**
 * verify-theme.mjs —— 浅色模式验证(v0.7)。
 *
 * 程序化验证浅色模式实现完整性,不依赖视觉截图(capturePage 在无 GPU 环境返回 0x0):
 *   T1 html.light 块存在 + 覆盖所有必须 token
 *   T2 语义色浅色版对比度 ≥4.5:1(OKLCH→sRGB→WCAG 公式)
 *   T3 -rgb 通道值与 OKLCH 计算结果一致(防手填 RGB 不准)
 *   T4 useTheme hook 存在且三态完整
 *   T5 index.html 有 FOUC 防闪烁脚本 + 不再硬编码 class="dark"
 *   T6 GlobalTooltip 用 CSS 变量(不再硬编码 rgba)
 *   T7 Toast/ConfirmCard 用 bg-surface-0(不再 bg-neutral-900)
 *   T8 prose 颜色用 token(不再硬编码 rgb 字面量)
 *   T9 Mermaid 监听 theme-changed(缓存 invalidate)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pass = (n) => console.log(`✓ ${n}`);
const fail = (n, d) => { console.error(`✗ ${n}` + (d ? ` — ${d}` : "")); process.exitCode = 1; };

// OKLCH → sRGB(CSS Color 4 spec 矩阵)
function oklchToRgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  return [r, g, bl].map((c) => Math.round(Math.max(0, Math.min(1, enc(c))) * 255));
}
function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(rgb1, rgb2) {
  const l1 = relLum(rgb1), l2 = relLum(rgb2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const WHITE = [255, 255, 255];

const css = readFileSync(join(ROOT, "src/renderer/index.css"), "utf8");
const lightBlock = css.match(/html\.light\s*\{([\s\S]*?)\n\}/);
const themeHook = existsSync(join(ROOT, "src/renderer/lib/useTheme.ts"));
const themeHookSrc = themeHook ? readFileSync(join(ROOT, "src/renderer/lib/useTheme.ts"), "utf8") : "";
const indexHtml = readFileSync(join(ROOT, "src/renderer/index.html"), "utf8");
const tooltipSrc = readFileSync(join(ROOT, "src/renderer/components/GlobalTooltip.tsx"), "utf8");
const toastSrc = readFileSync(join(ROOT, "src/renderer/components/Toast.tsx"), "utf8");
const confirmSrc = readFileSync(join(ROOT, "src/renderer/components/ConfirmCard.tsx"), "utf8");
const tailwindCfg = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
const mermaidSrc = readFileSync(join(ROOT, "src/renderer/lib/lazy-mermaid.ts"), "utf8");

let ok = true;
const check = (cond, name, detail) => { if (cond) pass(name); else { fail(name, detail); ok = false; } };

// T1: html.light 块 + 必须 token
check(!!lightBlock, "T1 html.light 块存在");
if (lightBlock) {
  const required = ["--surface-rail:", "--surface-0:", "--surface-1:", "--surface-2:",
    "--ink:", "--ink-strong:", "--ink-muted:", "--border:",
    "--brand:", "--accent:", "--gold:", "--warning:", "--exam:"];
  const missing = required.filter((t) => !lightBlock[1].includes(t));
  check(missing.length === 0, "T1 html.light 覆盖所有必须 token", `缺 ${missing.join(", ")}`);
}

// T2: 语义色浅色版对比度
if (lightBlock) {
  const extract = (name) => {
    const m = lightBlock[1].match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
    return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
  };
  const semColors = ["brand", "accent", "warning", "exam", "review"];
  const failing = [];
  for (const c of semColors) {
    const oklch = extract(c);
    if (!oklch) { failing.push(`${c} (未找到)`); continue; }
    const rgb = oklchToRgb(...oklch);
    const ratio = contrast(rgb, WHITE);
    if (ratio < 4.5) failing.push(`${c} ${ratio.toFixed(2)}:1`);
  }
  check(failing.length === 0, "T2 语义色浅色版对比度 ≥4.5:1", failing.join("; "));
}

// T3: -rgb 通道与 OKLCH 一疏(抽检 brand/accent)
if (lightBlock) {
  const pairs = [
    ["brand", "brand-rgb"],
    ["accent", "accent-rgb"],
    ["ink", "ink-rgb"],
    ["surface-rail", "surface-rail-rgb"],
  ];
  const mismatches = [];
  for (const [okName, rgbName] of pairs) {
    const okM = lightBlock[1].match(new RegExp(`--${okName}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
    const rgbM = lightBlock[1].match(new RegExp(`--${rgbName}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
    if (!okM || !rgbM) continue;
    const computed = oklchToRgb(parseFloat(okM[1]), parseFloat(okM[2]), parseFloat(okM[3])).join(" ");
    const declared = `${rgbM[1]} ${rgbM[2]} ${rgbM[3]}`;
    if (computed !== declared) mismatches.push(`${okName}: 算 ${computed} vs 填 ${declared}`);
  }
  check(mismatches.length === 0, "T3 -rgb 通道与 OKLCH 一致", mismatches.join("; "));
}

// T4: useTheme hook 三态
check(themeHook, "T4 useTheme.ts 存在");
check(/auto.*light.*dark|ThemeMode/.test(themeHookSrc), "T4 useTheme 三态类型");
check(themeHookSrc.includes("theme-changed"), "T4 useTheme 派发 theme-changed 事件");
check(themeHookSrc.includes("matchMedia"), "T4 useTheme 监听系统主题");

// T5: index.html
check(!/class="dark"/.test(indexHtml), "T5 index.html 不再硬编码 class=dark");
check(/localStorage.*lookatstudy-theme/.test(indexHtml), "T5 index.html 有 FOUC 防闪烁脚本");

// T6: GlobalTooltip 用 CSS 变量
check(/var\(--surface-0-rgb\)/.test(tooltipSrc), "T6 GlobalTooltip 用 surface-0-rgb 变量");
check(!/rgba\(8,\s*10,\s*20/.test(tooltipSrc), "T6 GlobalTooltip 不再硬编码 rgba(8,10,20)");
check(/var\(--ink\)/.test(tooltipSrc), "T6 GlobalTooltip 文字用 var(--ink)");

// T7: Toast/ConfirmCard 用 surface-0
check(/bg-surface-0/.test(toastSrc), "T7 Toast 用 bg-surface-0");
check(!/bg-neutral-900/.test(toastSrc), "T7 Toast 不再 bg-neutral-900");
check(/bg-surface-0/.test(confirmSrc), "T7 ConfirmCard 用 bg-surface-0");
check(!/bg-neutral-900/.test(confirmSrc), "T7 ConfirmCard 不再 bg-neutral-900");

// T8: prose 用 token(不再硬编码 rgb 字面量)
check(!/color:\s*"rgb\(245 245 250\)"/.test(tailwindCfg), "T8 prose 不再硬编码 rgb(245 245 250)");
check(/var\(--accent-rgb\)/.test(tailwindCfg), "T8 prose 用 var(--accent-rgb)");
check(/var\(--brand-rgb\)/.test(tailwindCfg), "T8 prose 用 var(--brand-rgb)");

// T9: Mermaid 监听 theme-changed
check(/theme-changed/.test(mermaidSrc), "T9 Mermaid 监听 theme-changed");
check(/mermaidPromise\s*=\s*null/.test(mermaidSrc), "T9 Mermaid invalidate 缓存");

console.log(ok ? "\n=== 浅色模式验证: 全部通过 ✅ ===" : "\n=== 浅色模式验证: 有失败 ❌ ===");
