/**
 * Markdown 课程解析器验证 —— 测真实 pure/markdown-course.ts。
 *
 * 不变量：
 *   - H1 → 课程标题
 *   - H2 → section，H3 → section 下的 lesson
 *   - anchor 是 GitHub 风格（小写/空格转 -/去标点）
 *   - H3 在 H2 前 → 归"(前言)"section
 *   - LabType: 有 python 代码块→code，有 ipynb→notebook，纯文本→doc
 */
import assert from "node:assert";
import {
  parseMarkdownToCourse,
  detectLabType,
  titleToAnchor,
  cleanTitle,
} from "../src/main/services/pure/markdown-course.ts";

// === T1: titleToAnchor ===
assert.strictEqual(titleToAnchor("The FDE Persona & Mission"), "the-fde-persona--mission");
assert.strictEqual(titleToAnchor("Hello, World!"), "hello-world");
assert.strictEqual(titleToAnchor("  多 空格  "), "多-空格");
console.log(`✓ T1 titleToAnchor: GitHub 风格 anchor 正确`);

// === T2: 基础 H1/H2/H3 解析 ===
const md1 = `# 我的课程

## 第一节
正文段落

### 子课 A
子课 A 正文

### 子课 B
子课 B 正文

## 第二节
### 子课 C
`;
const c1 = parseMarkdownToCourse(md1);
assert.strictEqual(c1.title, "我的课程", "T2: H1 → 标题");
assert.strictEqual(c1.sections.length, 2, `T2: 应 2 section, 实际 ${c1.sections.length}`);
assert.strictEqual(c1.sections[0].title, "第一节");
assert.strictEqual(c1.sections[0].lessons.length, 2, "T2: 第一节 2 lesson");
assert.strictEqual(c1.sections[1].lessons.length, 1, "T2: 第二节 1 lesson");
console.log(`✓ T2 H1/H2/H3 解析：标题 + 2 section（2/1 lesson）`);

// === T3: lesson body 正确归位 ===
assert.ok(c1.sections[0].lessons[0].body.includes("子课 A 正文"), "T3: A 的 body");
assert.ok(c1.sections[0].lessons[1].body.includes("子课 B 正文"), "T3: B 的 body");
assert.ok(!c1.sections[0].lessons[0].body.includes("子课 B"), "T3: A 的 body 不含 B");
console.log(`✓ T3 lesson body 归位：A/B 正文正确分隔`);

// === T4: H3 在 H2 前 → "(前言)" section ===
const md2 = `# 标题
### 孤儿子课
孤儿正文
## 真正的第一节
### 正常子课
`;
const c2 = parseMarkdownToCourse(md2);
assert.strictEqual(c2.sections[0].title, "(前言)", "T4: 首 section 是前言");
assert.strictEqual(c2.sections[0].lessons.length, 1, "T4: 前言 1 lesson");
assert.strictEqual(c2.sections[1].title, "真正的第一节");
console.log(`✓ T4 H3 先于 H2 → "(前言)" section`);

// === T5: anchor 生成在 section 和 lesson 上 ===
assert.ok(c1.sections[0].anchor.length > 0, "T5: section 有 anchor");
assert.ok(c1.sections[0].lessons[0].anchor.length > 0, "T5: lesson 有 anchor");
// 中文标题保留原字 + 空格转 -："子课 A" → "子课-a"
assert.strictEqual(c1.sections[0].lessons[0].anchor, "子课-a");
console.log(`✓ T5 anchor 生成：section + lesson 都有（中文保留）`);

// === T6: 无 H1 → "(untitled)" ===
const c3 = parseMarkdownToCourse("## 只有 H2");
assert.strictEqual(c3.title, "(untitled)", "T6: 无 H1 → untitled");
console.log(`✓ T6 无 H1 → "(untitled)"`);

