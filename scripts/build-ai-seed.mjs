#!/usr/bin/env node
/**
 * build-ai-seed.mjs — 一次性构建脚本（开发时手工跑），用项目自己的导入管线
 * (repo-fetcher.ts) 拉 microsoft/AI-For-Beginners 仓库，组装成一份大 markdown
 * 作为 LookatStudy 的内置种子课程内容。
 *
 * 产物: src/main/assets/seed-ai-for-beginners.md （入 git，被 seed.ts 以 ?raw 内联进 bundle）
 *
 * 和用户在 app 里点"GitHub URL 导入"走的是同一套纯函数:
 *   detectRepoPattern → fetchRepoFileTree → fetchMarkdownContents
 * 不重复造轮子（文件发现 / 格式解析 / .ipynb 处理全复用 repo-fetcher）。
 *
 * 与运行时导入的唯一差别:运行时落库用 generateCourseFromRepoFiles(db, ...)，
 * 这里不落库——把 fetch 回来的 FetchedFile[] 序列化成统一结构的 markdown
 * (# 课程 / ## section / ### lesson)，交给 seed.ts 走 generateCourseFromMarkdown。
 *
 * 用法: node scripts/build-ai-seed.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_PATH = join(ROOT, "src/main/assets/seed-ai-for-beginners.md");

const OWNER = "microsoft";
const REPO = "AI-For-Beginners";
const BRANCH = "master";

// 复用项目自己的导入管线（纯函数，不依赖 Electron）
const {
  cdnUrl,
  detectRepoPattern,
  filterLessonFiles,
  fetchRepoFileTree,
  pathsToDiscoveredFiles,
  extractInternalLinks,
  fetchMarkdownContents,
} = await import("../src/main/services/pure/repo-fetcher.ts");

const fetchFn = globalThis.fetch;

// ── 工具:把 fetch 回来的文件按路径目录分组、序列化成统一结构 markdown ──────

/**
 * 从路径推断"章节"（section）分组键。
 * AI-For-Beginners 的路径形如 lessons/3-NeuralNetworks/03-Perceptron/README.md
 * → section = "3-NeuralNetworks"（第二个目录段，跳过通用容器 "lessons"）
 * 根目录文件 → section = "(前言)"
 */
function inferSection(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "(前言)";
  // 找第一个非通用容器目录
  const GENERIC = new Set(["lessons", "docs", "doc", "src", "content", "modules", "chapters"]);
  const specific = parts.find((p, i) => i > 0 && !GENERIC.has(p.toLowerCase()) && !/\.(md|mdx)$/i.test(p));
  return specific || parts[0];
}

/** 从路径推断"课时"标题（倒数第二段，或文件名 stem） */
function inferLessonTitle(path, fallback) {
  const parts = path.split("/").filter(Boolean);
  // lessons/3-NeuralNetworks/03-Perceptron/README.md → "03-Perceptron"
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^readme/i.test(last) || last === "index.md") {
      return parts[parts.length - 2] || fallback;
    }
  }
  // 普通 file.md → 去扩展名
  return (parts[parts.length - 1] || fallback).replace(/\.(md|mdx|ipynb|rst|rmd|org|adoc)$/i, "");
}

/** 把路径段如 "03-Perceptron" / "NeuralNetworks" / "X1-MultiModal" 清理成可读标题 */
function prettifyTitle(raw) {
  return raw
    .replace(/^(\d+[-_]?)/, "")       // 去前导编号 "03-" / "03_" / "X1-"
    .replace(/^[Xx]\d+[-_]?/, "")
    // CamelCase 拆词: "NeuralNetworks" → "Neural Networks", "IntroCV" → "Intro CV"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")            // 连字符 → 空格
    .replace(/\s+/g, " ")             // 合并多空格
    .replace(/\b\w/g, (c) => c.toUpperCase()) // 首字母大写
    .trim();
}

