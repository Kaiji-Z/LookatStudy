/**
 * verify-pane-tiers.mjs —— 三档响应式布局纯函数验证(paneTiers.ts)。
 *
 * T1 ≥1240 三栏;T2 920~1239 双栏(中+一侧,互斥);T3 <920 单栏+切换栏/手势。
 * 阈值 = 各档pane最小宽度和(三栏 300+480+440≈1240;双栏 480+440=920)。
 * swipeTarget:T3 手势切栏判定(水平 ≥60px 且 ≥1.6× 纵向,左滑下一栏)。
 *
 * 跑法: npx tsx scripts/verify-pane-tiers.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  T1_MIN,
  T2_MIN,
  WINDOW_MIN,
  tierFor,
  t2SideFromT3,
  swipeTarget,
} from "../src/renderer/lib/paneTiers.ts";
import { composerCapPx, nextComposerHeight } from "../src/renderer/lib/composer-height.ts";

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

test("T1 阈值边界:1239→T2,1240→T1", () => {
  assert.equal(tierFor(1240), 1);
  assert.equal(tierFor(1239), 2);
  assert.equal(tierFor(99999), 1);
});

test("T2 阈值边界:919→T3,920→T2", () => {
  assert.equal(tierFor(920), 2);
  assert.equal(tierFor(919), 3);
  assert.equal(tierFor(560), 3);
  assert.equal(tierFor(0), 3);
});

test("T3 下限 = 窗口 minWidth(单栏对话舒适下限)", () => {
  assert.equal(tierFor(WINDOW_MIN), 3);
  assert.ok(WINDOW_MIN >= 480, "单栏对话至少容得下 chat 下限 480");
});

test("阈值 = pane 最小宽度之和(三栏 300+480+440,双栏 480+440)", () => {
  assert.equal(T1_MIN, 300 + 480 + 440 + 20, "T1 = 三栏最小和 + 余量");
  assert.equal(T2_MIN, 480 + 440, "T2 = 中+右最小和");
});

test("T3→T2 升档承接:看地图保地图侧,看笔记保笔记侧,看对话回默认(笔记侧)", () => {
  assert.equal(t2SideFromT3("rail"), "rail");
  assert.equal(t2SideFromT3("notebook"), "notebook");
  assert.equal(t2SideFromT3("chat"), "notebook");
});

test("swipeTarget 手势判定(阈值/方向/边界)", () => {
  assert.equal(swipeTarget("rail", -80, 5), "chat");
  assert.equal(swipeTarget("chat", -80, 5), "notebook");
  assert.equal(swipeTarget("chat", 80, 5), "rail");
  assert.equal(swipeTarget("notebook", 80, 5), "chat");
  assert.equal(swipeTarget("rail", 80, 5), null);
  assert.equal(swipeTarget("notebook", -80, 5), null);
  assert.equal(swipeTarget("chat", 59, 0), null);
  assert.equal(swipeTarget("chat", -80, 60), null);
  assert.equal(swipeTarget("chat", -200, 100), "notebook");
});


// ---------- v0.26 抽屉手机最小宽适配(源级守卫) ----------
test("抽屉宽度视口相对(w-full+max-w 帽,无固定 px 宽);手机端全宽不破", () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  const app = read("../src/renderer/App.tsx");
  // 两个抽屉面板:w-full 全随视口,max-w 只是桌面帽
  assert.ok(app.includes('className="relative w-full max-w-lg h-full'), "T: 设置抽屉面板 w-full+max-w-lg(视口相对)");
  assert.ok(app.includes('className="relative w-full max-w-md h-full'), "T: 复习抽屉面板 w-full+max-w-md(视口相对)");
  // 抽屉内不许固定五列(手机 ~57px/格必破)——companion 形态选择 flex-wrap
  const settings = read("../src/renderer/components/SettingsView.tsx");
  assert.ok(!settings.includes("grid-cols-5"), "T: 设置页无固定五列网格(改 flex-wrap)");
  assert.ok(settings.includes("flex flex-wrap gap-2\" role=\"radiogroup\""), "T: companion 形态选择 flex-wrap(窄屏换行)");
  // 测试结果行允许换行(长错误文案不撑破;v0.38 测试行迁入模型管理弹窗)
  const managerModal = read("../src/renderer/components/ModelManagerModal.tsx");
  assert.ok(managerModal.includes("flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0"), "T: 测试结果行可换行(模型管理弹窗)");
});

test("ui-test 抽屉窄屏守卫在(420px 零水平溢出断言)", () => {
  const idx = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  assert.ok(idx.includes("no horizontal overflow at 420px"), "T: ui-test 420px 抽屉零溢出断言在场");
});

test("composer 自增长高度(v0.43,回流自 dsh 插件):40vh 封顶/基线地板/双向钳制", () => {
  // 封顶:正常视口 40vh;极小视口走 120px 地板;非有限值同地板
  assert.equal(composerCapPx(1000), 400);
  assert.equal(composerCapPx(200), 120, "200px 视口不至于 80px 框");
  assert.equal(composerCapPx(0), 120);
  assert.equal(composerCapPx(Number.NaN), 120);
  assert.equal(composerCapPx(1000, 0.5), 500, "比率可调");
  // 目标高:内容高在 [base, cap] 内直通;越上界钳 cap;短于基线回 base(删行即缩);
  // 非有限 scrollHeight 回 base 保底
  assert.equal(nextComposerHeight(300, 400, 48), 300, "未越界直通");
  assert.equal(nextComposerHeight(999, 400, 48), 400, "越上界钳到封顶");
  assert.equal(nextComposerHeight(30, 400, 48), 48, "短于 rows=2 基线回基线");
  assert.equal(nextComposerHeight(Number.NaN, 400, 48), 48);
  // 接线(源级):ChatComposer 挂 ref + layoutEffect 按 [input] 重排 + 封顶内滚
  const c = readFileSync(new URL("../src/renderer/components/ChatComposer.tsx", import.meta.url), "utf8");
  assert.ok(c.includes("ref={taRef}") && c.includes("useLayoutEffect"), "textarea ref + layoutEffect");
  assert.ok(c.includes("nextComposerHeight(el.scrollHeight, composerCapPx(window.innerHeight)"), "纯函数决策接线");
  assert.ok(c.includes("overflow-y-auto"), "封顶后内滚");
});

test("讲解栏阅读度量守卫(v0.43 判例):正文 80ch 帽必须在场,外层 960px 帽不换 ch 阶梯", () => {
  const nb = readFileSync(new URL("../src/renderer/components/NotebookPanel.tsx", import.meta.url), "utf8");
  // 正文自身的度量(≈40 汉字/行,CJK 舒适默认)——这是真正起作用的那层帽
  assert.ok(nb.includes('className="prose prose-sm max-w-[80ch] leading-relaxed break-words'), "讲解正文 80ch 帽(ReactMarkdown 容器)");
  // v0.43 曾把外层 960px 帽换成 ch 阶梯:对正文惰性(内层 80ch 恒更小),只把
  // 无自带帽的卡片面收窄到 ~560px——判例:外层帽保持像素制
  assert.ok(nb.includes("mx-auto w-full max-w-[960px]"), "外层 960px 像素帽保持");
  assert.ok(!nb.includes("reading-measure") && !nb.includes("reading-pane"), "阶梯残留清零");
});

console.log(`\n${passed} passed`);
