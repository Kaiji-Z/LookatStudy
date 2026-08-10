/**
 * 种子课程重建脚本 —— 拉取 microsoft/AI-For-Beginners 并固化为内置静态 JSON。
 *
 * 用途:种子课程内置到 src/main/assets/seed-course.json(离线、无网络、无 LLM)。
 * 当上游仓库内容更新、或导入管线逻辑变化、或 SEED_VERSION bump 后,
 * 重新跑本脚本刷新 JSON:
 *
 *   npx tsx scripts/build-seed-json.mjs
 *
 * 流程:
 * 1. 启动内存 DB
 * 2. 用 importRepoToParsedCourse 拉取原文(需联网,约 30 秒)
 * 3. 用 generateCourseFromRepoFiles 落库
 * 4. 用 fetchTranslatedContent 拉中文翻译
 * 5. 用 persistTranslations 存翻译
 * 6. 验证完整性(section 数、lesson 数、内容覆盖率、翻译覆盖率)
 * 7. 导出 course 行 + content_nodes + progress(初始态) + 翻译 为 JSON
 *
 * 产物 src/main/assets/seed-course.json 由 seed.ts 运行时 readFileSync 加载。
 * 跑完同时记得 bump seed.ts 里的 SEED_VERSION 触发用户侧重建。
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  importRepoToParsedCourse,
  fetchTranslatedContent,
} from "../src/main/services/pure/repo-fetcher.ts";
import { generateCourseFromRepoFiles } from "../src/main/services/course-generator.ts";
import { persistTranslations, getCourseLanguages } from "../src/main/services/translation-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_PATH = join(ROOT, "src/main/assets/seed-course.json");

const COURSE_ID = "seed-ai-for-beginners";
const OWNER = "microsoft";
const REPO = "AI-For-Beginners";
const BRANCH = "master";
const LANG = "zh-CN";

// ── 初始化内存 DB ──
const wasmPath = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmPath, f) });
const sqljs = new SQL.Database();
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
sqljs.run("PRAGMA foreign_keys = ON;");
const db = drizzle(sqljs, { schema });

// ── 1. 拉取原文 ──
console.log("Step 1: 拉取原文课程…");
const importResult = await importRepoToParsedCourse(
  OWNER, REPO, BRANCH, globalThis.fetch,
  (msg) => console.log(`  ${msg}`),
);
const { course: parsed, fetchedFiles, readmeBranch } = importResult;
console.log(`  ✓ ${parsed.sections.length} section / ${parsed.sections.reduce((n,s)=>n+s.lessons.length,0)} lesson / ${fetchedFiles.length} files`);

// ── 2. 落库 ──
console.log("\nStep 2: 落库…");
generateCourseFromRepoFiles(db, parsed, {
  repoUrl: `https://github.com/${OWNER}/${REPO}`,
  repoName: REPO,
  courseId: COURSE_ID,
});

// ── 3. 拉取中文翻译 ──
console.log("\nStep 3: 拉取中文翻译…");
const translations = await fetchTranslatedContent(
  OWNER, REPO, readmeBranch, LANG, fetchedFiles, globalThis.fetch,
  (msg) => console.log(`  ${msg}`),
);
console.log(`  ✓ ${translations.size} 个文件有翻译`);

// ── 4. 存翻译 ──
console.log("\nStep 4: 存翻译…");
const transResult = await persistTranslations(db, COURSE_ID, LANG, translations);
console.log(`  ✓ 写入 ${transResult.written} 课, 跳过 ${transResult.skipped} 课, LLM 对齐 ${transResult.llmAligned ?? 0} 课`);

// ── 5. 验证完整性 ──
console.log("\nStep 5: 验证完整性…");
const nodes = db.select().from(schema.contentNodes).all().filter(n => n.courseId === COURSE_ID);
const sections = nodes.filter(n => n.type === "section");
const lessons = nodes.filter(n => n.type === "lesson");
const exams = nodes.filter(n => n.type === "exam");

// 内容覆盖率
const lessonsWithContent = lessons.filter(l => l.content && l.content.length > 100);
const contentCoverage = Math.round((lessonsWithContent.length / lessons.length) * 100);

// 翻译覆盖率
const availableLangs = getCourseLanguages(db, COURSE_ID);
const transRows = db.select().from(schema.contentNodeTranslations).all().filter(t => t.courseId === COURSE_ID && t.locale === LANG);
const transCoverage = Math.round((transRows.length / lessons.length) * 100);

console.log(`  sections: ${sections.length}`);
console.log(`  lessons: ${lessons.length}`);
console.log(`  exams: ${exams.length}`);
console.log(`  内容覆盖率: ${lessonsWithContent.length}/${lessons.length} (${contentCoverage}%)`);
console.log(`  翻译语言: ${availableLangs.join(", ")}`);
console.log(`  中文翻译覆盖: ${transRows.length}/${lessons.length} (${transCoverage}%)`);

// 抽样检查
console.log("\n  抽样（前 5 课）:");
for (let i = 0; i < Math.min(5, lessons.length); i++) {
  const l = lessons[i];
  const trans = transRows.find(t => t.nodeId === l.id);
  console.log(`    [${i+1}] ${l.title} (${l.content?.length ?? 0} 字) → 翻译: ${trans?.title ?? "(无)"}`);
}

// ── 6. 导出 JSON ──
// 导出完整可重建数据:course 行 + content_nodes + progress(初始解锁态) + zh-CN 翻译。
// seed.ts 从此 JSON 加载时,不需要联网、不需要重新跑 LLM/翻译管线,瞬时启动。
console.log("\nStep 6: 导出 JSON…");

// course 行(只一条)
const courseRow = db.select().from(schema.courses).all().find(c => c.id === COURSE_ID);
if (!courseRow) {
  console.error("✗ 种子 course 行未找到,abort");
  process.exit(1);
}

// progress 行(仅种子课程的)
const progressRows = db.select().from(schema.progress).all().filter(p =>
  nodes.some(n => n.id === p.nodeId),
);

const exportData = {
  version: 1,
  courseId: COURSE_ID,
  course: {
    id: courseRow.id,
    repoUrl: courseRow.repoUrl,
    repoName: courseRow.repoName,
    title: courseRow.title,
    description: courseRow.description,
    labType: courseRow.labType,
  },
  locale: LANG,
  nodes: nodes.map(n => ({
    id: n.id,
    parentId: n.parentId,
    type: n.type,
    title: n.title,
    sourcePath: n.sourcePath,
    orderIdx: n.orderIdx,
    content: n.content,
    summary: n.summary,
  })),
  // 初始进度态:第一个 lesson = available, 其余 lesson/exam = locked
  progress: progressRows.map(p => ({
    nodeId: p.nodeId,
    status: p.status,
    crownLevel: p.crownLevel,
  })),
  translations: transRows.map(t => ({
    nodeId: t.nodeId,
    title: t.title,
    content: t.content,
  })),
};

writeFileSync(OUT_PATH, JSON.stringify(exportData, null, 2), "utf8");
const sizeKB = Math.round(Buffer.byteLength(JSON.stringify(exportData), "utf8") / 1024);
console.log(`  ✓ 写入 ${OUT_PATH} (${sizeKB} KB)`);
console.log(`  ${exportData.nodes.length} nodes + ${exportData.progress.length} progress + ${exportData.translations.length} translations`);

// ── 质量判断 ──
const issues = [];
if (sections.length < 5) issues.push("section 数太少");
if (lessons.length < 20) issues.push("lesson 数太少");
if (contentCoverage < 80) issues.push(`内容覆盖率 ${contentCoverage}% < 80%`);
if (transCoverage < 50) issues.push(`翻译覆盖率 ${transCoverage}% < 50%`);

if (issues.length > 0) {
  console.log(`\n⚠️ 质量问题: ${issues.join(", ")}`);
  process.exit(1);
} else {
  console.log(`\n✅ 种子课程验证通过，已导出`);
}
