/**
 * 本地文件夹通用扫描器 —— 把任意课程文件夹(如 Coursera 下载包)递归扫描成文档清单。
 *
 * 设计原则:通用,不硬编码某一种文件夹结构。
 *   - 扫描所有文本类文件:.txt/.md/.markdown/.html/.htm/.pdf
 *   - 图片文件:.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp(多模态 flag on 时收集)
 *   - 中文优先去重(同内容 .zh-CN 和 .en 只留中文)
 *   - 按文件名 NN_ 前缀排序
 *   - HTML 去标签转纯文本(<co-content> 富文本质量足够)
 *   - PDF 用 pdf-parse 提取文本(图表提取不了,但文字说明能拿到)
 *   - PDF 图片提取由 pdf-renderer 处理(纯文字/纯图片/混合自动分类)
 *
 * 纯函数为主(htmlToText/标题推断/去重/图片引用解析),便于 verify 脚本测。
 * scanFolder 本身用 fs(异步),verify 用临时目录造文件测。
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep, basename, dirname } from "node:path";

export interface ScannedDoc {
  /** 相对根目录的路径(如 calculus/week1/lesson1/06_motivation.zh-CN.txt),用 / 分隔 */
  path: string;
  /** 从路径/文件名推断的标题(去数字前缀/扩展名/语言后缀) */
  title: string;
  /** 提取的纯文本内容 */
  content: string;
  /** 语言(zh/en/other),用于去重 */
  lang: "zh" | "en" | "other";
  /** 文件类型 */
  kind: "txt" | "md" | "html" | "pdf" | "ipynb" | "rst" | "rmd" | "org" | "adoc";
}

/** 扫描到的图片资源(独立图片文件 / markdown 引用 / PDF 页面渲染图) */
export interface ScannedImage {
  /** 相对根目录的路径(用 / 分隔) */
  path: string;
  /** 绝对路径(落库时复制到 assets 用);buffer 型(PDF 提取)为空串 */
  absPath: string;
  /** 从文件名推断的标题/描述 */
  title: string;
  /** MIME 类型 */
  mime: string;
  /** 来源:独立文件 / markdown 引用 / PDF 页面渲染图 */
  source: "image_file" | "markdown_ref" | "pdf_page";
  /** markdown ![](x) 的 alt 文本(独立文件时 = title) */
  altText: string;
  /** PDF 提取的图片二进制(有 buffer 时 absPath 可空);独立文件时为 undefined */
  buffer?: Buffer;
  /** PDF 来源页码(1-based);非 PDF 为 undefined */
  pageNumber?: number;
}

/** 支持的扩展名 → kind 映射 */
const EXT_KIND: Record<string, ScannedDoc["kind"]> = {
  txt: "txt",
  md: "md",
  markdown: "md",
  html: "html",
  htm: "html",
  pdf: "pdf",
  ipynb: "ipynb",
  rst: "rst",
  rmd: "rmd",
  org: "org",
  adoc: "adoc",
  asciidoc: "adoc",
};

/** 图片扩展名 → MIME 映射 */
const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** 排除的目录(非教学内容) */
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", "__pycache__",
  ".DS_Store", "translations",
]);

