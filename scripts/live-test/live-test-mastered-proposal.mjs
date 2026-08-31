/**
 * Live test: 收尾提议行为验证 —— mark_mastered 必须走真正的工具调用
 *
 * 跑法: npx tsx scripts/live-test/live-test-mastered-proposal.mjs (需要 API key)
 *
 * 复现的事故(2026-08-31,用户报告):默认思考档下模型不真正调用 mark_mastered,
 * 而是在正文里手写「[工具调用已执行] mark_mastered → …」假标记(模仿系统注入
 * 历史的标记格式)——UI 只认 tool-call part,学习者界面上没有确认卡片、无按钮可点。
 * 深度思考档则正常调用。该事故暴露的洞:文案存在性断言(verify-agent-locale)锁不住
 * 模型行为,prompt 的行为验收没有覆盖收尾提议场景——本测试补上这个洞。
 *
 * 测试设计:
 *   - system prompt 用真源 buildBaseAgentPrompt(含反伪造条款)+ 手拼 nodeContext
 *     + 手拼 learnerSnapshot 第四档(mastery≥0.85,"考虑提议标记掌握")——
 *     手抄文案与 agent-engine/learner-model-service 同源,源头改动需同步此处;
 *   - 历史消息里刻意包含两条「[工具调用已执行] …」标记行(真实历史装配即如此),
 *     复现事故诱因:模型见过标记格式,才有"照着写一个"的捷径可走;
 *   - 默认思考档(不带任何 thinking 参数)——事故档位;
 *   - tools 只给 mark_mastered + record_answer(schema 照抄 agent-engine 真源)。
 *
 * 断言:
 *   - 硬:响应含真正的 mark_mastered tool_calls(function calling),而非纯文本
 *   - 硬:回复正文不含「[工具调用已执行]」(不手写假标记)
 *   - 软:rationale 参数非空(记录)
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 mastered-proposal live test");
  process.exit(0);
}

// 真源导入:base-prompt 不引 db,tsx 可直接进(比 live-test-teaching 手抄 BASE_PROMPT
// 更进一步——prompt 改动自动跟随,不会测着旧版文案)。
const { buildBaseAgentPrompt } = await import("../../src/main/services/agent/base-prompt.ts");

/* —— 场景手拼文案(与 agent-engine.assembleContextBlocks / buildLearnerSnapshot 同源,源头改动需同步) —— */

const nodeContext =
  "课程标题：提示工程入门\n" +
  "当前学习节点：认识大模型的边界（lesson）\n" +
  "内容：大模型有明确的 capability boundary。一是随机性：同 prompt 两次生成可能不同，" +
  "temperature 越高越发散；二是幻觉与编造：模型会生成貌似合理但不真实的内容，" +
  "联网检索与引用核查是护栏；三是护栏机制：系统提示词约束 + 输入输出过滤双层防御；" +
  "四是模型能力参差：同一任务在不同代际/规模的模型上表现差异巨大，提示词要按目标模型调优。\n\n" +
  "知识点及掌握度（课级掌握度 = 最薄弱知识点）：\n" +
  "  0. 随机性（91%）\n" +
  "  1. 幻觉与编造（88%）\n" +
  "  2. 护栏机制（86%）\n" +
  "  3. 模型能力参差（90%）\n" +
  "（出题/判分时请用 knowledgeComponent 参数标注考察哪个知识点；优先覆盖薄弱项）";

// 手抄自 learner-model-service.getTeachingStrategy(mastery≥0.85 档)
const learnerSnapshot =
  "【学习者当前状态】\n" +
  "教学策略:学习者接近掌握。进入综合应用阶段:让学习者尝试教别人(费曼技巧)," +
  "考察知识在更大系统中的角色。如果学习者能清晰复述并举例,考虑提议标记掌握。";

const system = `${buildBaseAgentPrompt("zh-CN")}\n\n${nodeContext}\n\n${learnerSnapshot}`;

/* —— 历史消息:含真实历史装配会有的工具标记行(事故诱因复现) —— */

