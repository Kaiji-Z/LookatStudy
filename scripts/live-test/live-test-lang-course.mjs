/**
 * Live test: 语言学习课程双轴 —— Step2 判断准不准 + 教学行为改不改(需要 API key)
 *
 * 跑法: npx tsx scripts/live-test/live-test-lang-course.mjs
 *
 * 背景(issue #15, v0.33):中文界面学英语,题目和原文被整体翻译成中文——语言课
 * 失去考察对象。修复 = 双轴:导入 Step2 LLM 判断 languageTarget(被教语言)落库,
 * 命中后基座提示词注入目标语言 carve-out + 教学姿态块,出题语言行双轴。
 *
 * verify 层已锁提示词文本(verify-agent-locale/translation-roles),但"提示词写对"
 * ≠"模型听话"。本测试补行为面,两组真模型调用:
 *
 * A. Step2 判断(与 buildImportModel 同纪律:关思考):
 *   A1 中文写的英语教材 → languageTarget="en"(教材书写语言≠被教语言)
 *   A2 nanoGPT 风格编程仓库 → null(语言只是载体)
 *   A3 中文写的日语 N5 笔记 → "ja"
 * B. 教学 A/B(唯一变量 = buildBaseAgentPrompt 的 targetLang 参数):
 *   对照组(无 target) vs 实验组(target="en")各出一次 generate_quiz:
 *   硬:实验组每题 prompt+options 含英文素材(不被整体翻译成中文)
 *   硬:实验组每题 explanation 含中文(教学语言=界面语言)
 *   软:对照组题干被中文化(证实现状行为,模型默认不完全受控,只记录)
 */
import { readApiKey } from "./_load-env.mjs";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 lang-course live test");
  process.exit(0);
}

const BASE = process.env.Z_AI_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
const MODEL = process.env.Z_AI_MODEL || "glm-5.3-flash";

// 真源导入:提示词/解析改动自动跟随
const { buildRolePrompt, parseRoleResult } = await import("../../src/main/services/import-llm-service.ts");
const { buildBaseAgentPrompt } = await import("../../src/main/services/agent/base-prompt.ts");

const ENDPOINT = `${BASE.replace(/\/$/, "")}/chat/completions`;
const hasCjk = (s) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);
const hasEnglishWord = (s) => /[A-Za-z]{2,}/.test(s);

async function callOnce(body, timeoutMs = 180_000) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).choices?.[0]?.message;
}

let failed = 0;
const failures = [];
const hard = (ok, label) => {
  if (ok) console.log(`✓ ${label}`);
  else { failures.push(label); failed++; console.error(`✗ ${label}`); }
};
const soft = (ok, label) => console.log(`${ok ? "✓" : "⚠(软)"} ${label}`);

/* ══════════ A. Step2 语言课判断 ══════════ */

const fixtures = [
  {
    id: "A1 中文英语教材→en",
    readme:
      "# 英语语法入门\n\n本仓库是面向中文母语者的英语语法学习笔记,按 CEFR A1-A2 编排。\n\n" +
      "## 目录\n- Unit 01: be 动词与人称代词 (I am / you are / he is)\n" +
      "- Unit 02: 一般现在时与第三人称单数 (-s/-es)\n- Unit 03: 一般过去时不规则动词 (go→went, see→saw)\n" +
      "- Unit 04: 现在完成时 have/has + 过去分词\n- Unit 05: 情态动词 can/must/should\n\n" +
      "每课含词汇表、英文例句与中文讲解,句型填空练习附答案。先掌握 500 核心词汇再进入语法点。",
    files: ["units/unit01-be动词.md", "units/unit03-过去时.md", "vocab/core-500.md", "exercises/irregular-verbs.md"],
    tree: ["units/", "vocab/", "exercises/"],
    expect: "en",
    expectSourceLang: "zh-CN",
  },
  {
    id: "A2 英文编程仓库→null",
    readme:
      "# nanoGPT-style tutorial\n\nReimplementation of GPT-2 training in ~300 lines of PyTorch. Follow the lessons in order:\n" +
      "- lessons/1-Intro: tokens and embeddings\n- lessons/2-Attention: self-attention from scratch\n" +
      "- lessons/3-Optim: AdamW and LR schedule\n- src/model.py: the full transformer block\n\n" +
      "Run `python train.py --config base` after each lesson to reproduce the numbers.",
    files: ["lessons/1-Intro/README.md", "lessons/2-Attention/README.md", "src/model.py", "train.py"],
    tree: ["lessons/", "src/"],
    expect: null,
    expectSourceLang: "en",
  },
  {
    id: "A3 中文日语N5笔记→ja",
    readme:
      "# JLPT N5 语法笔记\n\n日语能力考 N5 备战笔记,中文讲解,例句日中对照。\n\n" +
      "## 目录\n- 第01课: です/ます 基本句型\n- 第02课: 助词 は/が/を 的区别\n" +
      "- 第03课: 动词ます形与て形变形\n- 第04课: い形容詞/な形容詞\n\n" +
      "每课附 N5 汉字读音表与听力文本,语法点配 3-5 个日文例句。",
    files: ["lessons/01-desu-masu.md", "lessons/02-joshi.md", "kanji/N5汉字表.md"],
    tree: ["lessons/", "kanji/"],
    expect: "ja",
    expectSourceLang: "zh-CN",
  },
];