/** HTML 转纯文本:去 script/style,标签转段落,<li> 加 •,decode 常见实体。纯函数,可测。 */
export function htmlToText(html: string): string {
  let s = html;
  // 去 script/style 整块
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  // 块级标签 → 换行
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // <li> → 项目符号
  s = s.replace(/<li[^>]*>/gi, "• ");
  // 表格单元格分隔
  s = s.replace(/<\/td>/gi, "\t");
  s = s.replace(/<\/th>/gi, "\t");
  // 去所有剩余标签
  s = s.replace(/<[^>]+>/g, "");
  // decode 常见 HTML 实体
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—");
  // 压缩多余空白(保留段落分隔)
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** 从文件名推断语言(用于中文优先去重)。 */
export function detectLang(filename: string): "zh" | "en" | "other" {
  const lower = filename.toLowerCase();
  if (/\.zh[-_]?cn\./.test(lower) || /\.zh[-_]?hans\./.test(lower) || /\.zh\./.test(lower)) return "zh";
  if (/\.en[-_]?us\./.test(lower) || /\.en\./.test(lower)) return "en";
  // 无语言后缀:内容是中文 → zh,否则 other(留给扫描时按内容判断)
  return "other";
}

/** 从路径推断标题:
 *   07_derivatives-and-tangents.zh-CN.txt → "Derivatives And Tangents"
 *   01_lesson-1-intro/README.md → "Lesson 1 Intro"
 * 去数字前缀 + 扩展名 + 语言后缀,- _ 转空格,首字母大写。纯函数,可测。 */
export function inferTitle(relPath: string): string {
  const filename = basename(relPath);
  // 去扩展名
  let name = filename.replace(/\.(txt|md|markdown|html?|pdf|ipynb|rst|rmd|org|adoc|asciidoc)$/i, "");
  // 去语言后缀(.zh-CN / .en / .en-US 等)
  name = name.replace(/\.(zh[-_]?cn|zh[-_]?hans|zh|en[-_]?us|en)$/i, "");
  // README / index → 用父目录名
  if (/^(readme|index)$/i.test(name)) {
    const parts = relPath.split("/").filter(Boolean);
    const parent = parts[parts.length - 2];
    if (parent) name = parent;
  }
  // 去开头数字前缀(01_ / 02-)
  name = name.replace(/^(\d+[_-]\s*)/, "");
  // - 和 _ 转空格
  name = name.replace(/[-_]+/g, " ").trim();
  // 首字母大写(英文),中文不受影响
  if (/^[a-z]/.test(name)) name = name.charAt(0).toUpperCase() + name.slice(1);
  return name || filename;
}

/** 算 basename 的去重 key(去掉语言后缀 + 扩展名)。
 *  06_motivation.en.txt 和 06_motivation.zh-CN.txt → key "06_motivation" */
export function dedupKey(relPath: string): string {
  const filename = basename(relPath);
  let name = filename.replace(/\.(txt|md|markdown|html?|pdf|ipynb|rst|rmd|org|adoc|asciidoc)$/i, "");
  name = name.replace(/\.(zh[-_]?cn|zh[-_]?hans|zh|en[-_]?us|en)$/i, "");
  return name.toLowerCase();
}

/**
 * 递归扫描一个目录,返回所有文本类文档(可选:同时收集图片)。
 * 中文优先去重:同 dedupKey 的多语言文件只保留中文(.zh 优先于 .en/other)。
 * 按相对路径排序(保持目录顺序 + 文件名 NN_ 前缀)。
 *
 * @param rootDir 根目录绝对路径
 * @param onProgress 可选进度回调(已扫文件数,当前路径)
 * @param options.collectImages true 时同时收集图片文件 + markdown 图片引用(多模态 flag)
 * @returns 文档数组,或 { docs, images }(collectImages=true 时)
 */
export async function scanFolder(
  rootDir: string,
  onProgress?: (scanned: number, currentPath: string) => void,
  options?: { collectImages?: boolean },
): Promise<ScannedDoc[] | { docs: ScannedDoc[]; images: ScannedImage[] }> {
  const allFiles: { absPath: string; relPath: string; isImage: boolean }[] = [];
  await walkDir(rootDir, rootDir, allFiles);

  // 按相对路径排序(目录顺序 + 文件名数字前缀)
  allFiles.sort((a, b) => naturalPathCompare(a.relPath, b.relPath));

  const docFiles = allFiles.filter((f) => !f.isImage);
  const imageFiles = allFiles.filter((f) => f.isImage);

  // 读所有文档文件,按 kind 提取内容
  const docs: ScannedDoc[] = [];
  let count = 0;
  for (const f of docFiles) {
    onProgress?.(++count, f.relPath);
    const ext = f.relPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    const kind = EXT_KIND[ext];
    if (!kind) continue;
    try {
      const content = await readFileWithKind(f.absPath, kind);
      if (!content || content.trim().length < 5) continue; // 跳过空/太短文件(中文 4-5 字也算有效)
      const lang = detectLang(f.relPath);
      docs.push({
        path: f.relPath,
        title: inferTitle(f.relPath),
        content,
        lang,
        kind,
      });
    } catch {
      // 单文件失败跳过(如损坏 PDF),不阻塞整体扫描
    }
  }

  // 中文优先去重:同 dedupKey 的文件,优先级 zh > en > other
  const dedupedDocs = dedupByLang(docs);

  // 不收图 → 直接返回(向后兼容)
  if (!options?.collectImages) {
    return dedupedDocs;
  }

  // === 收图 ===

  // 1. 独立图片文件
  const fileImages: ScannedImage[] = imageFiles.map((f) => {
    const ext = f.relPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    return {
      path: f.relPath,
      absPath: f.absPath,
      title: inferImageTitle(f.relPath),
      mime: IMAGE_EXT_MIME[ext] ?? "image/png",
      source: "image_file" as const,
      altText: inferImageTitle(f.relPath),
    };
  });

  // 2. markdown 图片引用(从 .md/.html 文档正文解析)
  const refImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    // 所有格式解析后都已转成 markdown,图片引用统一用 ![](path) 或 <img> 语法
    // txt 可能含裸路径但不常见,跳过;html 走 htmlToText 后图片标签已丢
    if (doc.kind === "txt" || doc.kind === "html") continue;
    const refs = extractImageRefs(doc.content);
    for (const ref of refs) {
      const resolvedPath = resolveImageRef(ref.refPath, doc.path);
      // 跳过已被独立文件覆盖的(去重后做)
      const ext = resolvedPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
      refImages.push({
        path: resolvedPath,
        absPath: join(rootDir, resolvedPath),
        title: ref.alt || inferImageTitle(resolvedPath),
        mime: IMAGE_EXT_MIME[ext] ?? "image/png",
        source: "markdown_ref" as const,
        altText: ref.alt || inferImageTitle(resolvedPath),
      });
    }
  }

  // 去重:同 path 只留一份(file 优先)
  const dedupedFileAndRefImages = dedupImages(fileImages, refImages);

  // 3. PDF 内嵌图片提取(纯文字 PDF 无图;混合/纯图片 PDF 有图)
  const pdfImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    if (doc.kind !== "pdf") continue;
    try {
      const { processPdf } = await import("../../lib/pdf-renderer.js");
      const pdfBuf = await readFile(join(rootDir, doc.path));
      const result = await processPdf(pdfBuf);
      for (const img of result.images) {
        pdfImages.push({
          path: `${doc.path}#page${img.pageNumber}.png`,
          absPath: "", // buffer 型,无源文件
          title: `${doc.title} - 图(第${img.pageNumber}页)`,
          mime: img.mimeType,
          source: "pdf_page" as const,
          altText: `${doc.title} 第${img.pageNumber}页`,
          buffer: img.buffer,
          pageNumber: img.pageNumber,
        });
      }
    } catch {
      // PDF 图片提取失败跳过(文字已在 doc.content 里)
    }
  }

  // 4. ipynb output 图片提取(notebook 的 code cell 执行输出图)
  const notebookImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    if (!doc.path.toLowerCase().endsWith(".ipynb")) continue;
    try {
      const { parseNotebook } = await import("./notebook-parser.js");
      const nbRaw = await readFile(join(rootDir, doc.path), "utf8");
      const nbResult = parseNotebook(nbRaw);
      for (const img of nbResult.images) {
        const buf = Buffer.from(img.base64, "base64");
        notebookImages.push({
          path: `${doc.path}#cell${img.cellIndex}.png`,
          absPath: "", // buffer 型
          title: `${doc.title} - 输出图(cell ${img.cellIndex})`,
          mime: img.mimeType,
          source: "image_file" as const, // 复用 image_file 类型(buffer 型)
          altText: img.altText,
          buffer: buf,
        });
      }
    } catch {
      // notebook 图片提取失败跳过(文字已在 doc.content 里)
    }
  }

  // 全部图片合并(PDF/notebook 图用唯一 path,不会和文件图冲突)
  const images = [...dedupedFileAndRefImages, ...pdfImages, ...notebookImages];

  return { docs: dedupedDocs, images };
}

