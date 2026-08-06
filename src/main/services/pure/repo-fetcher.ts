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
export function buildCourseFromFiles(
  courseTitle: string,
  files: FetchedFile[],
): ParsedCourse {
  const sections: ParsedSection[] = [];

  for (const file of files) {
    // 用文件路径推断章节标题
    // lessons/3-NeuralNetworks/03-Perceptron/README.md → "3-NeuralNetworks / 03-Perceptron"
    const parts = file.path.split("/").filter(Boolean);
    // 去掉末尾的 README.md / index.md
    const dirParts = parts[parts.length - 1]?.match(/^readme/i) || parts[parts.length - 1] === "index.md"
      ? parts.slice(0, -1)
      : parts;

    // 从路径构造章节标题
    let sectionTitle: string;
    if (dirParts.length >= 2) {
      // lessons/N-Topic/SubLesson → "N-Topic / SubLesson"
      sectionTitle = dirParts.slice(-2).join(" / ").replace(/\.md$/i, "");
    } else {
      sectionTitle = dirParts.join("/").replace(/\.md$/i, "") || file.title;
    }

    // 解析这个文件的内部结构
    const parsed = parseMarkdownToCourse(file.md);
    const parsedLessonCount = parsed.sections.reduce((sum, s) => sum + s.lessons.length, 0);

    // 如果文件有 H2/H3 结构且产生了 lesson，用它
    if (parsedLessonCount > 0) {
      for (const s of parsed.sections) {
        if (s.lessons.length === 0) continue; // 跳过没有 lesson 的空 section
        sections.push({
          title: `${sectionTitle} · ${s.title}`,
          anchor: s.anchor,
          lessons: s.lessons.map((l) => ({
            title: l.title,
            anchor: l.anchor,
            body: l.body,
          })),
        });
      }
    } else {
      // 文件没有 H2/H3，整个文件作为一个 lesson
      // 取第一个 H1 作为 lesson 标题，没有就用文件标题
      const h1Match = file.md.match(/^#\s+(.+)$/m);
      const lessonTitle = h1Match ? h1Match[1].trim() : file.title;
      sections.push({
        title: sectionTitle,
        anchor: sectionTitle.toLowerCase().replace(/\s+/g, "-"),
        lessons: [
          {
            title: lessonTitle,
            anchor: lessonTitle.toLowerCase().replace(/\s+/g, "-"),
            body: file.md,
          },
        ],
      });
    }
  }

  return { title: courseTitle, sections };
}