// === T7: 空文档 ===
const c4 = parseMarkdownToCourse("");
assert.strictEqual(c4.sections.length, 0, "T7: 空文档 0 section");
console.log(`✓ T7 空文档：0 section`);

// === LabType 检测 ===
// T8: doc
assert.strictEqual(detectLabType("# 标题\n\n纯文字段落"), "doc", "T8: 纯文本→doc");
console.log(`✓ T8 LabType doc：纯文本`);

// T9: code
assert.strictEqual(
  detectLabType("# 标题\n\n```python\nprint('hi')\n```\n"),
  "code",
  "T9: python 块→code",
);
assert.strictEqual(
  detectLabType("```js\nconst x=1\n```\n"),
  "code",
  "T9: js 块→code",
);
console.log(`✓ T9 LabType code：python/js 块`);

// T10: notebook
assert.strictEqual(
  detectLabType("# 用 jupyter notebook 学习\n"),
  "notebook",
  "T10: jupyter 关键词→notebook",
);
assert.strictEqual(
  detectLabType("见 example.ipynb"),
  "notebook",
  "T10: .ipynb→notebook",
);
console.log(`✓ T10 LabType notebook：jupyter/.ipynb 关键词`);

// T11: notebook 优先于 code（同时含）
assert.strictEqual(
  detectLabType("```python\nx=1\n```\n见 a.ipynb"),
  "notebook",
  "T11: 同时含 code+ipynb → notebook 优先",
);
console.log(`✓ T11 notebook 优先于 code`);

console.log("\n=== ALL MARKDOWN COURSE TESTS PASSED ✅ ===");

// === 对抗性测试: cleanTitle 标题清洗 ===
console.log("\n=== cleanTitle 对抗性测试 ===");

// 正常 emoji 清洗
assert.strictEqual(cleanTitle("🛠 The Modern FDE Stack"), "The Modern FDE Stack", "ADV1: 去 emoji");
console.log("✓ ADV1 去 emoji: 🛠 The Modern FDE Stack → The Modern FDE Stack");

// markdown 链接清洗
assert.strictEqual(cleanTitle("[Pre-lecture quiz](https://example.com)"), "Pre-lecture quiz", "ADV2: 去 md 链接");
console.log("✓ ADV2 去 md 链接: [Pre-lecture quiz](url) → Pre-lecture quiz");

// 纯中文标题不应被清洗掉
assert.strictEqual(cleanTitle("数据工程基础"), "数据工程基础", "ADV3: 中文标题保留");
console.log("✓ ADV3 中文标题保留: 数据工程基础 → 数据工程基础");

// 混合中英文 + emoji
assert.strictEqual(cleanTitle("📚 第一章：数据工程"), "第一章：数据工程", "ADV4: 中文+emoji");
console.log("✓ ADV4 中文+emoji: 📚 第一章：数据工程 → 第一章：数据工程");

// 空标题不应崩溃
assert.strictEqual(cleanTitle(""), "", "ADV5: 空标题不崩");
assert.strictEqual(cleanTitle("   "), "", "ADV6: 纯空格不崩");
console.log("✓ ADV5/6 空标题/纯空格: 不崩溃");

// 多重 emoji
assert.strictEqual(cleanTitle("🔥🚀🤖 AI 入门"), "AI 入门", "ADV7: 多重 emoji");
console.log("✓ ADV7 多重emoji: 🔥🚀🤖 AI 入门 → AI 入门");

// markdown 标题符号
assert.strictEqual(cleanTitle("## Section Title"), "Section Title", "ADV8: 去 md 标题符号");
console.log("✓ ADV8 去md符号: ## Section Title → Section Title");

// 数字开头的标题不被误伤
assert.strictEqual(cleanTitle("Phase 1: Data Engineering"), "Phase 1: Data Engineering", "ADV9: 数字标题保留");
console.log("✓ ADV9 数字标题: Phase 1: Data Engineering → 保留");

console.log("\n=== cleanTitle 对抗性测试 PASSED ✅ ===");