/** 按语言优先级去重(zh > en > other)。同 dedupKey 只保留最高优先级那份。 */
export function dedupByLang(docs: ScannedDoc[]): ScannedDoc[] {
  const priority = { zh: 0, en: 1, other: 2 };
  const byKey = new Map<string, ScannedDoc>();
  for (const d of docs) {
    const key = dedupKey(d.path);
    const existing = byKey.get(key);
    if (!existing || priority[d.lang] < priority[existing.lang]) {
      byKey.set(key, d);
    }
  }
  // 保持原顺序
  return docs.filter((d) => byKey.get(dedupKey(d.path)) === d);
}

/* ============================================================
 * 图片收集(多模态 flag on 时启用)
 * ============================================================ */

/** markdown 图片引用提取结果 */
export interface MarkdownImageRef {
  /** 原始 alt 文本 */
  alt: string;
  /** 引用路径(markdown 里的原始写法,如 ./img.png 或 ../assets/fig.png) */
  refPath: string;
}

/**
 * 从 markdown 内容里提取图片引用 ![alt](path)。
 * 纯函数,便于测试。
 *
 * 解析规则:
 *   - 匹配 ![可选alt](路径) 格式
 *   - 去掉路径里的锚点和查询参数后缀
 *   - 只保留图片扩展名(.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp)
 *   - 跳过 http(s) 绝对 URL(这些是外部资源,本地没有文件)
 *   - 跳过 data: URL
 */
