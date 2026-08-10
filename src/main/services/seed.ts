/**
 * 种子课程加载器 —— 运行时从 GitHub 真实拉取 microsoft/AI-For-Beginners。
 *
 * 和用户在 app 里点"GitHub URL 导入"走完全相同的管线:
 *   importRepoToParsedCourse → generateCourseFromRepoFiles →
 *   fetchTranslatedContent → persistTranslations → autoStructureCourse
 *
 * 网络不可达时静默跳过（不阻塞 app 启动），用户可手动导入。
 *
 * 幂等:已存在且版本号匹配 → 跳过。版本号 bump 触发重建。
 */
import { getDb, markDirty } from "../db/index.js";
import { courses, contentNodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateCourseFromRepoFiles } from "./course-generator.js";
import {
  importRepoToParsedCourse,
  fetchTranslatedContent,
} from "./pure/repo-fetcher.js";
import { persistTranslations } from "./translation-service.js";

const COURSE_ID = "seed-ai-for-beginners";
const OWNER = "microsoft";
const REPO = "AI-For-Beginners";
const BRANCH = "master";
const SEED_LANG = "zh-CN"; // 中文翻译
// 种子版本号：bump 触发重建（删旧课程 + 重新拉取）。
const SEED_VERSION = 7;

export async function ensureSeedCourse(): Promise<void> {
  const db = getDb();

  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();

  // 幂等：已存在且版本号匹配 → 跳过
  if (existing && (existing.version ?? 1) >= SEED_VERSION) return;

  // 版本号旧或不存在 → 删除旧种子课程
  // 兼容清理：旧版种子 id 是 seed-fde-roadmap
  const oldFde = db.select().from(courses).where(eq(courses.id, "seed-fde-roadmap")).get();
  if (oldFde) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, "seed-fde-roadmap")).run();
    db.delete(courses).where(eq(courses.id, "seed-fde-roadmap")).run();
  }
  if (existing) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, COURSE_ID)).run();
    db.delete(courses).where(eq(courses.id, COURSE_ID)).run();
  }

  // 真实拉取（和用户导入走同一条管线）
  try {
    console.error("[lookatstudy] 正在从 GitHub 拉取种子课程…");
    const importResult = await importRepoToParsedCourse(
      OWNER, REPO, BRANCH, fetch,
      (msg) => console.error(`[lookatstudy]   ${msg}`),
    );

    const { course: parsed, fetchedFiles, readmeBranch } = importResult;

    // 落库
    const result = generateCourseFromRepoFiles(db, parsed, {
      repoUrl: `https://github.com/${OWNER}/${REPO}`,
      repoName: REPO,
      courseId: COURSE_ID,
    });
    markDirty();

    // 拉取中文翻译
    try {
      console.error("[lookatstudy] 正在拉取中文翻译…");
      const translations = await fetchTranslatedContent(
        OWNER, REPO, readmeBranch, SEED_LANG, fetchedFiles, fetch,
        (msg) => console.error(`[lookatstudy]   ${msg}`),
      );
      if (translations.size > 0) {
        await persistTranslations(db, COURSE_ID, SEED_LANG, translations);
        markDirty();
      }
    } catch (e) {
      console.error("[lookatstudy] 翻译拉取失败，跳过:", e instanceof Error ? e.message : e);
    }

    // 更新版本号
    db.update(courses).set({ version: SEED_VERSION }).where(eq(courses.id, COURSE_ID)).run();
    markDirty();

    console.error(`[lookatstudy] 种子课程就绪: ${result.sectionCount} 章 / ${result.lessonCount} 课`);
  } catch (e) {
    // 网络不可达 → 静默跳过，不阻塞 app 启动
    console.error("[lookatstudy] 种子课程拉取失败（网络不可达?）:", e instanceof Error ? e.message : e);
    console.error("[lookatstudy] 用户可手动通过「导入课程」添加。");
  }
}