console.log(`\n═══ A. Step2 判断(model=${MODEL},关思考,与 buildImportModel 同纪律) ═══`);
for (const f of fixtures) {
  const prompt = buildRolePrompt(f.readme, f.files, [...f.tree, ...f.files]);
  const msg = await callOnce({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    // 机械抽取 = fast 档:glm 家族关思考(import 管线同款 body 补丁)
    thinking: { type: "disabled" },
    max_tokens: 4096,
    temperature: 0.2,
  });
  const parsed = parseRoleResult(msg?.content ?? "", f.files);
  console.log(`\n[${f.id}] sourceLang=${parsed.sourceLang} languageTarget=${parsed.languageTarget} files=${parsed.files.length} degraded=${parsed.degraded}`);
  hard(!parsed.degraded, `[${f.id}] 输出可解析(非 degraded)`);
  hard(parsed.languageTarget === f.expect, `[${f.id}] languageTarget=${JSON.stringify(parsed.languageTarget)} 期望 ${JSON.stringify(f.expect)}`);
  soft(parsed.sourceLang === f.expectSourceLang, `[${f.id}] sourceLang=${parsed.sourceLang}(期望 ${f.expectSourceLang},书写语言独立信号)`);
}

/* ══════════ B. 教学 A/B:generate_quiz 行为 ══════════ */

const nodeContext =
  "课程标题：英语语法入门(CEFR A1-A2)\n" +
  "当前学习节点：Unit 03 一般过去时不规则动词 (lesson)\n" +
  "内容：\n" +
  "# Unit 03 一般过去时不规则动词\n" +
  "一般过去时表示过去发生的动作。规则动词加 -ed,不规则动词需逐个记忆:\n" +
  "- go → went: I went to the store yesterday.\n" +
  "- see → saw: She saw a movie last night.\n" +
  "- eat → ate: We ate ramen for lunch.\n" +
  "- take → took: He took the bus home.\n" +
  "常见时间标志词: yesterday, last night, two days ago.\n\n" +
  "知识点及掌握度（课级掌握度 = 最薄弱知识点）：\n" +
  "  0. 不规则动词变形 (60%)\n  1. 时间标志词 (75%)\n" +
  "（出题/判分时请用 kc 参数标注考察哪个知识点；优先覆盖薄弱项）";

const quizTool = {
  type: "function",
  function: {
    name: "generate_quiz",
    description:
      "生成一组练习题(选择题/判断题),用于巩固当前节点的学习。返回的题目会渲染成可交互的练习卡产物。如果上方有知识点清单,每题用 kc 标注考察哪个知识点,优先覆盖薄弱项。",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "题干" },
              options: { type: "array", items: { type: "string" }, minItems: 2, description: "选项列表" },
              answer: { type: "number", description: "正确选项的索引(从 0 开始)" },
              explanation: { type: "string", description: "为什么这个答案对(答题反馈时展示)" },
              kc: { type: "string", description: "考察的知识点标题" },
            },
            required: ["prompt", "options", "answer", "explanation"],
          },
        },
      },
      required: ["questions"],
    },
  },
};

async function quizRound(targetLang, label) {
  const system = `${buildBaseAgentPrompt("zh-CN", targetLang)}\n\n${nodeContext}`;
  const msg = await callOnce({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: "考考我吧,出 3 道题" },
    ],
    tools: [quizTool],
    tool_choice: "auto",
  });
  const tc = (msg?.tool_calls ?? []).find((t) => t.function?.name === "generate_quiz");
  const content = msg?.content ?? "";
  console.log(`\n[${label}] tool_call=${tc ? "generate_quiz ✓" : "无"} 正文:${content.slice(0, 80).replace(/\n/g, " ") || "(空)"}`);
  if (!tc) return { ok: false, questions: [] };
  let questions = [];
  try { questions = JSON.parse(tc.function.arguments || "{}").questions ?? []; } catch { /* fallthrough */ }
  console.log(`[${label}] ${questions.length} 题`);
  for (const q of questions) console.log(`  - ${String(q.prompt).slice(0, 70)} | 选项: ${q.options?.slice(0, 2).join(" / ").slice(0, 50)}`);
  return { ok: questions.length >= 2, questions };
}

console.log(`\n═══ B. 教学 A/B(唯一变量=targetLang) ═══`);

const control = await quizRound(null, "对照组:无 target(现状行为)");
const treatment = await quizRound("en", "实验组:target=en(语言课双轴)");

hard(treatment.ok, "[实验组] 发出 generate_quiz 且 ≥2 题可解析");
if (treatment.ok) {
  for (const [i, q] of treatment.questions.entries()) {
    const stemMaterial = `${q.prompt} ${q.options?.join(" ") ?? ""}`;
    hard(hasEnglishWord(stemMaterial), `[实验组] 第${i + 1}题 题干/选项含英文素材(目标语言不被整体翻译)`);
    hard(hasCjk(String(q.explanation ?? "")), `[实验组] 第${i + 1}题 解析用中文(教学语言=界面语言)`);
  }
}
if (control.ok) {
  const translatedStems = control.questions.filter((q) => hasCjk(String(q.prompt)) && !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(String(q.prompt))).length;
  soft(
    translatedStems >= 1,
    `[对照组] ${translatedStems}/${control.questions.length} 题干纯中文无英文素材(现状=翻译掉考察对象,与 issue #15 报障一致)`,
  );
} else {
  soft(false, "[对照组] 未出题或解析失败(不影响实验组判定)");
}

if (failed > 0) {
  console.error(`\n=== lang-course live test: FAIL(${failed}) ===\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\n=== lang-course live test: PASS(判断+双轴教学行为均到位) ===");
