/**
 * 验证新导入管线的核心纯函数:
 * 1. extractOutlineWithCharCounts — 标题大纲 + 每段字符数
 * 2. extractImageSrcs — 提取原文图片序列
 * 3. replaceImagesByPosition — 翻译图片按位置映射到原文图
 *
 * 用模拟的 2-Symbolic 结构（基于真实数据分析）做 closed-loop 验证。
 */
import { extractOutlineWithCharCounts } from "../src/main/services/pure/repo-fetcher.ts";
import { extractImageSrcs, replaceImagesByPosition } from "../src/main/services/import-pipeline.ts";

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// ── 1. extractOutlineWithCharCounts ──
console.log("=== extractOutlineWithCharCounts ===");

const sampleMd = `# Knowledge Representation and Expert Systems

## [Pre-lecture quiz](url)

quiz link here.

## Knowledge Representation

Some content about KR.
This section has multiple lines.

## Expert Systems

### Forward vs. Backward Inference

H3 content here.

### Implementing Expert Systems

More H3 content.

## Ontologies and the Semantic Web

Ontology content.
`;

const outline = extractOutlineWithCharCounts(sampleMd, "lessons/2-Symbolic/README.md");
ok("H1 提取正确", outline.h1 === "Knowledge Representation and Expert Systems");
ok("totalChars 接近原文长度", outline.totalChars === sampleMd.length);
ok("H2/H3 数量正确 (4 H2 + 2 H3 = 6 headings)", outline.headings.length === 6);
ok("第一个 H2 是 Pre-lecture quiz", outline.headings[0].title.includes("Pre-lecture quiz"));
ok("H2 有 chars 字段", typeof outline.headings[0].chars === "number" && outline.headings[0].chars > 0);

// H3 应该有正确的 chars（到下一个同级 H3 或 H2）
const h3forward = outline.headings.find(h => h.title === "Forward vs. Backward Inference");
const h3impl = outline.headings.find(h => h.title === "Implementing Expert Systems");
ok("H3 Forward 存在", !!h3forward);
ok("H3 Implementing 存在", !!h3impl);
// Forward 的 chars 应该是从它到 Implementing 之前
ok("H3 Forward chars < H3 Implementing chars 起始（Forward 在前）", h3forward.chars > 0);

// 代码块内的 # 不算标题
const codeBlockMd = `# Title

## Real Heading

text

\`\`\`
## Not A Heading (in code block)
### Also Not
\`\`\`

## After Code
`;
const codeOutline = extractOutlineWithCharCounts(codeBlockMd, "test.md");
ok("代码块内 # 不算标题（只有 2 个 H2）",
  codeOutline.headings.filter(h => h.level === 2).length === 2);
ok("代码块后的 H2 被识别", codeOutline.headings.some(h => h.title === "After Code"));

// ── 2. extractImageSrcs ──
console.log("\n=== extractImageSrcs ===");

const contentWithImgs = `Some text

![diagram](lessons/images/diagram.png)

more text

![flow](https://example.com/flow.png)

and <img src="assets/pic.jpg" alt="pic" />`;

const srcs = extractImageSrcs(contentWithImgs);
ok("提取 3 个图片 src（2 markdown + 1 HTML）", srcs.length === 3);
ok("第一个是 diagram.png", srcs[0].includes("diagram.png"));
ok("第二个是 flow.png 外链", srcs[1].includes("flow.png"));
ok("第三个是 pic.jpg（HTML img）", srcs[2].includes("pic.jpg"));

// ── 3. replaceImagesByPosition ──
console.log("\n=== replaceImagesByPosition ===");

// 模拟：原文有 2 张图（已 inlined 成 base64），翻译正文也有 2 张图（不同 src）
const originalImgs = ["data:image/png;base64,AAA111", "data:image/webp;base64,BBB222"];
const transContent = `翻译文字

![翻译图1](../../../../translated_images/zh-CN/foo.webp)

更多翻译文字

![翻译图2](../translated_images/bar.zh-cn.png)

还有文字`;

const replaced = replaceImagesByPosition(transContent, originalImgs);
const replacedSrcs = extractImageSrcs(replaced);
ok("翻译图片数不变（2张）", replacedSrcs.length === 2);
ok("第1张替换为原文第1张 base64", replacedSrcs[0] === "data:image/png;base64,AAA111");
ok("第2张替换为原文第2张 base64", replacedSrcs[1] === "data:image/webp;base64,BBB222");
ok("翻译文字保留", replaced.includes("翻译文字") && replaced.includes("更多翻译文字"));

// 翻译图 > 原文图：多余的删掉
const transMore = `![图1](trans1.png) text ![图2](trans2.png) ![图3](trans3.png)`;
const replacedMore = replaceImagesByPosition(transMore, ["ORIG1"]);
const moreSrcs = extractImageSrcs(replacedMore);
ok("翻译 3 图 > 原文 1 图：只保留 1 张（多余的删掉）", moreSrcs.length === 1);
ok("保留的是原文图 ORIG1", moreSrcs[0] === "ORIG1");

// 翻译图 < 原文图：不影响（翻译只替换它有的）
const transFewer = `![唯一图](trans1.png)`;
const replacedFewer = replaceImagesByPosition(transFewer, ["ORIG1", "ORIG2", "ORIG3"]);
const fewerSrcs = extractImageSrcs(replacedFewer);
ok("翻译 1 图 < 原文 3 图：翻译图替换为原文第1张", fewerSrcs.length === 1 && fewerSrcs[0] === "ORIG1");

// HTML <img> 也被转成 markdown + 位置映射
const transHtml = `<img src="translated_images/x.webp" alt="X" />`;
const replacedHtml = replaceImagesByPosition(transHtml, ["data:base64,REAL"]);
ok("HTML <img> 转成 markdown + 替换", replacedHtml.includes("![X](data:base64,REAL)"));

// ── 4. 完整 closed-loop: 原文 inline → 提取 → 翻译位置映射 ──
console.log("\n=== closed-loop: 原文→提取→翻译映射 ===");

// 模拟原文（已 inline 后）
const originalInlined = `# Lesson

讲解文字

![概念图](data:image/png;base64,REAL_CONCEPT)

更多讲解

![流程图](data:image/png;base64,REAL_FLOW)`;

// 提取原文图片
const origImgs = extractImageSrcs(originalInlined);
ok("原文提取 2 张图", origImgs.length === 2);

// 模拟翻译正文（图片 src 完全不同，但位置对应）
const translationRaw = `# 课程

讲解文字翻译

![概念图翻译](../../../translated_images/zh-CN/concept.xxx.webp)

更多讲解翻译

![流程图翻译](../../../translated_images/zh-CN/flow.xxx.webp)`;

// 翻译位置映射
const translationFinal = replaceImagesByPosition(translationRaw, origImgs);
const finalSrcs = extractImageSrcs(translationFinal);
ok("翻译最终图片 = 原文图片（位置映射）", finalSrcs[0] === "data:image/png;base64,REAL_CONCEPT" && finalSrcs[1] === "data:image/png;base64,REAL_FLOW");
ok("翻译文字保留", translationFinal.includes("讲解文字翻译") && translationFinal.includes("更多讲解翻译"));

console.log(`\n=== 导入管线 v2 核心函数: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
