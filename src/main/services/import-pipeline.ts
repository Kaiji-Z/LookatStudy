/**
 * 智能导入管线编排 —— 新 5 步设计的 Step 5 执行器。
 *
 * 输入: analyzeRepo 的结果（文件角色 + 用户选的翻译）+ designCourseStructure 的结果
 * 输出: 落库完成的课程
 *
 * 子步骤:
 *   5a. 按 LLM 结构拉取正文
 *   5b. 下载图片 → base64 内联进正文
 *   5c. 落库 (content_nodes + progress)
 *   5d. 完整性验证
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes, courses, progress as progressTable, contentNodeTranslations } from "../db/schema.js";
import {
  fetchSingleFileContent,
  fetchImageAsDataUrl,
  cdnUrl,
} from "./pure/repo-fetcher.js";
import type { CourseStructure, DesignedLesson } from "./import-llm-service.js";
import { verifyCourseIntegrity, type VerificationResult } from "./pure/course-verifier.js";

type Db = SQLJsDatabase<typeof schema>;

/** 图片引用匹配用的扩展名 */
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];

export interface ImportPipelineResult {
  courseId: string;
  title: string;
  verification: VerificationResult;
}

/**
 * 执行 Step 5: 拉正文 → 图片内联 → 落库 → 验证。
 *
 * @param db DB 实例
 * @param structure LLM 设计的课程结构
 * @param owner/repo/branch 仓库信息
 * @param fetchFn fetch 函数
 * @param repoUrl/repoName 仓库 URL 和名称
 * @param langCode 用户选的翻译语言（null = 原文）
 * @param translationFiles 翻译文件路径列表（langCode 非 null 时）
 * @param onProgress 进度回调
 */
export async function executeImport(
  db: Db,
  structure: CourseStructure,
  opts: {
    owner: string;
    repo: string;
    branch: string;
    fetchFn: typeof fetch;
    repoUrl: string | null;
    repoName: string;
    langCode: string | null;
    translationFiles: Map<string, string[]> | null;
    markDirty: () => void;
  },
  onProgress?: (msg: string) => void,
): Promise<ImportPipelineResult> {
  const send = (msg: string) => onProgress?.(msg);
  const courseId = randomUUID();

  // ── 创建课程行 ──
  db.insert(courses).values({
    id: courseId,
    repoUrl: opts.repoUrl,
    repoName: opts.repoName,
    title: structure.courseTitle,
    description: `从 ${opts.repoName} 导入`,
    version: 1,
    labType: "doc",
  }).run();

  // ── 5a+5b: 拉正文 + 图片内联 ──
  const allLessons = structure.sections.flatMap((s) => s.lessons);
  send(`拉取 ${allLessons.length} 个文件的正文…`);

  // 缓存已拉取的文件正文（同一文件可能被多个 lesson 引用）
  const contentCache = new Map<string, string | null>();
  // 缓存已下载的图片（同路径不重复下载）
  const imageCache = new Map<string, string | null>();

  let sectionOrder = 0;
  let totalLessons = 0;
  let firstStudyLessonId: string | null = null;

  for (const sec of structure.sections) {
    const sectionId = randomUUID();
    db.insert(contentNodes).values({
      id: sectionId,
      courseId,
      parentId: null,
      type: "section",
      title: sec.title,
      sourcePath: null,
      orderIdx: sectionOrder++,
      summary: sec.summary ?? null,
      world: sec.world,
    }).run();

    let lessonOrder = 0;
    for (const lesson of sec.lessons) {
      // 5a: 拉正文
      const content = await getLessonContent(
        lesson, opts, contentCache, allLessons.length, totalLessons, send,
      );

      // 5b: 图片 base64 内联
      const inlinedContent = content ? await inlineImages(
        content, lesson.file, opts, imageCache, send,
      ) : null;

      const lessonId = randomUUID();
      const isPractice = lesson.world === "practice";
      const isStudy = !isPractice;

      db.insert(contentNodes).values({
        id: lessonId,
        courseId,
        parentId: sectionId,
        type: "lesson",
        title: lesson.title,
        sourcePath: lesson.anchor ? `${lesson.file}#${lesson.anchor}` : lesson.file,
        orderIdx: lessonOrder++,
        content: inlinedContent,
        world: lesson.world,
      }).run();

      // progress: practice 全 available, study 第一个 available
      const status = isPractice ? "available" : (firstStudyLessonId === null ? "available" : "locked");
      db.insert(progressTable).values({
        nodeId: lessonId,
        status,
        crownLevel: 0,
      }).run();

      if (isStudy && firstStudyLessonId === null) firstStudyLessonId = lessonId;
      totalLessons++;
    }

    // study section 有 ≥2 lesson 时加 exam
    if (sec.world === "study" && sec.lessons.filter((l) => l.world === "study").length >= 2) {
      const examId = randomUUID();
      db.insert(contentNodes).values({
        id: examId,
        courseId,
        parentId: sectionId,
        type: "exam",
        title: `${sec.title} · 章节测验`,
        sourcePath: null,
        orderIdx: lessonOrder,
        world: "study",
      }).run();
      db.insert(progressTable).values({
        nodeId: examId,
        status: "available",
        crownLevel: 0,
      }).run();
    }
  }

  // ── 翻译落库 ──
  if (opts.langCode && opts.translationFiles) {
    send(`拉取翻译版正文 (${opts.langCode})…`);
    await fetchAndPersistTranslations(
      db, courseId, opts.langCode, structure, opts, contentCache, imageCache, send,
    );
  }

  opts.markDirty();
  send("导入完成，验证课程完整性…");

  // ── 5d: 完整性验证 ──
  const verification = verifyCourseIntegrity(db, courseId);
  if (verification.ok) {
    send(`验证通过：${verification.stats.sections} 章 / ${verification.stats.lessons} 课 / ${verification.stats.lessonsWithImages} 课含图片`);
  } else {
    send(`验证发现 ${verification.issues.length} 个问题（不影响导入，课程可用）`);
    for (const issue of verification.issues.slice(0, 3)) {
      console.error(`[import] ${issue}`);
    }
  }

  return { courseId, title: structure.courseTitle, verification };
}

