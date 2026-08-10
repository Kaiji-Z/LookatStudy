/**
 * 本地文件夹导入服务 —— 把 scanFolder 的结果落库成课程。
 *
 * 流程:ScannedDoc[] → buildCourseFromFiles(按目录分组) → ParsedCourse →
 *      generateCourseFromRepoFiles(落库 + exam 节点)。
 *
 * 多模态(flag on):同时处理 ScannedImage[],把图片关联到 content_node:
 *   1. 复制图片到 userData/assets/{courseId}/
 *   2. 写 node_assets 行(按"图片路径最匹配 node.sourcePath"关联)
 *
 * 复用 repo-fetcher 的 buildCourseFromFiles(按第一个非通用目录分 section)。
 * 不在这里硬编码任何特定文件夹结构——目录分组是初步切分,真正的章节重组
 * 由调用方的 autoStructureCourse(LLM)做。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { buildCourseFromFiles, type FetchedFile } from "./pure/repo-fetcher.js";
import { generateCourseFromRepoFiles } from "./course-generator.js";
import type { ScannedDoc, ScannedImage } from "./pure/local-folder-scanner.js";
import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";

type Db = SQLJsDatabase<typeof schema>;

export interface ImportLocalFolderOptions {
  /** 多模态:扫描到的图片(flag on 时传入) */
  images?: ScannedImage[];
  /** 进度回调(图片处理时) */
  onProgress?: (msg: string) => void;
}

/**
 * 把扫描结果落库成课程。
 * @param db
 * @param docs 扫描器输出(文档)
 * @param folderName 文件夹名(作课程 repoName)
 * @param options.images 可选图片(flag on 时传入,会被复制到 assets + 写 node_assets)
 * @returns 生成的 courseId + 统计
 */
export function importLocalFolder(
  db: Db,
  docs: ScannedDoc[],
  folderName: string,
  options?: ImportLocalFolderOptions,
): { courseId: string; sectionCount: number; lessonCount: number; examCount: number; assetCount: number } {
  if (docs.length === 0) {
    throw new Error("文件夹里没有可识别的文本内容(.txt/.md/.html/.pdf)");
  }

  // ScannedDoc → FetchedFile(复用 buildCourseFromFiles 的分组逻辑)
  // 保留 docPath → FetchedFile 映射,供后续图片-node 关联用
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

  // === 多模态:图片关联 + 持久化 ===
  let assetCount = 0;
  if (options?.images && options.images.length > 0) {
    assetCount = persistImagesForCourse(db, result.courseId, docs, options.images, options.onProgress);
  }

  return {
    courseId: result.courseId,
    sectionCount: result.sectionCount,
    lessonCount: result.lessonCount,
    examCount: result.examCount,
    assetCount,
  };
}

/**
 * 把图片关联到 content_node 并持久化。
 *
 * 关联策略(路径接近度):
 *   1. 建 docPath → lesson nodeId 映射(从 DB 查课程的 lesson 节点,用 sourcePath 反查)
 *   2. 每张图片找"路径前缀最匹配的 doc"
 *   3. 该 doc 对应的 node 就是图片归属
 *   4. 复制图片到 assets 目录 + 写 node_assets 行
 *
 * 文件 IO(copyImageToAssets)依赖 Electron app.getPath,只在生产调用(测试不覆盖这里)。
 */