const messages = [
  {
    role: "assistant",
    content:
      "来做三道题巩固一下吧。\n[工具调用已执行] generate_quiz → 已向学习者发出交互答题卡《大模型边界检验》(共 3 题),学习者可直接作答",
  },
  { role: "user", content: "1A 2C 3B，做完了" },
  {
    role: "assistant",
    content:
      "3/3 全对！随机性、幻觉、护栏三个点都答到位了，薄弱项护栏机制这次也没失手。\n[工具调用已执行] record_answer → 已执行工具 record_answer,产物/效果已作用于学习者界面",
  },
  { role: "user", content: "费曼复述我也讲过了，四个知识点都过了。这课可以收了吗？" },
];

/* —— tools:照抄 agent-engine 真源 schema(OpenAI function calling 格式) —— */

const tools = [
  {
    type: "function",
    function: {
      name: "record_answer",
      description:
        "记录学习者的一次答题观测，自动更新掌握度（答对涨、答错降）。不需要人确认——判分由你(AI)完成，结果即时生效。",
      parameters: {
        type: "object",
        properties: {
          correct: { type: "boolean", description: "这次观测学习者是否答对" },
          rationale: { type: "string", description: "为什么这么判定（一句）" },
          knowledgeComponent: { type: "string", description: "考察的知识组件标题（从上方知识点清单中选一个）" },
        },
        required: ["correct", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_mastered",
      description: "提议把当前节点标记为已掌握。生成 Proposal 等人确认（人可以拒绝）。",
      parameters: {
        type: "object",
        properties: {
          rationale: { type: "string", description: "为什么判定已掌握" },
        },
        required: ["rationale"],
      },
    },
  },
];

/* —— 调用(默认思考档:不带任何 thinking 参数,即事故档位) —— */

console.log("system prompt 长度:", system.length, "字符");
console.log("发送收尾场景(默认思考档)…\n");

const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "glm-5.2",
    messages: [{ role: "system", content: system }, ...messages],
    tools,
    tool_choice: "auto",
  }),
  signal: AbortSignal.timeout(180_000),
});

if (!r.ok) {
  console.error(`❌ HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await r.json();
const msg = data.choices?.[0]?.message;
if (!msg) {
  console.error("❌ 响应缺 choices[0].message:", JSON.stringify(data).slice(0, 300));
  process.exit(1);
}

const content = msg.content ?? "";
const toolCalls = msg.tool_calls ?? [];
console.log("—— 正文 ——");
console.log(content.slice(0, 500) || "(空,纯工具调用)");
console.log("\n—— tool_calls ——");
for (const tc of toolCalls) {
  console.log(`  ${tc.function?.name}: ${tc.function?.arguments}`);
}

/* —— 断言 —— */

let failed = 0;

// 硬1:必须含真正的 mark_mastered 工具调用
const hasMarkMastered = toolCalls.some((tc) => tc.function?.name === "mark_mastered");
if (hasMarkMastered) {
  console.log("\n✓ 硬断言1: 发出了真正的 mark_mastered tool call");
} else {
  console.error("\n✗ 硬断言1: 未发出 mark_mastered tool call(手写标记事故回归!)");
  failed++;
}

// 硬2:正文不得手写「[工具调用已执行]」标记
if (content.includes("[工具调用已执行]")) {
  console.error("✗ 硬断言2: 正文手写了「[工具调用已执行]」假标记(手写标记事故回归!)");
  failed++;
} else {
  console.log("✓ 硬断言2: 正文未手写工具标记");
}

// 软:rationale 非空(记录,不 fail)
const mm = toolCalls.find((tc) => tc.function?.name === "mark_mastered");
if (mm) {
  try {
    const args = JSON.parse(mm.function.arguments || "{}");
    if (args.rationale && String(args.rationale).trim().length >= 4) {
      console.log(`✓ 软断言: rationale 非空(${String(args.rationale).slice(0, 60)}…)`);
    } else {
      console.log("⚠ 软断言: rationale 缺失或过短(记录,不 fail)");
    }
  } catch {
    console.log("⚠ 软断言: arguments 不是合法 JSON(记录,不 fail)");
  }
}

if (failed > 0) {
  console.error(`\n=== mastered-proposal live test: FAIL(${failed} 个硬断言失败) ===`);
  process.exit(1);
}
console.log("\n=== mastered-proposal live test: PASS ===");
