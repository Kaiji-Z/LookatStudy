/**
 * 真实导入全管线测试(含 LLM 结构化):
 * 拉 GitHub → 落库 → LLM 判 world + 重构 → 验证两个世界分类。
 *
 * 用法: npx tsx scripts/live-test/live-test-world-llm.mjs
 * 需要: Z_AI_API_KEY (走 GLM LLM 结构化)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import {
  detectRepoPattern,
  filterLessonFiles,
  fetchMarkdownContents,
  buildCourseFromFiles,
  importRepoToParsedCourse,
} from "../../src/main/services/pure/repo-fetcher.ts";
import { generateCourseFromRepoFiles } from "../../src/main/services/course-generator.ts";
import {
  analyzeCourseStructure,
  applyCourseStructure,
} from "../../src/main/services/course-structure-service.ts";

const API_KEY = readApiKey();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const TEST_REPO = "microsoft/AI-For-Beginners";
const COURSE_ID = "test-aifb-world";

console.log("=== Live Test: 两个世界全管线 ===");
console.log("仓库:", TEST_REPO);
console.log("API Key:", API_KEY ? `✅ (${API_KEY.slice(0, 6)}…)` : "❌ 未配置");
console.log("");

// === 建内存 DB ===
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
// 加 world 列
try { sqljs.run("ALTER TABLE content_nodes ADD COLUMN world TEXT NOT NULL DEFAULT 'study' CHECK (world IN ('study','practice'))"); } catch {}

// 注入 API key
if (API_KEY) {
  sqljs.run("INSERT INTO settings (key, value, is_secret) VALUES ('glm_api_key', ?, 1)", [API_KEY]);
  sqljs.run("INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES (?, ?, ?, ?, ?, ?)",
    ["custom-live-test", "ZAI CodingPlan", "openai-compatible", "https://api.z.ai/api/coding/paas/v4", API_KEY, "glm-5.2"]);
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-live-test')");
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')");
}
const db = drizzle(sqljs, { schema });

// === Step 1: 用 importRepoToParsedCourse 拉取(内部处理 SSL 重试) ===
console.log("Step 1: 拉取仓库(importRepoToParsedCourse)…");
const importResult = await importRepoToParsedCourse("microsoft", "AI-For-Beginners", "main", fetch,
  (msg) => process.stdout.write(`\r  ${msg.slice(0,70).padEnd(70)}`));
console.log("\n");
const parsed = importResult.course;
const totalLessons = parsed.sections.reduce((s, sec) => s + sec.lessons.length, 0);
console.log(`  ✓ ${parsed.sections.length} section / ${totalLessons} lesson`);

console.log("Step 2: 落库…");
const genResult = generateCourseFromRepoFiles(db, parsed, {
  repoUrl: `https://github.com/${TEST_REPO}`,
  repoName: "AI-For-Beginners",
  courseId: COURSE_ID,
});
console.log(`  ✓ ${genResult.sectionCount} section / ${genResult.lessonCount} lesson`);

// 统计 notebook/lab(实操候选)
const allLessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.type === "lesson" && n.courseId === COURSE_ID);
const notebooks = allLessons.filter((l) => (l.sourcePath ?? "").endsWith(".ipynb"));
const labs = allLessons.filter((l) => /\/lab\//.test(l.sourcePath ?? ""));
console.log(`  实操候选: ${notebooks.length} notebook + ${labs.length} lab`);

if (!API_KEY) {
  console.log("\n⚠️ 无 API key,跳过 LLM 结构化");
  process.exit(0);
}

// === Step 5: LLM 结构化 ===
console.log("\nStep 5: LLM 结构化(判 world + 分组)…");
const proposal = await analyzeCourseStructure(db, COURSE_ID);
console.log(`  ✓ ${proposal.sections.length} 章节, 跳过 ${proposal.skippedNodeIds.length} 节点`);

// 看每个 section 的 world
console.log("\n=== LLM 分组结果(含 world) ===");
for (const sec of proposal.sections) {
  const icon = sec.world === "practice" ? "🔧" : "📚";
  console.log(`  ${icon} [${sec.world}] ${sec.title} (${sec.lessonIds.length} 课)`);
  console.log(`     ${sec.summary}`);
}

console.log(`  🗑️ 跳过: ${proposal.skippedNodeIds.length} 节点`);

// === Step 6: 落库 ===
console.log("\nStep 6: 应用结构到 DB…");
const applyResult = applyCourseStructure(db, COURSE_ID, proposal);
console.log(`  ✓ ${applyResult.sectionCount} section / ${applyResult.lessonCount} lesson / ${applyResult.skippedCount} skipped`);

// === Step 7: 验证 world 分布 ===
console.log("\n=== 落库后 world 分布 ===");
const finalNodes = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === COURSE_ID);
const studySections = finalNodes.filter((n) => n.type === "section" && (n.world ?? "study") === "study");
const practiceSections = finalNodes.filter((n) => n.type === "section" && n.world === "practice");
const studyLessons = finalNodes.filter((n) => n.type === "lesson" && (n.world ?? "study") === "study");
const practiceLessons = finalNodes.filter((n) => n.type === "lesson" && n.world === "practice");
console.log(`📚 学习世界: ${studySections.length} sections, ${studyLessons.length} lessons`);
console.log(`🔧 实操世界: ${practiceSections.length} sections, ${practiceLessons.length} lessons`);

console.log("\n=== 学习世界 sections ===");
studySections.sort((a, b) => a.orderIdx - b.orderIdx).forEach((s) => {
  const cnt = finalNodes.filter((n) => n.parentId === s.id && n.type === "lesson").length;
  console.log(`  ${s.title} (${cnt} lessons)`);
});

console.log("\n=== 实操世界 sections ===");
practiceSections.sort((a, b) => a.orderIdx - b.orderIdx).forEach((s) => {
  const lessons = finalNodes.filter((n) => n.parentId === s.id && n.type === "lesson");
  console.log(`  ${s.title} (${lessons.length} lessons)`);
  lessons.slice(0, 5).forEach((l) => console.log(`    ${(l.sourcePath ?? "").endsWith(".ipynb") ? "📓" : "🔧"} ${l.title.slice(0,40)}`));
  if (lessons.length > 5) console.log(`    ... 还有 ${lessons.length - 5} 个`);
});

console.log("\n=== 测试完成 ===");
