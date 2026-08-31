/**
 * verify-history-budget.mjs —— 对话历史 token 预算裁剪测试。
 *
 * 背景(2026-08-31 评价定位的弱点):装配层每轮全量注入对话历史(全量消息+工具
 * 标记追加),长对话成本与窗口压力线性增长,且最终撞上下文上限直接 400。
 * 修复 = shared/history-budget.ts 纯函数(从最新往回按预算保留) + agent-engine
 * 装配点接线(预算=窗口-固定开销-输出预留,窗口经 llm-client.resolveActiveContextWindow
 * 统一解析,context-usage 同源)。
 *
 * 纯函数测试(不依赖 Electron/DB/LLM) + 源级接线守卫。
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const { trimHistoryToBudget } = await import("../shared/history-budget.ts");
const { estimateTokens } = await import("../shared/token-estimate.ts");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); failed++; }
}

// 可控 token 估算器:1 单位/字符,便于精确构造边界
const est = (m) => m.content.length;
const msg = (role, content) => ({ role, content });

/* ── T1 空输入与预算内全保留 ── */
test("T1: 空数组/预算内全保留,零丢弃", () => {
  assert.deepStrictEqual(trimHistoryToBudget([], 100, est), { kept: [], droppedCount: 0 });
  const ms = [msg("user", "abc"), msg("assistant", "de"), msg("user", "f")];
  const r = trimHistoryToBudget(ms, 100, est);
  assert.strictEqual(r.droppedCount, 0);
  assert.strictEqual(r.kept.length, 3);
  assert.strictEqual(r.kept[0].content, "abc", "装配序(旧→新)不变");
});

/* ── T2 超预算:从最旧开始丢,保留最新 ── */
test("T2: 超预算丢最旧,保留最新且顺序不变", () => {
  const ms = [
    msg("user", "aaaa"),        // 4
    msg("assistant", "bbbb"),   // 4
    msg("user", "cc"),          // 2
    msg("assistant", "dd"),     // 2
  ];
  // 预算 6:从尾累计 dd(2)+cc(2)=4,+bbbb(4)=8>6 → 丢前两条
  const r = trimHistoryToBudget(ms, 6, est);
  assert.strictEqual(r.droppedCount, 2);
  assert.deepStrictEqual(r.kept.map((m) => m.content), ["cc", "dd"]);
});

/* ── T3 minKeep 硬保底 ── */
test("T3: 预算极小/负数时仍保底最近 minKeep 条", () => {
  const ms = [msg("user", "aaaa"), msg("assistant", "bbbb"), msg("user", "cccc")];
  const r = trimHistoryToBudget(ms, 0, est); // 预算 0 → 硬保底 2 条
  assert.strictEqual(r.kept.length, 2);
  assert.deepStrictEqual(r.kept.map((m) => m.content), ["bbbb", "cccc"], "保的是最新的");
  assert.strictEqual(r.droppedCount, 1);
  const r2 = trimHistoryToBudget(ms, -5, est, 3); // 负预算 + minKeep 3 → 全保
  assert.strictEqual(r2.kept.length, 3);
  assert.strictEqual(r2.droppedCount, 0);
});

/* ── T4 最新消息单条超预算仍在保底内保留 ── */
test("T4: 最新消息本身超预算,仍在 minKeep 内保留(当前问题永不被裁)", () => {
  const ms = [msg("assistant", "xx"), msg("user", "a".repeat(100))];
  const r = trimHistoryToBudget(ms, 10, est, 1); // minKeep=1,最新 user 100 token 超预算
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.kept[0].role, "user");
  assert.ok(r.kept[0].content.length === 100);
});

/* ── T5 minKeep 高于预算内可保留条数时以 minKeep 为准 ── */
test("T5: 预算只够 1 条但 minKeep=2 → 保 2 条(宁溢出不裁光)", () => {
  const ms = [msg("user", "aaaa"), msg("assistant", "bbbb"), msg("user", "cccc")];
  const r = trimHistoryToBudget(ms, 4, est, 2); // 尾累计 cccc(4)=4,+bbbb 超 → 但 minKeep=2
  assert.strictEqual(r.kept.length, 2);
  assert.deepStrictEqual(r.kept.map((m) => m.content), ["bbbb", "cccc"]);
});

/* ── T6 纯函数契约:不改入参,对象引用不复制 ── */
test("T6: 纯函数(入参数组不动,元素是原引用)", () => {
  const a = msg("user", "aaaa");
  const b = msg("assistant", "bb");
  const ms = [a, b];
  const r = trimHistoryToBudget(ms, 3, est, 1); // minKeep=1:聚焦引用契约,不被默认保底拉回
  assert.strictEqual(ms.length, 2, "入参数组不被修改");
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.kept[0], b, "返回的是原对象引用(浅拷)");
});

/* ── T7 estimate 依赖注入:CJK 感知估算器同样工作 ── */
test("T7: estimate 注入(与 shared/token-estimate 组合,CJK 感知)", () => {
  // 中文消息 token 密度高于英文(estimateTokens CJK 感知):同字符数中文消耗预算更多
  const en = msg("user", "a".repeat(100));
  const zh = msg("user", "中".repeat(100));
  assert.ok(estimateTokens(zh.content) > estimateTokens(en.content), "估算器应为 CJK 感知");
  const r = trimHistoryToBudget([en, zh], estimateTokens(en.content), (m) => estimateTokens(m.content));
  // 预算=英文那条的 token 数:zh 更贵,累计必超 → minKeep=2 硬保底(两条都在)
  assert.strictEqual(r.kept.length, 2);
  // 单独把 zh 作为最新、预算给英文额度,minKeep=1:en 被裁,zh 保留
  const r2 = trimHistoryToBudget([en, zh], estimateTokens(en.content), (m) => estimateTokens(m.content), 1);
  assert.strictEqual(r2.kept.length, 1);
  assert.strictEqual(r2.kept[0], zh);
});

/* ── T8 边界:恰好压线(等于预算)不丢 ── */
test("T8: 累计恰好等于预算时保留(>预算才丢)", () => {
  const ms = [msg("user", "aaa"), msg("assistant", "bb")];
  const r = trimHistoryToBudget(ms, 5, est);
  assert.strictEqual(r.droppedCount, 0, "3+2=5 == 预算 5,不丢");
});

/* ── T9 源级接线守卫:engine 装配点调用 + 窗口解析统一出口 ── */
test("T9: agent-engine 装配点接线 + llm-client 窗口解析导出", () => {
  const engine = readFileSync(join(ROOT, "src/main/services/agent/agent-engine.ts"), "utf8");
  assert.ok(engine.includes("trimHistoryToBudget"), "engine 应调用 trimHistoryToBudget");
  assert.ok(/trimHistoryToBudget\(\s*messages/.test(engine), "裁剪对象应是 runAgentTurn 入参 messages(装配/fuse 同源)");
  assert.ok(/minKeep/.test(engine) || /,\s*2\s*,?\s*\)/.test(engine), "minKeep 显式传入(当前问题永不被裁)");
  const llmClient = readFileSync(join(ROOT, "src/main/services/agent/llm-client.ts"), "utf8");
  assert.ok(/export function resolveActiveContextWindow/.test(llmClient),
    "llm-client 应导出 resolveActiveContextWindow(engine 与 context-usage 共用,防循环依赖)");
  const usage = readFileSync(join(ROOT, "src/main/services/agent/context-usage.ts"), "utf8");
  assert.ok(usage.includes("resolveActiveContextWindow"), "context-usage 应改用统一出口(同源)");
});

console.log(`\n=== verify-history-budget: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
