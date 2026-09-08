/**
 * verify-pane-resize —— 三栏拖拽调宽(issue #14)纯函数 + 源级接线守卫。
 *
 * 纯函数层(src/renderer/lib/pane-resize.ts):
 * - clampRail/MidCandidate:可调区间钳制 + 视口预算(三栏 shrink-0/flex-1,
 *   宽度和超视口=右栏被顶出屏幕,预算必须在钳制里,不能靠 flex 兜底);
 * - parseStoredWidth:settings 脏值不硬吃(超区间回默认);
 * - solvePaneWidths:持久化值 × 当前视口求解 —— 不溢出不变式(矩阵全组合);
 * - resizeHandlesFor:档位-手柄映射(T1 双柄/T2 在场边界/T3 无)。
 *
 * 源级守卫:App 手柄接线 / MapRail 宽度 prop / 拖拽中 transition 禁用 +
 * 节流 + 终值必达 / 双击重置清 inline / CSS 命中区 44px 触屏红线 /
 * i18n 双语 / SettingKey 注册 / ui-test 断言在场。
 *
 * 跑法: npx tsx scripts/verify-pane-resize.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MID_CSS,
  MID_HARD_FLOOR,
  MID_MAX,
  MID_MIN,
  RAIL_DEFAULT,
  RAIL_MAX,
  RAIL_MIN,
  RIGHT_MIN,
  clampMidCandidate,
  clampRailCandidate,
  defaultMidWidth,
  parseStoredWidth,
  resizeHandlesFor,
  solvePaneWidths,
} from "../src/renderer/lib/pane-resize.ts";

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

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* ---------- 纯函数:钳制 ---------- */

test("clampRailCandidate:区间 [240,480] + 视口预算双重上限", () => {
  // 宽视口:RAIL_MAX 480 管辖
  assert.equal(clampRailCandidate(300, 1920, 440 + 691), 300);
  assert.equal(clampRailCandidate(550, 1920, 440 + 691), 480, "上限 480");
  assert.equal(clampRailCandidate(100, 1920, 440 + 691), 240, "下限 240");
  // 窄视口:预算管辖(1300 - 920 = 380 < 480)
  assert.equal(clampRailCandidate(550, 1300, RIGHT_MIN + 480), 380);
  assert.equal(clampRailCandidate(300, 1300, RIGHT_MIN + 480), 300, "预算内原值直过");
  // 极端窄:预算低于下限时保下限(不产负宽/零宽,溢出由 solve 的中栏压缩侧兜)
  assert.equal(clampRailCandidate(300, 1000, RIGHT_MIN + 480), 240);
});

test("clampMidCandidate:区间 [480,1100] + 视口预算 + 硬底 320", () => {
  assert.equal(clampMidCandidate(691, 2400, RIGHT_MIN + RAIL_DEFAULT), 691);
  assert.equal(clampMidCandidate(2000, 2400, RIGHT_MIN + RAIL_DEFAULT), 1100, "上限 1100");
  assert.equal(clampMidCandidate(100, 2400, RIGHT_MIN + RAIL_DEFAULT), 480, "下限 480");
  // 视口预算:1920 - 740 = 1180 > 1100 → 上限 1100 仍管辖
  assert.equal(clampMidCandidate(1200, 1920, RIGHT_MIN + 300), 1100);
  // 1600 - 740 = 860 → 预算管辖
  assert.equal(clampMidCandidate(1100, 1600, RIGHT_MIN + 300), 860);
  // 极端挤压:1240 - 920 = 320 → 硬底(低于 MIN 也保布局完整)
  assert.equal(clampMidCandidate(1100, 1240, RIGHT_MIN + 480), MID_HARD_FLOOR);
  assert.equal(clampMidCandidate(1100, 1240, RIGHT_MIN + 480), 320);
});

/* ---------- 纯函数:存储解析 ---------- */

