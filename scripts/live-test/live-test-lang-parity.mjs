/**
 * Live test: 双语行为等价 —— base prompt 英文本体(i18n 落地)不回退指令遵循
 *
 * 跑法: npx tsx scripts/live-test/live-test-lang-parity.mjs (需要 API key)
 *
 * 背景(2026-08-31 评价定位的弱点):此前非 zh locale 只追加一句英文语言指令,
 * 整套行为约束(红线/工具/排版)仍是中文——英文模型用中文指令理解规则再英文输出,
 * 指令遵循质量隐性折损。修复 = buildBaseAgentPrompt 非 zh 分支换英文本体。
 *
 * 本测试验证修复的行为面:同一收尾提议场景(mark_mastered 事故场景),唯一变量
 * 是 buildBaseAgentPrompt(locale),断言两种语言下核心行为等价:
 *   硬:必须发出真正的 mark_mastered tool call(不是手写假标记)
 *   硬:正文不得手写「[工具调用已执行]」标记(红线遵循)
 *   硬:输出语言跟随 locale(zh 组含 CJK;en 组零 CJK——含语言指令遵循)
 *   软:en 组 tool-call rationale 也是英文(工具参数跟随语言)
 *
 * 课程材料刻意用英文课文:把"课文语言"与"界面语言"解耦——真实 en 用户学的
 * 常是英文课,而 AI 输出语言由界面语言决定(resolveOutputLang 契约)。
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 lang-parity live test");
  process.exit(0);
}

// 真源导入:prompt 改动自动跟随
const { buildBaseAgentPrompt } = await import("../../src/main/services/agent/base-prompt.ts");

const nodeContextEn =
  "课程标题：Intro to Prompt Engineering\n" +
  "当前学习节点：Knowing the model's boundaries (lesson)\n" +
  "内容：LLMs have clear capability boundaries. (1) Randomness: the same prompt can " +
  "yield different outputs; higher temperature means more divergence. (2) Hallucination: " +
  "models fluently invent plausible-but-false content; retrieval and citation checks are " +
  "guardrails. (3) Guardrails: system-prompt constraints plus input/output filtering. " +
  "(4) Capability spread: the same task performs very differently across model generations " +
  "and scales; prompts should be tuned for the target model.\n\n" +
  "知识点及掌握度（课级掌握度 = 最薄弱知识点）：\n" +
  "  0. Randomness (91%)\n" +
  "  1. Hallucination (88%)\n" +
  "  2. Guardrails (86%)\n" +
  "  3. Capability spread (90%)\n" +
  "（出题/判分时请用 knowledgeComponent 参数标注考察哪个知识点；优先覆盖薄弱项）";

// 手抄自 learner-model-service.getTeachingStrategy(mastery≥0.85 档);英文组同档直译
const snapshotZh =
  "【学习者当前状态】\n" +
  "教学策略:学习者接近掌握。进入综合应用阶段:让学习者尝试教别人(费曼技巧)," +
  "考察知识在更大系统中的角色。如果学习者能清晰复述并举例,考虑提议标记掌握。";
const snapshotEn =
  "【Learner status】\n" +
  "Teaching strategy: the learner is close to mastery. Move to synthesis: have them teach " +
  "it back (Feynman technique) and probe the concept's role in the bigger system. If they " +
  "can explain it clearly with examples, consider proposing to mark the lesson as mastered.";

const tools = [
  {
    type: "function",
    function: {
      name: "mark_mastered",
      description: "Propose marking the current lesson as mastered. Creates a Proposal awaiting the learner's confirmation (they can decline).",
      parameters: {
        type: "object",
        properties: { rationale: { type: "string", description: "Why you judge it mastered" } },
        required: ["rationale"],
      },
    },
  },
];

const hasCjk = (s) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);

async function runOnce(locale, snapshot) {
  const system = `${buildBaseAgentPrompt(locale)}\n\n${nodeContextEn}\n\n${snapshot}`;
  const messages = [
    {
      role: "assistant",
      content:
        "Let's consolidate with three questions.\n[工具调用已执行] generate_quiz → 已向学习者发出交互答题卡《Model boundary check》(共 3 题),学习者可直接作答",
    },
    { role: "user", content: "1A 2C 3B — done." },
    {
      role: "assistant",
      content:
        "3/3 correct! Randomness, hallucination and guardrails all solid — including your weakest point, guardrails.\n[工具调用已执行] record_answer → 已执行工具 record_answer,产物/效果已作用于学习者界面",
    },
    { role: "user", content: locale === "zh-CN" ? "费曼复述我也讲过了，四个知识点都过了。这课可以收了吗？" : "I've also done the Feynman recap — all four points covered. Can we close this lesson?" },
  ];
  const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "glm-5.2", messages: [{ role: "system", content: system }, ...messages], tools, tool_choice: "auto" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices?.[0]?.message;
}

let failed = 0;
const failures = [];

for (const [locale, snapshot] of [["zh-CN", snapshotZh], ["en", snapshotEn]]) {
  console.log(`\n===== locale=${locale} =====`);
  const msg = await runOnce(locale, snapshot);
  const content = msg?.content ?? "";
  const toolCalls = msg?.tool_calls ?? [];
  const mm = toolCalls.find((tc) => tc.function?.name === "mark_mastered");
  console.log("正文(截断):", content.slice(0, 220).replace(/\n/g, " ") || "(空)");
  console.log("tool_calls:", toolCalls.map((tc) => tc.function?.name).join(", ") || "(无)");

  if (mm) console.log(`✓ [${locale}] 真 mark_mastered tool call`);
  else { failures.push(`[${locale}] 未发出 mark_mastered tool call`); failed++; console.error(`✗ [${locale}] 未发出 mark_mastered tool call`); }

  if (content.includes("[工具调用已执行]")) { failures.push(`[${locale}] 正文手写工具标记(红线违反)`); failed++; console.error(`✗ [${locale}] 正文手写工具标记`); }
  else console.log(`✓ [${locale}] 正文零手写标记`);

  const cjk = hasCjk(content);
  if (locale === "zh-CN" && !cjk) { failures.push("[zh-CN] 输出未跟随中文"); failed++; console.error("✗ [zh-CN] 输出不含中文"); }
  else if (locale === "en" && cjk) { failures.push("[en] 输出含中文残留(语言指令未遵循)"); failed++; console.error("✗ [en] 输出含中文残留"); }
  else console.log(`✓ [${locale}] 输出语言正确`);

  if (locale === "en" && mm) {
    try {
      const args = JSON.parse(mm.function.arguments || "{}");
      const rEn = !hasCjk(String(args.rationale ?? ""));
      console.log(rEn ? "✓ [en] rationale 也是英文(工具参数跟随语言)" : "⚠ [en] rationale 含中文(软,记录)");
    } catch { console.log("⚠ [en] arguments 非法 JSON(软,记录)"); }
  }
}

if (failed > 0) {
  console.error(`\n=== lang-parity live test: FAIL(${failed}) ===\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\n=== lang-parity live test: PASS(双语行为等价) ===");
