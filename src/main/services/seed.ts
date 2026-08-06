/**
 * 种子课程加载器 —— 内嵌 FDE Roadmap README 全文，走通用 generateCourseFromMarkdown。
 *
 * 这样每个 lesson 的 content 字段有真实正文（不再空壳），AI 导师有内容可教、练习有内容可考。
 * README 全文以 ?raw 方式构建时内联（无需运行时读文件）。
 *
 * 来源: https://github.com/pierpaolo28/Awesome-FDE-Roadmap 的 README.md
 */
import { getDb, markDirty } from "../db/index.js";
import { courses, contentNodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateCourseFromMarkdown } from "./course-generator.js";
// vite ?raw import：构建时把 README 全文内联成字符串
import fdeReadmeMd from "./seed-fde-readme.md?raw";

const COURSE_ID = "seed-fde-roadmap";
const COURSE_REPO_URL = "https://github.com/pierpaolo28/Awesome-FDE-Roadmap";
// 种子版本号：bump 这个数字会触发种子课程重建（删旧内容节点重新生成）。
// 用户自定义 provider / 进度 / 其他课程不受影响。
const SEED_VERSION = 2;

export function ensureSeedCourse(): void {
  const db = getDb();

  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();

  // 幂等：已存在且版本号匹配 → 跳过
  if (existing && (existing.version ?? 1) >= SEED_VERSION) return;

  // 版本号旧或不存在 → 删除旧种子课程的节点（只删种子课程，不动其他数据）
  if (existing) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, COURSE_ID)).run();
    db.delete(courses).where(eq(courses.id, COURSE_ID)).run();
  }

  // 走通用生成器（和用户导入走同一条路径，保证一致性）
  generateCourseFromMarkdown(db, fdeReadmeMd, {
    repoUrl: COURSE_REPO_URL,
    repoName: "Awesome-FDE-Roadmap",
    courseId: COURSE_ID,
  });

  // 更新版本号
  db.update(courses).set({ version: SEED_VERSION }).where(eq(courses.id, COURSE_ID)).run();
  markDirty();
}
