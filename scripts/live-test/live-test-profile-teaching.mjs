/**
 * Live test: 画像注入的教学风格行为验收(ENTP → 辩论式/对话式教学)
 *
 * 跑法: npx tsx scripts/live-test/live-test-profile-teaching.mjs (需要 API key)
 *
 * 验收对象(v0.36 boot-guide 迭代, SPEC §5): verify 的文案断言只能锁"注入块存在",
 * 锁不住"注入后教学行为真的变了"——本测试用同一节课做 A/B:ENTP 画像档 vs 无画像档,
 * 断言 ENTP 档呈现互动式教学(至少一个问句/邀请),并记录双档全文供人工比对。
 *
 * 设计:
 *   - system = 真源 buildBaseAgentPrompt + 手拼 nodeContext + 真源 buildProfileInjection
 *     (ENTP:框架先行/边讲边问/直接纠错/允许跳着学——与 agent-engine 注入同源);
 *   - 用户消息是中性的"开始讲这节课"——不给任何风格暗示,风格只能来自画像;
 *   - 默认思考档。
 *
 * 断言:
 *   - 硬: 两档都有非空回复(画像不破坏基本教学)
 *   - 硬: ENTP 档回复包含互动标记(问句 ？/? 或"你"直接称呼的邀请)——对话式教学的最低信号
 *   - 硬: 无画像档不含画像相关信息(没有把 ENTI/画像词泄漏进无画像档)
 *   - 软: 记录两档长度/问句数对比(人工审查输出)
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 profile-teaching live test");
  process.exit(0);
}

const { buildBaseAgentPrompt } = await import("../../src/main/services/agent/base-prompt.ts");
const { buildProfileInjection, expandMbtiToStyle, emptyProfile } = await import("../../shared/learner-profile.ts");

const nodeContext =
  "课程标题：缓存入门\n" +
  "当前学习节点：CPU 缓存行与伪共享（lesson）\n" +
  "内容：CPU 缓存以 64 字节缓存行为单位读取内存。数组顺序遍历比跳跃遍历快得多，" +
  "因为顺序访问命中同一缓存行；多线程写同一缓存行的不同变量会导致伪共享——" +
  "缓存一致性协议让两个核心互相失效对方的缓存行,性能骤降。对齐(padding)是标准解法。\n";

const entpProfile = {
  ...emptyProfile(),
  name: "阿凯",
  mbti: "ENTP",
  style: expandMbtiToStyle("ENTP"),
  goal: "interview",
  goalNote: "两周后",
};
const profileBlock = buildProfileInjection(entpProfile, "zh-CN");
if (!profileBlock) {
  console.error("❌ 画像注入块为空(真源回归!)");
  process.exit(1);
}

const systemEntp = `${buildBaseAgentPrompt("zh-CN")}\n\n${nodeContext}\n\n${profileBlock}`;
const systemPlain = `${buildBaseAgentPrompt("zh-CN")}\n\n${nodeContext}`;
const userMsg = { role: "user", content: "开始讲这节课吧。" };

async function run(system, label) {
  console.log(`\n=== ${label} (system ${system.length} 字符) ===`);
  const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "glm-5.2", messages: [{ role: "system", content: system }, userMsg] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) {
    console.error(`❌ HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const msg = r.json ? (await r.json()).choices?.[0]?.message : null;
  if (!msg) {
    console.error("❌ 响应缺 message");
    process.exit(1);
  }
  const content = msg.content ?? "";
  console.log(content.slice(0, 400) + (content.length > 400 ? "…(截断)" : ""));
  return content;
}

let entp = await run(systemEntp, "ENTP 画像档");
const isInteractive = (t) => /[？?]/.test(t) || t.includes("你猜") || t.includes("来，");
// 风格是概率行为:首答无互动标记时重试一次(双采样仍无 → 判失败)
if (!isInteractive(entp)) {
  console.log("(首答无互动标记,重试一次)");
  const retry = await run(systemEntp, "ENTP 画像档(重试)");
  if (isInteractive(retry)) entp = retry + " [retry sample: 首答无互动标记]";
}
const plain = await run(systemPlain, "无画像档(基线)");

/* —— 断言 —— */
let failed = 0;

if (entp.trim().length < 50) { console.error("✗ 硬1a: ENTP 档回复过短/为空"); failed++; }
else console.log("✓ 硬1a: ENTP 档有实质回复");

const interactive = isInteractive(entp);
if (interactive) console.log("✓ 硬1b: ENTP 档包含互动标记(问句/邀请)——对话式教学信号");
else { console.error("✗ 硬1b: ENTP 档(含重试)无任何问句/邀请(画像没生效?)"); failed++; }

if (plain.trim().length < 50) { console.error("✗ 硬2a: 基线档回复过短/为空"); failed++; }
else console.log("✓ 硬2a: 基线档有实质回复");

if (/ENTP|画像|辩论家/.test(plain)) { console.error("✗ 硬2b: 基线档泄漏画像词(无画像档不该有)"); failed++; }
else console.log("✓ 硬2b: 基线档不含画像泄漏");

/* 软:对比统计(人工审查) */
const countQ = (s) => (s.match(/[？?]/g) ?? []).length;
console.log(`\n软统计: 问句数 ENTP=${countQ(entp)} vs 基线=${countQ(plain)}; 长度 ${entp.length} vs ${plain.length}`);
console.log("(期望倾向: ENTP 档问句更多、更口语;不作为硬门槛——风格是概率行为)");

if (failed) {
  console.error(`\n❌ ${failed} 项硬断言失败`);
  process.exit(1);
}
console.log("\n✅ profile-teaching live test 全部硬断言通过");