test("parseStoredWidth:null/空/垃圾/超区间 → null(历史脏值不硬吃)", () => {
  assert.equal(parseStoredWidth(null, RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth(undefined, RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("", RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("   ", RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("abc", RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("480.5abc", RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("NaN", RAIL_MIN, RAIL_MAX), null);
  assert.equal(parseStoredWidth("239", RAIL_MIN, RAIL_MAX), null, "低于区间");
  assert.equal(parseStoredWidth("481", RAIL_MIN, RAIL_MAX), null, "高于区间");
  assert.equal(parseStoredWidth("240", RAIL_MIN, RAIL_MAX), 240);
  assert.equal(parseStoredWidth("300", RAIL_MIN, RAIL_MAX), 300);
  assert.equal(parseStoredWidth("480", RAIL_MIN, RAIL_MAX), 480);
  assert.equal(parseStoredWidth("480", MID_MIN, MID_MAX), 480);
  assert.equal(parseStoredWidth("1100", MID_MIN, MID_MAX), 1100);
  assert.equal(parseStoredWidth("1101", MID_MIN, MID_MAX), null);
  assert.equal(parseStoredWidth("691.4", MID_MIN, MID_MAX), 691, "小数四舍五入(px 粒度)");
});

/* ---------- 纯函数:默认中栏宽 ---------- */

test("defaultMidWidth = clamp(36vw, 480, 800) 的数值形式", () => {
  assert.equal(defaultMidWidth(920), 480); // 331 → 下限
  assert.equal(defaultMidWidth(1300), 480); // 468 → 下限
  assert.ok(Math.abs(defaultMidWidth(1920) - 691.2) < 0.01);
  assert.equal(defaultMidWidth(2400), 800); // 864 → 上限
  // DEFAULT_MID_CSS 与数值形式同口径(字符串只挂 CSS,数字只进预算)
  assert.equal(DEFAULT_MID_CSS, "clamp(480px, 36vw, 800px)");
});

/* ---------- 纯函数:档位-手柄映射 ---------- */

test("resizeHandlesFor:T1 双柄(栏在场才在)/T2 在场边界/T3 无", () => {
  assert.deepEqual(resizeHandlesFor(1, true, true), { rail: true, mid: true });
  assert.deepEqual(resizeHandlesFor(1, false, true), { rail: false, mid: true });
  assert.deepEqual(resizeHandlesFor(1, true, false), { rail: true, mid: false });
  assert.deepEqual(resizeHandlesFor(2, true, false), { rail: true, mid: false }, "T2 左侧:左|中");
  assert.deepEqual(resizeHandlesFor(2, false, true), { rail: false, mid: true }, "T2 右侧:中|右");
  assert.deepEqual(resizeHandlesFor(3, true, true), { rail: false, mid: false }, "T3 单栏无手柄");
  assert.deepEqual(resizeHandlesFor(3, false, false), { rail: false, mid: false });
});

/* ---------- 纯函数:solve 不溢出不变式(矩阵) ---------- */

test("solvePaneWidths(T1):全组合 rail+mid+440 ≤ vw,宽视口保留定制值", () => {
  for (const vw of [1240, 1280, 1300, 1600, 1920, 2048, 2560]) {
    for (const railStored of [null, 240, 300, 420, 480]) {
      for (const midStored of [null, 480, 691, 800, 1000, 1100]) {
        const { rail, mid } = solvePaneWidths(railStored, midStored, vw, "t1");
        const railEff = rail ?? RAIL_DEFAULT;
        const midEff = mid ?? defaultMidWidth(vw);
        assert.ok(
          railEff + midEff + RIGHT_MIN <= vw + 0.5,
          `T1 溢出 vw=${vw} rail=${railStored}→${railEff} mid=${midStored}→${midEff}`,
        );
        assert.ok(railEff >= RAIL_MIN && railEff <= RAIL_MAX, `rail 越界 ${railEff}`);
        assert.ok(midEff >= MID_HARD_FLOOR, `mid 破硬底 ${midEff}`);
      }
    }
  }
  // 宽视口:定制值原样保留(不被预算改写)
  const keep = solvePaneWidths(480, 1100, 2560, "t1");
  assert.equal(keep.rail, 480);
  assert.equal(keep.mid, 1100);
  // 窄视口:先压中栏(保左栏用户意图),极端时中栏落硬底
  const squeeze = solvePaneWidths(480, 1100, 1600, "t1");
  assert.equal(squeeze.rail, 480);
  assert.equal(squeeze.mid, 680, "1600-440-480 精确吃满");
  const hardFloor = solvePaneWidths(480, 1100, 1240, "t1");
  assert.equal(hardFloor.mid, MID_HARD_FLOOR);
  // 未定制 = null(挂响应式默认,不用数值冻结 vw)
  const defaults = solvePaneWidths(null, null, 1600, "t1");
  assert.equal(defaults.rail, null);
  assert.equal(defaults.mid, null);
});

test("solvePaneWidths(T2-notebook):mid ≤ vw-440;未定制 null", () => {
  for (const vw of [920, 1000, 1239]) {
    for (const midStored of [null, 480, 800, 1100]) {
      const { rail, mid } = solvePaneWidths(null, midStored, vw, "t2-notebook");
      assert.equal(rail, null, "左栏不在场");
      const midEff = mid ?? defaultMidWidth(vw);
      assert.ok(midEff + RIGHT_MIN <= vw + 0.5, `T2-nb 溢出 vw=${vw} mid=${midEff}`);
    }
  }
  assert.equal(solvePaneWidths(null, 1100, 1239, "t2-notebook").mid, 799);
  assert.equal(solvePaneWidths(null, 1100, 920, "t2-notebook").mid, 480);
});

test("solvePaneWidths(T2-rail):rail 与中栏最小宽分食视口;mid 恒 null(flex 撑满)", () => {
  for (const vw of [920, 1000, 1239]) {
    for (const railStored of [null, 300, 480]) {
      const { rail, mid } = solvePaneWidths(railStored, null, vw, "t2-rail");
      assert.equal(mid, null);
      const railEff = rail ?? RAIL_DEFAULT;
      assert.ok(railEff + MID_MIN <= vw + 0.5, `T2-rail 溢出 vw=${vw} rail=${railEff}`);
    }
  }
  assert.equal(solvePaneWidths(480, null, 920, "t2-rail").rail, 440);
  assert.equal(solvePaneWidths(300, null, 1920, "t2-rail").rail, 300);
  assert.deepEqual(solvePaneWidths(480, 800, 800, "t3"), { rail: null, mid: null }, "T3 恒默认");
});

/* ---------- 源级守卫:接线 ---------- */

test("App.tsx:手柄接线(左/中柄 + 持久化读写 + 求解挂 style)", () => {
  const app = read("../src/renderer/App.tsx");
  assert.ok(app.includes("PaneResizeHandle"), "T: 组件引入");
  assert.ok(app.includes('side="rail"') && app.includes('side="mid"'), "T: 两条边界手柄");
  assert.ok(app.includes('commitPaneWidth("rail"') && app.includes('commitPaneWidth("mid"'), "T: 提交路由");
  assert.ok(
    app.includes('api.setSetting("pane_width_left"') && app.includes('api.setSetting("pane_width_mid"'),
    "T: 持久化写",
  );
  assert.ok(
    app.includes('api.getSetting("pane_width_left")') && app.includes('api.getSetting("pane_width_mid")'),
    "T: 启动读",
  );
  assert.ok(app.includes("parseStoredWidth"), "T: 存储值经纯函数解析(脏值不硬吃)");
  assert.ok(
    app.includes("solvedPaneW.mid != null ? `${solvedPaneW.mid}px` : DEFAULT_MID_CSS"),
    "T: 中栏宽=求解值或响应式默认",
  );
  assert.ok(app.includes("solvePaneWidths(railWidthStored, midWidthStored"), "T: 渲染期求解(窗口变小不溢出)");
  assert.ok(app.includes("resizeHandlesFor(tier, showLeft, showRight)"), "T: 档位-手柄映射纯函数驱动");
});

test("MapRail.tsx:宽度 prop(默认 300 类不破,定制 inline width)", () => {
  const rail = read("../src/renderer/components/MapRail.tsx");
  assert.ok(rail.includes("props.width == null ? \"w-[300px]\""), "T: 未定制回默认类");
  assert.ok(rail.includes("{ width: props.width }"), "T: 定制宽 inline style");
  assert.ok(rail.includes("fullWidth?: boolean; width?: number | null"), "T: prop 声明");
});

test("PaneResizeHandle:拖拽期 imperative + transition 禁用 + 节流 + 终值必达 + 双击重置", () => {
  const h = read("../src/renderer/components/PaneResizeHandle.tsx");
  assert.ok(h.includes('el.style.transition = "none"'), "T: 拖拽中禁用 width transition(不跟手)");
  assert.ok(h.includes('el.style.transition = ""'), "T: 松手恢复 transition");
  assert.ok(h.includes("DRAG_APPLY_MIN_MS"), "T: 应用节流(物理岛 ResizeObserver→重建不逐帧)");
  // 终值必达:finish 里全程位移重算(节流窗内松手不丢终值)
  assert.ok(/const finalW = propsRef\.current\.clampLive\(d\.startW \+ \(e\.clientX - d\.startX\)\)/.test(h), "T: 终值按全程位移结算");
  assert.ok(h.includes('el.style.width = ""'), "T: 双击重置清 inline(默认类/clamp 接管)");
  assert.ok(h.includes("onCommit(null)"), "T: 双击提交 null=回默认");
  assert.ok(h.includes('role="separator"'), "T: a11y 语义");
  assert.ok(h.includes("window.addEventListener(\"pointermove\""), "T: window 级监听(合成事件可达)");
});

test("index.css:手柄命中区 44px 触屏红线 + 细指针收窄 + 拖拽全局光标", () => {
  const css = read("../src/renderer/index.css");
  assert.ok(css.includes(".pane-resize-handle::before"), "T: 命中区伪元素");
  assert.ok(/\.pane-resize-handle::before\s*\{[^}]*width:\s*44px/.test(css.replace(/\n\s*/g, " ")), "T: 触屏 44px");
  assert.ok(/@media \(pointer: fine\)\s*\{\s*\.pane-resize-handle::before\s*\{\s*width:\s*12px/.test(css.replace(/\n\s*/g, " ")), "T: 细指针 12px");
  assert.ok(css.includes("body.pane-dragging"), "T: 拖拽全局光标+禁选择");
});

test("i18n:手柄文案双语在册(zh + en 各三键)", () => {
  const i18n = read("../src/renderer/lib/i18n.ts");
  for (const key of ["pane.resizeTooltip", "pane.resizeRailAria", "pane.resizeChatAria"]) {
    const count = i18n.split(`"${key}"`).length - 1;
    assert.equal(count, 2, `T: ${key} 应在 zh/en 两册各一条`);
  }
});

test("SettingKey:pane_width_left / pane_width_mid 已注册(preload 零 as 断言)", () => {
  const types = read("../shared/types.ts");
  assert.ok(types.includes('"pane_width_left" | "pane_width_mid"'), "T: 键入联合");
});

test("ui-test:pane-resize 断言在场(真 GUI 拖拽/持久化/重置/T3 无柄)", () => {
  const idx = read("../src/main/index.ts");
  assert.ok(idx.includes("pane-resize:"), "T: ui-test 套件标记");
  assert.ok(idx.includes("pane-handle-rail"), "T: 手柄 testid 被断言");
});

console.log(`\n${passed} passed`);