function persistImagesForCourse(
  db: Db,
  courseId: string,
  docs: ScannedDoc[],
  images: ScannedImage[],
  onProgress?: (msg: string) => void,
): number {
  // 动态 require asset-service(避免顶部 import electron 在测试环境崩)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    copyImageToAssets,
    writeBufferToAssets,
    persistAssetRecord,
  } = require("./asset-service.js") as typeof import("./asset-service.js");

  // 建 docPath → lesson nodeId 映射
  // generateCourseFromRepoFiles 用 sourcePath = `${section.title}#${lesson.anchor}`,
  // 但这不含原文件路径。改用:遍历课程的所有 lesson 节点,用 title 匹配 doc.title。
  const nodes = db
    .select()
    .from(schema.contentNodes)
    .where(eq(schema.contentNodes.courseId, courseId))
    .all();
  const lessons = nodes.filter((n) => n.type === "lesson");

  // docPath → nodeId:优先用 doc.title 匹配 lesson.title;匹配不到用目录匹配
  const docToNode = new Map<string, string>();
  for (const doc of docs) {
    // 精确标题匹配
    const exact = lessons.find(
      (l) => l.title === doc.title || l.title.toLowerCase() === doc.title.toLowerCase(),
    );
    if (exact) {
      docToNode.set(doc.path, exact.id);
      continue;
    }
    // 标题包含匹配(doc title 是 lesson title 的一部分或反之)
    const partial = lessons.find(
      (l) =>
        l.title.includes(doc.title) ||
        doc.title.includes(l.title) ||
        l.title.toLowerCase().includes(doc.title.toLowerCase()),
    );
    if (partial) {
      docToNode.set(doc.path, partial.id);
    }
  }

  // fallback lesson:如果图片匹配不到任何 doc,挂到第一个 lesson(防图丢失)
  const fallbackNodeId = lessons[0]?.id;

  let count = 0;
  let processed = 0;
  for (const img of images) {
    processed++;
    if (processed % 10 === 0) onProgress?.(`正在处理图片 ${processed}/${images.length}…`);

    // 找最匹配的 doc(路径前缀最长匹配)
    // PDF 图的 path 含 "#pageN" 后缀,去后缀后再匹配
    const imgBasePath = img.path.split("#")[0];
    const imgDir = dirname(imgBasePath);
    let bestDoc: ScannedDoc | null = null;
    let bestOverlap = -1;
    for (const doc of docs) {
      const docDir = dirname(doc.path);
      // 图片和 doc 在同一目录或 doc 是父目录 → 匹配
      if (imgDir === docDir || imgDir.startsWith(docDir + "/") || imgBasePath === doc.path) {
        const overlap = docDir.split("/").length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestDoc = doc;
        }
      }
    }
    // 找 nodeId
    let nodeId: string | null = bestDoc ? (docToNode.get(bestDoc.path) ?? null) : null;
    if (!nodeId) nodeId = fallbackNodeId ?? null;
    if (!nodeId) continue; // 课程没 lesson 节点,跳过(极端情况)

    // 写图片到 assets + 写 DB
    const destName = makeUniqueFilename(img.path, count);
    try {
      if (img.buffer) {
        // PDF 提取的图(buffer 型,直接写)
        writeBufferToAssets(img.buffer, courseId, destName);
      } else if (img.absPath && existsSync(img.absPath)) {
        // 独立文件 / markdown 引用(从源路径复制)
        copyImageToAssets(img.absPath, courseId, destName);
      } else {
        // 源文件不存在(markdown 引用了但文件不在)→ 跳过
        continue;
      }
      persistAssetRecord(db, {
        nodeId,
        courseId,
        filename: destName,
        mimeType: img.mime,
        sourcePath: img.path,
        sourceKind: img.source,
        altText: img.altText,
        pageNumber: img.pageNumber ?? null,
      });
      count++;
    } catch {
      // 单张图失败跳过,不阻塞整体导入
    }
  }
  return count;
}

/** 把图片相对路径转成 assets 文件名:去目录,加序号前缀防冲突 */
function makeUniqueFilename(relPath: string, index: number): string {
  const base = basename(relPath);
  return `${String(index).padStart(3, "0")}-${base}`;
}

/** 文件夹名转人类可读课程标题:mathematics-for-ml → "Mathematics For Ml"。 */
function humanizeFolderName(name: string): string {
  const cleaned = basename(name).replace(/[-_]+/g, " ").trim();
  if (!cleaned) return name;
  // 首字母大写(英文),中文不受影响
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
