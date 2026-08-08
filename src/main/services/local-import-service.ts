/**
 * 本地文件夹导入服务 —— 把 scanFolder 的结果落库成课程。
 *
 * 流程:ScannedDoc[] → buildCourseFromFiles(按目录分组) → ParsedCourse →
 *      generateCourseFromRepoFiles(落库 + exam 节点)。
 *
 * 复用 repo-fetcher 的 buildCourseFromFiles(按第一个非通用目录分 section)。
 * 不在这里硬编码任何特定文件夹结构——目录分组是初步切分,真正的章节重组
 * 由调用方的 autoStructureCourse(LLM)做。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { buildCourseFromFiles, type FetchedFile } from "./pure/repo-fetcher.js";
import { generateCourseFromRepoFiles } from "./course-generator.js";
import type { ScannedDoc } from "./pure/local-folder-scanner.js";
import { basename } from "node:path";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 把扫描结果落库成课程。
 * @param db
 * @param docs 扫描器输出
 * @param folderName 文件夹名(作课程 repoName)
 * @returns 生成的 courseId + 统计
 */
export function importLocalFolder(
  db: Db,
  docs: ScannedDoc[],
  folderName: string,
): { courseId: string; sectionCount: number; lessonCount: number; examCount: number } {
  if (docs.length === 0) {
    throw new Error("文件夹里没有可识别的文本内容(.txt/.md/.html/.pdf)");
  }

  // ScannedDoc → FetchedFile(复用 buildCourseFromFiles 的分组逻辑)
  const files: FetchedFile[] = docs.map((d) => ({
    path: d.path,
    title: d.title,
    md: d.content, // buildCourseFromFiles 内部用 parseMarkdownToCourse 解析,纯文本也能当 body
  }));

  const courseTitle = humanizeFolderName(folderName);
  const parsed = buildCourseFromFiles(courseTitle, files);

  const result = generateCourseFromRepoFiles(db, parsed, {
    repoUrl: null,
    repoName: folderName,
  });

  return {
    courseId: result.courseId,
    sectionCount: result.sectionCount,
    lessonCount: result.lessonCount,
    examCount: result.examCount,
  };
}

/** 文件夹名转人类可读课程标题:mathematics-for-ml → "Mathematics For Ml"。 */
function humanizeFolderName(name: string): string {
  const cleaned = basename(name).replace(/[-_]+/g, " ").trim();
  if (!cleaned) return name;
  // 首字母大写(英文),中文不受影响
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
