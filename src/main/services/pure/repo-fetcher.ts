/**
 * 仓库导入器 —— 从学习型 GitHub 仓库构建课程结构。
 *
 * 核心策略:不依赖文件列表 API（api.github.com / api.jsdelivr.net 在很多网络环境下不可达），
 * 而是从 README.md 的 markdown 内部链接发现课程结构。
 *
 * 学习仓库的 README 通常有完整的课程大纲，链接指向每个课时:
 *   - 形态 A（课程型）: 链接指向 lessons/N-Topic/README.md + .ipynb
 *   - 形态 B（单文件型）: README 本身是超长文档，无子文件链接
 *
 * 数据源: cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}（全球 CDN，无速率限制，
 * 在大多数网络环境下可用，包括 raw.githubusercontent.com 被墙的情况）
 *
 * 纯函数设计: fetchFn 由调用方注入（生产用 global fetch，测试用 mock）。
 */
import { parseMarkdownToCourse, type ParsedCourse, type ParsedSection, type ParsedLesson } from "./markdown-course.js";
import { classifyFile, type FileClassification } from "./file-classifier.js";

/** 仓库文件条目（从 README 链接发现） */
export interface DiscoveredFile {
  path: string;
  /** 链接文本（课时标题） */
  title: string;
  /** 文件类型: md 正文 / ipynb notebook / rst / rmd / org / adoc / other */
  kind: "md" | "ipynb" | "rst" | "rmd" | "org" | "adoc" | "other";
}

/** 仓库检测结果 */
export type RepoPattern = "course" | "single-file" | "unsupported";

export interface DetectionResult {
  pattern: RepoPattern;
  reason: string;
  /** course 模式: 从 README 链接发现的课时文件 */
  lessonFiles?: DiscoveredFile[];
  /** 单文件模式: README 本身的正文长度 */
  readmeLength?: number;
}

/** 拉取结果 */
export interface FetchedFile {
  path: string;
  title: string;
  md: string;
  /** 文件分类（由 classifyFile 填充，buildCourseFromFiles 用于决定是否进 lesson 列表） */
  classification?: FileClassification;
}

export interface FetchResult {
  ok: FetchedFile[];
  failed: { path: string; error: string }[];
}

