/**
 * Live test: "开始学习"的 hook 起手式 v2(二选一按钮卡)—— 动机层验证。
 *
 * 跑法: npx tsx scripts/live-test/live-test-hook-opener.mjs  (需要 .env 里有 Z_AI_API_KEY)
 *
 * v2:猜测不再是纯文字,而是 AI 调用 pose_guess 工具 → 渲染成二选一按钮卡(一点即猜)。
 * 本测试给 GLM 注册 pose_guess 工具(tool_choice=auto,不强制),喂"开始学习"canned prompt,
 * 断言模型【主动】产出了合规的 pose_guess 调用(否则它就没用上新机制):
 *   T1  调用了 pose_guess(不是只用文字给猜测)
 *   T2  prose 钩子非空(先写散文钩子,再调工具)
 *   T3  pose_guess 参数合规:prompt 非空 + 恰好 2 个选项(各有 id+label)
 *   T4  整段(钩子+猜测)不含计分语言(答对/答错/计分/判定)——把猜测当玩,不是考
 *
 * 这是"别让我又在 prompt 末尾粘一段然后嘴硬"的护栏:模型若偷偷只用文字、或给出计分题,这里会红。
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("skip: no API key configured");
  process.exit(0);
}

const SAMPLE_CONTENT =
  "递归:函数在内部调用自身。必须有基线条件(base case)停止,否则无限递归。" +
  "每层调用压栈,栈深过大会 Stack Overflow。典型用例:阶乘、斐波那契、树遍历。";

const SYSTEM =
  "你是 LookatStudy 的 AI 学习导师。用清晰、鼓励的中文回答。\n\n" +
  `当前学习节点:递归(lesson)\n内容:${SAMPLE_CONTENT}\n学习者当前掌握度:未知(首次接触)`;

const USER_PROMPT =
  `我想开始学「递归」。但我现在没什么劲——别直接讲概念,也别出计分题考我。请这样开场:\n` +
  `1. 先用一两句散文抛个钩子(反直觉的、或跟我日常有关的,让我产生好奇);\n` +
  `2. 然后调用 pose_guess 工具,给我一个二选一的小猜测(就是玩,不是考试);\n` +
  `3. 我会点选项猜,你【下一回合】再揭晓,顺带把这课最核心的一点讲清楚。\n` +
  `铁律:起手不要讲座、不要用 generate_quiz 出计分题、不要计分。把我勾住是唯一目标。`;

// 注册 pose_guess 工具(OpenAI function-calling 格式;对齐 agent-engine 的 zod schema)
const tools = [
  {
    type: "function",
    function: {
      name: "pose_guess",
      description:
        "抛一个二选一猜测(是猜/玩,不计分、不是考)。先写一两句散文钩子,再调本工具给猜测问题 + 恰好 2 个选项。",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "猜测的问题" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "选项 id(如 a/b)" },
                label: { type: "string", description: "选项文本" },
              },
              required: ["id", "label"],
            },
          },
        },
        required: ["prompt", "options"],
      },
    },
  },
];

async function callGlm() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: "glm-5.2",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER_PROMPT },
        ],
        tools,
        tool_choice: "auto", // 不强制 —— 测的是模型会不会主动用 pose_guess
        temperature: 0.7,
      }),
    });
    if (r.ok) return (await r.json()).choices?.[0]?.message ?? {};
    if (r.status === 429 && attempt === 0) {
      console.log(`  429 限流,重试一次…`);
      await new Promise((res) => setTimeout(res, 4000));
      continue;
    }
    throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  }
  throw new Error("两次重试后仍失败");
}

console.log("调用 GLM(glm-5.2)模拟「开始学习」v2(带 pose_guess 工具)…\n");
const msg = await callGlm();

const prose = typeof msg.content === "string" ? msg.content : "";
const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
const guessCall = toolCalls.find((c) => c?.function?.name === "pose_guess");

console.log("===== 散文钩子 =====");
console.log(prose || "(无散文,直接调了工具)");
console.log("===== pose_guess 调用 =====");
console.log(guessCall ? JSON.stringify(guessCall.function, null, 2) : "(没调 pose_guess!)");
console.log("===================\n");

// === 断言 ===
function assert(cond, msg) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${msg}`);
    process.exit(1);
  }
}

assert(!!guessCall, `T1 应调用 pose_guess 工具(实际 tool_calls: ${toolCalls.map((c) => c?.function?.name).join(",") || "无"})`);
console.log(`✓ T1 调用了 pose_guess(不是只用文字给猜测)`);

assert(prose.trim().length > 0, `T2 应先写散文钩子再调工具, 实际 prose 长度 ${prose.length}`);
console.log(`✓ T2 散文钩子非空(先暖场,再给猜测)`);

// 解析工具参数
let args = {};
try {
  args = JSON.parse(guessCall.function.arguments || "{}");
} catch {
  assert(false, `T3 pose_guess arguments 不是合法 JSON: ${guessCall.function.arguments}`);
}

assert(typeof args.prompt === "string" && args.prompt.length > 0, `T3 prompt 应非空, 实际: ${args.prompt}`);
assert(Array.isArray(args.options) && args.options.length === 2, `T3 应恰好 2 个选项, 实际: ${args.options?.length}`);
for (const [i, o] of (args.options || []).entries()) {
  assert(typeof o?.id === "string" && typeof o?.label === "string" && o.label, `T3 选项 ${i} 需 id+label, 实际: ${JSON.stringify(o)}`);
}
console.log(`✓ T3 pose_guess 参数合规:prompt + 恰好 2 选项(${args.options.map((o) => o.label).join(" / ")})`);

const fullText = prose + JSON.stringify(args);
const GRADE_WORDS = ["答对", "答错", "计分", "判定对错", "得分", "评分"];
const foundGrade = GRADE_WORDS.filter((w) => fullText.includes(w));
assert(foundGrade.length === 0, `T4 不计分:不应出现 ${JSON.stringify(foundGrade)}`);
console.log(`✓ T4 无计分语言(猜测当玩,不是考)`);

console.log("\n=== HOOK OPENER v2 LIVE TEST PASSED ✅ ===");
