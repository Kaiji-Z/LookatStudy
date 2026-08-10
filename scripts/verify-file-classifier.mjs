/**
 * verify-file-classifier.mjs — 课时文件分类器规则引擎测试。
 *
 * 测试 classifyFile 对各种路径/内容模式的判定:
 * - 高置信度噪声 (translation/meta/notebook/lab/example/section-intro) → keepAsLesson=false
 * - 不确定内容 → keepAsLesson=true, role=uncertain
 * - 正文充分的文件 → uncertain (交给 LLM)
 *
 * 纯函数测试，零网络/DB 依赖。
 */
import { strict as assert } from "node:assert";
import {
  classifyFile,
  classifyFiles,
  summarizeClassifications,
} from "../src/main/services/pure/file-classifier.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}

// 通用上下文：AI-For-Beginners 风格的兄弟路径
const AIB_SIBLINGS = [
  "lessons/1-Intro/README.md",
  "lessons/3-NeuralNetworks/README.md",
  "lessons/3-NeuralNetworks/03-Perceptron/README.md",
  "lessons/3-NeuralNetworks/03-Perceptron/lab/README.md",
  "lessons/3-NeuralNetworks/03-Perceptron/Perceptron.ipynb",
  "translations/zh-CN/README.md",
  "LICENSE",
  "lessons/4-ComputerVision/06-IntroCV/README.md",
  "examples/mnist_classifier.py",
];

const RICH_MD = "# Lesson Title\n\nThis is a rich lesson with substantial content. ".repeat(20) +
  "\n\n## Section A\n\nDetailed explanation of concept A with examples and context.\n\n## Section B\n\nMore content here.";

