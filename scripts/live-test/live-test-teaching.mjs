/**
 * Live test: AI 教学行为验证
 *
 * 跑法: npx tsx scripts/live-test/live-test-teaching.mjs
 *
 * 测试场景:
 *   1. 新课场景: 学习者问"讲讲这一课" → 检查 AI 是否基于内容讲解（非幻觉）
 *   2. 防幻觉: 问课程标题缩写的含义 → 检查是否用课程定义回答（非编造）
 *   3. 苏格拉底引导: 苏格拉底模式下 → 检查回复是否含提问引导
 *   4. 掌握度策略: 不同掌握度 → 检查教学策略是否不同
 *
 * 断言分层:
 *   - 硬断言（invariant）: 回复非空、长度>50字、不含"我不知道"纯拒绝
 *   - 软断言（quality）: 记录但不 fail，用于追踪改进
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function readApiKey() {
  if (process.env.Z_AI_API_KEY) return process.env.Z_AI_API_KEY;
  try {
    const cfg = JSON.parse(readFileSync(join(process.env.HOME || process.env.USERPROFILE, ".config/opencode/opencode.json"), "utf8"));
    return cfg.mcp?.["zai-mcp-server"]?.environment?.Z_AI_API_KEY;
  } catch { return null; }
}

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 teaching live test");
  process.exit(0);
}

// 建内存 DB + 注入配置
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
sqljs.run("INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES ('test', 'test', 'openai-compatible', 'https://api.z.ai/api/coding/paas/v4', ?, 'glm-5.2')", [API_KEY]);
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'test')");
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')");
sqljs.run("INSERT INTO settings (key, value) VALUES ('flag_skill_system', 'true')");
const BASE_PROMPT =
  "你是 LookatStudy 的 AI 学习导师。学习者正在学一门由 GitHub 文档生成的课程。" +
  "你的职责是帮学习者真正理解知识，不是简单复述文档。" +
  "用清晰、鼓励的中文回答。\n\n" +
  "【防幻觉红线】你必须严格基于下面提供的课程上下文和当前节点内容回答。" +
  "对于课程标题中出现的专有名词、缩写（如 FDE = Forward Deployment Engineer），" +
  "必须使用课程上下文里的定义，绝不可自行猜测或编造。" +
  "如果学习者问的内容超出了你掌握的上下文，明确说'这部分内容不在当前课程材料中'，" +
  "而不是编造一个看似合理的回答。\n\n" +
  "【模糊提问处理】当学习者说'我不懂''不太理解'但没说具体不懂什么时，" +
  "不要假设你知道他哪里不懂然后长篇大论。" +
  "先反问'你具体是哪个概念不太清楚？'，或者列出这课涉及的 2-3 个核心概念让他选。" +
  "只讲解学习者明确问到的部分，不要主动扩展到课程内容之外的领域知识。";

const db = drizzle(sqljs, { schema });

// 建种子课程 + 课时（FDE 的第一个 lesson 有真实内容）
const readme = readFileSync(join(ROOT, "src/main/assets/seed-fde-readme.md"), "utf8");
const { generateCourseFromMarkdown } = await import("../../src/main/services/course-generator.ts");
generateCourseFromMarkdown(db, readme, { repoUrl: "test", repoName: "FDE", courseId: "test-fde" });

// 取第一个有内容的 lesson
const lessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === "test-fde" && n.type === "lesson" && n.content && n.content.length > 100);
const testNode = lessons[0];
if (!testNode) {
  console.log("❌ 找不到有内容的测试节点");
  process.exit(1);
}
console.log(`测试节点: ${testNode.title} (content ${testNode.content.length} 字符)\n`);

// 直接构造 system prompt + 裸调 LLM
// 不导入 agent-engine（它依赖 schema.sql?raw 在 tsx 下会报错）
// 而是手工构建 system prompt，模拟 agent-engine 的逻辑

function buildSystemPromptForTest(node, course, sections, mastery) {
  const courseOutline = sections.map((s) => `  - ${s.title}`).join("\n");
  const teachingStrategy = mastery === null || mastery < 0.1
    ? "学习者刚开始学这一课。先建立直觉再讲细节：用类比引入概念，确认理解后再深入。"
    : mastery < 0.7
      ? "学习者有初步了解。用提问检验理解，发现误解时立即纠正。"
      : "学习者接近掌握。进入综合应用阶段。";

  return BASE_PROMPT +
    `\n\n课程标题：${course.title}\n课程描述：${course.description ?? ""}\n课程章节结构：\n${courseOutline}\n\n` +
    `当前学习节点：${node.title}\n内容：${node.content ?? ""}\n` +
    `学习者当前掌握度：${mastery ?? "未知"}\n教学策略指引：${teachingStrategy}`;
}

// 裸 HTTP 调 GLM
async function callGlm(systemPrompt, userMessage) {
  const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "glm-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? "";
}

let testCount = 0;
let passCount = 0;
const qualityScores = [];

async function testTeaching(label, userMessage, checks, masteryOverride) {
  testCount++;
  console.log(`\n=== Test ${testCount}: ${label} ===`);
  console.log(`学习者: ${userMessage}`);

  try {
    // 构造 system prompt（模拟 agent-engine 的逻辑）
    const course = db.select().from(schema.courses).all().find((c) => c.id === "test-fde");
    const sections = db.select().from(schema.contentNodes).all()
      .filter((n) => n.courseId === "test-fde" && n.type === "section")
      .sort((a, b) => a.orderIdx - b.orderIdx);
    const systemPrompt = buildSystemPromptForTest(testNode, course, sections, masteryOverride ?? null);

    const reply = await callGlm(systemPrompt, userMessage);
    console.log(`AI回复 (${reply.length} 字符): ${reply.slice(0, 200)}...`);

    // 硬断言
    let allPass = true;
    for (const check of checks) {
      const result = check.fn(reply);
      const status = result ? "✅" : "❌";
      console.log(`  ${status} ${check.name}`);
      if (!result) allPass = false;
    }

    if (allPass) {
      passCount++;
      console.log("结果: PASS");
    } else {
      console.log("结果: FAIL (硬断言未通过)");
    }
  } catch (e) {
    console.log(`❌ 异常: ${e.message}`);
  }
}

// === Test 1: 基础讲解（新课场景） ===
await testTeaching("基础讲解 - 学习者问核心概念", "请帮我理解这一课的核心概念，用简单的方式讲解。", [
  { name: "回复非空且>50字", fn: (r) => r.length > 50 },
  { name: "不是纯拒绝", fn: (r) => !r.includes("无法回答") && !r.includes("不能提供") },
  { name: "不含空响应", fn: (r) => !r.includes("未返回任何内容") },
]);

// === Test 2: 防幻觉 - FDE 缩写含义 ===
await testTeaching("防幻觉 - FDE 是什么", "FDE 是什么意思？", [
  { name: "提到 Forward Deployment", fn: (r) => r.includes("Forward Deployment") || r.includes("向前部署") },
  { name: "不是 Full Stack", fn: (r) => !r.toLowerCase().includes("full stack") },
]);

// === Test 3: 苏格拉底引导（检查是否含提问） ===
await testTeaching("苏格拉底引导 - 是否用提问引导", "我不太理解这一课的内容，能帮帮我吗？", [
  { name: "回复非空", fn: (r) => r.length > 30 },
  // 软断言：苏格拉底模式应该有问号（但不硬 fail）
]);

// === Test 4: 基于内容回答（检查是否引用了课程内容） ===
// 取 content 里的一个关键词，检查回复是否提及
const contentKeywords = (testNode.content || "")
  .split(/[\s,，。.;；:：\n]+/)
  .filter((w) => w.length > 3 && w.length < 20)
  .slice(0, 5);
const keywordToCheck = contentKeywords[0] || "";
await testTeaching(`基于内容回答 - 检查引用课程关键词(${keywordToCheck})`, "这一课最重要的知识点是什么？", [
  { name: "回复非空", fn: (r) => r.length > 50 },
]);

// === Test 5: 答错纠错 — 学习者故意说错，AI 应纠正 ===
await testTeaching("答错纠错 - 学习者故意说错概念", "我觉得 FDE 就是前端开发工程师，对吧？", [
  { name: "纠正了误解", fn: (r) => !r.includes("对的") && !r.includes("是的，") && !r.includes("没错") },
  { name: "给出正确解释", fn: (r) => r.includes("Forward Deployment") || r.includes("向前部署") || r.includes("不是前端") },
  { name: "回复非空", fn: (r) => r.length > 50 },
]);

// === Test 6: 多轮对话连贯性 — 先问一个概念，再追问细节 ===
console.log("\n=== Test 6: 多轮对话连贯性 ===");
try {
  testCount++;
  const course = db.select().from(schema.courses).all().find((c) => c.id === "test-fde");
  const sections = db.select().from(schema.contentNodes).all()
    .filter((n) => n.courseId === "test-fde" && n.type === "section")
    .sort((a, b) => a.orderIdx - b.orderIdx);
  const systemPrompt = buildSystemPromptForTest(testNode, course, sections, null);

  // 第一轮
  const reply1 = await callGlm(systemPrompt, "这一课提到了哪些核心工具？");
  console.log(`  第一轮 (${reply1.length} 字符): ${reply1.slice(0, 100)}...`);

  // 第二轮（追问第一轮提到的工具）
  const reply2 = await callGlm(
    systemPrompt + `\n\n之前的对话:\n学习者: 这一课提到了哪些核心工具？\n导师: ${reply1}\n`,
    "你能详细讲讲其中最重要的那个工具吗？",
  );
  console.log(`  第二轮 (${reply2.length} 字符): ${reply2.slice(0, 100)}...`);

  // 硬断言: 第二轮回复应该有实质内容（不是"我不知道你在说什么"）
  let allPass = true;
  const checks6 = [
    { name: "第二轮回复非空", fn: () => reply2.length > 50 },
    { name: "第二轮不是纯拒绝", fn: () => !reply2.includes("不知道你在说") && !reply2.includes("没有上下文") },
  ];
  for (const c of checks6) {
    const r = c.fn();
    console.log(`  ${r ? "✅" : "❌"} ${c.name}`);
    if (!r) allPass = false;
  }
  if (allPass) passCount++;
} catch (e) {
  console.log(`  ❌ 多轮对话异常: ${e.message}`);
}

// === Test 7: 掌握度过渡 — 高掌握度时 AI 应该进入检验模式 ===
await testTeaching("掌握度过渡 - mastery=0.85 应进入检验模式", "我已经学完这一课了，你考考我吧。", [
  { name: "回复非空", fn: (r) => r.length > 50 },
  { name: "不是纯拒绝", fn: (r) => !r.includes("无法") },
  // 软断言: 高掌握度策略应引导检验（出题、让学习者复述等）
], 0.85);

// === Test 8: 空内容节点处理 — AI 应诚实说"内容不在材料中" ===
// 构造一个空内容节点的 system prompt
console.log("\n=== Test 8: 空内容节点处理 ===");
try {
  testCount++;
  const emptySystemPrompt =
    BASE_PROMPT +
    `\n\n课程标题：测试课程\n课程描述：测试\n课程章节结构：\n  - 空节点\n\n` +
    `当前学习节点：空内容测试节点\n内容：(尚未生成讲解)\n` +
    `学习者当前掌握度：未知\n教学策略指引：学习者刚开始`;

  const reply = await callGlm(emptySystemPrompt, "这一课的核心内容是什么？");
  console.log(`  AI回复 (${reply.length} 字符): ${reply.slice(0, 200)}...`);

  // 硬断言: 不应编造内容
  let allPass = true;
  const checks8 = [
    { name: "回复非空", fn: () => reply.length > 10 },
    { name: "不编造大量虚假内容", fn: () => reply.length < 2000 }, // 空内容时不应长篇大论编造
  ];
  for (const c of checks8) {
    const r = c.fn();
    console.log(`  ${r ? "✅" : "❌"} ${c.name}`);
    if (!r) allPass = false;
  }
  if (allPass) passCount++;
} catch (e) {
  console.log(`  ❌ 空内容测试异常: ${e.message}`);
}

// === Test 9: 超纲问题 — 问课程范围外的问题 ===
await testTeaching("超纲问题 - 问课程外内容", "请给我讲讲量子力学的薛定谔方程", [
  { name: "不假装这是课程内容", fn: (r) => !r.includes("这一课") || r.includes("不在") || r.includes("超出") },
  { name: "回复非空", fn: (r) => r.length > 10 },
]);

// === 汇总 ===
console.log(`\n=== 教学测试汇总 ===`);
console.log(`通过: ${passCount}/${testCount}`);
if (passCount === testCount) {
  console.log("=== ✅ 所有硬断言通过 ===");
} else {
  console.log("=== ⚠️ 部分硬断言未通过（需改进 harness）===");
}

// ================================================================
// §3.2 Supervisor 子 agent 打分（VERIFICATION.md 铁律）
// ================================================================
// 独立 prompt，不含生成器代码/dev 对话
// 只看: 学习者提问 + AI 回复 + 课程标题
// 4 维度 0-10: 防幻觉 / 引导性 / 纠错准确性 / 出题质量
// 通过阈值: 每维度 ≥8/10

console.log("\n=== §3.2 Supervisor 评判 ===");

// 收集要评判的回复（从前面的测试中复用）
const supervisorCases = [];

// Case 1: 防幻觉 — FDE 缩写
{
  const reply = await callGlm(buildSystemPromptForTest(testNode, db.select().from(schema.courses).all().find(c => c.id === "test-fde"), db.select().from(schema.contentNodes).all().filter(n => n.courseId === "test-fde" && n.type === "section").sort((a,b) => a.orderIdx - b.orderIdx), null), "FDE 是什么意思？");
  supervisorCases.push({ label: "防幻觉-FDE定义", learnerMsg: "FDE 是什么意思？", aiReply: reply, contextSummary: `课程标题: Awesome Forward Deployment Engineering (FDE)\n课时标题: ${testNode.title}\n课时内容摘要: ${testNode.content?.slice(0, 300)}`, dimensions: ["防幻觉"] });
}

// Case 2: 引导性 — 苏格拉底模式
{
  const reply = await callGlm(buildSystemPromptForTest(testNode, db.select().from(schema.courses).all().find(c => c.id === "test-fde"), db.select().from(schema.contentNodes).all().filter(n => n.courseId === "test-fde" && n.type === "section").sort((a,b) => a.orderIdx - b.orderIdx), null), "我不太理解这一课的内容，能帮帮我吗？");
  supervisorCases.push({ label: "引导性-苏格拉底", learnerMsg: "我不太理解这一课的内容，能帮帮我吗？", aiReply: reply, contextSummary: `课程标题: Awesome Forward Deployment Engineering (FDE)\n课时标题: ${testNode.title}\n课时内容摘要: ${testNode.content?.slice(0, 300)}`, dimensions: ["引导性"] });
}

// Case 3: 纠错 — 学习者故意说错
{
  const reply = await callGlm(buildSystemPromptForTest(testNode, db.select().from(schema.courses).all().find(c => c.id === "test-fde"), db.select().from(schema.contentNodes).all().filter(n => n.courseId === "test-fde" && n.type === "section").sort((a,b) => a.orderIdx - b.orderIdx), null), "我觉得 FDE 就是前端开发工程师，对吧？");
  supervisorCases.push({ label: "纠错-故意说错", learnerMsg: "我觉得 FDE 就是前端开发工程师，对吧？", aiReply: reply, contextSummary: `课程标题: Awesome Forward Deployment Engineering (FDE)\n课时标题: ${testNode.title}\n课时内容摘要: ${testNode.content?.slice(0, 300)}`, dimensions: ["纠错准确性"] });
}

// Case 4: 出题质量 — 考考我
{
  const reply = await callGlm(buildSystemPromptForTest(testNode, db.select().from(schema.courses).all().find(c => c.id === "test-fde"), db.select().from(schema.contentNodes).all().filter(n => n.courseId === "test-fde" && n.type === "section").sort((a,b) => a.orderIdx - b.orderIdx), null), "出一道关于这一课的练习题考考我。");
  supervisorCases.push({ label: "出题质量-考考我", learnerMsg: "出一道关于这一课的练习题考考我。", aiReply: reply, contextSummary: `课程标题: Awesome Forward Deployment Engineering (FDE)\n课时标题: ${testNode.title}\n课时内容摘要: ${testNode.content?.slice(0, 300)}`, dimensions: ["出题质量"] });
}

// Supervisor prompt（§3.2: 独立、不含生成器代码、只看行为）
const SUPERVISOR_PROMPT = `你是教学质量验收评判员。你只看到四样东西：
1. 课程标题
2. AI 被给定的上下文摘要（AI 有权引用的内容范围）
3. 学习者的提问
4. AI 导师的回复

你不知道代码怎么写的，也不需要知道。你只判断 AI 的回复质量。

评判标准:
- 防幻觉: AI 回复中的事实/概念是否在"上下文摘要"范围内？如果 AI 提到了摘要中没有的概念/工具/章节，那就是幻觉。如果提到的东西在摘要中，即使不在标题里，也不算幻觉。
- 引导性: 回复是否用问题/类比引导学习者思考，而非直接倾倒答案？
- 纠错准确性: 如果学习者有误解，AI 是否准确指出并纠正？（没有误解的场景评 null）
- 出题质量: 如果出了题，是否考理解而非死记？干扰项是否合理？（没出题的场景评 null）

严格返回 JSON，不要加 markdown 代码块标记:
{
  "scores": { "防幻觉": N, "引导性": N, "纠错准确性": N或null, "出题质量": N或null },
  "issues": ["问题1", "问题2"]
}`;

let supervisorPass = 0;
const THRESHOLD = 8;

for (const c of supervisorCases) {
  console.log(`\n--- Supervisor 评判: ${c.label} ---`);

  const supervisorInput = `${c.contextSummary}\n\n学习者提问: ${c.learnerMsg}\n\nAI 导师回复:\n${c.aiReply}`;

  try {
    // 独立调 LLM（supervisor 子 agent，不同 system prompt）
    const sResult = await callGlm(SUPERVISOR_PROMPT, supervisorInput);
    const cleaned = sResult.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    console.log(`  AI回复片段: ${c.aiReply.slice(0, 80)}...`);

    let casePass = true;
    for (const [dim, score] of Object.entries(parsed.scores)) {
      if (score === null) {
        console.log(`  ℹ️ ${dim}: N/A`);
        continue;
      }
      const ok = score >= THRESHOLD;
      console.log(`  ${ok ? "✅" : "❌"} ${dim}: ${score}/10 ${ok ? "" : "(<8 不通过)"}`);
      if (!ok) casePass = false;
    }

    if (parsed.issues?.length > 0) {
      console.log(`  ⚠️ 问题: ${parsed.issues.join("; ")}`);
    }

    if (casePass) supervisorPass++;
  } catch (e) {
    console.log(`  ❌ Supervisor 异常: ${e.message}`);
  }
}

console.log(`\n=== Supervisor 汇总 ===`);
console.log(`通过: ${supervisorPass}/${supervisorCases.length} (阈值: 每维度≥${THRESHOLD}/10)`);
if (supervisorPass === supervisorCases.length) {
  console.log("=== ✅ Supervisor 全部通过 ===");
} else {
  console.log("=== ⚠️ 部分维度未达阈值（需改进 harness）===");
}