/**
 * 归一化单个 lesson README 正文:
 * - 剥所有 H1（与组装的课程 H1 冲突；课内 H1 如 "# Overfitting" 当噪音删）
 * - 剥 Pre/Post-lecture quiz 外链行（在 app 里打不开）
 * - 剥 ## [Assignment](lab/README.md) 段（lab 没 bundle，死链）
 * - 课内子标题降级两级(## → ####, ### → #####)，避免被 markdown-course
 *   解析器误判为新 section 把一课拆碎
 * - 代码块内的 # 不动（靠围栏状态机）
 */
function normalizeLessonMd(md) {
  const lines = md.split("\n");
  const out = [];
  let skipAssignmentBlock = false;
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // 代码围栏状态机
    if (/^(```|~~~)/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }
    if (inCodeFence) {
      out.push(line);
      continue;
    }
    // 剥所有 H1
    if (/^#\s+/.test(line)) continue;
    // 剥 quiz 链接行
    if (/\[Pre-lecture quiz\]/.test(line) || /\[Post-lecture quiz\]/.test(line)) continue;
    // 剥 Assignment 段（到下一个同级标题前）
    if (/^##\s*\[Assignment\]/.test(line)) {
      skipAssignmentBlock = true;
      continue;
    }
    if (skipAssignmentBlock) {
      if (/^#{1,2}\s+/.test(line) && !/^\s{4,}/.test(line)) {
        skipAssignmentBlock = false; // 这行是新段标题，下面会处理（降级）
      } else {
        continue;
      }
    }
    // 标题降级两级（## → ####, ### → #####, #### → ######）
    const headingMatch = /^(#{2,4})(\s+.*)$/.exec(line);
    if (headingMatch) {
      out.push(`##${headingMatch[0]}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── 主流程 ──────────────────────────────────────────────────────────
async function main() {
  console.log(`▸ fetching README from ${OWNER}/${REPO}@${BRANCH} …`);
  const readmeUrl = cdnUrl(OWNER, REPO, BRANCH, "README.md");
  const readmeMd = await fetchFn(readmeUrl).then((r) => {
    if (!r.ok) throw new Error(`README fetch ${r.status}`);
    return r.text();
  });
  console.log(`  README: ${readmeMd.length} chars`);

  // 1. detectRepoPattern —— 和用户导入走同一条路径
  const detection = detectRepoPattern(readmeMd);
  console.log(`  detectRepoPattern: ${detection.pattern} (${detection.reason})`);
  if (detection.pattern === "unsupported") {
    throw new Error("仓库被判定为 unsupported，无法构建种子课程");
  }

  // 2. 文件发现:优先用 GitHub Tree API 拿完整文件树（和 IPC handler 一致）
  //    失败则降级到 README 链接里发现的文件（detectRepoPattern 已提取）
  let lessonFiles;
  try {
    console.log(`▸ fetching repo file tree (GitHub API → jsdelivr fallback) …`);
    const tree = await fetchRepoFileTree(OWNER, REPO, BRANCH, fetchFn);
    console.log(`  tree source: ${tree.source}, ${tree.paths.length} paths`);
    if (tree.paths.length > 0) {
      const allFiles = pathsToDiscoveredFiles(tree.paths);
      lessonFiles = filterLessonFiles(allFiles).filter((f) => f.kind !== "other");
      console.log(`  from tree: ${lessonFiles.length} lesson files after filter`);
    }
  } catch (e) {
    console.log(`  tree fetch failed (${e.message}), falling back to README links`);
  }
  if (!lessonFiles || lessonFiles.length === 0) {
    // fallback: README 链接里发现的（detectRepoPattern 已经做过）
    lessonFiles = filterLessonFiles(detection.lessonFiles || []);
    console.log(`  from readme links: ${lessonFiles.length} lesson files`);
  }

  // 种子筛选:只保留"课时正文 README"，排除 .ipynb notebook、lab/、examples/ 等。
  // 路径深度规则:
  //   lessons/NN-Section/README.md           (3 段) = 章节介绍
  //   lessons/NN-Section/NN-Lesson/README.md (4 段) = 课时正文
  // 若某 section 有 4 段课时，丢掉它的 3 段介绍（避免重复）；若 section 只有介绍，保留作唯一课时。
  const lessonReadmes = lessonFiles.filter((f) => {
    const p = f.path;
    if (!p.startsWith("lessons/")) return false;
    if (!/\/README\.md$/i.test(p)) return false;
    if (p.includes("/lab/")) return false;
    return true;
  });
  // 找出"有深度课时"的 section（路径前缀 = lessons/NN-Section/）
  const sectionsWithLessons = new Set();
  for (const f of lessonReadmes) {
    const parts = f.path.split("/").filter(Boolean);
    if (parts.length >= 4) {
      sectionsWithLessons.add(parts.slice(0, 2).join("/")); // lessons/3-NeuralNetworks
    }
  }
  const seedLessonFiles = lessonReadmes.filter((f) => {
    const parts = f.path.split("/").filter(Boolean);
    // 深度课时(4 段) → 保留
    if (parts.length >= 4) return true;
    // 章节介绍(3 段) → 仅在该 section 没有深度课时时保留
    const sectionPrefix = parts.slice(0, 2).join("/");
    return !sectionsWithLessons.has(sectionPrefix);
  });
  console.log(`  seed filter (lesson READMEs only): ${seedLessonFiles.length} files`);
  lessonFiles = seedLessonFiles.length >= 5 ? seedLessonFiles : lessonFiles;

  if (lessonFiles.length === 0) {
    throw new Error("没找到任何课时文件");
  }

  // 3. 上限（和 IPC handler 一致:200 文件防爆）
  const MAX = 200;
  if (lessonFiles.length > MAX) {
    console.log(`  ⚠ ${lessonFiles.length} files > ${MAX}，截断`);
    lessonFiles = lessonFiles.slice(0, MAX);
  }

  // 4. fetchMarkdownContents —— 拉正文（含 .ipynb 解析、多格式转换）
  console.log(`▸ fetching ${lessonFiles.length} file contents …`);
  const fetchResult = await fetchMarkdownContents(
    lessonFiles, OWNER, REPO, BRANCH, fetchFn,
    (done, total, path) => {
      if (done % 5 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total} fetched`);
      }
    },
  );
  console.log(`\r  ✓ fetched: ${fetchResult.ok.length} ok, ${fetchResult.failed.length} failed`);
  if (fetchResult.failed.length > 0) {
    for (const f of fetchResult.failed.slice(0, 5)) {
      console.log(`    ✗ ${f.path}: ${f.error}`);
    }
    if (fetchResult.failed.length > 5) console.log(`    ... and ${fetchResult.failed.length - 5} more`);
  }

  // 5. 序列化成统一结构 markdown
  //    按 section 分组（路径推断），section 内按路径排序保持原顺序
  const sectionMap = new Map(); // sectionKey → { title, lessons: [{title, body}] }
  for (const file of fetchResult.ok) {
    const sectionKey = inferSection(file.path);
    const lessonRaw = inferLessonTitle(file.path, file.title);
    const lessonTitle = prettifyTitle(lessonRaw);
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, { title: prettifyTitle(sectionKey), lessons: [] });
    }
    sectionMap.get(sectionKey).lessons.push({
      title: lessonTitle,
      body: normalizeLessonMd(file.md),
    });
  }

  // 课程标题
  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  const courseTitle = h1Match ? h1Match[1].trim() : `${REPO}`;

  // 组装输出
  const out = [];
  out.push(`# AI for Beginners — 12 Weeks, 24 Lessons (Microsoft)`);
  out.push("");
  out.push(`> Source: [${OWNER}/${REPO}](https://github.com/${OWNER}/${REPO}) — auto-imported via repo-fetcher pipeline.`);
  out.push("");

  let sectionCount = 0;
  let lessonCount = 0;
  for (const [, sec] of sectionMap) {
    out.push(`## ${sec.title}`);
    out.push("");
    sectionCount++;
    for (const lesson of sec.lessons) {
      out.push(`### ${lesson.title}`);
      out.push("");
      out.push(lesson.body || "*(此课无正文)*");
      out.push("");
      lessonCount++;
    }
  }

  writeFileSync(OUT_PATH, out.join("\n"), "utf8");
  const bytes = Buffer.byteLength(out.join("\n"), "utf8");
  console.log("");
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  ${sectionCount} sections, ${lessonCount} lessons, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