// ============================================================
// 规则 1: 翻译副本
// ============================================================
test("T1 translations/ → translation, skip", () => {
  const r = classifyFile("translations/zh-CN/README.md", RICH_MD, { siblingPaths: AIB_SIBLINGS });
  assert.strictEqual(r.role, "translation");
  assert.strictEqual(r.confidence, "high");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T1b translated_images/ → translation, skip", () => {
  const r = classifyFile("translated_images/zh-CN/image.png.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "translation");
  assert.strictEqual(r.keepAsLesson, false);
});

// ============================================================
// 规则 2: 仓库元数据
// ============================================================
test("T2 LICENSE → meta, skip", () => {
  const r = classifyFile("LICENSE", "MIT License...", { siblingPaths: [] });
  assert.strictEqual(r.role, "meta");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T2b CONTRIBUTING.md → meta, skip", () => {
  const r = classifyFile("CONTRIBUTING.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "meta");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T2c code_of_conduct.md → meta, skip", () => {
  const r = classifyFile("CODE_OF_CONDUCT.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "meta");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T2d README 不在 meta 名单（交给 fallback）", () => {
  const r = classifyFile("README.md", RICH_MD, { siblingPaths: [] });
  assert.notStrictEqual(r.role, "meta"); // README 走 fallback
});

// ============================================================
// 规则 3: Jupyter notebook
// ============================================================
test("T3 .ipynb → notebook, skip", () => {
  const r = classifyFile("lessons/3-NeuralNetworks/03-Perceptron/Perceptron.ipynb", RICH_MD, { siblingPaths: AIB_SIBLINGS });
  assert.strictEqual(r.role, "notebook");
  assert.strictEqual(r.keepAsLesson, false);
});

// ============================================================
// 规则 4: 配套练习
// ============================================================
test("T4 /lab/ → lab, skip", () => {
  const r = classifyFile("lessons/3-NeuralNetworks/03-Perceptron/lab/README.md", RICH_MD, { siblingPaths: AIB_SIBLINGS });
  assert.strictEqual(r.role, "lab");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T4b /exercise/ → lab, skip", () => {
  const r = classifyFile("lessons/2-Intro/exercise/README.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "lab");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T4c /assignment/ → lab, skip", () => {
  const r = classifyFile("course/assignment/hw1.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "lab");
});

// ============================================================
// 规则 5: 示例代码
// ============================================================
test("T5 /examples/ → example, skip", () => {
  const r = classifyFile("examples/mnist_classifier.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "example");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T5b /demo/ → example, skip", () => {
  const r = classifyFile("demo/quickstart.md", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "example");
});

// ============================================================
// 规则 6: section-intro
// ============================================================
test("T6 章节介绍页（有更深 lesson）→ section-intro, skip", () => {
  const siblings = [
    "lessons/3-NeuralNetworks/README.md",           // ← 待判定
    "lessons/3-NeuralNetworks/03-Perceptron/README.md", // 更深
    "lessons/3-NeuralNetworks/04-OwnFramework/README.md", // 更深
  ];
  const r = classifyFile("lessons/3-NeuralNetworks/README.md", RICH_MD, { siblingPaths: siblings });
  assert.strictEqual(r.role, "section-intro");
  assert.strictEqual(r.keepAsLesson, false);
});

test("T6b 章节介绍页（无更深 lesson）→ 不是 section-intro, 走 fallback", () => {
  // Intro section 只有 README，没有子目录 lesson → 不判 section-intro
  const siblings = ["lessons/1-Intro/README.md"];
  const r = classifyFile("lessons/1-Intro/README.md", RICH_MD, { siblingPaths: siblings });
  assert.notStrictEqual(r.role, "section-intro");
});

// ============================================================
// 规则 7: 正文太少
// ============================================================
test("T7 正文太少（<200字无代码）→ uncertain, keep", () => {
  const r = classifyFile("lessons/some-short-file.md", "# Title\n\nShort.", { siblingPaths: [] });
  assert.strictEqual(r.role, "uncertain");
  assert.strictEqual(r.confidence, "low");
  assert.strictEqual(r.keepAsLesson, true);
});

test("T7b 正文少但有代码块 → 走 fallback (uncertain)", () => {
  const r = classifyFile("lessons/code-snippet.md", "# Title\n\n```python\nprint('hi')\n```", { siblingPaths: [] });
  assert.strictEqual(r.role, "uncertain"); // 有代码块不走规则7，走 fallback
  assert.strictEqual(r.keepAsLesson, true);
});

// ============================================================
// fallback: 不确定
// ============================================================
test("T8 正常 lesson README → uncertain (交给 LLM), keep", () => {
  const r = classifyFile("lessons/3-NeuralNetworks/03-Perceptron/README.md", RICH_MD, { siblingPaths: AIB_SIBLINGS });
  assert.strictEqual(r.role, "uncertain");
  assert.strictEqual(r.confidence, "low");
  assert.strictEqual(r.keepAsLesson, true);
});

// ============================================================
// 优先级测试（规则顺序）
// ============================================================
test("T9 translations/ 优先于 .ipynb（翻译 notebook）", () => {
  const r = classifyFile("translations/fr/lesson.ipynb", RICH_MD, { siblingPaths: [] });
  assert.strictEqual(r.role, "translation"); // 翻译规则先命中
});

test("T10 /lab/ 优先于 section-intro（lab README 也是 lab）", () => {
  const siblings = [
    "lessons/3-NN/03-Perceptron/lab/README.md",
    "lessons/3-NN/03-Perceptron/README.md",
    "lessons/3-NN/README.md",
  ];
  const r = classifyFile("lessons/3-NN/03-Perceptron/lab/README.md", RICH_MD, { siblingPaths: siblings });
  assert.strictEqual(r.role, "lab"); // lab 规则先于 section-intro
});

// ============================================================
// 批量分类
// ============================================================
test("T11 classifyFiles 批量分类 + siblingPaths 自动填充", () => {
  const files = [
    { path: "lessons/3-NN/README.md", md: RICH_MD },
    { path: "lessons/3-NN/03-Perceptron/README.md", md: RICH_MD },
    { path: "translations/zh/README.md", md: RICH_MD },
    { path: "LICENSE", md: "MIT" },
  ];
  const results = classifyFiles(files);
  assert.strictEqual(results.length, 4);
  // translations/ → skip
  assert.strictEqual(results[2].classification.role, "translation");
  assert.strictEqual(results[2].classification.keepAsLesson, false);
  // LICENSE → meta
  assert.strictEqual(results[3].classification.role, "meta");
  // 每个结果都有 classification
  for (const r of results) {
    assert.ok(r.classification);
    assert.ok(typeof r.classification.reason === "string");
  }
});

// ============================================================
// 统计
// ============================================================
test("T12 summarizeClassifications 统计正确", () => {
  const classifs = [
    { role: "lesson", confidence: "high", reason: "", keepAsLesson: true },
    { role: "uncertain", confidence: "low", reason: "", keepAsLesson: true },
    { role: "uncertain", confidence: "low", reason: "", keepAsLesson: true },
    { role: "lab", confidence: "high", reason: "", keepAsLesson: false },
    { role: "translation", confidence: "high", reason: "", keepAsLesson: false },
  ];
  const s = summarizeClassifications(classifs);
  assert.strictEqual(s.keepCount, 3);
  assert.strictEqual(s.skipCount, 2);
  assert.strictEqual(s.uncertainCount, 2);
  assert.strictEqual(s.byRole["uncertain"], 2);
  assert.strictEqual(s.byRole["lab"], 1);
});

// ============================================================
// 对抗性测试
// ============================================================
test("T13 空路径不崩", () => {
  const r = classifyFile("", "", { siblingPaths: [] });
  assert.ok(r); // 不崩即可
});

test("T14 极长路径不崩", () => {
  const longPath = "a/".repeat(100) + "README.md";
  const r = classifyFile(longPath, RICH_MD, { siblingPaths: [] });
  assert.ok(r);
});

test("T15 特殊字符路径不崩", () => {
  const r = classifyFile("lessons/课程 (1)/测试.md", RICH_MD, { siblingPaths: [] });
  assert.ok(r);
  assert.strictEqual(r.role, "uncertain"); // 无规则命中 → fallback
});

// ============================================================
console.log(`\n=== 课时文件分类器: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
