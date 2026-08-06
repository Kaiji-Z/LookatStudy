/**
 * 种子课程加载器 —— 内嵌 FDE Roadmap README 全文，走通用 generateCourseFromMarkdown。
 *
 * 这样每个 lesson 的 content 字段有真实正文（不再空壳），AI 导师有内容可教、练习有内容可考。
 * README 全文以 ?raw 方式构建时内联（无需运行时读文件）。
 *
 * 来源: https://github.com/pierpaolo28/Awesome-FDE-Roadmap 的 README.md
 */
import { getDb, markDirty } from "../db/index.js";
import { courses } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateCourseFromMarkdown } from "./course-generator.js";
// vite ?raw import：构建时把 README 全文内联成字符串
import fdeReadmeMd from "./seed-fde-readme.md?raw";

const COURSE_ID = "seed-fde-roadmap";
const COURSE_REPO_URL = "https://github.com/pierpaolo28/Awesome-FDE-Roadmap";

export function ensureSeedCourse(): void {
  const db = getDb();

  // 幂等：已存在则跳过
  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();
  if (existing) return;

  // 走通用生成器（和用户导入走同一条路径，保证一致性）
  generateCourseFromMarkdown(db, fdeReadmeMd, {
    repoUrl: COURSE_REPO_URL,
    repoName: "Awesome-FDE-Roadmap",
    courseId: COURSE_ID,
  });
  markDirty();
}
