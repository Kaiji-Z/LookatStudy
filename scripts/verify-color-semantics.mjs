/**
 * 颜色语义规范验证(v0.3.5 收紧版)。
 *
 * 设计权威:PRODUCT.md color strategy(Full palette 5+1 色):
 *   brand  绿 #58cc02 = 进度/正确/主操作/选中
 *   accent 蓝 #1cb0f6 = 交互/进行中/链接
 *   gold   金 #ffc800 = mastery/皇冠/达成
 *   warning红 #ff4b4b = 错误/破坏性/overdue
 *   review 橙 #ff7a1a = SRS 复习/streak 连击(独立于 warning 红)
 *   exam   紫 #a855f7 = 章节考试节点(第6语义色)
 *
 * 颜色系统:src/renderer/index.css :root(OKLCH 变量,单一真源),
 * Tailwind colors 用 rgb(var(--xxx-rgb) / <alpha-value>) 引用联动。
 *
 * 本测试静态扫描源码(components/ + App.tsx),禁止原生 Tailwind 颜色
 * (red/orange/green/yellow/purple/blue)直接出现在 className 里 —— 它们
 * 必须用语义 token(text-warning / text-review / text-brand / text-exam)。
 * 深色背景对比度:text-neutral-500 必须配 dark:text-neutral-400+。
 */
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENT_DIR = join(__dirname, "..", "src", "renderer", "components");
const APP_FILE = join(__dirname, "..", "src", "renderer", "App.tsx");

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// 收集 components/ 下所有 tsx + App.tsx(之前的盲区)
function readAllTsx(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...readAllTsx(full));
    } else if (entry.endsWith(".tsx")) {
      files.push({ path: full, content: readFileSync(full, "utf-8") });
    }
  }
  return files;
}
const allFiles = readAllTsx(COMPONENT_DIR);
allFiles.push({ path: APP_FILE, content: readFileSync(APP_FILE, "utf-8") });
const allLines = allFiles.flatMap((f) =>
  f.content.split("\n").map((l, i) => ({ line: l, file: f.path, no: i + 1 })),
);
const fmtHits = (hits) =>
  hits
    .slice(0, 5)
    .map((h) => `  ${h.file.split(/[\\/]/).slice(-2).join("/")}:${h.no}  ${h.line.trim().slice(0, 100)}`)
    .join("\n");

// ---------- T1: 金色(gold)只用于 mastery/crown/达成场景 ----------
test("T1 gold 只用于 mastery/crown/达成 场景", () => {
  const goldLines = allLines.filter((h) => /\bgold\b/.test(h.line) && /className|class=/.test(h.line));
  // 允许:mastery, crown, 掌握, Lv, achieved, gold/\d(透明度边框), star, 皇冠, 通关, exam
  // (考试通过用 gold 光环,见 PRODUCT.md exam 行)
  const violations = goldLines.filter((h) =>
    !/mastery|crown|掌握|Lv|achieved|progress|gold\/\d|star|皇冠|通关|exam|考试|🎯|review-|reviewPanel/i.test(h.line),
  );
  assert.ok(
    violations.length <= 2,
    `gold 可能误用 ${violations.length} 处:\n${fmtHits(violations)}`,
  );
});

// ---------- T2: 禁止原生 red/orange/yellow/purple 出现在 className ----------
// 颜色已全部变量化(red/orange→warning/review, purple→exam, green→brand)。
// className 里再出现这些原生色 = 没走 token,应改 text-warning/text-review/text-exam/text-brand。
test("T2 禁止原生 red/orange/yellow/purple 直接用 className(应走语义 token)", () => {
  // 匹配 text-red-500 / bg-red-600 / border-orange-500/30 等;排除注释行
  const nativeRe = /(?:text|bg|border|ring|divide|from|to|via)-(?:red|orange|yellow|purple)-\d/;
  const hits = allLines.filter(
    (h) => nativeRe.test(h.line) && !/^\s*(\/\/|\*|\/\*)/.test(h.line),
  );
  // 允许 0 处:全部应迁移到 warning/review/exam token
  // (原 T2 的"停止按钮 hover:bg-red"特例已迁移到 bg-warning,不再需要放行)
  assert.ok(
    hits.length === 0,
    `原生 red/orange/yellow/purple 残留 ${hits.length} 处(应改 text-warning/text-review/text-exam):\n${fmtHits(hits)}`,
  );
});

// ---------- T3: 禁止 green 直接用 className(成功应走 text-brand) ----------
// green-300/green-400/green-900 之前用于"测试成功/已保存",已迁 brand。
test("T3 禁止原生 green 直接用 className(成功应走 text-brand)", () => {
  const greenRe = /(?:text|bg|border|ring)-(?:green|emerald|lime)-\d/;
  const hits = allLines.filter(
    (h) => greenRe.test(h.line) && !/^\s*(\/\/|\*|\/\*)/.test(h.line),
  );
  assert.ok(
    hits.length === 0,
    `原生 green 残留 ${hits.length} 处(应改 text-brand / bg-brand):\n${fmtHits(hits)}`,
  );
});

