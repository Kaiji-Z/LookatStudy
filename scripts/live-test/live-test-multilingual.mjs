/**
 * live-test-multilingual.mjs — 完整多语言导入对比测试。
 *
 * 1. 用 importRepoToParsedCourse 拉原文（英文）
 * 2. 用 detectRepoLanguages 检测翻译语言
 * 3. 用 fetchTranslatedContent 拉中文翻译
 * 4. persistTranslations 存入 DB
 * 5. 对比:原文 vs 翻译覆盖了多少课？翻译质量如何？
 *
 * 用法: npx tsx scripts/live-test/live-test-multilingual.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { randomUUID } from "node:crypto";

import { readApiKey } from "./_load-env.mjs";
import * as schema from "../../src/main/db/schema.ts";
import {
  importRepoToParsedCourse,
  detectRepoLanguages,
  fetchTranslatedContent,
} from "../../src/main/services/pure/repo-fetcher.ts";
import { generateCourseFromRepoFiles } from "../../src/main/services/course-generator.ts";
import {
  persistTranslations,
  getNodeTranslation,
  getCourseLanguages,
  getCourseTitleTranslations,
} from "../../src/main/services/translation-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key，但本测试不需要 LLM——继续...");
}

const OWNER = "microsoft";
const REPO = "AI-For-Beginners";
const BRANCH = "master";
const COURSE_ID = "test-multi-lang";
const LANG = "zh-CN";

// ── 初始化内存 DB ──
const wasmPath = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmPath, f) });
const sqljs = new SQL.Database();
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
sqljs.run("PRAGMA foreign_keys = ON;");
const db = drizzle(sqljs, { schema });

// ============================================================
console.log("=".repeat(60));
console.log("Step 1: 拉取原文课程（importRepoToParsedCourse）");
console.log("=".repeat(60));

const importResult = await importRepoToParsedCourse(
  OWNER, REPO, BRANCH, globalThis.fetch,
  (msg) => console.log(`  ${msg}`),
);

const { course: parsed, fetchedFiles } = importResult;
const totalLessons = parsed.sections.reduce((n, s) => n + s.lessons.length, 0);
console.log(`\n  原文: ${parsed.sections.length} section / ${totalLessons} lesson / ${fetchedFiles.length} files`);

// 落库原文
generateCourseFromRepoFiles(db, parsed, {
  repoUrl: `https://github.com/${OWNER}/${REPO}`,
  repoName: REPO,
  courseId: COURSE_ID,
});

// ============================================================
console.log("\n" + "=".repeat(60));
console.log("Step 2: 检测翻译语言（detectRepoLanguages）");
console.log("=".repeat(60));

const langs = await detectRepoLanguages(OWNER, REPO, BRANCH, globalThis.fetch);
console.log(`  检测到 ${langs.length} 种语言`);
console.log(`  前 10: ${langs.slice(0, 10).map((l) => `${l.name}(${l.code})`).join(", ")}`);

const zhLang = langs.find((l) => l.code === LANG);
console.log(`  中文翻译: ${zhLang ? `✓ ${zhLang.name} (${zhLang.code})` : "✗ 未找到"}`);

if (!zhLang) {
  console.log("\n❌ 未找到中文翻译，测试终止");
  process.exit(1);
}

// ============================================================
console.log("\n" + "=".repeat(60));
console.log(`Step 3: 拉取中文翻译（fetchTranslatedContent）`);
console.log("=".repeat(60));

const translations = await fetchTranslatedContent(
  OWNER, REPO, BRANCH, LANG, fetchedFiles, globalThis.fetch,
  (msg) => console.log(`  ${msg}`),
);

console.log(`\n  翻译版文件: ${translations.size} / ${fetchedFiles.length}`);

// ============================================================
console.log("\n" + "=".repeat(60));
console.log("Step 4: 存入 DB（persistTranslations）");
console.log("=".repeat(60));

const persistResult = await persistTranslations(db, COURSE_ID, LANG, translations);
console.log(`  写入: ${persistResult.written} 课有翻译`);
console.log(`  跳过: ${persistResult.skipped} 课无翻译`);
console.log(`  LLM 对齐: ${persistResult.llmAligned ?? 0} 课`);

// ============================================================
console.log("\n" + "=".repeat(60));
console.log("Step 5: 对比 —— 原文 vs 翻译");
console.log("=".repeat(60));

// 取 DB 里所有 lesson
const lessons = db.select().from(schema.contentNodes).all()
  .filter((n) => n.courseId === COURSE_ID && n.type === "lesson");

const availableLangs = getCourseLanguages(db, COURSE_ID);
console.log(`  课程可用语言: ${availableLangs.join(", ")}`);

const titleMap = getCourseTitleTranslations(db, COURSE_ID, LANG);
console.log(`  翻译标题映射: ${titleMap.size} / ${lessons.length}`);

// 抽样对比前 5 个 lesson 的原文 vs 翻译
console.log("\n  ┌─ 抽样对比（前 8 课）:");
for (let i = 0; i < Math.min(8, lessons.length); i++) {
  const lesson = lessons[i];
  const trans = getNodeTranslation(db, lesson.id, LANG);
  const origTitle = lesson.title;
  const transTitle = trans?.title ?? "(无翻译)";
  const origPreview = (lesson.content ?? "").slice(0, 60).replace(/\n/g, " ");
  const transPreview = (trans?.content ?? "").slice(0, 60).replace(/\n/g, " ");
  console.log(`  │`);
  console.log(`  │ [${i + 1}] 原文标题: ${origTitle}`);
  console.log(`  │     翻译标题: ${transTitle}`);
  console.log(`  │     原文摘要: ${origPreview}...`);
  console.log(`  │     翻译摘要: ${transPreview}...`);
}

// 统计翻译覆盖率
const withTranslation = lessons.filter((l) => getNodeTranslation(db, l.id, LANG));
const withoutTranslation = lessons.filter((l) => !getNodeTranslation(db, l.id, LANG));
const coverage = Math.round((withTranslation.length / lessons.length) * 100);

console.log(`\n  ┌─ 覆盖率统计:`);
console.log(`  │ 总 lesson: ${lessons.length}`);
console.log(`  │ 有中文翻译: ${withTranslation.length} (${coverage}%)`);
console.log(`  │ 无中文翻译: ${withoutTranslation.length} (${100 - coverage}%)`);

// 列出无翻译的 lesson
if (withoutTranslation.length > 0) {
  console.log(`  │ 无翻译的课:`);
  for (const l of withoutTranslation.slice(0, 10)) {
    console.log(`  │   - ${l.title} (sourcePath: ${l.sourcePath})`);
  }
  if (withoutTranslation.length > 10) {
    console.log(`  │   ... 和其余 ${withoutTranslation.length - 10} 课`);
  }
}

// ============================================================
console.log("\n" + "=".repeat(60));
console.log("总结");
console.log("=".repeat(60));
console.log(`  原文: ${parsed.sections.length} section / ${totalLessons} lesson`);
console.log(`  翻译语言: ${langs.length} 种可用`);
console.log(`  中文翻译覆盖: ${withTranslation.length}/${lessons.length} (${coverage}%)`);
console.log(`  翻译标题映射: ${titleMap.size}/${lessons.length}`);
