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
import { parseMarkdownToCourse, type ParsedCourse, type ParsedSection } from "./markdown-course.js";

/** 仓库文件条目（从 README 链接发现） */
export interface DiscoveredFile {
  path: string;
  /** 链接文本（课时标题） */
  title: string;
  /** 文件类型: md 正文 / ipynb notebook / other */
  kind: "md" | "ipynb" | "other";
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
    // 只收 .md 和 .ipynb
    let kind: DiscoveredFile["kind"] = "other";
    if (href.endsWith(".md") || href.endsWith(".mdx")) kind = "md";
    else if (href.endsWith(".ipynb")) kind = "ipynb";
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
  const mdLinks = filterLessonFiles(allLinks).filter((f) => f.kind === "md");

  // 课程型: 有 ≥3 个 .md 子文件链接
  if (mdLinks.length >= 3) {
    return {
      pattern: "course",
      reason: `README 含 ${mdLinks.length} 个内部 .md 链接，判定为课程型仓库`,
      lessonFiles: mdLinks,
    };
  }

  // 单文件型: README 本身够长
  if (readmeMd.length > 3000) {
    return {
      pattern: "single-file",
      reason: `README 无足够子文件链接（${mdLinks.length} 个），但正文 ${readmeMd.length} 字符，判定为单文件型`,
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
 * 每个 .md 文件 → 一个 section（用文件路径的目录名做章节标题）
 * 文件内部的 H2 → 该章节下的 lessons
 * 文件内部的 H3 → 更细的 lessons（如果有的话）
 *
 * 如果文件没有 H2/H3，整个文件作为一个 lesson。
 */
/**
 * 把课程型仓库的多个课时文件合并成 ParsedCourse 结构。
 *
 * v2 改进(2026-08-08):按**顶层目录**分组,减少碎片。
 *   - lessons/3-NeuralNetworks/03-Perceptron/README.md 和
 *     lessons/3-NeuralNetworks/04-Deep/README.md 归到同一 "3-NeuralNetworks" section
 *     (而不是各自一个 section → 47 碎片)
 *   - 根目录的 .md / 扁平结构的 .md 各自独立成 section
 *
 * 每个文件的内部 H2/H3 → 该 section 下的 lessons;无 H2/H3 则整个文件作一个 lesson。
 */
export function buildCourseFromFiles(
  courseTitle: string,
  files: FetchedFile[],
): ParsedCourse {
  // 第一步:给每个文件算"分组键"(=顶层目录名)和"lesson 候选"
  interface FileGroup {
    sectionTitle: string;
    orderKey: string; // 用于排序(保持原路径顺序)
    files: { title: string; body: string }[];
  }
  const groupMap = new Map<string, FileGroup>();
  const groupOrder: string[] = [];

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    // 去掉末尾的 README.md / index.md
    const dirParts = parts[parts.length - 1]?.match(/^readme/i) || parts[parts.length - 1] === "index.md"
      ? parts.slice(0, -1)
      : parts;

    // 分组键 + section 标题:用"第一个非通用目录"做章节分组键。
    //   - lessons/1-Intro/README.md → 键 "1-Intro"(跳过通用 "lessons")
    //   - lessons/3-NN/03-Perceptron/README.md → 键 "3-NN"(跳过 "lessons",用第一个具体目录)
    //   - docs/api.md → 键 "docs"("docs" 虽通用但没更深的目录,用它)
    //   - 根目录 README.md → 键 = 文件名(各自独立)
    //   - 纯 file.md(无目录) → 键 = 文件名
    const GENERIC_DIRS = new Set(["lessons", "docs", "doc", "src", "content", "modules", "chapters", "lessons"]);
    let groupKey: string;
    let sectionTitle: string;
    // 找第一个非通用目录(跳过 lessons/docs/src 等容器目录,用具体章节目录)
    const specificDir = dirParts.find((p) => !GENERIC_DIRS.has(p.toLowerCase()) && !/\.(md|mdx)$/i.test(p));
    if (dirParts.length >= 2 && specificDir) {
      groupKey = specificDir.replace(/\.md$/i, "");
      sectionTitle = groupKey;
    } else if (dirParts.length === 1) {
      // 单层目录或单文件 → 各自独立成 section
      groupKey = file.path;
      sectionTitle = dirParts[0]!.replace(/\.md$/i, "") || file.title;
    } else {
      // 无目录(纯文件名,根目录)
      groupKey = file.path;
      sectionTitle = file.title;
    }

    // lesson 候选:解析文件内部 H2/H3,或整个文件作一 lesson
    const parsed = parseMarkdownToCourse(file.md);
    const parsedLessonCount = parsed.sections.reduce((sum, s) => sum + s.lessons.length, 0);
    const lessonCandidates: { title: string; body: string }[] =
      parsedLessonCount > 0
        ? parsed.sections
            .filter((s) => s.lessons.length > 0)
            .flatMap((s) => s.lessons.map((l) => ({ title: l.title, body: l.body })))
        : (() => {
            const h1Match = file.md.match(/^#\s+(.+)$/m);
            const lessonTitle = h1Match ? h1Match[1]!.trim() : file.title;
            return [{ title: lessonTitle, body: file.md }];
          })();

    if (!groupMap.has(groupKey)) {
      const g: FileGroup = { sectionTitle, orderKey: file.path, files: [] };
      groupMap.set(groupKey, g);
      groupOrder.push(groupKey);
    }
    groupMap.get(groupKey)!.files.push(...lessonCandidates);
  }

  // 第二步:每个分组 → 一个 section(files 按原路径顺序已稳定)
  const sections: ParsedSection[] = groupOrder.map((key) => {
    const g = groupMap.get(key)!;
    return {
      title: g.sectionTitle,
      anchor: g.sectionTitle.toLowerCase().replace(/\s+/g, "-"),
      lessons: g.files.map((l) => ({
        title: l.title,
        anchor: l.title.toLowerCase().replace(/\s+/g, "-"),
        body: l.body,
      })),
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
    else continue;
    // 排除非教学内容
    if (lower.includes("node_modules/") || lower.startsWith(".git/") || lower.includes("translations/")) continue;
    if (lower.endsWith("license.md") || lower.endsWith("contributing.md") || lower.endsWith("code_of_conduct.md")) continue;
    seen.add(p);
    // 标题用文件名(去扩展名)或最后一层目录名
    const parts = p.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? p;
    const title = last.replace(/\.(md|mdx|ipynb)$/i, "").replace(/^readme$/i, parts[parts.length - 2] ?? last);
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
      .filter((n) => n.type === "blob" && /\.(md|mdx)$/i.test(n.path))
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

/** 从 markdown 文本提取图片引用 ![alt](path),只收相对路径的图片扩展名 */
export function extractImageRefsFromMd(md: string): { alt: string; path: string }[] {
  const refs: { alt: string; path: string }[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(md)) !== null) {
    const alt = m[1].trim();
    let url = m[2].trim();
    // 去 title 后缀
    const titleMatch = url.match(/\s+"[^"]*"$/);
    if (titleMatch) url = url.slice(0, titleMatch.index).trim();
    url = url.split("#")[0];
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    url = url.replace(/^\.\//, "");
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;
    refs.push({ alt, path: url });
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
