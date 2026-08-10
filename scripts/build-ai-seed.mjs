#!/usr/bin/env node
/**
 * build-ai-seed.mjs — 一次性构建脚本（开发时手工跑），把 microsoft/AI-For-Beginners
 * 的顶层 README（当前言）+ 25 个 lesson README（正文）组装成一份大 markdown，
 * 作为 LookatStudy 的内置种子课程内容。
 *
 * 产物: src/main/assets/seed-ai-for-beginners.md （入 git，被 seed.ts 以 ?raw 内联进 bundle）
 *
 * 设计:
 * - 顶层 README 只是课程目录（每课 1-2 行），精华在每个 lesson README 里
 *   （概念讲解 + PyTorch/TF 代码 + 图）。
 * - 组装结构: `# 课程 H1` → `## Section` → `### Lesson N. Title` → 该课正文
 * - 剥每课自己的 H1（避免与组装 H1 冲突）、剥 Pre/Post-quiz 外链、剥 Assignment 死链
 * - 保留正文 / 图片引用 / 代码块（notebook 太大不 bundle，代码已在 lesson README 里）
 *
 * 用法: node scripts/build-ai-seed.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_PATH = join(ROOT, "src/main/assets/seed-ai-for-beginners.md");

// jsdelivr CDN mirror of GitHub raw content（绕开 raw.githubusercontent.com 的证书问题）
const RAW_BASE = "https://cdn.jsdelivr.net/gh/microsoft/AI-For-Beginners@master";

// ── 课程结构（手工维护，源自 README syllabus） ──────────────────────────
// section = H2, lesson = H3。path 相对 repo 根。
const CURRICULUM = [
  {
    section: "Introduction to AI",
    lessons: [
      { num: "01", title: "Introduction and History of AI", path: "lessons/1-Intro/README.md" },
    ],
  },
  {
    section: "Knowledge Representation & Symbolic AI",
    lessons: [
      { num: "02", title: "Knowledge Representation and Expert Systems", path: "lessons/2-Symbolic/README.md" },
    ],
  },
  {
    section: "Introduction to Neural Networks",
    lessons: [
      { num: "03", title: "Perceptron", path: "lessons/3-NeuralNetworks/03-Perceptron/README.md" },
      { num: "04", title: "Multi-Layered Perceptron & Own Framework", path: "lessons/3-NeuralNetworks/04-OwnFramework/README.md" },
      { num: "05", title: "Intro to Frameworks (PyTorch & TensorFlow)", path: "lessons/3-NeuralNetworks/05-Frameworks/README.md" },
    ],
  },
  {
    section: "Computer Vision",
    lessons: [
      { num: "06", title: "Intro to Computer Vision & OpenCV", path: "lessons/4-ComputerVision/06-IntroCV/README.md" },
      { num: "07", title: "Convolutional Neural Networks", path: "lessons/4-ComputerVision/07-ConvNets/README.md" },
      { num: "08", title: "Pre-trained Networks & Transfer Learning", path: "lessons/4-ComputerVision/08-TransferLearning/README.md" },
      { num: "09", title: "Autoencoders & VAEs", path: "lessons/4-ComputerVision/09-Autoencoders/README.md" },
      { num: "10", title: "Generative Adversarial Networks & Style Transfer", path: "lessons/4-ComputerVision/10-GANs/README.md" },
      { num: "11", title: "Object Detection", path: "lessons/4-ComputerVision/11-ObjectDetection/README.md" },
      { num: "12", title: "Semantic Segmentation & U-Net", path: "lessons/4-ComputerVision/12-Segmentation/README.md" },
    ],
  },
  {
    section: "Natural Language Processing",
    lessons: [
      { num: "13", title: "Text Representation (BoW, TF-IDF)", path: "lessons/5-NLP/13-TextRep/README.md" },
      { num: "14", title: "Semantic Word Embeddings (Word2Vec, GloVe)", path: "lessons/5-NLP/14-Embeddings/README.md" },
      { num: "15", title: "Language Modeling & Training Embeddings", path: "lessons/5-NLP/15-LanguageModeling/README.md" },
      { num: "16", title: "Recurrent Neural Networks", path: "lessons/5-NLP/16-RNN/README.md" },
      { num: "17", title: "Generative Recurrent Networks", path: "lessons/5-NLP/17-GenerativeNetworks/README.md" },
      { num: "18", title: "Transformers & BERT", path: "lessons/5-NLP/18-Transformers/README.md" },
      { num: "19", title: "Named Entity Recognition", path: "lessons/5-NLP/19-NER/README.md" },
      { num: "20", title: "Large Language Models & Prompt Programming", path: "lessons/5-NLP/20-LangModels/README.md" },
    ],
  },
  {
    section: "Other AI Techniques",
    lessons: [
      { num: "21", title: "Genetic Algorithms", path: "lessons/6-Other/21-GeneticAlgorithms/README.md" },
      { num: "22", title: "Deep Reinforcement Learning", path: "lessons/6-Other/22-DeepRL/README.md" },
      { num: "23", title: "Multi-Agent Systems", path: "lessons/6-Other/23-MultiagentSystems/README.md" },
    ],
  },
  {
    section: "AI Ethics",
    lessons: [
      { num: "24", title: "AI Ethics & Responsible AI", path: "lessons/7-Ethics/README.md" },
    ],
  },
  {
    section: "Extras",
    lessons: [
      { num: "25", title: "Multi-Modal Networks (CLIP & VQGAN)", path: "lessons/X-Extras/X1-MultiModal/README.md" },
    ],
  },
];

// ── 工具函数 ──────────────────────────────────────────────────────────

/** fetch raw github 文本，失败抛错（带 url） */
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

