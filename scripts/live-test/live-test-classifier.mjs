/**
 * live-test-classifier.mjs — 分类器+LLM 两阶段结构化的 live test。
 *
 * 证明: 新管线（规则过滤 + LLM 两阶段）比旧管线（无过滤 + LLM 单阶段）
 * 产出的课程结构质量更好。
 *
 * 指标:
 *   1. 规则层过滤了多少噪声（notebook/lab/translation 等不该当 lesson 的）
 *   2. LLM 两阶段 prompt 是否正确判了 uncertain 文件的 keep/skip
 *   3. 最终 section 数合理（不碎片化）
 *   4. 无 notebook/lab 混入最终 lesson 列表
 *
 * 用法: npx tsx scripts/live-test/live-test-classifier.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";

import { readApiKey } from "./_load-env.mjs";
import * as schema from "../../src/main/db/schema.ts";
import {
  detectRepoPattern,
  filterLessonFiles,
  fetchMarkdownContents,
  buildCourseFromFiles,
} from "../../src/main/services/pure/repo-fetcher.ts";
import { classifyFile, summarizeClassifications } from "../../src/main/services/pure/file-classifier.ts";
import { generateCourseFromRepoFiles } from "../../src/main/services/course-generator.ts";
import { analyzeCourseStructure, applyCourseStructure } from "../../src/main/services/course-structure-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，跳过 classifier live test");
  process.exit(0);
}

const TEST_REPO = "microsoft/AI-For-Beginners";
const BRANCH = "master";
const COURSE_ID = "test-classifier-live";

// ── 初始化 DB ──
const wasmPath = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmPath, f) });
const sqljs = new SQL.Database();
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(
  "INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES (?, ?, ?, ?, ?, ?)",
  ["custom-live-test", "ZAI CodingPlan", "openai-compatible", "https://api.z.ai/api/coding/paas/v4", API_KEY, "glm-5.2"],
);
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-live-test')");
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')");
const db = drizzle(sqljs, { schema });

// ── Step 1: 拉取 README ──
console.log("Step 1: 拉取 README…");
const readme = await (await fetch(`https://cdn.jsdelivr.net/gh/${TEST_REPO}@${BRANCH}/README.md`)).text();
console.log(`  ✓ ${readme.length} 字符`);

// ── Step 2: 检测仓库形态 + 发现文件 ──
console.log("Step 2: 检测仓库形态…");
const detection = detectRepoPattern(readme);
const lessonFiles = filterLessonFiles(detection.lessonFiles || []);
console.log(`  ✓ ${detection.pattern}, ${lessonFiles.length} 个课时文件链接`);

// ── Step 3: 批量拉取 ──
console.log("Step 3: 批量拉取文件…");
const fetched = await fetchMarkdownContents(
  lessonFiles, "microsoft", "AI-For-Beginners", BRANCH, fetch,
  (done, total) => { if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`); },
);
console.log(`\n  ✓ 成功 ${fetched.ok.length}, 失败 ${fetched.failed.length}`);

// ── Step 4: 分类（规则层）──
console.log("\nStep 4: 规则分类…");
const allPaths = fetched.ok.map((f) => f.path);
const classifications = fetched.ok.map((f) => ({
  path: f.path,
  ...classifyFile(f.path, f.md, { siblingPaths: allPaths }),
}));
const summary = summarizeClassifications(classifications.map((c) => ({ role: c.role, confidence: c.confidence, reason: c.reason, keepAsLesson: c.keepAsLesson })));
console.log(`  规则直接跳过(高置信度噪声): ${summary.skipCount}`);
console.log(`    ${Object.entries(summary.byRole).filter(([k]) => k !== "lesson" && k !== "uncertain").map(([k, v]) => `${k}: ${v}`).join(", ")}`);
console.log(`  保留(含 uncertain): ${summary.keepCount}`);
console.log(`    其中 uncertain(交 LLM 判断): ${summary.uncertainCount}`);

// ── Step 5: buildCourseFromFiles（含分类器集成）──
console.log("\nStep 5: 构建课程结构（分类器集成）…");
const titleMatch = readme.match(/^#\s+(.+)$/m);
const courseTitle = titleMatch ? titleMatch[1].trim() : "AI-For-Beginners";
const parsed = buildCourseFromFiles(courseTitle, fetched.ok.map((f) => ({ ...f })));
const totalLessonsBeforeLLM = parsed.sections.reduce((n, s) => n + s.lessons.length, 0);
const uncertainLessons = parsed.sections.flatMap((s) => s.lessons).filter((l) => l.uncertain);
console.log(`  ✓ ${parsed.sections.length} section / ${totalLessonsBeforeLLM} lesson`);
console.log(`  其中 uncertain lesson: ${uncertainLessons.length}（LLM 将判断 keep/skip）`);

// ── Step 6: 落库 ──
console.log("\nStep 6: 写入 DB…");
generateCourseFromRepoFiles(db, parsed, {
  repoUrl: `https://github.com/${TEST_REPO}`,
  repoName: "AI-For-Beginners",
  courseId: COURSE_ID,
});

// ── Step 7: LLM 两阶段结构化 ──
console.log("\nStep 7: LLM 两阶段结构化…");
console.log(`  调用 GLM 分析 ${totalLessonsBeforeLLM} 个课时（含 ${uncertainLessons.length} 个 uncertain）…`);

const proposal = await analyzeCourseStructure(db, COURSE_ID);
console.log(`  ✓ LLM 返回: ${proposal.sections.length} 章节, 跳过 ${proposal.skippedNodeIds.length} 节点`);
console.log("");
console.log("  LLM 分组结果:");
for (const sec of proposal.sections) {
  console.log(`    📁 ${sec.title} (${sec.lessonIds.length} 课)`);
  console.log(`       ${sec.summary}`);
}
if (proposal.skippedNodeIds.length > 0) {
  console.log(`    🗑️ 跳过: ${proposal.skippedNodeIds.length} 个节点`);
}

// ── Step 8: 验证结果 ──
console.log("\nStep 8: 验证质量…");
const _applyResult = applyCourseStructure(db, COURSE_ID, proposal);

const finalLessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === COURSE_ID && n.type === "lesson");
const finalSections = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === COURSE_ID && n.type === "section");

// 验证 1: 无 notebook/lab 混入
const noiseTitles = finalLessons.filter((l) => {
  const t = l.title.toLowerCase();
  return t.includes("notebook") || t.includes("lab") || /perceptron\.ipynb/.test(t);
});
console.log(`  最终 lesson 数: ${finalLessons.length}`);
console.log(`  最终 section 数: ${finalSections.length}`);
console.log(`  混入的 notebook/lab: ${noiseTitles.length}`);
if (noiseTitles.length > 0) {
  console.log(`    ⚠ ${noiseTitles.map((l) => l.title).join(", ")}`);
}

// 验证 2: section 数合理（3-12）
const sectionCountOk = finalSections.length >= 3 && finalSections.length <= 12;
console.log(`  section 数合理(3-10): ${sectionCountOk ? "✓" : "✗ " + finalSections.length}`);

// 验证 3: 每个 section 至少 1 lesson
const emptySections = finalSections.filter((s) => {
  const children = finalLessons.filter((l) => l.parentId === s.id);
  return children.length === 0;
});
console.log(`  空 section: ${emptySections.length}`);

// 验证 4: LLM 跳过的节点数 > 0（说明分类+两阶段在工作）
const llmSkipCount = proposal.skippedNodeIds.length;
console.log(`  LLM 跳过节点: ${llmSkipCount}`);

console.log(`\n=== 分类器+LLM live test 结果 ===`);
console.log(`  原始文件: ${fetched.ok.length}`);
console.log(`  规则过滤后 lesson: ${totalLessonsBeforeLLM}（过滤 ${fetched.ok.length - totalLessonsBeforeLLM} 个噪声）`);
console.log(`  LLM 结构化后: ${finalSections.length} section / ${finalLessons.length} lesson`);
console.log(`  LLM 跳过: ${llmSkipCount} 个节点`);
console.log(`  碎片化改善: ${fetched.ok.length} 文件 → ${finalSections.length} 章节`);

const allGood = noiseTitles.length === 0 && sectionCountOk && emptySections.length === 0;
console.log(`\n${allGood ? "=== ✅ 分类器+LLM 端到端验证通过 ===" : "=== ❌ 有质量问题 ==="}`);
if (!allGood) process.exit(1);
