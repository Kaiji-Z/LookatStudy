/**
 * 课时文件分类器 —— 规则引擎 + LLM 兜底两阶段分类。
 *
 * 设计理念（见 dev-docs 讨论与种子构建经验）:
 * - 规则只判**高置信度**的（路径明确的 lab/翻译/notebook/license 等）
 * - 不确定的标 `uncertain`，`keepAsLesson: true`，显式交给 LLM 在
 *   `analyzeCourseStructure` 里先分类（keep/skip）再排结构
 * - 不做死规则覆盖一切——边界 case 太多时规则会臃肿且脆弱
 *
 * 级联模式镜像 `classifyLlmError`（llm-client.ts）—— first-match-wins。
 *
 * 零依赖（纯函数），归 services/pure/。
 */

/** 文件角色（分类标签） */
export type FileRole =
  | "lesson" // 确定的课时正文
  | "notebook" // Jupyter notebook（独立成 lesson 不合适，但正文有代码价值）
  | "lab" // 配套练习/作业
  | "section-intro" // 章节介绍页（同 section 有更深的 lesson）
  | "translation" // 翻译副本
  | "meta" // 仓库元数据（LICENSE/CONTRIBUTING 等）
  | "example" // 示例代码
  | "uncertain"; // 规则无法确定，交给 LLM

/** 置信度 */
export type Confidence = "high" | "low";

/** 分类结果 */
export interface FileClassification {
  role: FileRole;
  confidence: Confidence;
  /** 人话解释，供审计/调试/进度提示 */
  reason: string;
  /**
   * 是否进 lesson 列表。
   * - 高置信度 lesson / uncertain → true（uncertain 先留，让 LLM 定）
   * - 高置信度噪声（translation/meta/lab/example/notebook/section-intro）→ false
   */
  keepAsLesson: boolean;
}

/** 分类上下文：同一批次所有文件的路径（用于 section-intro 判断） */
export interface ClassifyContext {
  siblingPaths: string[];
}

/** 仓库元数据文件名（忽略大小写，匹配文件名 stem） */
const META_FILE_NAMES = new Set([
  "license", "licence", "contributing", "code_of_conduct", "security", "changelog",
  "authors", "maintainers",
  "pull_request_template", "issue_template", "support", "citation",
]);

/** 配套练习目录/文件名关键词（路径含这些子串即判定） */
const LAB_KEYWORDS = ["/lab/", "/labs/", "/exercise/", "/exercises/", "/assignment/", "/assignments/", "/quiz/", "/quizzes/", "/homework/", "/practice/", "/solution/", "labs/", "exercises/", "assignments/"];

/** 示例代码目录关键词（路径含这些子串即判定，含根目录开头） */
const EXAMPLE_KEYWORDS = ["/examples/", "/example/", "/demo/", "/demos/", "/samples/", "/sample/", "examples/", "example/", "demo/", "demos/", "samples/"];

/**
 * 判断一个文件是否是 section-intro：它是某个 section 的 README.md，
 * 且同 section 下有**更深一级的 README.md lesson**（不是 lab/notebook）。
 *
 * 例:
 *   `lessons/3-NN/README.md` 是 section-intro ← 因为有 `lessons/3-NN/03-Perceptron/README.md`
 *   `lessons/3-NN/03-Perceptron/README.md` 不是 ← 虽然 03-Perceptron/ 下有 lab/README.md，
 *      但 lab 不是 lesson，不能用来判定 lesson 是 intro
 */
function isSectionIntro(path: string, siblingPaths: string[]): boolean {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  // 必须是 README.md / index.md
  if (!last || !(/^readme/i.test(last) || last === "index.md")) return false;
  // 当前深度
  const myDepth = parts.length;
  if (myDepth < 3) return false; // 太浅不可能是 section-intro
  // section 前缀（去掉末尾 README）
  const prefix = parts.slice(0, -1).join("/");
  // 找同 section 下更深一级的**真正 lesson README**（排除 lab/notebook/exercise 等噪声）
  const hasDeeperLesson = siblingPaths.some((sib) => {
    if (sib === path) return false;
    const sibLower = sib.toLowerCase();
    // 排除噪声路径
    if (sibLower.includes("/lab/") || sibLower.includes("/exercise/") || sibLower.includes("/assignment/")) return false;
    if (sibLower.endsWith(".ipynb")) return false;
    const sibParts = sib.split("/").filter(Boolean);
    const sibPrefix = sibParts.slice(0, -1).join("/");
    // 同 section 且更深（`prefix/NN-Lesson/README.md` vs `prefix/README.md`）
    return sibPrefix.startsWith(prefix + "/") && sibParts.length > myDepth;
  });
  return hasDeeperLesson;
}

