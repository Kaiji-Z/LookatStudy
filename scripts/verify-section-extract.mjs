/**
 * 验证 import-pipeline 的标题序号截取逻辑（三个修复）:
 * 1. H2 anchor 含 H3 子段（级别感知 endIdx，修 Expert Systems 丢 H3）
 * 2. isFirstOfFile 含文件头部 H1+前言（修 H1/Pre-lecture quiz 丢失）
 * 3. 翻译用 titleIndex 序号对齐（修英文 anchor 匹配中文标题失败）
 *
 * 用模拟的 2-Symbolic 真实结构做 closed-loop 验证。
 */
import { extractHeadings, findTitleIndex, extractSectionByIndex } from "../src/main/services/import-pipeline.ts";

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// 模拟 2-Symbolic README 结构（原文，英文标题）
const originalMd = `# Knowledge Representation and Expert Systems

Summary of Symbolic AI content

![sketchnote](sketchnotes/ai-symbolic.png)

The quest for artificial intelligence is based on a search for knowledge.

## [Pre-lecture quiz](url)

Pre-lecture quiz link here.

## Knowledge Representation

One of the important concepts in Symbolic AI is **knowledge**.
This section has content about KR.

## Classifying Computer Knowledge Representations

Classification content here.

## Expert Systems

Expert systems intro.

### Forward vs. Backward Inference

H3 content about forward and backward inference.

### Implementing Expert Systems

H3 content about implementation.

## Ontologies and the Semantic Web

Ontology content here.
`;

const headings = extractHeadings(originalMd);
console.log(`=== extractHeadings: 找到 ${headings.length} 个 H2/H3 ===`);
// 应该是: Pre-lecture quiz, Knowledge Rep, Classifying, Expert Systems, Forward, Implementing, Ontologies = 7
ok("标题数 = 7（5 H2 + 2 H3）", headings.length === 7);
ok("H2/H3 级别正确", headings[0].level === 2 && headings[4].level === 3);

// ── 修复1: H2 含 H3 子段（Expert Systems）──
console.log("\n=== 修复1: H2 anchor 含 H3 子段 ===");
const expertIdx = findTitleIndex(headings, "## Expert Systems");
ok("Expert Systems 的 titleIndex = 3", expertIdx === 3);
const expertSection = extractSectionByIndex(originalMd, headings, expertIdx, false);
ok("Expert Systems 含 H3 Forward", expertSection.includes("Forward vs. Backward Inference"));
ok("Expert Systems 含 H3 Implementing", expertSection.includes("Implementing Expert Systems"));
ok("Expert Systems 不含 Ontologies（下一个 H2）", !expertSection.includes("Ontologies and the Semantic Web"));
ok("Expert Systems 不含 Classifying（上一个 H2）", !expertSection.includes("Classifying Computer"));

// ── 修复2: isFirstOfFile 含 H1+前言+Pre-lecture quiz ===
console.log("\n=== 修复2: isFirstOfFile 含文件头部 ===");
const krIdx = findTitleIndex(headings, "## Knowledge Representation");
ok("Knowledge Representation 的 titleIndex = 1", krIdx === 1);
const krFirst = extractSectionByIndex(originalMd, headings, krIdx, true); // isFirstOfFile=true
ok("首 lesson 含 H1 标题", krFirst.includes("Knowledge Representation and Expert Systems"));
ok("首 lesson 含前言 quest", krFirst.includes("quest for artificial intelligence"));
ok("首 lesson 含 sketchnote 图引用", krFirst.includes("ai-symbolic.png"));
ok("首 lesson 含 Pre-lecture quiz", krFirst.includes("Pre-lecture quiz"));
ok("首 lesson 含 Knowledge Representation 正文", krFirst.includes("important concepts in Symbolic AI"));
ok("首 lesson 不含 Classifying（下一个 H2）", !krFirst.includes("Classifying Computer"));

// 对比：非首 lesson 不含文件头部
const krNotFirst = extractSectionByIndex(originalMd, headings, krIdx, false);
ok("非首 lesson 不含 H1 标题", !krNotFirst.includes("Knowledge Representation and Expert Systems") || krNotFirst.trimStart().startsWith("## Knowledge"));
ok("非首 lesson 不含前言 quest", !krNotFirst.includes("quest for artificial intelligence"));

// ── 修复3: 翻译用 titleIndex 序号对齐（中文标题）──
console.log("\n=== 修复3: 翻译 titleIndex 序号对齐 ===");
// 模拟翻译文件（中文标题，结构相同）
const transMd = `# 知识表示与专家系统

符号 AI 内容摘要

![草图](translated_images/ai-symbolic.webp)

人工智能的追求是基于对知识的探索。

## [课前测验](url)

课前测验链接。

## 知识表示

符号 AI 的重要概念是**知识**。

## 计算机知识表示分类

分类内容。

## 专家系统

专家系统介绍。

### 前向与后向推理

前向和后向推理内容。

### 实现专家系统

实现内容。

## 本体论与语义网

本体内容。
`;

const transHeadings = extractHeadings(transMd);
ok("翻译文件标题数 = 7（和原文一致）", transHeadings.length === 7);

// 用原文的 titleIndex 截取翻译（不依赖文字匹配！）
// Knowledge Representation: titleIndex=1, isFirstOfFile=true
const transKr = extractSectionByIndex(transMd, transHeadings, krIdx, true);
ok("翻译 Knowledge Rep 含中文 H1", transKr.includes("知识表示与专家系统"));
ok("翻译 Knowledge Rep 含中文前言", transKr.includes("人工智能的追求"));
ok("翻译 Knowledge Rep 含课前测验", transKr.includes("课前测验"));
ok("翻译 Knowledge Rep 含知识表示正文", transKr.includes("重要概念是"));
ok("翻译 Knowledge Rep 不含分类（下一个 H2）", !transKr.includes("计算机知识表示分类"));

// Expert Systems: titleIndex=3, isFirstOfFile=false
const transExpert = extractSectionByIndex(transMd, transHeadings, expertIdx, false);
ok("翻译 Expert Systems 含中文 H3 前向推理", transExpert.includes("前向与后向推理"));
ok("翻译 Expert Systems 含中文 H3 实现", transExpert.includes("实现专家系统"));
ok("翻译 Expert Systems 不含本体（下一个 H2）", !transExpert.includes("本体论与语义网"));

// ── 翻译标题和原文不同文字，但序号对齐成功 ===
console.log("\n=== 序号对齐验证（英文 anchor → 中文标题，按序号匹配）===");
ok("原文 Expert Systems(titleIndex=3) = 翻译第4个标题（专家系统）",
  transHeadings[3].title === "专家系统");
ok("原文 Knowledge Rep(titleIndex=1) = 翻译第2个标题（知识表示）",
  transHeadings[1].title === "知识表示");

console.log(`\n=== 标题序号截取: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
