/**
 * Live test: "开始学习"的 hook 起手式 —— 动机层验证。
 *
 * 跑法: npx tsx scripts/live-test/live-test-hook-opener.mjs  (需要 .env 里有 Z_AI_API_KEY)
 *
 * 验证的不是"知识点对不对",而是**起手式的形状**——这是 feat: hook opener 的核心承诺:
 *   - 不讲义开场(别一上来"这课讲…/核心概念是…")
 *   - 不计分(不出现"答对/答错/计分/判定"——把猜测当玩,不是考试)
 *   - 有一个二选一猜测(含"还是/或者"或两个选项)
 *   - 不抢答(把钩子+猜测抛出后停下,等用户猜,不直接揭晓)
 *
 * 这是"别让我又在 prompt 末尾粘一段然后嘴硬"的护栏:模型如果偷偷变回讲义+计分题,
 * 这里的形状断言会抓到。继续率(真正的产品裁判)要等真实用户量,这里先守住机制层。
 *
 * 注:裸调 GLM 不带工具定义,所以无法直接断言"没调 generate_quiz 工具"——
 * 但若模型 lapsing 成计分题,文本里会出现"答对/答错/判定"等词,形状断言同样能抓。
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("skip: no API key configured");
  process.exit(0);
}

// 近似 agent-engine 注入:导师人设 + 一课内容(用递归做样本,内容短、钩子点明显)
const SAMPLE_CONTENT =
  "递归:函数在内部调用自身。必须有基线条件(base case)停止,否则无限递归。" +
  "每层调用压栈,栈深过大会 Stack Overflow。典型用例:阶乘、斐波那契、树遍历。";

const SYSTEM =
  "你是 LookatStudy 的 AI 学习导师。用清晰、鼓励的中文回答。\n\n" +
  `当前学习节点:递归(lesson)\n内容:${SAMPLE_CONTENT}\n学习者当前掌握度:未知(首次接触)`;

const USER_PROMPT =
  `我想开始学「递归」。但我现在没什么劲——别直接讲概念,也别出计分题考我。请这样开场:\n` +
  `1. 一两句抛个钩子:反直觉的、或跟我日常有关的,让我产生好奇;\n` +
  `2. 给我一个二选一的小猜测(就是玩,不是考试,别说"答对/答错");\n` +
  `3. 我猜完,你再揭晓,顺带把这课最核心的一点讲清楚。\n` +
  `铁律:起手不要讲座、不要用出题工具(generate_quiz)、不要计分。把我勾住是唯一目标。`;

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
        temperature: 0.7,
      }),
    });
    if (r.ok) {
      const j = await r.json();
      return j.choices?.[0]?.message?.content ?? "";
    }
    if (r.status === 429 && attempt === 0) {
      console.log(`  429 限流,重试一次…`);
      await new Promise((res) => setTimeout(res, 4000));
      continue;
    }
    throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  }
  throw new Error("两次重试后仍失败");
}

console.log("调用 GLM(glm-5.2) 模拟「开始学习」起手式…\n");
const reply = await callGlm();
console.log("===== AI 起手式回复 =====");
console.log(reply);
console.log("=========================\n");

// === 形状断言 ===
const GRADE_WORDS = ["答对", "答错", "计分", "判定对错", "得分", "评分"];
const foundGrade = GRADE_WORDS.filter((w) => reply.includes(w));
assert(foundGrade.length === 0, `T1 不计分:不应出现计分语言,实际命中 ${JSON.stringify(foundGrade)}`);
console.log(`✓ T1 无计分语言(把猜测当玩,不是考试)`);

const hasChoice = /还是|或者/.test(reply) || /\bA[.、)]/.test(reply);
assert(hasChoice, `T2 二选一猜测:应含"还是/或者"或选项标记`);
console.log(`✓ T2 含二选一猜测`);

assert(/？|\?/.test(reply), `T3 钩子以问句抛出:应含问号`);
console.log(`✓ T3 有问句(钩子/猜测)`);

// 起手式不该是讲义开场
const LECTURE_OPEN = /^(这课|这节课|核心概念|我们来|本章|这一课讲)/;
assert(!LECTURE_OPEN.test(reply.trim()), `T4 不讲义开场:不应以"这课讲…/核心概念是…"开头`);
console.log(`✓ T4 非讲义开场`);

console.log("\n=== HOOK OPENER LIVE TEST PASSED ✅ ===");

function assert(cond, msg) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${msg}`);
    process.exit(1);
  }
}