/** CDN URL 构造 */
export function cdnUrl(owner: string, repo: string, branch: string, path: string): string {
  const cleanPath = path.replace(/^\.\//, "").replace(/^\//, "");
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${cleanPath}`;
}

/**
 * 从 README 的 markdown 链接提取内部文件引用。
 * 只看相对路径（非 http/锚点），且指向 .md/.ipynb 文件。
 */
export function extractInternalLinks(readmeMd: string): DiscoveredFile[] {
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const seen = new Set<string>();
  const files: DiscoveredFile[] = [];
  let m;
  while ((m = linkPattern.exec(readmeMd)) !== null) {
    const title = m[1].trim();
    let href = m[2].trim();
    // 去掉锚点部分
    href = href.split("#")[0];
    // 只看相对路径
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) continue;
    // 去掉 ./ 前缀
    href = href.replace(/^\.\//, "");
    // 收 .md / .ipynb / .rst / .rmd / .org / .adoc
    let kind: DiscoveredFile["kind"] = "other";
    if (href.endsWith(".md") || href.endsWith(".mdx")) kind = "md";
    else if (href.endsWith(".ipynb")) kind = "ipynb";
    else if (href.endsWith(".rst")) kind = "rst";
    else if (href.endsWith(".rmd")) kind = "rmd";
    else if (href.endsWith(".org")) kind = "org";
    else if (href.endsWith(".adoc") || href.endsWith(".asciidoc")) kind = "adoc";
    else continue;
    // 去重
    if (seen.has(href)) continue;
    seen.add(href);
    files.push({ path: href, title: title || href, kind });
  }
  return files;
}

/**
 * 过滤:只保留像课时文件的（排除 translations/、lab/、translations、LICENSE 等）
 */
export function filterLessonFiles(files: DiscoveredFile[]): DiscoveredFile[] {
  return files.filter((f) => {
    const p = f.path.toLowerCase();
    // 排除翻译目录
    if (p.includes("translations/")) return false;
    // 排除常见非教学内容
    if (p.endsWith("license.md") || p.endsWith("contributing.md") || p.endsWith("code_of_conduct.md"))
      return false;
    // 排除 lab/ 目录（是配套练习说明，不是课时正文）
    // 注意:保留，但后面处理时区分对待
    return true;
  });
}

/**
 * 检测仓库形态。
 *
 * - course: README 链接里有 ≥3 个 .md 文件指向子目录（说明有课程结构）
 * - single-file: 链接不够，但 README 本身够长（>3KB，有实质内容）
 * - unsupported: README 太短且无子文件（可能是纯链接集合仓库）
 */
export function detectRepoPattern(readmeMd: string): DetectionResult {
  const allLinks = extractInternalLinks(readmeMd);
  const lessonLinks = filterLessonFiles(allLinks).filter((f) => f.kind !== "other");

  // 课程型: 有 ≥3 个子文件链接(.md/.ipynb/.rst/.rmd/.org/.adoc 任一)
  if (lessonLinks.length >= 3) {
    return {
      pattern: "course",
      reason: `README 含 ${lessonLinks.length} 个内部课程文件链接，判定为课程型仓库`,
      lessonFiles: lessonLinks,
    };
  }

  // 单文件型: README 本身够长
  if (readmeMd.length > 3000) {
    return {
      pattern: "single-file",
      reason: `README 无足够子文件链接（${lessonLinks.length} 个），但正文 ${readmeMd.length} 字符，判定为单文件型`,
      readmeLength: readmeMd.length,
    };
  }

  // 不支持
  return {
    pattern: "unsupported",
    reason: `README 太短（${readmeMd.length} 字符）且无课程子文件链接，可能不是学习仓库`,
  };
}

/**
 * 并发拉取多个 markdown 文件（5 并发，防 CDN 过载）。
 *
 * @param files 要拉取的文件列表
 * @param owner repo owner
 * @param repo repo name
 * @param branch 分支名
 * @param fetchFn 注入的 fetch 函数
 * @param onProgress 进度回调 (done, total, currentPath)
 */
export async function fetchMarkdownContents(
  files: DiscoveredFile[],
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (done: number, total: number, currentPath: string) => void,
): Promise<FetchResult> {
  const ok: FetchedFile[] = [];
  const failed: { path: string; error: string }[] = [];
  const CONCURRENCY = 5;
  let done = 0;

  // 分批并发
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (f) => {
        const url = cdnUrl(owner, repo, branch, f.path);
        const r = await fetchFn(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        // .ipynb → 用 notebook-parser 转成 markdown(markdown cell + code block)
        if (f.path.toLowerCase().endsWith(".ipynb")) {
          try {
            const { parseNotebook } = await import("./notebook-parser.js");
            const nbResult = parseNotebook(text);
            return { path: f.path, title: f.title, md: nbResult.markdown };
          } catch {
            return { path: f.path, title: f.title, md: text };
          }
        }
        // .rst/.rmd/.org/.adoc → 用各自解析器转 markdown
        const lowerPath = f.path.toLowerCase();
        if (lowerPath.endsWith(".rst") || lowerPath.endsWith(".rmd") || lowerPath.endsWith(".org") || lowerPath.endsWith(".adoc") || lowerPath.endsWith(".asciidoc")) {
          const parserMap: Record<string, string> = {
            ".rst": "rst-parser", ".rmd": "rmd-parser", ".org": "org-parser",
            ".adoc": "adoc-parser", ".asciidoc": "adoc-parser",
          };
          const ext = lowerPath.match(/\.[^.]+$/)?.[0] ?? "";
          const parserName = parserMap[ext];
          if (parserName) {
            try {
              const mod = await import(`./${parserName}.js`);
              const fn = mod.parseRst ?? mod.parseRmd ?? mod.parseOrg ?? mod.parseAdoc;
              return { path: f.path, title: f.title, md: fn(text).markdown };
            } catch {
              return { path: f.path, title: f.title, md: text };
            }
          }
        }
        return { path: f.path, title: f.title, md: text };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      done++;
      const file = batch[j];
      const result = results[j];
      if (file) onProgress?.(done, files.length, file.path);
      if (result && result.status === "fulfilled") {
        ok.push(result.value);
      } else if (result && result.status === "rejected") {
        failed.push({
          path: file?.path ?? "(unknown)",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  return { ok, failed };
}

/**
 * 把课程型仓库的多个课时文件合并成 ParsedCourse 结构。
 *
 * v3 改进:集成 file-classifier 规则引擎。
 *   - 先对每个文件调 classifyFile 判定角色（lesson/notebook/lab/section-intro/uncertain 等）
 *   - keepAsLesson=false 的文件（translation/meta/notebook/lab/example/section-intro）不进 lesson 列表
 *   - section-intro 的正文追加到同 section 摘要（作为章节概述）
 *   - uncertain 的文件进 lesson 列表但标 uncertain=true，后续 LLM 结构化时优先判断 keep/skip
 *
 * 分组策略保留 v2 的"第一个非通用目录"启发式（减少碎片）。
 *
 * 每个文件的内部 H2/H3 → 该 section 下的 lessons;无 H2/H3 则整个文件作一个 lesson。
 */
export function buildCourseFromFiles(
  courseTitle: string,
  files: FetchedFile[],
): ParsedCourse {
  // 第 0 步:对每个文件分类（siblingPaths = 全部文件路径）
  const allPaths = files.map((f) => f.path);
  for (const file of files) {
    if (!file.classification) {
      file.classification = classifyFile(file.path, file.md, { siblingPaths: allPaths });
    }
  }

  // 第一步:给每个 keepAsLesson 文件算"分组键"和"lesson 候选"
  // 非课时文件(notebook/lab/example/section-intro)的正文不丢弃——
  // notebook/lab/example 追加到同目录 lesson 的正文末尾（作为"代码/练习补充"）,
  // section-intro 追加到 section 第一个 lesson 的正文开头（作为"章节概述"）。
  interface FileGroup {
    sectionTitle: string;
    orderKey: string; // 用于排序(保持原路径顺序)
    lessons: ParsedLesson[];
    /** 待追加到第一个 lesson 的章节概述正文 */
    pendingIntro?: string;
  }
  const groupMap = new Map<string, FileGroup>();
  const groupOrder: string[] = [];

  const GENERIC_DIRS = new Set(["lessons", "docs", "doc", "src", "content", "modules", "chapters", "tutorials", "guide"]);

  /**
   * 计算文件的 section 分组键（和 lesson 用同一个逻辑）。
   */
  function sectionKeyOf(path: string): { groupKey: string; sectionTitle: string } {
    const parts = path.split("/").filter(Boolean);
    const dirParts = parts[parts.length - 1]?.match(/^readme/i) || parts[parts.length - 1] === "index.md"
      ? parts.slice(0, -1)
      : parts;
    const specificDir = dirParts.find((p) => !GENERIC_DIRS.has(p.toLowerCase()) && !/\.(md|mdx)$/i.test(p));
    if (dirParts.length >= 2 && specificDir) {
      const gk = specificDir.replace(/\.md$/i, "");
      return { groupKey: gk, sectionTitle: gk };
    } else if (dirParts.length === 1) {
      return { groupKey: path, sectionTitle: dirParts[0]!.replace(/\.md$/i, "") };
    }
    return { groupKey: path, sectionTitle: parts[parts.length - 1] ?? path };
  }

  // 先按路径排序，保证同目录的 notebook 在 lesson 之后（这样 lesson 先建好，notebook 能追加到它）
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const classification = file.classification!;
    const { groupKey, sectionTitle } = sectionKeyOf(file.path);

    // 确保分组存在
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { sectionTitle, orderKey: file.path, lessons: [] });
      if (!groupOrder.includes(groupKey)) groupOrder.push(groupKey);
    }
    const group = groupMap.get(groupKey)!;

    // ---- 非课时文件：正文合并到同目录 lesson ----
    if (!classification.keepAsLesson) {
      if (classification.role === "section-intro") {
        // section-intro → 追加到 section 第一个 lesson 开头
        group.pendingIntro = file.md;
      } else if (classification.role === "notebook" || classification.role === "lab" || classification.role === "example") {
        // notebook/lab/example → 追加到同 group 最后一个 lesson 的末尾（作为代码/练习补充）
        // 文件已按路径排序，同目录的 lesson README 在 notebook 前面处理，所以 group 里已有 lesson
        const targetLesson = group.lessons[group.lessons.length - 1];
        if (targetLesson && file.md.trim().length > 0) {
          const label = classification.role === "notebook" ? "📓 Notebook 代码" : classification.role === "lab" ? "🔧 练习" : "💡 示例";
          targetLesson.body += `\n\n---\n\n**${label}**（来自 \`${file.path}\`）:\n\n${file.md}`;
        }
      }
      // translation/meta 不合并，直接跳过
      continue;
    }

    // ---- 课时文件：正常进 lesson 列表 ----
    const parsed = parseMarkdownToCourse(file.md);
    const parsedLessonCount = parsed.sections.reduce((sum, s) => sum + s.lessons.length, 0);
    const isUncertain = classification.role === "uncertain";
    const lessonCandidates: ParsedLesson[] =
      parsedLessonCount > 0
        ? parsed.sections
            .filter((s) => s.lessons.length > 0)
            .flatMap((s) => s.lessons.map((l) => ({
              title: l.title,
              anchor: l.title.toLowerCase().replace(/\s+/g, "-"),
              body: l.body,
              uncertain: isUncertain,
            })))
        : (() => {
            const h1Match = file.md.match(/^#\s+(.+)$/m);
            const lessonTitle = h1Match ? h1Match[1]!.trim() : file.title;
            return [{
              title: lessonTitle,
              anchor: lessonTitle.toLowerCase().replace(/\s+/g, "-"),
              body: file.md,
              uncertain: isUncertain,
            }];
          })();

    group.lessons.push(...lessonCandidates);
  }

  // 第二步:把 pendingIntro（section-intro 正文）追加到每个 section 第一个 lesson 开头
  for (const key of groupOrder) {
    const g = groupMap.get(key)!;
    if (g.pendingIntro && g.lessons.length > 0) {
      g.lessons[0]!.body = `> **📖 章节概述**\n>\n> ${g.pendingIntro.replace(/\n/g, "\n> ")}\n\n---\n\n${g.lessons[0]!.body}`;
    }
  }

  // 第三步:每个分组 → 一个 section（去掉空 section）
  const sections: ParsedSection[] = groupOrder
    .filter((key) => groupMap.get(key)!.lessons.length > 0)
    .map((key) => {
      const g = groupMap.get(key)!;
      return {
        title: g.sectionTitle,
        anchor: g.sectionTitle.toLowerCase().replace(/\s+/g, "-"),
        lessons: g.lessons,
      };
    });

  return { title: courseTitle, sections };
}

