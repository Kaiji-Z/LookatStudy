/**
 * Live test: update_learner_profile 工具行为验收(证据≥2 → 真工具调用)
 *
 * 跑法: npx tsx scripts/live-test/live-test-profile-update.mjs (需要 API key)
 *
 * 验收对象(v0.36, SPEC §5): 画像与行为冲突场景下,模型必须发起真正的
 * update_learner_profile 工具调用(Propose 确认卡),而不是:
 *   a) 正文手写「[工具调用已执行] …」假标记(2026-08-31 事故模式);
 *   b) 只在正文里说"我把你的画像改了"(没改——写路径只有工具);
 *   c) 单次证据就提议(description 要求证据≥2 次)。
 *
 * 场景设计:画像声明 pacing=sequential(按顺序推进),但对话历史里学习者
 * 两次明确表达跳着学的偏好——证据 2 次,满足提议门槛,然后学习者直接说
 * "就按我说的改"。
 *
 * 断言:
 *   - 硬: 响应含真正的 update_learner_profile tool call
 *   - 硬: patch 参数含 style.pacing=exploratory(改的是被证伪的维度)
 *   - 硬: 正文不手写「[工具调用已执行]」
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 profile-update live test");
  process.exit(0);
}

const { buildBaseAgentPrompt } = await import("../../src/main/services/agent/base-prompt.ts");
const { buildProfileInjection, expandMbtiToStyle, emptyProfile } = await import("../../shared/learner-profile.ts");

const nodeContext =
  "课程标题：缓存入门\n" +
  "当前学习节点：CPU 缓存行与伪共享（lesson）\n" +
  "内容：CPU 缓存以 64 字节缓存行为单位读取内存。顺序访问命中同一缓存行,性能高;" +
  "多线程写同一缓存行导致伪共享,对齐是解法。\n";

// 画像声明 ISTJ(顺序推进) —— 与即将出现的探索行为形成冲突
const profile = { ...emptyProfile(), name: "阿凯", mbti: "ISTJ", style: expandMbtiToStyle("ISTJ") };
const profileBlock = buildProfileInjection(profile, "zh-CN");
const system = `${buildBaseAgentPrompt("zh-CN")}\n\n${nodeContext}\n\n${profileBlock}`;

/* 历史:两次探索性证据 + 明确的修改请求 */
const messages = [
  {
    role: "assistant",
    content: "我们按课程地图的顺序来,先讲缓存行基础。\n[工具调用已执行] generate_quiz → 已向学习者发出交互答题卡《缓存行检验》(共 2 题),学习者可直接作答",
  },
  { role: "user", content: "先别出题,我想直接跳到伪共享那节,基础我自己看——这是第一次跟你说,我讨厌按顺序爬。" },
  { role: "assistant", content: "好,那我们直接看伪共享。不过我注意到你更喜欢跳着学,先记下了。" },
  { role: "user", content: "对,再强调一次:地图顺序对我来说是折磨,我永远想先去最有趣的部分。把我画像里那个'按顺序推进'改了吧,就按我说的改。" },
];

const tools = [
  {
    type: "function",
    function: {
      name: "update_learner_profile",
      description:
        "提议更新学习者画像（称呼/MBTI/教学风格偏好/学习目标）。生成 Proposal 等人确认（人可以拒绝）。" +
        "只有当你观察到与现有画像不符的学习模式、且证据出现了至少 2 次时才调用；" +
        "学习者拒绝后不要在同一问题上重复纠缠。",
      parameters: {
        type: "object",
        properties: {
          rationale: { type: "string", description: "观察依据（引用至少两次具体证据）" },
          patch: {
            type: "object",
            properties: {
              name: { type: "string", description: "称呼" },
              mbti: { type: "string", description: "MBTI 四字母（如 ENTP）" },
              goal: { type: "string", description: "学习目标" },
              goalNote: { type: "string", description: "目标补充（如面试时间线）" },
              freeNote: { type: "string", description: "画像自述" },
              style: {
                type: "object",
                properties: {
                  start: { type: "string", description: "analogy|framework" },
                  interaction: { type: "string", description: "dialogue|lecture" },
                  feedback: { type: "string", description: "direct|encouraging" },
                  pacing: { type: "string", description: "sequential|exploratory" },
                },
                description: "教学风格四维（只传要改的维度）",
              },
            },
            description: "要修改的字段，只传要改的，其余保持不变",
          },
        },
        required: ["rationale", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_quiz",
      description: "出题检验理解。",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", description: "题目主题" } },
        required: ["topic"],
      },
    },
  },
];

console.log("system prompt 长度:", system.length, "字符");
console.log("发送画像冲突场景(默认思考档)…\n");

const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ model: "glm-5.2", messages: [{ role: "system", content: system }, ...messages], tools, tool_choice: "auto" }),
  signal: AbortSignal.timeout(180_000),
});

if (!r.ok) {
  console.error(`❌ HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
const msg = (await r.json()).choices?.[0]?.message;
if (!msg) {
  console.error("❌ 响应缺 message");
  process.exit(1);
}
const content = msg.content ?? "";
const toolCalls = msg.tool_calls ?? [];
console.log("—— 正文 ——");
console.log(content.slice(0, 400) || "(空,纯工具调用)");
console.log("\n—— tool_calls ——");
for (const tc of toolCalls) console.log(`  ${tc.function?.name}: ${tc.function?.arguments}`);

let failed = 0;

const updateCall = toolCalls.find((tc) => tc.function?.name === "update_learner_profile");
if (updateCall) {
  console.log("\n✓ 硬1: 发出了真正的 update_learner_profile tool call");
} else {
  console.error("\n✗ 硬1: 未发出 update_learner_profile 工具调用(画像更新没走工具!)");
  failed++;
}

if (updateCall) {
  let args;
  try {
    args = JSON.parse(updateCall.function.arguments);
  } catch {
    console.error("✗ 硬2: 工具参数不是合法 JSON");
    failed++;
    args = null;
  }
  if (args) {
    const pacing = args.patch?.style?.pacing;
    if (pacing === "exploratory") console.log("✓ 硬2: patch.style.pacing=exploratory(改的是被证伪的维度)");
    else { console.error(`✗ 硬2: patch.style.pacing=${pacing ?? "(缺失)"}(应改 exploratory)`); failed++; }
    if (args.rationale && args.rationale.length > 5) console.log("✓ 软: rationale 带依据:", args.rationale.slice(0, 80));
    else console.log("⚠️ 软: rationale 偏短:", args.rationale);
  }
}

if (content.includes("[工具调用已执行]")) {
  console.error("✗ 硬3: 正文手写「[工具调用已执行]」假标记(事故回归!)");
  failed++;
} else {
  console.log("✓ 硬3: 正文无手写假标记");
}

if (failed) {
  console.error(`\n❌ ${failed} 项硬断言失败`);
  process.exit(1);
}
console.log("\n✅ profile-update live test 全部硬断言通过");
