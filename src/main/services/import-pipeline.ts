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
import type { ContentSource } from "./content-source.js";
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
    source: ContentSource;
    repoUrl: string | null;
    repoName: string;
    langCode: string | null;
    translationFiles: Map<string, string[]> | null;
    sourceLang: string;
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
    sourceLang: opts.sourceLang,
  }).run();

  // ── 5a+5b: 拉正文 + 图片内联 ──
  const allLessons = structure.sections.flatMap((s) => s.lessons);
  send(`拉取 ${allLessons.length} 个文件的正文…`);

  // 缓存已拉取的文件正文（同一文件可能被多个 lesson 引用）
  const contentCache = new Map<string, string | null>();
  // 缓存已下载的图片（同路径不重复下载）
  const imageCache = new Map<string, string | null>();
  // 每个 lesson 原文 inlined 后的图片 src 数组（按出现顺序），供翻译按位置映射
  const lessonImages = new Map<string, string[]>();
  // 原文文件的标题列表缓存（供标题序号截取）
  const headingsCache = new Map<string, Heading[]>();
  // 每个 lesson 的截取 meta（titleIndex + isFirstOfFile），供翻译用相同序号对齐
  const lessonMeta = new Map<string, { titleIndex: number; isFirstOfFile: boolean }>();
  // 每个 file 的首个 lesson 的 sourcePath（首 lesson 含文件头部 H1+前言）
  const fileFirstLesson = new Map<string, string>();
  for (const lesson of allLessons) {
    const sp = lesson.anchor ? `${lesson.file}#${lesson.anchor}` : lesson.file;
    if (!fileFirstLesson.has(lesson.file)) fileFirstLesson.set(lesson.file, sp);
  }

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
      // 5a: 拉正文（标题序号截取：含文件头部 + H3 子段 + 供翻译对齐的 meta）
      const content = await getLessonContent(
        lesson, opts.source, contentCache, headingsCache, fileFirstLesson, lessonMeta,
        allLessons.length, totalLessons, send,
      );

      // 5b: 图片 base64 内联
      let inlinedContent = content ? await inlineImages(
        content, lesson.file, opts.source, imageCache, send,
      ) : null;

      // 5b-2: 独立图片 attachImages（LLM 关联的孤儿图，追加到正文末尾）
      if (inlinedContent && lesson.attachImages && lesson.attachImages.length > 0) {
        for (const imgPath of lesson.attachImages) {
          if (!imageCache.has(imgPath)) {
            const dataUrl = await opts.source.getImageDataUrl(imgPath);
            imageCache.set(imgPath, dataUrl ?? opts.source.getImageFallbackUrl(imgPath));
          }
          const resolved = imageCache.get(imgPath);
          if (resolved) {
            inlinedContent += `\n\n![](${resolved})`;
          }
        }
      }

      // 记录原文图片 src 数组（翻译按位置映射用）
      const srcPath = lesson.anchor ? `${lesson.file}#${lesson.anchor}` : lesson.file;
      lessonImages.set(srcPath, extractImageSrcs(inlinedContent ?? ""));

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
    send(`拉取 ${opts.langCode} 翻译正文（图片按位置用原文图，不下载翻译图）`);
    await fetchAndPersistTranslations(
      db, courseId, opts.langCode, structure, opts.source, opts.markDirty, contentCache, lessonImages, lessonMeta, send,
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

/** 标题信息：行号 + 级别（2=H2, 3=H3）+ 标题文字 */
type Heading = { line: number; level: number; title: string };

/**
 * 提取文件的所有 H2/H3 标题（带行号 + 级别），代码块内的不算。
 * 用于按标题序号截取段落（原文和翻译用相同序号对齐）。
 */
export function extractHeadings(content: string): Heading[] {
  const lines = content.split(/\r?\n/);
  const headings: Heading[] = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^(\s*)(```|~~~)/.test(lines[i]!)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = lines[i]!.match(/^(#{2,3})\s+(.+)$/);
    if (m) headings.push({ line: i, level: m[1]!.length, title: m[2]!.trim() });
  }
  return headings;
}

/** 找 anchor 在标题列表里的序号（双向 includes 匹配，文字定位） */
export function findTitleIndex(headings: Heading[], anchor: string): number {
  const anchorClean = anchor.replace(/^#{1,3}\s+/, "").toLowerCase().trim();
  for (let i = 0; i < headings.length; i++) {
    const titleLower = headings[i]!.title.toLowerCase();
    if (titleLower.includes(anchorClean) || anchorClean.includes(titleLower)) return i;
  }
  return -1;
}

/**
 * 按标题序号截取段落。
 *
 * 关键设计（修三个 bug）:
 *  - isFirstOfFile=true → startLine=0，包含文件头部（H1+前言+Pre-lecture quiz）
 *  - endIdx 级别感知：H2 anchor 遇到 H3 不结束（H3 是子段，应包含），遇到同级/更高级才结束
 *    → 修复 Expert Systems 丢失 H3 子段
 *  - 原文和翻译用相同 titleIndex，不依赖文字匹配
 *    → 修复翻译 anchor 英文匹配中文标题失败
 */
export function extractSectionByIndex(
  content: string,
  headings: Heading[],
  titleIndex: number,
  isFirstOfFile: boolean,
): string {
  const lines = content.split(/\r?\n/);
  const anchor = headings[titleIndex]!;
  const startLine = isFirstOfFile ? 0 : anchor.line;
  // endLine: 下一个 level <= anchor.level 的标题（H2 遇 H3 不停，遇 H2/H1 停）
  let endLine = lines.length;
  for (let i = titleIndex + 1; i < headings.length; i++) {
    if (headings[i]!.level <= anchor.level) { endLine = headings[i]!.line; break; }
  }
  return lines.slice(startLine, endLine).join("\n").trim();
}

/**
 * 获取 lesson 的正文内容。
 * 用标题序号截取（extractSectionByIndex），保证原文/翻译对齐 + H3 子段不丢 + 文件头部归入首 lesson。
 */
async function getLessonContent(
  lesson: DesignedLesson,
  source: ContentSource,
  cache: Map<string, string | null>,
  headingsCache: Map<string, Heading[]>,
  fileFirstLesson: Map<string, string>,
  lessonMeta: Map<string, { titleIndex: number; isFirstOfFile: boolean }>,
  total: number,
  done: number,
  send: (msg: string) => void,
): Promise<string | null> {
  send(`\r拉取正文 ${done + 1}/${total}: ${lesson.file.slice(0, 50)}`);

  // 从缓存或拉取
  if (!cache.has(lesson.file)) {
    const content = await source.getFile(lesson.file);
    cache.set(lesson.file, content);
  }
  const fullContent = cache.get(lesson.file);
  if (!fullContent) return null;

  // 无 anchor: 返回整个文件
  if (!lesson.anchor) return fullContent;

  // 标题列表（缓存）
  if (!headingsCache.has(lesson.file)) {
    headingsCache.set(lesson.file, extractHeadings(fullContent));
  }
  const headings = headingsCache.get(lesson.file)!;

  const titleIndex = findTitleIndex(headings, lesson.anchor);
  const sp = `${lesson.file}#${lesson.anchor}`;
  const isFirstOfFile = fileFirstLesson.get(lesson.file) === sp;

  // 记录 meta 供翻译用（翻译用相同序号 + isFirstOfFile 对齐）
  lessonMeta.set(sp, { titleIndex, isFirstOfFile });

  if (titleIndex === -1) return fullContent; // anchor 没找到，降级全文
  return extractSectionByIndex(fullContent, headings, titleIndex, isFirstOfFile);
}

/**
 * 将正文中的相对路径图片引用替换为 base64 data-url。
 * 只替换相对路径（非 http/data），从 CDN 下载图片转 base64。
 */
async function inlineImages(
  content: string,
  sourceFile: string,
  source: ContentSource,
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
      const dataUrl = await source.getImageDataUrl(imgPath);
      if (dataUrl) {
        imageCache.set(imgPath, dataUrl);
      } else {
        // 下载失败或超限 → fallback（GitHub 用 CDN URL，本地返回 null 保留原 src）
        imageCache.set(imgPath, source.getImageFallbackUrl(imgPath));
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
 *
 * 截取对齐（标题序号，修翻译 anchor 英文匹配中文失败）:
 *   原文处理时记录了每个 lesson 的 titleIndex + isFirstOfFile（lessonMeta）。
 *   翻译文件用相同的 titleIndex 截取同序号标题段落，不依赖文字匹配。
 *   → 原文第 N 个 H2 段落 = 翻译第 N 个 H2 段落（机翻保持结构）。
 *
 * 图片处理（位置映射，不下载翻译图）:
 *   翻译正文里的图片引用，按出现位置替换成原文图片（base64/cdn），多余的删掉。
 */
async function fetchAndPersistTranslations(
  db: Db,
  courseId: string,
  langCode: string,
  structure: CourseStructure,
  source: ContentSource,
  markDirty: () => void,
  contentCache: Map<string, string | null>,
  lessonImages: Map<string, string[]>,
  lessonMeta: Map<string, { titleIndex: number; isFirstOfFile: boolean }>,
  send: (msg: string) => void,
): Promise<void> {
  const allLessons = structure.sections.flatMap((s) => s.lessons);
  // 翻译文件的标题列表缓存（按原 file 路径 key）
  const transHeadingsCache = new Map<string, Heading[]>();
  let transWritten = 0;

  for (let idx = 0; idx < allLessons.length; idx++) {
    const lesson = allLessons[idx]!;
    const sourcePath = lesson.anchor ? `${lesson.file}#${lesson.anchor}` : lesson.file;
    const transPath = `translations/${langCode}/${lesson.file}`;

    // 从缓存或拉取翻译文件
    if (!contentCache.has(transPath)) {
      const content = await source.getFile(transPath);
      contentCache.set(transPath, content);
    }
    const transContent = contentCache.get(transPath);
    if (!transContent) continue; // 该文件无翻译

    // 用 titleIndex 序号对齐截取翻译（不依赖文字匹配，修英文 anchor vs 中文标题）
    let finalContent: string;
    if (!lesson.anchor) {
      finalContent = transContent; // 无 anchor = 整个翻译文件
    } else {
      const meta = lessonMeta.get(sourcePath);
      if (!meta || meta.titleIndex === -1) {
        finalContent = transContent; // 原文 anchor 没找到，降级全文
      } else {
        // 翻译文件的标题列表（缓存，按原 file 路径 key）
        if (!transHeadingsCache.has(lesson.file)) {
          transHeadingsCache.set(lesson.file, extractHeadings(transContent));
        }
        const transHeadings = transHeadingsCache.get(lesson.file)!;
        if (meta.titleIndex >= transHeadings.length) continue; // 翻译缺该段落
        finalContent = extractSectionByIndex(transContent, transHeadings, meta.titleIndex, meta.isFirstOfFile);
      }
    }

    // 图片位置映射：按位置替换成原文图片（不下载翻译图）
    const originalImgs = lessonImages.get(sourcePath) ?? [];
    finalContent = replaceImagesByPosition(finalContent, originalImgs);

    // 找对应的 lesson 节点
    const lessonNode = db.select().from(contentNodes)
      .where(eq(contentNodes.courseId, courseId)).all()
      .find((n) => n.type === "lesson" && n.sourcePath === sourcePath);
    if (!lessonNode) continue;

    // 翻译标题取首个标题（H1 或 H2）
    const hMatch = finalContent.match(/^#{1,2}\s+(.+)$/m);
    const transTitle = hMatch ? hMatch[1]!.trim() : lesson.title;

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

  markDirty();
  send(`翻译完成: ${transWritten} 课有翻译`);
}

/**
 * 提取 markdown 正文里的所有图片 src（按出现顺序）。
 * 匹配 markdown ![](src) 和 HTML <img src="...">。
 * 用于记录原文 inlined 后的图片序列（已是 base64/cdn），供翻译按位置映射。
 */
export function extractImageSrcs(content: string): string[] {
  const srcs: string[] = [];
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    srcs.push(m[1]!);
  }
  for (const m of content.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    srcs.push(m[1]!);
  }
  return srcs;
}

/**
 * 按位置替换翻译正文里的图片引用为原文图片。
 * 翻译第 i 张图 → originalImgs[i]（原文第 i 张的 base64/cdn）。
 * 超出原文图片数的翻译图 → 删掉（机翻增图罕见，删掉最干净）。
 * HTML <img> 统一转成 markdown ![](src)（ReactMarkdown 不渲染 raw HTML）。
 *
 * 用统一正则一次扫描 markdown ![](x) 和 HTML <img>，避免分两步导致
 * HTML 转成 markdown 后被二次扫到、共用 imgIdx 误删。
 */
export function replaceImagesByPosition(content: string, originalImgs: string[]): string {
  let imgIdx = 0;
  // 统一匹配 markdown ![](x) 或 HTML <img src="x">，按出现顺序处理
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  return content.replace(pattern, (match, mdAlt: string, _mdSrc: string, htmlSrc?: string) => {
    if (imgIdx >= originalImgs.length) return ""; // 多余的删掉
    const replacement = originalImgs[imgIdx++]!;
    if (htmlSrc !== undefined) {
      // HTML <img>: 提取 alt 属性，转成 markdown
      const altMatch = match.match(/alt=["']([^"']*)["']/i);
      const alt = altMatch?.[1] ?? "";
      return `![${alt}](${replacement})`;
    }
    // markdown ![](x)
    return `![${mdAlt}](${replacement})`;
  });
}