/**
 * 从顶层 README 提取前言：H1 标题 + 简介段（第一个非徽章非目录的段落）。
 * 剥掉徽章行、徽章图片、TOC 表格、"Translations" 段。
 */
function extractPreamble(topMd) {
  const lines = topMd.split("\n");
  const out = [];
  let inTable = false;
  let collectedIntro = false;
  for (const line of lines) {
    // 跳过空行
    if (line.trim() === "") {
      if (out.length > 0 && !collectedIntro) out.push("");
      continue;
    }
    // 跳过徽章行（全是 ![..](..) 或 [![..](..)](..)）
    if (/^\[?!\[/.test(line.trim())) continue;
    // 跳过 HTML 注释 / hr 分隔
    if (/^<!--/.test(line.trim()) || /^-{3,}$/.test(line.trim())) continue;
    // 跳过 H1（组装时已用我们自己的统一标题，不需要原 README 的 H1）
    if (/^#\s+/.test(line)) continue;
    // 跳过翻译语言链接行（一行里全是 [Lang](./translations/xx/) 的那种）
    if (/\[.*\]\(\.?\/?translations\/[a-z]/i.test(line) && line.split("|").length > 5) continue;
    // 表格（| ... |）整段跳过 —— 顶层 README 的表格是课程目录 + 翻译列表
    if (line.trim().startsWith("|")) { inTable = true; continue; }
    if (inTable) {
      // 表格结束于第一个非 | 开头的行
      if (!line.trim().startsWith("|")) inTable = false;
      else continue;
    }
    // 命中"Translations"/"Translation"等章节就停（后面是翻译索引，不要）
    if (/^##\s+.*[Tt]ranslation/.test(line)) break;
    // 命中"Curriculum"/课程目录章节也停（目录不要，我们用 lesson 正文）
    if (/^##\s+.*([Cc]urriculum|课程|Table of [Cc]ontents)/.test(line)) break;
    // 简介段：收集到第一个有意义的非标题段落就够
    if (!collectedIntro && line.trim().length > 40 && !/^#/.test(line)) {
      out.push(line);
      collectedIntro = true;
      continue;
    }
    // 简介后的第二个段落（通常是对课程的一句话描述），也收
    if (collectedIntro && out.length < 6 && !/^#/.test(line) && line.trim().length > 40) {
      out.push(line);
      break;
    }
  }
  return out.join("\n").trim();
}

/**
 * 归一化单个 lesson README：
 * - 剥本课自己的 H1（标题已在组装的 ### Lesson N. Title 里）
 * - 剥 [Pre-lecture quiz](...) / [Post-lecture quiz](...) 整行（外链在 app 里打不开）
 * - 剥 ## [Assignment](lab/README.md) 段（lab 我们没 bundle，死链）
 * - **课程内的子标题降级两级**：## → ####, ### → #####
 *   （课程结构是 # 课程 / ## section / ### lesson；若保留课内 ## 子标题，
 *   会被 markdown-course 解析器误判为新 section，把一课拆碎。降级后整课
 *   正文都在同一个 ### Lesson 下，H4/H5 只是渲染时的视觉小标题。）
 * - 保留其余正文、图片、代码块
 * - **代码块内的 # 不动**（Python 注释 / R 指令等），靠代码围栏状态机
 */
function normalizeLessonMd(md) {
  const lines = md.split("\n");
  const out = [];
  let skipAssignmentBlock = false;
  let inCodeFence = false; // ``` 围栏状态机，代码块内的 # 不降级
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码围栏状态机：``` 或 ~~~ 切换
    if (/^(```|~~~)/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }

    // 代码块内原样保留（Python 注释里的 # 不动）
    if (inCodeFence) {
      out.push(line);
      continue;
    }

    // 剥所有 H1（课内 H1 标题如 "# Overfitting" 会与组装的课程 H1 冲突；
    // 课程正文标题已在 ### Lesson N. Title 里，课内 H1 当噪音删）
    if (/^#\s+/.test(line)) {
      continue;
    }
    // 剥 quiz 链接行（可能是 ## [Pre-lecture quiz](url) 或独立一行 - [...](url)）
    if (/\[Pre-lecture quiz\]/.test(line) || /\[Post-lecture quiz\]/.test(line)) continue;
    // 剥 Assignment 段：从 `## [Assignment](lab/...)` 开始到下一个同级或更高级标题前
    if (/^##\s*\[Assignment\]/.test(line)) {
      skipAssignmentBlock = true;
      continue;
    }
    if (skipAssignmentBlock) {
      // 段结束条件：遇到新的 ## 或 # 标题
      if (/^#{1,2}\s+/.test(line) && !/^\s{4,}/.test(line)) {
        skipAssignmentBlock = false;
        // 不要 continue —— 这行是新段标题，要保留（但下面会做降级）
      } else {
        continue;
      }
    }

    // 标题降级：课内 ## → ####, ### → #####, #### → ######
    // （只降 2-4 级；已剥的 H1 不在这；# 课程 H1 不在这层处理）
    const headingMatch = /^(#{2,4})(\s+.*)$/.exec(line);
    if (headingMatch) {
      out.push(`##${headingMatch[0]}`); // 补两个 # 实现降两级
      continue;
    }
    out.push(line);
  }
  // 清理尾部多余空行
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── 主流程 ──────────────────────────────────────────────────────────
async function main() {
  console.log("▸ fetching top-level README …");
  const topMd = await fetchText(`${RAW_BASE}/README.md`);
  const preamble = extractPreamble(topMd);
  console.log(`  preamble: ${preamble.split("\n").length} lines`);

  const out = [];
  // 组装 H1（统一标题，不直接用顶层 README 的 H1，因为它可能很长）
  out.push("# AI for Beginners — 12 Weeks, 24 Lessons (Microsoft)");
  out.push("");
  out.push(preamble);
  out.push("");

  let sectionCount = 0;
  let lessonCount = 0;
  const failures = [];

  for (const sec of CURRICULUM) {
    out.push(`## ${sec.section}`);
    out.push("");
    sectionCount++;
    for (const lesson of sec.lessons) {
      const url = `${RAW_BASE}/${lesson.path}`;
      try {
        console.log(`▸ lesson ${lesson.num} ${lesson.title}`);
        const md = await fetchText(url);
        const body = normalizeLessonMd(md);
        out.push(`### Lesson ${lesson.num}. ${lesson.title}`);
        out.push("");
        out.push(body);
        out.push("");
        lessonCount++;
      } catch (err) {
        console.error(`  ✗ ${lesson.path}: ${err.message}`);
        failures.push({ num: lesson.num, path: lesson.path, err: err.message });
        // 失败也放一个占位 lesson，保证课程树结构完整
        out.push(`### Lesson ${lesson.num}. ${lesson.title}`);
        out.push("");
        out.push(`*(此课内容拉取失败: ${err.message})*`);
        out.push("");
      }
    }
  }

  writeFileSync(OUT_PATH, out.join("\n"), "utf8");
  const lines = out.length;
  const bytes = Buffer.byteLength(out.join("\n"), "utf8");
  console.log("");
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  ${sectionCount} sections, ${lessonCount} lessons, ${lines} lines, ${(bytes / 1024).toFixed(1)} KB`);
  if (failures.length) {
    console.log(`  ⚠ ${failures.length} failures:`);
    for (const f of failures) console.log(`    - ${f.num} ${f.path}: ${f.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
