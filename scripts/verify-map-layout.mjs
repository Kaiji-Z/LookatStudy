/**
 * mapLayout 布局引擎验证 —— 纯函数,易测。
 *
 * v0.6:气球布局(单一,种子确定性抖动)+ 绳子贝塞尔。
 *
 * 核心不变量:
 *   1. N 课 → N 节点 + N-1 段
 *   2. 确定性:同 seed 两次调用坐标完全相等(锁住"不乱跳")
 *   3. 节点 y 单调递增(从上到下)
 *   4. 段端点 = 相邻节点中心
 *   5. balloonSegmentToPath 生成合法 SVG(纯像素,无 %,M...C...)
 *   6. sectionHeight 随 lessonCount 增长
 *   7. 0 课时不崩
 *   8. hashStr 确定性 + 分布(100 种子零碰撞)
 *   9. 节点 x 不溢出容器
 */
import assert from "node:assert";
import {
  computeBalloonLayout,
  sectionHeight,
  balloonSegmentToPath,
  hashStr,
} from "../src/renderer/lib/mapLayout.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// T1: N 课 → N 节点 + N-1 段
test("T1 气球布局: 5 课 → 5 节点 + 4 段", () => {
  const { nodes, segments } = computeBalloonLayout(5, 268, "sec-a");
  assert.strictEqual(nodes.length, 5);
  assert.strictEqual(segments.length, 4);
});

// T2: 确定性 —— 同 seed 两次调用坐标完全相等(核心新增)
test("T2 确定性: 同 seed 两次调用坐标完全相等", () => {
  const a = computeBalloonLayout(8, 268, "section-hello");
  const b = computeBalloonLayout(8, 268, "section-hello");
  assert.strictEqual(a.nodes.length, b.nodes.length);
  for (let i = 0; i < a.nodes.length; i++) {
    assert.strictEqual(a.nodes[i].x, b.nodes[i].x, `节点 ${i} x 应稳定`);
    assert.strictEqual(a.nodes[i].y, b.nodes[i].y, `节点 ${i} y 应稳定`);
  }
});

// T3: 不同 seed → 不同布局(避免所有章节长得一样)
test("T3 多样性: 不同 seed 产生不同 x 分布", () => {
  const a = computeBalloonLayout(6, 268, "alpha");
  const b = computeBalloonLayout(6, 268, "beta");
  let diff = 0;
  for (let i = 0; i < a.nodes.length; i++) {
    if (Math.abs(a.nodes[i].x - b.nodes[i].x) > 0.5) diff++;
  }
  assert.ok(diff >= 3, `不同 seed 至少 3 节点 x 应不同,实际 ${diff}`);
});

// T4: 节点 y 单调递增(从上到下)
test("T4 节点 y 单调递增", () => {
  const { nodes } = computeBalloonLayout(6, 268, "sec-y");
  for (let i = 0; i < nodes.length - 1; i++) {
    assert.ok(nodes[i].y < nodes[i + 1].y, `节点 ${i} y 应 < 节点 ${i + 1} y`);
  }
});

// T5: 段端点 = 相邻节点中心
test("T5 段端点 = 相邻节点中心", () => {
  const { nodes, segments } = computeBalloonLayout(5, 268, "sec-e");
  for (let i = 0; i < segments.length; i++) {
    assert.strictEqual(segments[i].from.x, nodes[i].x);
    assert.strictEqual(segments[i].from.y, nodes[i].y);
    assert.strictEqual(segments[i].to.x, nodes[i + 1].x);
    assert.strictEqual(segments[i].to.y, nodes[i + 1].y);
  }
});

// T6: balloonSegmentToPath 合法 SVG path(纯像素,无 %)
test("T6 balloonSegmentToPath: 合法 SVG(无 %,M...C...)", () => {
  const { segments } = computeBalloonLayout(5, 268, "sec-svg");
  for (const seg of segments) {
    const d = balloonSegmentToPath(seg);
    assert.ok(!d.includes("%"), `path 含非法 %: ${d}`);
    assert.ok(d.startsWith("M ") && d.includes("C "), `path 应为 M...C... 形式: ${d}`);
    const nums = d.match(/-?\d+\.?\d*/g);
    assert.ok(nums && nums.length >= 6, `path 应含至少 6 个数字: ${d}`);
  }
});

// T7: sectionHeight 随 lessonCount 增长
test("T7 sectionHeight 随 lessonCount 增长", () => {
  const h3 = sectionHeight(3);
  const h6 = sectionHeight(6);
  const h10 = sectionHeight(10);
  assert.ok(h3 < h6 && h6 < h10, `高度应递增: ${h3} < ${h6} < ${h10}`);
});

// T8: 0 课时不崩
test("T8 0 课时不崩", () => {
  const { nodes, segments } = computeBalloonLayout(0, 268, "empty");
  assert.strictEqual(nodes.length, 0);
  assert.strictEqual(segments.length, 0);
  assert.ok(sectionHeight(0) > 0, "0 课也应返回正高度");
});

// T9: hashStr 确定性 + 分布(100 种子零碰撞)
test("T9 hashStr: 确定性 + 100 种子零碰撞", () => {
  // 确定性
  assert.strictEqual(hashStr("foo"), hashStr("foo"));
  assert.notStrictEqual(hashStr("foo"), hashStr("bar"));
  // 分布:100 个不同输入无碰撞
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const h = hashStr(`seed-${i}-unique`);
    assert.ok(!seen.has(h), `hashStr 碰撞: seed-${i}-unique`);
    seen.add(h);
  }
});

// T10: 节点球不溢出容器(球中心 x 在 [NODE_RADIUS, containerWidth-NODE_RADIUS])
test("T10 节点球不溢出容器", () => {
  const containerWidth = 268;
  const NODE_RADIUS = 28;
  const { nodes } = computeBalloonLayout(10, containerWidth, "overflow-test");
  for (let i = 0; i < nodes.length; i++) {
    assert.ok(
      nodes[i].x >= NODE_RADIUS - 0.5 && nodes[i].x <= containerWidth - NODE_RADIUS + 0.5,
      `节点 ${i} 球溢出容器: x=${nodes[i].x}, 容器宽 ${containerWidth}, 半径 ${NODE_RADIUS}`,
    );
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
console.log(`\n=== 地图气球布局引擎: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
