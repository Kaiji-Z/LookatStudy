/**
 * verify-token-estimate —— 上下文用量估算纯函数的回归套件。
 *
 * 覆盖 shared/token-estimate.ts 全部导出:
 *   - estimateTokens: 空/纯 ASCII/纯 CJK/混合/巨大输入/emoji(确定性,无依赖)
 *   - contextPercent: 窗口未知 → null;0/负数防护;钳 0-100
 *   - segmentPercents: 总宽守恒;0 段 → 0;空输入
 *   - formatTokenCount: 三档格式
 *
 * 运行:tsx scripts/verify-token-estimate.mjs(verify:core 的一员)
 */
import {
  estimateTokens,
  contextPercent,
  segmentPercents,
  formatTokenCount,
} from "../shared/token-estimate.ts";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.log(`✗ ${name}`);
    fail++;
  }
}

/* ---- T1 estimateTokens 基础量纲 ---- */
check("T1a 空串 = 0", estimateTokens("") === 0);
// 纯 ASCII:4 字符 ≈ 1 token(400 字符 → 100)
check("T1b 纯 ASCII 400 字符 = 100", estimateTokens("a".repeat(400)) === 100);
// 纯 CJK:1.1 token/字(100 汉字 → 110)
check("T1c 纯 CJK 100 字 = 110", estimateTokens("学".repeat(100)) === 110);
// 混合:100 汉字 + 100 ASCII = 110 + 25 = 135
check("T1d 混合 100CJK+100ASCII = 135", estimateTokens("学".repeat(100) + "a".repeat(100)) === 135);
// 全角标点按 CJK 计
check("T1e 全角标点计入 CJK 档", estimateTokens("，。：；！？") === Math.ceil(6 * 1.1));
// 顺向不等式:更长文本不减
check("T1f 单调性", estimateTokens("学习") < estimateTokens("学习学习"));
// emoji/特殊字符按 other 档(不抛、非零)
check("T1g emoji 不抛且非零", estimateTokens("🎉🎉🎉🎉🎉") > 0);
// 巨大输入不抛(10 万字符)
check("T1h 100k 字符不抛且有限", Number.isFinite(estimateTokens("x".repeat(100000))));

/* ---- T2 contextPercent ---- */
check("T2a 窗口 null → null", contextPercent(1000, null) === null);
check("T2b 窗口 0 → null(防除零)", contextPercent(1000, 0) === null);
check("T2c 窗口负数 → null", contextPercent(1000, -5) === null);
check("T2d 0 已用 → 0%", contextPercent(0, 128000) === 0);
check("T2e 负已用 → 0%", contextPercent(-3, 128000) === 0);
check("T2f 一半 → 50%", contextPercent(64000, 128000) === 50);
check("T2g 四舍五入 33%", contextPercent(42400, 128000) === 33);
check("T2h 超限钳 100%", contextPercent(999999, 128000) === 100);

/* ---- T3 segmentPercents ---- */
// 三段 1k/3k/4k(占比 12.5%/37.5%/50%),总占比 80% → 10/30/40,合计 80
{
  const w = segmentPercents([1000, 3000, 4000], 80);
  const sum = w.reduce((a, b) => a + b, 0);
  check("T3a 宽度合计守恒(= 总占比)", Math.abs(sum - 80) < 1e-9);
  check("T3b 段比例正确(10/30/40)", Math.abs(w[0] - 10) < 1e-9 && Math.abs(w[1] - 30) < 1e-9 && Math.abs(w[2] - 40) < 1e-9);
}
check("T3c 全 0 段 → 全 0 宽", segmentPercents([0, 0, 0], 80).every((w) => w === 0));
check("T3d 空segments → 空结果", segmentPercents([], 80).length === 0);
check("T3e 总占比 0 → 全 0 宽", segmentPercents([1, 2], 0).every((w) => w === 0));

/* ---- T4 formatTokenCount ---- */
check("T4a <1000 原样", formatTokenCount(500) === "500");
check("T4b 999 → 999", formatTokenCount(999) === "999");
check("T4c 1234 → 1.2k", formatTokenCount(1234) === "1.2k");
check("T4d 9999 → 10.0k", formatTokenCount(9999) === "10.0k");
check("T4e 12000 → 12k", formatTokenCount(12000) === "12k");
check("T4f 200000 → 200k", formatTokenCount(200000) === "200k");

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\nFAIL (${fail}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
