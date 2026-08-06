/**
 * SM-2 间隔重复算法验证。
 *
 * VERIFICATION §3.1 红线：断言必须落在真实源码上，不是副本。
 * 这里直接 import { computeSm2 } from "../src/main/services/pure/sm2.ts" ——
 * 测的是 srs.ts 实际调用的同一个函数（srs.ts re-export 自 pure/sm2.ts）。
 *
 * 如果有人改了 pure/sm2.ts 里的算法但没跑这个测试，断言会立刻失败。
 * 运行方式：tsx（package.json 的 verify:core 已切到 tsx）。
 */
import assert from "node:assert";
import { computeSm2 } from "../src/main/services/pure/sm2.ts";

// === 测试用例 ===

// T1: 新卡片，答对（quality=5）→ 第一次复习间隔 1 天
let r1 = computeSm2({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 }, 5);
assert.strictEqual(r1.repetitions, 1, "T1: 答对后 repetitions 应为 1");
assert.strictEqual(r1.intervalDays, 1, "T1: 第一次答对 interval 应为 1 天");
assert.ok(r1.easeFactor > 2.5, `T1: 答对 5 分应提升 EF, 实际 ${r1.easeFactor}`);
console.log(`✓ T1 新卡答对(5): reps=${r1.repetitions}, interval=${r1.intervalDays}d, EF=${r1.easeFactor.toFixed(3)}`);

// T2: 连续第二次答对 → 间隔 6 天
let r2 = computeSm2({ easeFactor: r1.easeFactor, intervalDays: r1.intervalDays, repetitions: 1 }, 5);
assert.strictEqual(r2.repetitions, 2);
assert.strictEqual(r2.intervalDays, 6, "T2: 第二次答对应是 6 天");
console.log(`✓ T2 二次答对: reps=${r2.repetitions}, interval=${r2.intervalDays}d, EF=${r2.easeFactor.toFixed(3)}`);

// T3: 第三次答对 → 间隔 = 6 * EF
let r3 = computeSm2({ easeFactor: r2.easeFactor, intervalDays: 6, repetitions: 2 }, 5);
assert.strictEqual(r3.repetitions, 3);
assert.ok(r3.intervalDays > 6, `T3: 第三次 interval 应 > 6, 实际 ${r3.intervalDays}`);
console.log(`✓ T3 三次答对: reps=${r3.repetitions}, interval=${r3.intervalDays}d (≈6*EF)`);

// T4: 答错（quality=1）→ 重置 repetitions=0, interval=1
let r4 = computeSm2({ easeFactor: 2.5, intervalDays: 30, repetitions: 5 }, 1);
assert.strictEqual(r4.repetitions, 0, "T4: 答错应重置 repetitions");
assert.strictEqual(r4.intervalDays, 1, "T4: 答错 interval 应回到 1 天");
assert.ok(r4.easeFactor < 2.5, `T4: 答错应降 EF, 实际 ${r4.easeFactor}`);
console.log(`✓ T4 答错(1): reps=${r4.repetitions}, interval=${r4.intervalDays}d, EF=${r4.easeFactor.toFixed(3)} (被重置)`);

// T5: EF 永远 ≥ 1.3（下限保护）
let r5 = { easeFactor: 1.3, intervalDays: 10, repetitions: 3 };
for (let i = 0; i < 5; i++) {
  r5 = computeSm2(r5, 0); // 连续 5 次全错
}
assert.ok(r5.easeFactor >= 1.3, `T5: EF 下限 1.3, 实际 ${r5.easeFactor}`);
console.log(`✓ T5 连续全错 5 次: EF 仍 ≥ 1.3 (${r5.easeFactor.toFixed(3)})`);

// T6: EF 永远 ≤ 3.0（上限保护）
let r6 = { easeFactor: 3.0, intervalDays: 10, repetitions: 3 };
for (let i = 0; i < 5; i++) {
  r6 = computeSm2(r6, 5); // 连续 5 次满分
}
assert.ok(r6.easeFactor <= 3.0, `T6: EF 上限 3.0, 实际 ${r6.easeFactor}`);
console.log(`✓ T6 连续满分 5 次: EF 仍 ≤ 3.0 (${r6.easeFactor.toFixed(3)})`);

// T7: 边界 quality=3（勉强对）→ repetitions 推进但 EF 略降
let r7 = computeSm2({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 }, 3);
assert.strictEqual(r7.repetitions, 1, "T7: q=3 仍算答对，repetitions 推进");
assert.ok(r7.easeFactor < 2.5, `T7: q=3 应略降 EF, 实际 ${r7.easeFactor}`);
console.log(`✓ T7 勉强对(q=3): reps=${r7.repetitions}, EF=${r7.easeFactor.toFixed(3)} (略降)`);

// T8: dueAt 计算正确（间隔 N 天后）
const fixedNow = new Date("2026-01-15T00:00:00Z");
let r8 = computeSm2({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 }, 5, fixedNow);
const expectedDue = new Date("2026-01-16T00:00:00Z").toISOString();
assert.strictEqual(r8.dueAt, expectedDue, `T8: dueAt 应为次日, 实际 ${r8.dueAt}`);
console.log(`✓ T8 dueAt 计算: ${r8.dueAt} (= 2026-01-16)`);

console.log("\n=== ALL SRS ALGORITHM TESTS PASSED ✅ ===");
