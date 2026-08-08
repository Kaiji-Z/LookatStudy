/**
 * 本地文件夹通用扫描器 —— 把任意课程文件夹(如 Coursera 下载包)递归扫描成文档清单。
 *
 * 设计原则:通用,不硬编码某一种文件夹结构。
 *   - 扫描所有文本类文件:.txt/.md/.markdown/.html/.htm/.pdf
 *   - 中文优先去重(同内容 .zh-CN 和 .en 只留中文)
 *   - 按文件名 NN_ 前缀排序
 *   - HTML 去标签转纯文本(<co-content> 富文本质量足够)
 *   - PDF 用 pdf-parse 提取文本(图表提取不了,但文字说明能拿到)
 *
 * 纯函数为主(htmlToText/标题推断/去重),便于 verify 脚本测。
 * scanFolder 本身用 fs(异步),verify 用临时目录造文件测。
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep, basename } from "node:path";

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
  kind: "txt" | "md" | "html" | "pdf";
}

/** 支持的扩展名 → kind 映射 */
const EXT_KIND: Record<string, ScannedDoc["kind"]> = {
  txt: "txt",
  md: "md",
  markdown: "md",
  html: "html",
  htm: "html",
  pdf: "pdf",
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
  let name = filename.replace(/\.(txt|md|markdown|html?|pdf)$/i, "");
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
  let name = filename.replace(/\.(txt|md|markdown|html?|pdf)$/i, "");
  name = name.replace(/\.(zh[-_]?cn|zh[-_]?hans|zh|en[-_]?us|en)$/i, "");
  return name.toLowerCase();
}

/**
 * 递归扫描一个目录,返回所有文本类文档。
 * 中文优先去重:同 dedupKey 的多语言文件只保留中文(.zh 优先于 .en/other)。
 * 按相对路径排序(保持目录顺序 + 文件名 NN_ 前缀)。
 *
 * @param rootDir 根目录绝对路径
 * @param onProgress 可选进度回调(已扫文件数,当前路径)
 */
export async function scanFolder(
  rootDir: string,
  onProgress?: (scanned: number, currentPath: string) => void,
): Promise<ScannedDoc[]> {
  const allFiles: { absPath: string; relPath: string }[] = [];
  await walkDir(rootDir, rootDir, allFiles);

  // 按相对路径排序(目录顺序 + 文件名数字前缀)
  allFiles.sort((a, b) => naturalPathCompare(a.relPath, b.relPath));

  // 读所有文件,按 kind 提取内容
  const docs: ScannedDoc[] = [];
  let count = 0;
  for (const f of allFiles) {
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
  return dedupByLang(docs);
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

/* ---------- 内部辅助 ---------- */

async function walkDir(root: string, current: string, acc: { absPath: string; relPath: string }[]): Promise<void> {
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
        acc.push({ absPath: abs, relPath: rel });
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