// ---------- T4: 正文 text-neutral-500 不能是"单值无 dark 变体"(对比度) ----------
// dark-only 环境下 neutral-500 在 neutral-900 上刚好 4.5:1,但配 text-sm/text-xs 偏弱。
// 规范:neutral-500 必须配 dark:text-neutral-400+ 提升暗色对比,或升到 neutral-600。
// 抓两种违规:(a) "text-neutral-500 dark:text-neutral-500"(双 500,dark 无提升)
//          (b) "text-neutral-500" 单值且同行有 text-sm/text-xs/text-[1(小字)
test("T4 text-neutral-500 必须配 dark 提升或避开小字(对比度)", () => {
  const bad = allLines.filter((h) => {
    const l = h.line;
    // (a) 双 500
    if (/text-neutral-500 dark:text-neutral-500/.test(l)) return true;
    // (b) 单值 500(无 dark:text-neutral-4xx 跟随)+ 是小字
    if (/text-neutral-500/.test(l) && !/dark:text-neutral-[46]/.test(l) && /text-(sm|xs|\[1)/.test(l)) return true;
    return false;
  });
  // 允许残留少量(辅助提示文字),但应 ≤3 处且逐个审查
  assert.ok(
    bad.length <= 3,
    `neutral-500 对比度风险 ${bad.length} 处(配 dark:text-neutral-400 或升 600):\n${fmtHits(bad)}`,
  );
});

// ---------- T5: brand(绿)用法广泛(数量合理性) ----------
test("T5 brand(绿)用于 进度/选中/操作/正确(应有合理用量)", () => {
  const brandLines = allLines.filter((h) => /text-brand|bg-brand|border-brand/.test(h.line));
  assert.ok(
    brandLines.length > 10,
    `brand 用法应广泛(active/进度/操作/正确),实际 ${brandLines.length} 处`,
  );
});

// ---------- T6: accent(蓝)不该用于 mastery 场景 ----------
test("T6 accent(蓝)用于 交互/进行中,不用于 mastery 场景", () => {
  const accentLines = allLines.filter((h) => /text-accent|bg-accent|border-accent/.test(h.line));
  assert.ok(accentLines.length > 0, "accent 应有合理用法");
  const misuse = accentLines.filter((h) => /mastery|crown|掌握|完成|achieved/i.test(h.line));
  assert.ok(misuse.length === 0, `accent 不该用于 mastery 场景:\n${fmtHits(misuse)}`);
});

// ---------- T7: exam(紫)只用于考试节点(不应散落到普通 UI) ----------
test("T7 exam(紫)只用于考试节点场景", () => {
  const examLines = allLines.filter((h) => /text-exam|bg-exam|border-exam/.test(h.line));
  // exam 用量应克制(只在 MapRail 考试节点 + ExamView);允许少量,但不该到处都是
  assert.ok(
    examLines.length <= 8,
    `exam 用量 ${examLines.length} 偏多(应只在考试节点/ExamView):\n${fmtHits(examLines)}`,
  );
});

// ---------- T8: 关键 testid 存在(无被误删) ----------
test("T8 关键 testid 存在", () => {
  const combined = allLines.map((h) => h.line).join("\n");
  const required = [
    "map-rail", "chat-panel", "chat-stream", "notebook-panel",
    "composer", "skill-picker", "xp-bar", "streak-badge",
    "command-palette", "thread-switcher",
  ];
  for (const id of required) {
    assert.ok(combined.includes(`data-testid="${id}"`), `缺少 testid: ${id}`);
  }
});

// ---------- T9: index.css :root 必须定义所有语义色变量(单一真源完整性) ----------
test("T9 index.css :root 定义全部语义色 token(单一真源)", () => {
  const css = readFileSync(join(__dirname, "..", "src", "renderer", "index.css"), "utf-8");
  const requiredVars = [
    "--brand:", "--brand-rgb:", "--brand-dark:", "--brand-light:",
    "--accent:", "--accent-rgb:", "--accent-dark:", "--accent-light:",
    "--gold:", "--gold-rgb:", "--gold-dark:", "--gold-light:",
    "--warning:", "--warning-rgb:", "--warning-dark:", "--warning-light:",
    "--review:", "--review-rgb:",
    "--exam:", "--exam-rgb:", "--exam-dark:", "--exam-light:",
  ];
  const missing = requiredVars.filter((v) => !css.includes(v));
  assert.strictEqual(
    missing.length,
    0,
    `index.css :root 缺少 token: ${missing.join(", ")}(改色唯一真源,必须齐全)`,
  );
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 颜色语义规范: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