/**
 * 获取 lesson 的正文内容。
 * 如果有 anchor（H2/H3 标题），从文件正文中截取对应段落。
 */
async function getLessonContent(
  lesson: DesignedLesson,
  opts: { owner: string; repo: string; branch: string; fetchFn: typeof fetch },
  cache: Map<string, string | null>,
  total: number,
  done: number,
  send: (msg: string) => void,
): Promise<string | null> {
  send(`\r拉取正文 ${done + 1}/${total}: ${lesson.file.slice(0, 50)}`);

  // 从缓存或拉取
  if (!cache.has(lesson.file)) {
    const content = await fetchSingleFileContent(
      lesson.file, opts.owner, opts.repo, opts.branch, opts.fetchFn,
    );
    cache.set(lesson.file, content);
  }
  const fullContent = cache.get(lesson.file);
  if (!fullContent) return null;

  // 无 anchor: 返回整个文件
  if (!lesson.anchor) return fullContent;

  // 有 anchor: 截取 H2/H3 段落
  const lines = fullContent.split(/\r?\n/);
  const anchorLower = lesson.anchor.toLowerCase().trim();
  let startIdx = -1;
  let endIdx = lines.length;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^(\s*)(```|~~~)/.test(lines[i]!)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (startIdx === -1) {
      // 找到 anchor 标题行
      const lineLower = lines[i]!.toLowerCase().trim();
      if (/^#{2,3}\s+/.test(lines[i]!) && lineLower.includes(anchorLower.replace(/^#{2,3}\s+/, ""))) {
        startIdx = i;
      }
    } else {
      // 找到下一个同级或更高级标题 → 结束
      if (/^#{1,3}\s+/.test(lines[i]!)) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) return fullContent; // anchor 没找到，返回整个文件
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/**
 * 将正文中的相对路径图片引用替换为 base64 data-url。
 * 只替换相对路径（非 http/data），从 CDN 下载图片转 base64。
 */
async function inlineImages(
  content: string,
  sourceFile: string,
  opts: { owner: string; repo: string; branch: string; fetchFn: typeof fetch },
  imageCache: Map<string, string | null>,
  _send: (msg: string) => void,
): Promise<string> {
  // 匹配 markdown 图片引用 ![alt](url) 和 HTML <img src="url">
  const mdImgPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const htmlImgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

  // 解析图片路径（相对 sourceFile 的目录）
  const fileDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";

  async function resolveImage(src: string): Promise<string> {
    // 外链/data 不处理
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      return src;
    }
    // 只处理图片扩展名
    const lower = src.toLowerCase();
    if (!IMAGE_EXTS.some((ext) => lower.endsWith(ext))) return src;

    // 解析相对路径
    let imgPath = src.replace(/^\.\//, "").replace(/^\.\.\//g, (m) => m); // 保留 ../
    if (imgPath.startsWith("../")) {
      // 向上回溯目录
      const parts = (fileDir + "/" + imgPath).split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "..") resolved.pop();
        else if (p !== "." && p !== "") resolved.push(p);
      }
      imgPath = resolved.join("/");
    } else if (fileDir) {
      imgPath = `${fileDir}/${imgPath}`;
    }

    // 从缓存或下载
    if (!imageCache.has(imgPath)) {
      const dataUrl = await fetchImageAsDataUrl(
        imgPath, opts.owner, opts.repo, opts.branch, opts.fetchFn,
      );
      if (dataUrl) {
        imageCache.set(imgPath, dataUrl);
      } else {
        // 下载失败或超限 → 用 CDN URL 替代(联网可看,离线不可看)
        const cdn = cdnUrl(opts.owner, opts.repo, opts.branch, imgPath);
        imageCache.set(imgPath, cdn);
      }
    }
    return imageCache.get(imgPath) ?? src;
  }

  // 替换 markdown 图片
  let result = content;
  const mdMatches = [...content.matchAll(mdImgPattern)];
  for (const m of mdMatches) {
    const alt = m[1] ?? "";
    const src = m[2] ?? "";
    const newSrc = await resolveImage(src);
    if (newSrc !== src) {
      result = result.replace(m[0], `![${alt}](${newSrc})`);
    }
  }

  // 替换 HTML 图片 → 转成 markdown 图片语法(ReactMarkdown 不渲染 raw HTML)
  const htmlMatches = [...result.matchAll(htmlImgPattern)];
  for (const m of htmlMatches) {
    const src = m[1] ?? "";
    // 从 <img> 标签提取 alt 属性
    const altMatch = m[0].match(/alt=["']([^"']*)["']/i);
    const alt = altMatch?.[1] ?? "";
    const newSrc = await resolveImage(src);
    // 整个 <img> 标签替换成 markdown ![](url)
    result = result.replace(m[0], `![${alt}](${newSrc})`);
  }

  return result;
}

/**
 * 拉取翻译版正文并写入 content_node_translations 表。
 */
async function fetchAndPersistTranslations(
  db: Db,
  courseId: string,
  langCode: string,
  structure: CourseStructure,
  opts: { owner: string; repo: string; branch: string; fetchFn: typeof fetch; markDirty: () => void },
  contentCache: Map<string, string | null>,
  imageCache: Map<string, string | null>,
  send: (msg: string) => void,
): Promise<void> {
  // 翻译文件路径: translations/{langCode}/{originalPath}
  const allLessons = structure.sections.flatMap((s) => s.lessons);
  let transWritten = 0;

  for (let idx = 0; idx < allLessons.length; idx++) {
    const lesson = allLessons[idx]!;
    const transPath = `translations/${langCode}/${lesson.file}`;

    // 从缓存或拉取
    if (!contentCache.has(transPath)) {
      const content = await fetchSingleFileContent(
        transPath, opts.owner, opts.repo, opts.branch, opts.fetchFn,
      );
      contentCache.set(transPath, content);
    }
    const transContent = contentCache.get(transPath);
    if (!transContent) continue; // 该文件无翻译

    // anchor 截取（同原文逻辑）
    let finalContent = transContent;
    if (lesson.anchor) {
      const lines = transContent.split(/\r?\n/);
      const anchorLower = lesson.anchor.toLowerCase().trim();
      let startIdx = -1;
      let endIdx = lines.length;
      let inCodeFence = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^(\s*)(```|~~~)/.test(lines[i]!)) { inCodeFence = !inCodeFence; continue; }
        if (inCodeFence) continue;
        if (startIdx === -1) {
          const lineLower = lines[i]!.toLowerCase().trim();
          if (/^#{2,3}\s+/.test(lines[i]!) && lineLower.includes(anchorLower.replace(/^#{2,3}\s+/, ""))) {
            startIdx = i;
          }
        } else {
          if (/^#{1,3}\s+/.test(lines[i]!)) { endIdx = i; break; }
        }
      }
      if (startIdx !== -1) {
        finalContent = lines.slice(startIdx, endIdx).join("\n").trim();
      }
    }

    // 图片内联（翻译版也可能有图片引用）
    finalContent = await inlineImages(
      finalContent, `translations/${langCode}/${lesson.file}`, opts, imageCache, send,
    );

    // 找对应的 lesson 节点
    const sourcePath = lesson.anchor ? `${lesson.file}#${lesson.anchor}` : lesson.file;
    const lessonNode = db.select().from(contentNodes)
      .where(eq(contentNodes.courseId, courseId)).all()
      .find((n) => n.type === "lesson" && n.sourcePath === sourcePath);
    if (!lessonNode) continue;

    // 翻译标题取 H1
    const h1Match = finalContent.match(/^#\s+(.+)$/m);
    const transTitle = h1Match ? h1Match[1]!.trim() : lesson.title;

    db.insert(contentNodeTranslations).values({
      id: randomUUID(),
      nodeId: lessonNode.id,
      courseId,
      locale: langCode,
      title: transTitle,
      content: finalContent,
    }).run();
    transWritten++;

    if (transWritten % 10 === 0) {
      send(`翻译 ${transWritten} 课已写入…`);
    }
  }

  opts.markDirty();
  send(`翻译完成: ${transWritten} 课有翻译`);
}