/** 提取正文纯文字字符数（粗略：去 markdown 语法 + 代码块后的字符数） */
function proseCharCount(md: string): number {
  // 去代码块
  const noCodeBlocks = md.replace(/```[\s\S]*?```/g, "");
  // 去行内代码
  const noInlineCode = noCodeBlocks.replace(/`[^`]*`/g, "");
  // 去 markdown 链接语法，保留文字
  const noLinks = noInlineCode.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 去图片
  const noImages = noLinks.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // 去 HTML 标签
  const noHtml = noImages.replace(/<[^>]+>/g, "");
  return noHtml.replace(/\s/g, "").length;
}

/** 判断正文是否含代码块 */
function hasCodeBlock(md: string): boolean {
  return /```/.test(md);
}

/**
 * 主分类函数：first-match-wins 级联规则。
 *
 * @param path 文件路径（相对 repo 根，/ 分隔）
 * @param md 文件正文（已转成 markdown）
 * @param context 分类上下文（siblingPaths = 同批次所有文件路径）
 */
export function classifyFile(
  path: string,
  md: string,
  context: ClassifyContext,
): FileClassification {
  const lowerPath = path.toLowerCase();
  const parts = path.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] ?? path;
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();

  // ── 规则 1: 翻译副本 ──
  if (lowerPath.includes("translations/") || lowerPath.includes("translated_images/")) {
    return { role: "translation", confidence: "high", keepAsLesson: false,
      reason: "路径含 translations/，是翻译副本" };
  }

  // ── 规则 2: 仓库元数据 ──
  if (META_FILE_NAMES.has(stem)) {
    return { role: "meta", confidence: "high", keepAsLesson: false,
      reason: `文件名 ${stem} 是仓库元数据` };
  }

  // ── 规则 3: Jupyter notebook ──
  if (lowerPath.endsWith(".ipynb")) {
    return { role: "notebook", confidence: "high", keepAsLesson: false,
      reason: ".ipynb notebook，独立成 lesson 不合适（精华是代码不是讲解）" };
  }

  // ── 规则 4: 配套练习 ──
  for (const kw of LAB_KEYWORDS) {
    if (lowerPath.includes(kw)) {
      return { role: "lab", confidence: "high", keepAsLesson: false,
        reason: `路径含 ${kw}，是配套练习` };
    }
  }

  // ── 规则 5: 示例代码 ──
  for (const kw of EXAMPLE_KEYWORDS) {
    if (lowerPath.includes(kw)) {
      return { role: "example", confidence: "high", keepAsLesson: false,
        reason: `路径含 ${kw}，是示例代码` };
    }
  }

  // ── 规则 6: section-intro（章节介绍页）──
  if (isSectionIntro(path, context.siblingPaths)) {
    return { role: "section-intro", confidence: "high", keepAsLesson: false,
      reason: "章节介绍页（同 section 有更深的 lesson 文件）" };
  }

  // ── 规则 7: 正文太少 ──
  const proseChars = proseCharCount(md);
  if (proseChars < 200 && !hasCodeBlock(md)) {
    return { role: "uncertain", confidence: "low", keepAsLesson: true,
      reason: `正文仅 ${proseChars} 字且无代码块，内容太少，交给 LLM 判断` };
  }

  // ── fallback: 不确定，交给 LLM ──
  return { role: "uncertain", confidence: "low", keepAsLesson: true,
    reason: "规则未命中高置信度分类，交给 LLM 判断" };
}

/**
 * 批量分类便捷函数：一次性给所有文件分类（siblingPaths 自动填充）。
 */
export function classifyFiles(
  files: { path: string; md: string }[],
): Array<{ path: string; md: string; classification: FileClassification }> {
  const allPaths = files.map((f) => f.path);
  return files.map((f) => ({
    path: f.path,
    md: f.md,
    classification: classifyFile(f.path, f.md, { siblingPaths: allPaths }),
  }));
}

/**
 * 统计分类结果（供进度提示 / 调试）。
 */
export function summarizeClassifications(
  classifications: FileClassification[],
): { byRole: Record<string, number>; keepCount: number; skipCount: number; uncertainCount: number } {
  const byRole: Record<string, number> = {};
  let keepCount = 0;
  let skipCount = 0;
  let uncertainCount = 0;
  for (const c of classifications) {
    byRole[c.role] = (byRole[c.role] ?? 0) + 1;
    if (c.keepAsLesson) keepCount++;
    else skipCount++;
    if (c.role === "uncertain") uncertainCount++;
  }
  return { byRole, keepCount, skipCount, uncertainCount };
}