export function extractImageRefs(md: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];
  const seen = new Set<string>();

  // 1. Markdown 语法 ![alt](url)
  const mdPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdPattern.exec(md)) !== null) {
    const alt = m[1].trim();
    let url = m[2].trim();
    // 去空格和标题(如 ![alt](path "title"))
    const titleMatch = url.match(/\s+"[^"]*"$/);
    if (titleMatch) url = url.slice(0, titleMatch.index).trim();
    // 去锚点
    url = url.split("#")[0];
    // 跳过外部 URL 和 data URL
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    // 只留图片扩展名
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!(ext in IMAGE_EXT_MIME)) continue;
    const key = alt + "|" + url;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ alt, refPath: url });
  }

  // 2. HTML <img> 标签(src='...' 或 src="...")
  // 覆盖微软课程仓库常见的 <img src='images/xxx.png' alt='描述'/>
  // 两步法:先提取 <img ...> 整标签,再独立提取 src 和 alt(属性顺序无关)
  const htmlPattern = /<img\s+[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = htmlPattern.exec(md)) !== null) {
    const tag = hm[0];
    const url = (tag.match(/src=['"]([^'"]+)['"]/i)?.[1] ?? "").trim().split("#")[0];
    const alt = (tag.match(/alt=['"]([^'"]*)['"]/i)?.[1] ?? "").trim();
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!(ext in IMAGE_EXT_MIME)) continue;
    const key = alt + "|" + url;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ alt: alt || (url.split("/").pop() ?? url), refPath: url });
  }

  return refs;
}

/**
 * 把 markdown 图片引用解析成相对于扫描根目录的路径。
 * 处理 ./ ../ 等相对引用。
 *
 * @param refPath markdown 里的原始引用(如 ./img.png)
 * @param docRelPath 引用所在文档的相对路径(如 ch1/lesson1/notes.md)
 * @returns 相对根目录的标准化路径(如 ch1/lesson1/img.png),用 / 分隔
 *
 * 纯函数,便于测试。
 */
