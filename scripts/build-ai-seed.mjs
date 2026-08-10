#!/usr/bin/env node
/**
 * build-ai-seed.mjs — 一次性构建脚本（开发时手工跑），用项目自己的导入管线
 * (repo-fetcher.ts) 拉 microsoft/AI-For-Beginners 仓库，组装成一份大 markdown
 * 作为 LookatStudy 的内置种子课程内容。
 *
 * 产物: src/main/assets/seed-ai-for-beginners.md （入 git，被 seed.ts 以 ?raw 内联进 bundle）
 *
 * 和用户在 app 里点"GitHub URL 导入"走的是同一套纯函数:
 *   importRepoToParsedCourse (fetch README → detectRepoPattern → fetchMarkdownContents
 *     → classifyFile → buildCourseFromFiles)
 *
 * 分类器自动过滤噪声(translations/notebook/lab/example/section-intro)，
 * 不确定的内容交给 LLM 在运行时 analyzeCourseStructure 判断。
 *
 * 用法: npx tsx scripts/build-ai-seed.mjs
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

// 复用项目自己的导入管线编排函数（纯函数，不依赖 Electron）
const { importRepoToParsedCourse } = await import("../src/main/services/pure/repo-fetcher.ts");

/** 把路径段如 "03-Perceptron" / "NeuralNetworks" / "0-course-setup" 清理成可读标题 */
function prettifyTitle(raw) {
  return raw
    .replace(/^(\d+[-_]?)/, "")
    .replace(/^[Xx]\d+[-_]?/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * 归一化单个 lesson 正文:
 * - 剥所有 H1（与组装的课程 H1 冲突）
 * - 剥 Pre/Post-lecture quiz 外链行
 * - 剥 ## [Assignment](lab/README.md) 段
 * - 课内子标题降级两级(## → ####, ### → #####)
 * - 代码块内的 # 不动（围栏状态机）
 */
function normalizeLessonMd(md) {
  const lines = md.split("\n");
  const out = [];
  let skipAssignmentBlock = false;
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }
    if (inCodeFence) { out.push(line); continue; }
    if (/^#\s+/.test(line)) continue;
    if (/\[Pre-lecture quiz\]/.test(line) || /\[Post-lecture quiz\]/.test(line)) continue;
    if (/^##\s*\[Assignment\]/.test(line)) { skipAssignmentBlock = true; continue; }
    if (skipAssignmentBlock) {
      if (/^#{1,2}\s+/.test(line) && !/^\s{4,}/.test(line)) {
        skipAssignmentBlock = false;
      } else { continue; }
    }
    const headingMatch = /^(#{2,4})(\s+.*)$/.exec(line);
    if (headingMatch) { out.push(`##${headingMatch[0]}`); continue; }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── 主流程 ──────────────────────────────────────────────────────────
async function main() {
  console.log(`▸ importing ${OWNER}/${REPO}@${BRANCH} via repo-fetcher pipeline …`);
  const result = await importRepoToParsedCourse(
    OWNER, REPO, BRANCH, globalThis.fetch,
    (msg) => console.log(`  ${msg}`),
  );

  const { course } = result;
  console.log(`  parsed: ${course.sections.length} sections`);

  // 序列化成统一结构 markdown
  const out = [];
  out.push(`# AI for Beginners — 12 Weeks, 24 Lessons (Microsoft)`);
  out.push("");
  out.push(`> Source: [${OWNER}/${REPO}](https://github.com/${OWNER}/${REPO}) — auto-imported via repo-fetcher pipeline.`);
  out.push("");

  let sectionCount = 0;
  let lessonCount = 0;
  for (const sec of course.sections) {
    if (sec.lessons.length === 0) continue;
    out.push(`## ${prettifyTitle(sec.title)}`);
    out.push("");
    sectionCount++;
    for (const lesson of sec.lessons) {
      out.push(`### ${lesson.title}`);
      out.push("");
      out.push(normalizeLessonMd(lesson.body) || "*(此课无正文)*");
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
