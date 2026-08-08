/**
 * mapLayout 布局引擎验证 —— 纯函数,易测。
 *
 * 核心不变量:
 *   1. 三种布局都生成 N 个节点坐标 + N-1 段连接
 *   2. linear 模式所有节点 x 相同(中轴)
 *   3. zigzag 模式相邻节点 x 不同(左右交替)
 *   4. compact 模式节点数减半的行数
 *   5. segmentToPath 生成合法 SVG path(无 % 非法单位,纯数字像素)
 *   6. 节点 y 单调递增(从上到下)
 *   7. sectionHeight 随 lessonCount 增长
 */
import assert from "node:assert";
import {
  computeSectionLayout,
  sectionHeight,
  segmentToPath,
  recommendMode,
  LAYOUT_MODES,
} from "../src/renderer/lib/mapLayout.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// T1: zigzag 基础 —— 5 课生成 5 节点 + 4 段
test("T1 zigzag: 5 课 → 5 节点 + 4 段", () => {
  const { nodes, segments } = computeSectionLayout(5, "zigzag", 268);
  assert.strictEqual(nodes.length, 5);
  assert.strictEqual(segments.length, 4);
});

// T2: linear 所有节点 x 相同(中轴对齐)
test("T2 linear: 所有节点 x 相同(中轴)", () => {
  const { nodes } = computeSectionLayout(4, "linear", 268);
  const xs = nodes.map((n) => n.x);
  assert.ok(xs.every((x) => x === xs[0]), `linear 节点 x 应全相同,实际 ${xs.join(",")}`);
});

// T3: zigzag 相邻节点 x 不同(左右交替)
test("T3 zigzag: 相邻节点 x 不同(交替)", () => {
  const { nodes } = computeSectionLayout(6, "zigzag", 268);
  for (let i = 0; i < nodes.length - 1; i++) {
    assert.notStrictEqual(nodes[i].x, nodes[i + 1].x, `zigzag 节点 ${i} 和 ${i + 1} 的 x 不应相同`);
  }
});

// T4: 节点 y 单调递增(zigzag/linear);compact 允许同行双节点 y 相等
test("T4 节点 y 单调递增(zigzag/linear;compact 同行可等)", () => {
  for (const mode of ["zigzag", "linear"]) {
    const { nodes } = computeSectionLayout(6, mode, 268);
    for (let i = 0; i < nodes.length - 1; i++) {
      assert.ok(nodes[i].y < nodes[i + 1].y, `${mode} 节点 ${i} y 应 < 节点 ${i + 1} y`);
    }
  }
  // compact:同行两节点 y 相等,跨行 y 递增(节点 0,1 同行;节点 1→2 跨行 y 增)
  const { nodes: cmp } = computeSectionLayout(6, "compact", 268);
  assert.strictEqual(cmp[0].y, cmp[1].y, "compact 节点 0,1 同行 y 相等");
  assert.ok(cmp[1].y < cmp[2].y, "compact 跨行(1→2)y 递增");
});

// T5: segmentToPath 生成合法 SVG path(纯数字,无 %)
test("T5 segmentToPath: 合法 SVG path(无 % 非法单位)", () => {
  const { segments } = computeSectionLayout(5, "zigzag", 268);
  for (const seg of segments) {
    const d = segmentToPath(seg);
    assert.ok(!d.includes("%"), `path 含非法 %: ${d}`);
    assert.ok(d.startsWith("M ") && d.includes("C "), `path 应为 M...C... 形式: ${d}`);
    // 所有数字可解析
    const nums = d.match(/-?\d+\.?\d*/g);
    assert.ok(nums && nums.length >= 6, `path 应含至少 6 个数字: ${d}`);
  }
});

// T6: sectionHeight 随 lessonCount 增长
test("T6 sectionHeight 随 lessonCount 增长", () => {
  const h3 = sectionHeight(3, "zigzag");
  const h6 = sectionHeight(6, "zigzag");
  const h10 = sectionHeight(10, "zigzag");
  assert.ok(h3 < h6 && h6 < h10, `高度应递增: ${h3} < ${h6} < ${h10}`);
});

// T7: compact 比 zigzag 省纵向空间(同节点数)
test("T7 compact 比 zigzag 省纵向空间", () => {
  const hZig = sectionHeight(8, "zigzag");
  const hCmp = sectionHeight(8, "compact");
  assert.ok(hCmp < hZig, `compact 应比 zigzag 矮: ${hCmp} < ${hZig}`);
});

// T8: recommendMode 按 lessonCount 推荐
test("T8 recommendMode: ≤4 linear, >4 zigzag", () => {
  assert.strictEqual(recommendMode(3), "linear");
  assert.strictEqual(recommendMode(4), "linear");
  assert.strictEqual(recommendMode(5), "zigzag");
  assert.strictEqual(recommendMode(20), "zigzag");
});

// T9: LAYOUT_MODES 有 3 个选项
test("T9 LAYOUT_MODES: 3 个布局选项", () => {
  assert.strictEqual(LAYOUT_MODES.length, 3);
  const modes = LAYOUT_MODES.map((m) => m.mode);
  assert.ok(modes.includes("zigzag") && modes.includes("linear") && modes.includes("compact"));
});

// T10: 0 课时不崩
test("T10 0 课时不崩", () => {
  const { nodes, segments } = computeSectionLayout(0, "zigzag", 268);
  assert.strictEqual(nodes.length, 0);
  assert.strictEqual(segments.length, 0);
  assert.ok(sectionHeight(0, "zigzag") > 0, "0 课也应返回正高度");
});

// T11: 段的 from/to 与相邻节点一致
test("T11 段端点 = 相邻节点中心", () => {
  const { nodes, segments } = computeSectionLayout(5, "zigzag", 268);
  for (let i = 0; i < segments.length; i++) {
    assert.strictEqual(segments[i].from.x, nodes[i].x);
    assert.strictEqual(segments[i].from.y, nodes[i].y);
    assert.strictEqual(segments[i].to.x, nodes[i + 1].x);
    assert.strictEqual(segments[i].to.y, nodes[i + 1].y);
  }
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
console.log(`\n=== 地图布局引擎: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
