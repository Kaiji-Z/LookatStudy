/**
 * Live test: 完整导入管线 —— 拉取 → 解析 → LLM 结构化
 *
 * 跑法: npx tsx scripts/live-test/live-test-import-pipeline.mjs
 *
 * 需要: Z_AI_API_KEY 环境变量（或 ~/.config/opencode/opencode.json 里的 key）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./_load-env.mjs"; // 把 .env 的 Z_AI_API_KEY 灌进 process.env
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import {
  detectRepoPattern,
  filterLessonFiles,
  fetchMarkdownContents,
  buildCourseFromFiles,
} from "../../src/main/services/pure/repo-fetcher.ts";
import { generateCourseFromRepoFiles } from "../../src/main/services/course-generator.ts";
import {
  analyzeCourseStructure,
  applyCourseStructure,
} from "../../src/main/services/course-structure-service.ts";

// === 读取 API key ===
function readApiKey() {
  if (process.env.Z_AI_API_KEY) return process.env.Z_AI_API_KEY;
  if (process.env.ZHIPU_API_KEY) return process.env.ZHIPU_API_KEY;
  try {
    const cfg = JSON.parse(
      readFileSync(
        join(process.env.HOME || process.env.USERPROFILE, ".config/opencode/opencode.json"),
        "utf8",
      ),
    );
    return cfg.mcp?.["zai-mcp-server"]?.environment?.Z_AI_API_KEY;
  } catch {
    return null;
  }
}

const API_KEY = readApiKey();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const TEST_REPO = "microsoft/AI-For-Beginners";
const COURSE_ID = "test-aifb-live";

console.log("=== Live Test: 完整导入管线 ===");
console.log("仓库:", TEST_REPO);
console.log("API Key:", API_KEY ? `已配置 (${API_KEY.slice(0, 6)}…)` : "❌ 未配置（将跳过 LLM 结构化）");
console.log("");

// === 建内存 DB ===
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);

// 注入 API key 到 settings（用 ZAI CodingPlan 接口 + glm-5.2）
if (API_KEY) {
  sqljs.run("INSERT INTO settings (key, value, is_secret) VALUES ('glm_api_key', ?, 1)", [API_KEY]);
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'glm')");
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')");
  // 覆盖 glm 预设的 baseUrl 为 CodingPlan 接口（用户实际使用的端点）
  // 通过 settings 表的 glm_base_url 覆盖（如果 resolver 支持），否则直接改 provider 配置
  // 这里直接注入一个自定义 provider 行
  sqljs.run(
    "INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES (?, ?, ?, ?, ?, ?)",
    ["custom-live-test", "ZAI CodingPlan (live test)", "openai-compatible", "https://api.z.ai/api/coding/paas/v4", API_KEY, "glm-5.2"],
  );
  sqljs.run("UPDATE settings SET value = 'custom-live-test' WHERE key = 'active_provider'");
}

const db = drizzle(sqljs, { schema });

// === Step 1: 拉 README ===
console.log("Step 1: 拉取 README…");
const readme = await (await fetch(`https://cdn.jsdelivr.net/gh/${TEST_REPO}@main/README.md`)).text();
console.log(`  ✓ ${readme.length} 字符`);

// === Step 2: 检测形态 ===
console.log("Step 2: 检测仓库形态…");
const detection = detectRepoPattern(readme);
console.log(`  ✓ ${detection.pattern} — ${detection.reason}`);
const lessonFiles = filterLessonFiles(detection.lessonFiles || []);
console.log(`  发现 ${lessonFiles.length} 个课时文件`);

// === Step 3: 批量拉取 ===
console.log("Step 3: 批量拉取 .md 文件…");
const fetched = await fetchMarkdownContents(
  lessonFiles, "microsoft", "AI-For-Beginners", "main", fetch,
  (done, total, path) => {
    if (done % 10 === 0 || done === total) process.stdout.write(`  ${done}/${total}\r`);
  },
);
console.log(`  ✓ 成功 ${fetched.ok.length}, 失败 ${fetched.failed.length}`);
if (fetched.failed.length > 0) {
  console.log(`  失败列表: ${fetched.failed.map((f) => f.path).slice(0, 5).join(", ")}`);
}

// === Step 4: 合并成课程 ===
console.log("Step 4: 合并成课程结构…");
const titleMatch = readme.match(/^#\s+(.+)$/m);
const courseTitle = titleMatch ? titleMatch[1].trim() : "AI-For-Beginners";
const parsed = buildCourseFromFiles(courseTitle, fetched.ok);
const totalLessons = parsed.sections.reduce((s, sec) => s + sec.lessons.length, 0);
console.log(`  ✓ 原始结构: ${parsed.sections.length} section / ${totalLessons} lesson`);

// === Step 5: 落库 ===
console.log("Step 5: 写入数据库…");
const genResult = generateCourseFromRepoFiles(db, parsed, {
  repoUrl: `https://github.com/${TEST_REPO}`,
  repoName: "AI-For-Beginners",
  courseId: COURSE_ID,
});
console.log(`  ✓ ${genResult.sectionCount} section / ${genResult.lessonCount} lesson`);

// 检查内容覆盖率
const lessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.type === "lesson" && n.courseId === COURSE_ID);
const withContent = lessons.filter((l) => l.content && l.content.length > 20);
console.log(`  内容覆盖: ${withContent.length}/${lessons.length} 课时有正文`);

// === Step 6: LLM 结构化（如果有 key） ===
if (!API_KEY) {
  console.log("\n⚠️  无 API key，跳过 LLM 结构化测试");
  console.log("\n=== 导入管线测试完成（无 LLM 结构化）===");
  process.exit(0);
}

console.log("\nStep 6: LLM 结构化…");
console.log("  调用 GLM 分析", lessons.length, "个课时…");

try {
  const proposal = await analyzeCourseStructure(db, COURSE_ID);
  console.log(`  ✓ LLM 返回: ${proposal.sections.length} 章节, 跳过 ${proposal.skippedNodeIds.length} 节点`);
  console.log("");
  console.log("  LLM 分组结果:");
  for (const sec of proposal.sections) {
    console.log(`    📁 ${sec.title} (${sec.lessonIds.length} 课)`);
    console.log(`       ${sec.summary}`);
  }
  if (proposal.skippedNodeIds.length > 0) {
    console.log(`    🗑️ 跳过: ${proposal.skippedNodeIds.length} 个 lab/练习节点`);
  }

  // 落库
  console.log("\n  应用结构到 DB…");
  const applyResult = applyCourseStructure(db, COURSE_ID, proposal);
  console.log(`  ✓ ${applyResult.sectionCount} section / ${applyResult.lessonCount} lesson / ${applyResult.skippedCount} skipped`);

  // 验证结果
  const finalSections = db.select().from(schema.contentNodes).all()
    .filter((n) => n.type === "section" && n.courseId === COURSE_ID)
    .sort((a, b) => a.orderIdx - b.orderIdx);
  console.log("\n  最终章节结构:");
  for (const sec of finalSections) {
    const childLessons = db.select().from(schema.contentNodes).all()
      .filter((n) => n.parentId === sec.id && n.type === "lesson");
    console.log(`    ${sec.orderIdx + 1}. ${sec.title} (${childLessons.length} 课)`);
    if (sec.content) console.log(`       → ${sec.content}`);
  }

  console.log(`\n=== ✅ 完整管线测试通过 ===`);
  console.log(`从 ${parsed.sections.length} 个碎片 → ${applyResult.sectionCount} 个教学章节`);
} catch (e) {
  console.error(`\n❌ LLM 结构化失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