export function resolveImageRef(refPath: string, docRelPath: string): string {
  const docDir = dirname(docRelPath).replace(/\\/g, "/");
  // 统一用 / 分隔(Windows \ 路径归一)
  const normalized = refPath.replace(/\\/g, "/").replace(/^\.\//, "");
  // 相对引用(含 ./ ../ 纯文件名 子目录)→ 相对 docDir 解析。
  // 用纯字符串拼接(不依赖 node:path 的盘符行为,跨平台一致)。
  const parts = docDir === "." ? [] : docDir.split("/").filter(Boolean);
  const refParts = normalized.split("/");
  for (const p of refParts) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return parts.join("/");
}

/** 从图片文件名推断 alt 文本(去扩展名 + 数字前缀) */
export function inferImageTitle(filename: string): string {
  let name = basename(filename);
  name = name.replace(/\.(png|jpe?g|gif|webp|svg|bmp)$/i, "");
  name = name.replace(/^(\d+[_-]\s*)/, "");
  name = name.replace(/[-_]+/g, " ").trim();
  if (/^[a-z]/.test(name)) name = name.charAt(0).toUpperCase() + name.slice(1);
  return name || basename(filename);
}

/**
 * 把独立图片文件 + markdown 引用合并去重。
 * 去重规则:按相对根目录路径归一。同一图既被 .md 引用又是独立文件 → 只留一份(image_file 优先,因为它肯定存在)。
 *
 * 纯函数,便于测试。
 */
export function dedupImages(
  fileImages: ScannedImage[],
  refImages: ScannedImage[],
): ScannedImage[] {
  const seen = new Map<string, ScannedImage>();
  // 先放 file(优先),再放 ref(补充未匹配的)
  for (const img of fileImages) {
    if (!seen.has(img.path)) seen.set(img.path, img);
  }
  for (const img of refImages) {
    if (!seen.has(img.path)) seen.set(img.path, img);
  }
  return Array.from(seen.values());
}

/* ---------- 内部辅助 ---------- */

async function walkDir(root: string, current: string, acc: { absPath: string; relPath: string; isImage: boolean }[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDir(root, abs, acc);
    } else if (entry.isFile()) {
      const ext = entry.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
      if (ext in EXT_KIND) {
        const rel = relative(root, abs).split(sep).join("/");
        acc.push({ absPath: abs, relPath: rel, isImage: false });
      } else if (ext in IMAGE_EXT_MIME) {
        const rel = relative(root, abs).split(sep).join("/");
        acc.push({ absPath: abs, relPath: rel, isImage: true });
      }
    }
  }
}

async function readFileWithKind(absPath: string, kind: ScannedDoc["kind"]): Promise<string> {
  if (kind === "pdf") {
    // pdf-parse 动态 require(避免打包时直接解析它的测试文件坑)
    const buf = await readFile(absPath);
    const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buf);
    return data.text.trim();
  }
  if (kind === "ipynb") {
    // .ipynb 是 JSON,用 notebook-parser 转成 markdown(markdown cell + code block)
    const raw = await readFile(absPath, "utf8");
    const { parseNotebook } = await import("./notebook-parser.js");
    const result = parseNotebook(raw);
    return result.markdown;
  }
  if (kind === "rst" || kind === "rmd" || kind === "org" || kind === "adoc") {
    // 非 markdown 标记格式 → 用各自解析器转 markdown
    const raw = await readFile(absPath, "utf8");
    const parser = { rst: "rst-parser", rmd: "rmd-parser", org: "org-parser", adoc: "adoc-parser" }[kind];
    if (parser) {
      try {
        const mod = await import(`./${parser}.js`);
        const fn = mod.parseRst ?? mod.parseRmd ?? mod.parseOrg ?? mod.parseAdoc;
        return fn(raw).markdown;
      } catch {
        return raw; // 解析失败 → 当纯文本
      }
    }
    return raw;
  }
  const raw = await readFile(absPath, "utf8");
  return kind === "html" ? htmlToText(raw) : raw;
}

/** 路径自然排序:按段拆分,数字段按数值比较(02_ 在 10_ 前,不是字典序)。 */
function naturalPathCompare(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const na = pa[i]!.match(/^(\d+)/)?.[1];
    const nb = pb[i]!.match(/^(\d+)/)?.[1];
    if (na && nb && na !== nb) return Number(na) - Number(nb);
    if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return pa.length - pb.length;
}