/* ============================================================
 * 文件发现:GitHub Tree API(主)→ jsdelivr 文件列表(fallback)→ README 链接(兜底)
 *
 * 用户网络只是偶尔不稳,不屏蔽 API。设计以最优方式为主,降级防抖。
 * ============================================================ */

/** 文件发现的来源标记(供进度提示 + 测试断言)。 */
export type FileDiscoverySource = "github-tree-api" | "jsdelivr-list" | "readme-links" | "none";

export interface DiscoveredTree {
  paths: string[];
  source: FileDiscoverySource;
}

/** 从 .md 路径列表构造 DiscoveredFile[](复用 filterLessonFiles 排除规则 + 标题推断)。 */
export function pathsToDiscoveredFiles(paths: string[]): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (seen.has(p)) continue;
    let kind: DiscoveredFile["kind"] = "other";
    if (lower.endsWith(".md") || lower.endsWith(".mdx")) kind = "md";
    else if (lower.endsWith(".ipynb")) kind = "ipynb";
    else if (lower.endsWith(".rst")) kind = "rst";
    else if (lower.endsWith(".rmd")) kind = "rmd";
    else if (lower.endsWith(".org")) kind = "org";
    else if (lower.endsWith(".adoc") || lower.endsWith(".asciidoc")) kind = "adoc";
    else continue;
    // 排除非教学内容
    if (lower.includes("node_modules/") || lower.startsWith(".git/") || lower.includes("translations/")) continue;
    if (lower.endsWith("license.md") || lower.endsWith("contributing.md") || lower.endsWith("code_of_conduct.md")) continue;
    seen.add(p);
    // 标题用文件名(去扩展名)或最后一层目录名
    const parts = p.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? p;
    const title = last.replace(/\.(md|mdx|ipynb|rst|rmd|org|adoc|asciidoc)$/i, "").replace(/^readme$/i, parts[parts.length - 2] ?? last);
    files.push({ path: p, title, kind });
  }
  return files;
}

