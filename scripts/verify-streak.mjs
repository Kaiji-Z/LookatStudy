/**
 * Streak 打卡逻辑验证 —— 含 freeze（冻结）正确语义。
 *
 * VERIFICATION §3.1：断言落在真实源码上。
 * 这里 import { computeStreakTransition } from "../src/main/services/pure/streak-transition.ts" ——
 * streak.ts re-export 这同一个函数并应用到 DB。测的是真实状态机逻辑。
 *
 * freeze 真实语义：
 *   gap=2（前天打、昨天漏、今天回）→ freeze 补上漏的那天，streak 继续
 *   gap>=3 → 漏太多，即使有 freeze 也断了
 */
import assert from "node:assert";
import { computeStreakTransition } from "../src/main/services/pure/streak-transition.ts";

// === 测试 ===

// T1: 首次打卡 → streak=1
const s1 = computeStreakTransition({ currentStreak: 0, longestStreak: 0, lastActiveDate: null, freezeCount: 2 });
assert.strictEqual(s1.currentStreak, 1);
console.log(`✓ T1 首次打卡: streak=1`);

// T2: 连续第二天 → streak=2
const day2 = new Date("2026-01-02T10:00:00");
const s2 = computeStreakTransition({ currentStreak: 1, longestStreak: 1, lastActiveDate: "2026-01-01", freezeCount: 2 }, day2);
assert.strictEqual(s2.currentStreak, 2);
console.log(`✓ T2 连续第二天: streak=2`);

// T3: 同日幂等
const s3 = computeStreakTransition(s2, day2);
assert.strictEqual(s3.currentStreak, 2);
console.log(`✓ T3 同日重复: streak=2 (幂等)`);

// T4: gap=2（前天打、昨天漏、今天回）+ 有 freeze → streak 继续, freeze -1
const day4 = new Date("2026-01-04T10:00:00"); // last=01-02, 今天=01-04, gap=2
const s4 = computeStreakTransition({ currentStreak: 5, longestStreak: 5, lastActiveDate: "2026-01-02", freezeCount: 2 }, day4);
assert.strictEqual(s4.currentStreak, 6, "T4: gap=2 + freeze → streak 应继续到 6");
assert.strictEqual(s4.freezeCount, 1, "T4: freeze 应消耗到 1");
console.log(`✓ T4 gap=2 用 freeze: streak=5→6, freeze=2→1`);

// T5: gap=3（漏了 2 天）→ freeze 救不了，重置
const day5 = new Date("2026-01-05T10:00:00"); // last=01-02, 今天=01-05, gap=3
const s5 = computeStreakTransition({ currentStreak: 5, longestStreak: 5, lastActiveDate: "2026-01-02", freezeCount: 2 }, day5);
assert.strictEqual(s5.currentStreak, 1, "T5: gap=3 应重置");
assert.strictEqual(s5.freezeCount, 2, "T5: 重置时 freeze 不消耗");
console.log(`✓ T5 gap=3 (漏2天): streak 重置=1, freeze 保留=2`);

// T6: gap=2 但 freeze=0 → 救不了，重置
const s6 = computeStreakTransition({ currentStreak: 3, longestStreak: 5, lastActiveDate: "2026-01-02", freezeCount: 0 }, day4);
assert.strictEqual(s6.currentStreak, 1, "T6: freeze 用完应重置");
console.log(`✓ T6 gap=2 + freeze=0: streak 重置=1 (没 freeze 可用)`);

// T7: longestStreak 永远记录最大值
assert.strictEqual(s6.longestStreak, 5, "T7: longest 应保留历史最大 5");
console.log(`✓ T7 longestStreak: 保持历史最大=5 (新 streak=1 不影响)`);

// T8: 用 freeze 后下一天连续 → streak 正常 +1（freeze 不再消耗）
const s8 = computeStreakTransition({ currentStreak: 6, longestStreak: 6, lastActiveDate: "2026-01-04", freezeCount: 1 }, new Date("2026-01-05T10:00:00"));
assert.strictEqual(s8.currentStreak, 7);
assert.strictEqual(s8.freezeCount, 1, "T8: 连续打卡 freeze 不消耗");
console.log(`✓ T8 freeze 后连续: streak=6→7, freeze 保持=1`);

console.log("\n=== ALL STREAK TESTS PASSED ✅ ===");
