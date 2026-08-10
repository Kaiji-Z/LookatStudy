/**
 * 种子课程加载器 —— 内嵌 microsoft/AI-For-Beginners 组装全文，走通用 generateCourseFromMarkdown。
 *
 * 课程结构：8 个 section（Intro/Symbolic/NN/CV/NLP/Other/Ethics/Extras）× 25 课。
 * 每节课 README 含真实正文（概念讲解 + PyTorch/TF 代码 + 图），AI 导师有内容可教、练习有内容可考。
 * 组装后的 markdown 以 ?raw 方式构建时内联（无需运行时读文件）。
 *
 * 来源: https://github.com/microsoft/AI-For-Beginners
 * 组装脚本: scripts/build-ai-seed.mjs（开发时跑一次，产物入 git）
 */
import { getDb, markDirty } from "../db/index.js";
import { courses, contentNodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { generateCourseFromMarkdown } from "./course-generator.js";
// vite ?raw import：构建时把组装全文内联成字符串
import aiReadmeMd from "../assets/seed-ai-for-beginners.md?raw";

const COURSE_ID = "seed-ai-for-beginners";
const COURSE_REPO_URL = "https://github.com/microsoft/AI-For-Beginners";
// 种子版本号：bump 这个数字会触发种子课程重建（删旧内容节点重新生成）。
// 用户自定义 provider / 进度 / 其他课程不受影响。
const SEED_VERSION = 6;

export function ensureSeedCourse(): void {
  const db = getDb();

  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();

  // 幂等：已存在且版本号匹配 → 跳过
  if (existing && (existing.version ?? 1) >= SEED_VERSION) return;

  // 版本号旧或不存在 → 删除旧种子课程的节点（只删种子课程，不动其他数据）
  // 兼容：旧版种子 id 是 seed-fde-roadmap，升级时一并清理
  const oldFde = db.select().from(courses).where(eq(courses.id, "seed-fde-roadmap")).get();
  if (oldFde) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, "seed-fde-roadmap")).run();
    db.delete(courses).where(eq(courses.id, "seed-fde-roadmap")).run();
  }
  if (existing) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, COURSE_ID)).run();
    db.delete(courses).where(eq(courses.id, COURSE_ID)).run();
  }

  // 走通用生成器（和用户导入走同一条路径，保证一致性）
  generateCourseFromMarkdown(db, aiReadmeMd, {
    repoUrl: COURSE_REPO_URL,
    repoName: "AI-For-Beginners",
    courseId: COURSE_ID,
  });

  // 更新版本号
  db.update(courses).set({ version: SEED_VERSION }).where(eq(courses.id, COURSE_ID)).run();
  markDirty();
}