/**
 * 主方式:GitHub Tree API 一次拿全仓文件树。
 * https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1
 * 返回 { tree: [{ path, type }] }。筛 blob + .md/.ipynb。
 * 网络失败/限流 → 抛错(由调用方降级)。
 */
export async function fetchRepoFileTree(
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
): Promise<DiscoveredTree> {
  // GitHub Tree API
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const apiRes = await fetchFn(apiUrl);
  if (apiRes.ok) {
    const data = (await apiRes.json()) as { tree?: Array<{ path: string; type: string }> };
    const mdPaths = (data.tree ?? [])
      .filter((n) => n.type === "blob" && /\.(md|mdx|ipynb|rst|rmd|org|adoc|asciidoc)$/i.test(n.path))
      .map((n) => n.path);
    if (mdPaths.length > 0) return { paths: mdPaths, source: "github-tree-api" };
  }

  // Fallback:jsdelivr 文件列表 API
  const jsUrl = `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${branch}`;
  const jsRes = await fetchFn(jsUrl);
  if (jsRes.ok) {
    const data = (await jsRes.json()) as { files?: Array<{ name: string; type: string }> };
    // jsdelivr 返回扁平/嵌套结构不一,兼容:收所有 .md 路径
    const mdPaths: string[] = [];
    const walk = (nodes: Array<{ name: string; type: string; files?: unknown }>, prefix: string) => {
      for (const n of nodes) {
        const full = prefix ? `${prefix}/${n.name}` : n.name;
        if (n.type === "file" && /\.(md|mdx)$/i.test(n.name)) mdPaths.push(full);
      }
    };
    if (Array.isArray(data.files)) walk(data.files, "");
    if (mdPaths.length > 0) return { paths: mdPaths, source: "jsdelivr-list" };
  }

  return { paths: [], source: "none" };
}

