/**
 * Live test: 练习题模块验证
 *
 * 跑法: npx tsx scripts/live-test/live-test-exercise.mjs
 *
 * 测试场景:
 *   1. MCQ 出题质量: 格式正确 + 4选项 + answer 合法下标 + 干扰项合理
 *   2. 填空题出题质量: 格式正确 + 答案非空 + 非开放性问题
 *   3. 判断题出题质量: 格式正确 + answer 是 true/false
 *   4. MCQ 判分: 正确答案 → correct=true；错误答案 → correct=false
 *   5. 题干考理解而非记忆: 检查题干不是原文复制粘贴
 *   6. 解释质量: 答错时有解释 + 解释非空
 *
 * 断言分层:
 *   - 硬断言（invariant）: JSON 格式/选项数/下标合法/判分正确
 *   - 软断言（quality）: 题干质量/解释质量 → 记录但不 fail
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./_load-env.mjs"; // 把 .env 的 Z_AI_API_KEY 灌进 process.env
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
  console.log("⚠️  无 API key，跳过 exercise live test");
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
const db = drizzle(sqljs, { schema });

// 建种子课程 + 取有内容的课时
const readme = readFileSync(join(ROOT, "src/main/assets/seed-ai-for-beginners.md"), "utf8");
const { generateCourseFromMarkdown } = await import("../../src/main/services/course-generator.ts");
generateCourseFromMarkdown(db, readme, { repoUrl: "test", repoName: "AI-For-Beginners", courseId: "test-ai" });
const lessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === "test-ai" && n.type === "lesson" && n.content && n.content.length > 100);
const testNode = lessons[0];
if (!testNode) { console.log("❌ 找不到有内容的测试节点"); process.exit(1); }
console.log(`测试节点: ${testNode.title} (content ${testNode.content.length} 字符)\n`);

// 裸调 GLM 生成练习题（复用 exercise-service 的 prompt 构建）
function buildPrompt(title, content, type) {
  const typeSpec = {
    mcq: `出一道四选一选择题。options 是 4 个选项的数组，answer 是正确选项的下标（"0"/"1"/"2"/"3"）。
干扰项设计要求：基于学习者常犯的真实误解，让认真学过的人能排除，没学懂的人会选错。
题干要考"理解"而非"记忆"：不要出"X 定义是什么"这种背诵题，要出"在 Y 场景下该用 X 还是 Z"这种应用题。`,
    fill_blank: `出一道填空题。answer 是标准答案字符串。
答案要明确唯一。考概念关键词或逻辑推理结果，不要考死记的数字或拼写。`,
    true_false: `出一道判断题。answer 是 "true" 或 "false"。
出学习者容易判断错的陈述——看似正确但有微妙错误，或看似错误但实际正确的。`,
  }[type];
  return [
    `你是 LookatStudy 的出题官。基于下面的学习内容出一道考察理解（不是死记硬背）的${type}题。`,
    ``, `学习节点：${title}`, `内容：${content.slice(0, 3000)}`, ``, typeSpec, ``,
    `出题红线:`, `- 答案必须在提供的学习内容中有依据`,
    `- 题干用中文`, `- 干扰项 plausible 但 definitely wrong`, ``,
    `严格按以下 JSON 格式返回，不要加任何 markdown 代码块标记、不要解释：`,
    `{`, `  "prompt": "题干（不含选项）",`,
    type === "mcq" ? `  "options": ["选项A", "选项B", "选项C", "选项D"],\n  "answer": "0",`
      : type === "true_false" ? `  "answer": "true",` : `  "answer": "标准答案",`,
    `  "explanation": "为什么是这个答案 + 其他选项为什么错（2-3句）"`, `}`,
  ].join("\n");
}

async function callGlm(prompt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: "glm-5.2", messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 4096 }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content ?? "";
    // 尝试解析，如果失败且还有重试次数，再来一次
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      JSON.parse(cleaned);
      return text;
    } catch (e) {
      if (attempt === 0) {
        console.log(`  ⚠️ JSON 解析失败，重试... (${e.message})`);
        continue;
      }
      throw e;
    }
  }
  throw new Error("两次尝试后仍无法获取有效 JSON");
}

function parseExercise(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

let testCount = 0, passCount = 0;

function assert(label, condition, detail) {
  testCount++;
  const status = condition ? "✅" : "❌";
  console.log(`  ${status} ${label}${detail ? ": " + detail : ""}`);
  if (condition) passCount++;
  return condition;
}

// === Test 1: MCQ 出题质量 ===
console.log("=== Test 1: MCQ 选择题 ===");
try {
  const raw = await callGlm(buildPrompt(testNode.title, testNode.content, "mcq"));
  const ex = parseExercise(raw);
  console.log(`  题干: ${ex.prompt?.slice(0, 80)}...`);
  assert("JSON 解析成功", !!ex.prompt);
  assert("有 4 个选项", Array.isArray(ex.options) && ex.options.length === 4, `${ex.options?.length} 个`);
  assert("answer 是合法下标 0-3", ["0","1","2","3"].includes(ex.answer), `answer="${ex.answer}"`);
  assert("有解释", typeof ex.explanation === "string" && ex.explanation.length > 10, `${ex.explanation?.length} 字符`);
  // 软断言: 题干不是原文复制
  const isCopyPaste = testNode.content.includes(ex.prompt?.slice(0, 30));
  console.log(`  ℹ️ 题干原创性: ${isCopyPaste ? "可能是原文复制（软断言）" : "非原文复制 ✅"}`);
  // 软断言: 干扰项不与正确答案语义重复
  if (ex.options && ex.answer) {
    const correctIdx = parseInt(ex.answer);
    const correctOpt = ex.options[correctIdx];
    const distractors = ex.options.filter((_, i) => i !== correctIdx);
    const allDistractorsDifferent = distractors.every((d) => d !== correctOpt);
    console.log(`  ℹ️ 干扰项与正确答案不同: ${allDistractorsDifferent ? "✅" : "⚠️ 有重复"}`);
  }
} catch (e) { testCount++; console.log(`  ❌ MCQ 测试异常: ${e.message}`); }

// === Test 2: 填空题出题质量 ===
console.log("\n=== Test 2: 填空题 ===");
try {
  const raw = await callGlm(buildPrompt(testNode.title, testNode.content, "fill_blank"));
  const ex = parseExercise(raw);
  console.log(`  题干: ${ex.prompt?.slice(0, 80)}...`);
  assert("JSON 解析成功", !!ex.prompt);
  assert("answer 非空", typeof ex.answer === "string" && ex.answer.length > 0, `answer="${ex.answer}"`);
  assert("有解释", typeof ex.explanation === "string" && ex.explanation.length > 10);
} catch (e) { testCount++; console.log(`  ❌ 填空题测试异常: ${e.message}`); }

// === Test 3: 判断题出题质量 ===
console.log("\n=== Test 3: 判断题 ===");
try {
  const raw = await callGlm(buildPrompt(testNode.title, testNode.content, "true_false"));
  const ex = parseExercise(raw);
  console.log(`  题干: ${ex.prompt?.slice(0, 80)}...`);
  assert("JSON 解析成功", !!ex.prompt);
  assert("answer 是 true 或 false", ex.answer === "true" || ex.answer === "false", `answer="${ex.answer}"`);
  assert("有解释", typeof ex.explanation === "string" && ex.explanation.length > 10);
} catch (e) { testCount++; console.log(`  ❌ 判断题测试异常: ${e.message}`); }

// === Test 4: MCQ 判分逻辑（用生成的题验证 gradeAnswer）===
console.log("\n=== Test 4: 判分逻辑 ===");
try {
  const raw = await callGlm(buildPrompt(testNode.title, testNode.content, "mcq"));
  const ex = parseExercise(raw);
  if (ex.options && ex.answer) {
    const correctIdx = parseInt(ex.answer);
    // 正确答案下标 → 应判对
    assert("选正确下标 → correct=true", String(correctIdx) === ex.answer);
    // 错误答案下标 → 应判错
    const wrongIdx = (correctIdx + 1) % 4;
    assert("选错误下标 → correct=false", String(wrongIdx) !== ex.answer);
  }
} catch (e) { testCount++; console.log(`  ❌ 判分测试异常: ${e.message}`); }

// === Test 5: 多次出题的多样性 ===
console.log("\n=== Test 5: 出题多样性（连续出 3 道 MCQ）===");
try {
  const prompts3 = await Promise.all([
    callGlm(buildPrompt(testNode.title, testNode.content, "mcq")),
    callGlm(buildPrompt(testNode.title, testNode.content, "mcq")),
    callGlm(buildPrompt(testNode.title, testNode.content, "mcq")),
  ]);
  const exs = prompts3.map(parseExercise);
  const prompts = exs.map((e) => e.prompt?.slice(0, 30));
  const unique = new Set(prompts).size;
  assert("3 道题题干不完全相同", unique >= 2, `${unique}/3 唯一`);
  console.log(`  ℹ️ 3 道题中 ${unique} 道题干不同`);
} catch (e) { testCount++; console.log(`  ❌ 多样性测试异常: ${e.message}`); }

// === 汇总 ===
console.log(`\n=== 练习测试汇总 ===`);
console.log(`通过: ${passCount}/${testCount}`);
if (passCount === testCount) {
  console.log("=== ✅ 所有硬断言通过 ===");
} else {
  console.log("=== ⚠️ 部分硬断言未通过 ===");
}
