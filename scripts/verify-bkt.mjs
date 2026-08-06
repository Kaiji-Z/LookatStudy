/**
 * BKT 掌握度算法验证 —— 测真实源码 pure/bkt.ts。
 *
 * 核心不变量（每个是一条断言）：
 *   答对 → 掌握度升；答错 → 掌握度降
 *   连续答对会逼近 1，连续答错会逼近 0
 *   slip/guess 让单次更新有"软"特性（不会一步到 0 或 1）
 *   null 初始 = pInit(0.5)
 *   masteryToCrown 单调
 */
import assert from "node:assert";
import {
  updateMastery,
  masteryToCrown,
  BKT_DEFAULTS,
} from "../src/main/services/pure/bkt.ts";

// T1: 答对升、答错降
const after = updateMastery(0.5, true);
assert.ok(after > 0.5, `T1: 答对应升掌握度, 实际 ${after}`);
const afterWrong = updateMastery(0.5, false);
assert.ok(afterWrong < 0.5, `T1: 答错应降掌握度, 实际 ${afterWrong}`);
console.log(`✓ T1 答对升(${after.toFixed(3)}) / 答错降(${afterWrong.toFixed(3)})`);

// T2: null 初始 = pInit
const fromNull = updateMastery(null, true);
const fromInit = updateMastery(BKT_DEFAULTS.pInit, true);
assert.strictEqual(fromNull, fromInit, "T2: null 应等价于 pInit");
console.log(`✓ T2 null 初始 = pInit(${BKT_DEFAULTS.pInit})`);

// T3: 连续答对逼近 1（10 次后 > 0.95）
let m = 0.5;
for (let i = 0; i < 10; i++) m = updateMastery(m, true);
assert.ok(m > 0.95, `T3: 连续答对应逼近 1, 实际 ${m}`);
console.log(`✓ T3 连续答对 10 次 → ${m.toFixed(4)}（>0.95）`);

// T4: 连续答错显著逼近 0（受 transit 限制不会到 0，15 次后 < 0.15）
// 注：BKT 的 transit 项给掌握度一个下限，这是算法的标准行为不是 bug。
m = 0.5;
for (let i = 0; i < 15; i++) m = updateMastery(m, false);
assert.ok(m < 0.15, `T4: 连续答错应显著逼近 0, 实际 ${m}`);
console.log(`✓ T4 连续答错 15 次 → ${m.toFixed(4)}（<0.15，transit 设下限）`);

// T5: 单次更新是"软"的（不会一步到 0 或 1）
const oneRight = updateMastery(0.5, true);
const oneWrong = updateMastery(0.5, false);
assert.ok(oneRight < 0.99, `T5: 单次答对不该到 0.99, 实际 ${oneRight}`);
assert.ok(oneWrong > 0.01, `T5: 单次答错不该到 0.01, 实际 ${oneWrong}`);
console.log(`✓ T5 单次更新软：对=${oneRight.toFixed(3)} 错=${oneWrong.toFixed(3)}`);

// T6: mastery 永远在 [0,1]
m = 0.5;
for (let i = 0; i < 100; i++) m = updateMastery(m, i % 2 === 0);
assert.ok(m >= 0 && m <= 1, `T6: 100 次混合后仍 [0,1], 实际 ${m}`);
console.log(`✓ T6 100 次混合更新后仍在 [0,1]：${m.toFixed(4)}`);

// T7: masteryToCrown 单调 + null→0
assert.strictEqual(masteryToCrown(null), 0, "T7: null → 0");
assert.strictEqual(masteryToCrown(0.1), 1);
assert.strictEqual(masteryToCrown(0.4), 2);
assert.strictEqual(masteryToCrown(0.6), 3);
assert.strictEqual(masteryToCrown(0.8), 4);
assert.strictEqual(masteryToCrown(0.95), 5);
console.log(`✓ T7 masteryToCrown 单调：null→0, 0.1→1, 0.4→2, 0.6→3, 0.8→4, 0.95→5`);

// T8: 边界——极端参数下不会 NaN/Infinity
const extreme = updateMastery(0, true, { pInit: 0.5, pTransit: 0, pSlip: 0, pGuess: 0 });
assert.ok(!Number.isNaN(extreme) && Number.isFinite(extreme), `T8: 极端参数不 NaN, 实际 ${extreme}`);
console.log(`✓ T8 极端参数(P(T)=P(S)=P(G)=0) 不退化 NaN：${extreme}`);

console.log("\n=== ALL BKT TESTS PASSED ✅ ===");