/**
 * 兜底:从 README 链接发现 + 一层递归(读到的 .md 文件内部再找链接)。
 * 用于 Tree API + jsdelivr 都失败时,或网络不稳的场景。
 */
export async function discoverFromReadmeRecursively(
  readmeMd: string,
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  maxDepth = 1,
  onProgress?: (msg: string) => void,
): Promise<DiscoveredTree> {
  const direct = filterLessonFiles(extractInternalLinks(readmeMd)).filter((f) => f.kind === "md");
  if (direct.length === 0) return { paths: [], source: "readme-links" };

  const allPaths = new Set<string>(direct.map((f) => f.path));

  // 一层递归:拉取直接链接的文件,从其内部再找 .md 链接
  if (maxDepth >= 1) {
    onProgress?.(`README 发现 ${direct.length} 个文件,递归扫描子链接…`);
    const fetched = await fetchMarkdownContents(direct, owner, repo, branch, fetchFn);
    for (const f of fetched.ok) {
      const subLinks = filterLessonFiles(extractInternalLinks(f.md)).filter((s) => s.kind === "md");
      for (const s of subLinks) {
        if (!allPaths.has(s.path)) allPaths.add(s.path);
      }
    }
  }

  return { paths: Array.from(allPaths), source: "readme-links" };
}

/* ============================================================
 * v0.8 多模态:GitHub 导入图片收集
 * 从已拉取的 .md 内容里解析 ![](img.png) 引用,从 CDN 下载图片二进制。
 * ============================================================ */

/** 图片扩展名集合(与 local-folder-scanner 保持一致) */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

/** ext → MIME */
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** 从 markdown 文本提取图片引用 ![alt](path) + <img src='...'>,只收相对路径的图片扩展名 */
export function extractImageRefsFromMd(md: string): { alt: string; path: string }[] {
  const refs: { alt: string; path: string }[] = [];
  const seen = new Set<string>();

  // 1. Markdown 语法 ![alt](url)
  const mdPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdPattern.exec(md)) !== null) {
    const alt = m[1].trim();
    let url = m[2].trim();
    const titleMatch = url.match(/\s+"[^"]*"$/);
    if (titleMatch) url = url.slice(0, titleMatch.index).trim();
    url = url.split("#")[0];
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    url = url.replace(/^\.\//, "");
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ alt, path: url });
  }

  // 2. HTML <img> 标签(覆盖微软课程仓库 <img src='images/xxx.png'/>)
  // 两步法:先提取 <img ...> 整标签,再独立提取 src 和 alt(属性顺序无关)
  const htmlPattern = /<img\s+[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = htmlPattern.exec(md)) !== null) {
    const tag = hm[0];
    let url = (tag.match(/src=['"]([^'"]+)['"]/i)?.[1] ?? "").trim().split("#")[0];
    const alt = (tag.match(/alt=['"]([^'"]*)['"]/i)?.[1] ?? "").trim();
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    url = url.replace(/^\.\//, "");
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ alt: alt || (url.split("/").pop() ?? url), path: url });
  }

  return refs;
}

