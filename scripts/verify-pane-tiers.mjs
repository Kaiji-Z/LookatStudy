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
  // 测试结果行允许换行(长错误文案不撑破)
  assert.ok(settings.includes("flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0"), "T: 测试结果行可换行");
});

test("ui-test 抽屉窄屏守卫在(420px 零水平溢出断言)", () => {
  const idx = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  assert.ok(idx.includes("no horizontal overflow at 420px"), "T: ui-test 420px 抽屉零溢出断言在场");
});

console.log(`\n${passed} passed`);