/** 从 .md 文件路径解析图片引用的绝对仓库路径(相对 doc 所在目录) */
function resolveRepoImgPath(imgRef: string, docPath: string): string {
  const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const parts = docDir ? docDir.split("/") : [];
  for (const p of imgRef.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return parts.join("/");
}

/** 下载的图片结果 */
export interface DownloadedImage {
  /** 仓库内的相对路径(用作 sourcePath) */
  repoPath: string;
  /** 关联的 doc 路径(用于 nodeId 匹配) */
  docPath: string;
  /** 图片二进制 */
  buffer: Buffer;
  /** MIME */
  mimeType: string;
  /** alt 文本 */
  altText: string;
}

/**
 * 从已拉取的 markdown 文件里收集图片引用,从 CDN 下载二进制。
 * 5 并发,防 CDN 过载。单个失败跳过不阻塞。
 *
 * @param files 已拉取的 .md 文件(ok 列表)
 * @param owner repo owner
 * @param repo repo name
 * @param branch 分支
 * @param fetchFn 注入的 fetch
 * @param onProgress 进度回调
 * @returns 下载成功的图片列表
 */
export async function fetchRepoImages(
  files: FetchedFile[],
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<DownloadedImage[]> {
  // 1. 从所有 .md 文件收集图片引用(去重)
  const allRefs = new Map<string, { repoPath: string; docPath: string; alt: string }>();
  for (const file of files) {
    const refs = extractImageRefsFromMd(file.md);
    for (const ref of refs) {
      const repoPath = resolveRepoImgPath(ref.path, file.path);
      if (!allRefs.has(repoPath)) {
        allRefs.set(repoPath, { repoPath, docPath: file.path, alt: ref.alt });
      }
    }
  }

  if (allRefs.size === 0) return [];
  const refList = Array.from(allRefs.values());
  const downloaded: DownloadedImage[] = [];
  const CONCURRENCY = 5;

  // 2. 并发下载(分批)
  for (let i = 0; i < refList.length; i += CONCURRENCY) {
    const batch = refList.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (ref) => {
        const url = cdnUrl(owner, repo, branch, ref.repoPath);
        const r = await fetchFn(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const ext = ref.repoPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "png";
        return {
          repoPath: ref.repoPath,
          docPath: ref.docPath,
          buffer: buf,
          mimeType: EXT_TO_MIME[ext] ?? "image/png",
          altText: ref.alt || ref.repoPath.split("/").pop() || ref.repoPath,
        } satisfies DownloadedImage;
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const done = i + j + 1;
      const ref = batch[j];
      onProgress?.(done, refList.length, ref?.repoPath ?? "");
      const result = results[j];
      if (result && result.status === "fulfilled") {
        downloaded.push(result.value);
      }
    }
  }

  return downloaded;
}

/* ============================================================
 * 顶层编排:从 GitHub repo URL → ParsedCourse（纯函数，不落库）
 *
 * 提取自 ipc/index.ts 的 importFromRepo handler 的纯逻辑部分。
 * IPC handler / 种子脚本 / 未来 CLI 都复用本函数。
 * ============================================================ */

/** importRepoToParsedCourse 的返回结果 */
export interface ImportRepoResult {
  /** 构建好的课程结构（含 classification 标签） */
  course: ParsedCourse;
  /** 仓库检测结果 */
  detection: DetectionResult;
  /** 拉取的文件（含 classification，供图像收集等后续步骤用） */
  fetchedFiles: FetchedFile[];
  /** README 实际用的分支（main 或 master） */
  readmeBranch: string;
  /** README 全文（供 single-file 降级用） */
  readmeMd: string;
}

/** 文件数上限（防爆，和 IPC handler 一致） */
const MAX_FILES = 200;

/**
 * 从 GitHub 仓库构建课程结构 —— 纯编排函数。
 *
 * 流程: fetch README → detectRepoPattern → 发现文件树 → fetchMarkdownContents
 *       → classifyFile（在 buildCourseFromFiles 内）→ buildCourseFromFiles
 *
 * 不落库、不发进度事件（onProgress 回调只传消息字符串，由调用方决定怎么用）。
 *
 * @param owner GitHub owner
 * @param repo GitHub repo
 * @param branch 起始分支（README 先试 main 再试 master）
 * @param fetchFn 注入的 fetch（生产用 global fetch，测试用 mock）
 * @param onProgress 进度回调（可选）
 */
export async function importRepoToParsedCourse(
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
): Promise<ImportRepoResult> {
  const send = (msg: string) => onProgress?.(msg);

  // 1. 拉 README（试 main/master 两个分支）
  send("正在拉取 README…");
  const branches = branch === "master" ? ["master", "main"] : ["main", "master"];
  let readmeMd: string | null = null;
  let readmeBranch = branch;
  for (const br of branches) {
    try {
      const r = await fetchFn(cdnUrl(owner, repo, br, "README.md"));
      if (r.ok) {
        readmeMd = await r.text();
        readmeBranch = br;
        break;
      }
    } catch {
      // 网络错误，试下一个分支
    }
  }
  if (!readmeMd) throw new Error(`无法拉取 README（试过分支: ${branches.join(", ")}）`);
  send(`README 拉取成功（${readmeMd.length} 字符，分支 ${readmeBranch}）`);

  // 2. 检测仓库形态
  const detection = detectRepoPattern(readmeMd);
  if (detection.pattern === "unsupported") {
    throw new Error(`仓库不支持: ${detection.reason}`);
  }

  // single-file: 直接返回（调用方用 generateCourseFromMarkdown 处理）
  if (detection.pattern === "single-file") {
    return {
      course: parseMarkdownToCourse(readmeMd),
      detection,
      fetchedFiles: [],
      readmeBranch,
      readmeMd,
    };
  }

  // 3. course 型: 发现文件
  let lessonFiles = filterLessonFiles(detection.lessonFiles ?? []);

  // 尝试完整文件树（GitHub Tree API → jsdelivr fallback）
  try {
    send("正在扫描仓库文件树…");
    const tree = await fetchRepoFileTree(owner, repo, readmeBranch, fetchFn);
    if (tree.paths.length > 0) {
      const treeFiles = pathsToDiscoveredFiles(tree.paths);
      const treeLessonFiles = filterLessonFiles(treeFiles).filter((f) => f.kind !== "other");
      if (treeLessonFiles.length > lessonFiles.length) {
        lessonFiles = treeLessonFiles;
        send(`文件树发现 ${lessonFiles.length} 个课时文件（来源: ${tree.source}）`);
      }
    }
  } catch {
    // Tree API 失败，用 README 链接里已有的
    send("文件树拉取失败，使用 README 链接发现");
  }

  if (lessonFiles.length === 0) {
    // 没有子文件，降级为 single-file
    send("未发现课时文件，降级为单文件导入");
    return {
      course: parseMarkdownToCourse(readmeMd),
      detection: { ...detection, pattern: "single-file", reason: "无课时文件，降级" },
      fetchedFiles: [],
      readmeBranch,
      readmeMd,
    };
  }

  // 上限
  if (lessonFiles.length > MAX_FILES) {
    send(`文件数 ${lessonFiles.length} 超过上限 ${MAX_FILES}，截断`);
    lessonFiles = lessonFiles.slice(0, MAX_FILES);
  }

  // 4. 拉取正文
  send(`检测到课程型仓库（${lessonFiles.length} 个文件），开始拉取…`);
  const fetchResult = await fetchMarkdownContents(
    lessonFiles, owner, repo, readmeBranch, fetchFn,
    (done, total, path) => send(`拉取 ${done}/${total}: ${path}`),
  );

  if (fetchResult.ok.length === 0) {
    // 全部失败，降级为 single-file
    send("所有文件拉取失败，降级为单文件导入");
    return {
      course: parseMarkdownToCourse(readmeMd),
      detection: { ...detection, pattern: "single-file", reason: "全部文件拉取失败" },
      fetchedFiles: [],
      readmeBranch,
      readmeMd,
    };
  }

  // 5. 构建课程（buildCourseFromFiles 内部会调 classifyFile 做分类）
  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  const courseTitle = h1Match ? h1Match[1]!.trim() : repo;
  const course = buildCourseFromFiles(courseTitle, fetchResult.ok);
  send(`解析完成：${course.sections.length} 章节，构建课程…`);

  return {
    course,
    detection,
    fetchedFiles: fetchResult.ok,
    readmeBranch,
    readmeMd,
  };
}

