/**
 * Jupyter Notebook 解析器验证 —— 测 notebook-parser.ts 的纯函数。
 *
 * 不变量:
 *   - parseNotebook: markdown cell → 原文;code cell → ```lang``` 代码块
 *   - extractOutputImages: 从 code output 的 data["image/png"] 提取 base64
 *   - inferLanguage: 从 kernelspec/language_info 推断代码语言
 *   - normalizeSource: string[] → string 拼接
 *   - 无效 JSON 抛错
 */
import assert from "node:assert";
import {
  parseNotebook,
  extractOutputImages,
  inferLanguage,
  normalizeSource,
} from "../src/main/services/pure/notebook-parser.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// === T1: normalizeSource — string[] → string ===
test("T1 normalizeSource: 数组拼接", () => {
  assert.strictEqual(normalizeSource(["hello", " world"]), "hello world");
  assert.strictEqual(normalizeSource(["line1\n", "line2\n", "line3"]), "line1\nline2\nline3");
});

// === T2: normalizeSource — string 直接返回 ===
test("T2 normalizeSource: 字符串原样返回", () => {
  assert.strictEqual(normalizeSource("hello"), "hello");
  assert.strictEqual(normalizeSource(""), "");
});

// === T3: normalizeSource — null/undefined/number 防护 ===
test("T3 normalizeSource: 非法类型返回空串", () => {
  assert.strictEqual(normalizeSource(null), "");
  assert.strictEqual(normalizeSource(undefined), "");
  assert.strictEqual(normalizeSource(123), "");
  assert.strictEqual(normalizeSource({}), "");
});

// === T4: inferLanguage — kernelspec.language 优先 ===
test("T4 inferLanguage: kernelspec.language 优先", () => {
  assert.strictEqual(
    inferLanguage({ kernelspec: { language: "Python", name: "python3" } }),
    "python",
  );
  assert.strictEqual(
    inferLanguage({ kernelspec: { language: "R", name: "ir" } }),
    "r",
  );
});

// === T5: inferLanguage — language_info.name ===
test("T5 inferLanguage: language_info.name", () => {
  assert.strictEqual(inferLanguage({ language_info: { name: "julia" } }), "julia");
  assert.strictEqual(inferLanguage({ language_info: { name: "Python" } }), "python");
});

// === T6: inferLanguage — 从 name 推断 ===
test("T6 inferLanguage: kernelspec.name 推断", () => {
  assert.strictEqual(inferLanguage({ kernelspec: { name: "python3" } }), "python");
  assert.strictEqual(inferLanguage({ kernelspec: { name: "ir" } }), "r");
  assert.strictEqual(inferLanguage({ kernelspec: { name: "julia-1.8" } }), "julia");
});

// === T7: inferLanguage — 默认 python ===
test("T7 inferLanguage: 无信息时默认 python", () => {
  assert.strictEqual(inferLanguage({}), "python");
  assert.strictEqual(inferLanguage({ kernelspec: {} }), "python");
});

// === T8: extractOutputImages — 提取 image/png ===
test("T8 extractOutputImages: 提取 image/png base64", () => {
  const outputs = [
    {
      output_type: "execute_result",
      data: {
        "image/png": "iVBORw0KGgo=",
        "text/plain": "<Figure>",
      },
    },
  ];
  const images = extractOutputImages(outputs, 5);
  assert.strictEqual(images.length, 1);
  assert.strictEqual(images[0].base64, "iVBORw0KGgo=");
  assert.strictEqual(images[0].mimeType, "image/png");
  assert.strictEqual(images[0].source, "notebook_output");
  assert.strictEqual(images[0].cellIndex, 5);
});

// === T9: extractOutputImages — image/jpeg 也提取 ===
test("T9 extractOutputImages: 提取 image/jpeg", () => {
  const outputs = [{ data: { "image/jpeg": "/9j/4AAQ=" } }];
  const images = extractOutputImages(outputs, 3);
  assert.strictEqual(images.length, 1);
  assert.strictEqual(images[0].mimeType, "image/jpeg");
  assert.strictEqual(images[0].base64, "/9j/4AAQ=");
});

// === T10: extractOutputImages — 无图返回空 ===
test("T10 extractOutputImages: 无图/无 data 返回空", () => {
  assert.strictEqual(extractOutputImages([], 0).length, 0);
  assert.strictEqual(extractOutputImages(undefined, 0).length, 0);
  assert.strictEqual(extractOutputImages([{ data: { "text/plain": "text" } }], 0).length, 0);
  assert.strictEqual(extractOutputImages([{ output_type: "stream", text: "hello" }], 0).length, 0);
});

// === T11: parseNotebook — markdown + code cell 转换 ===
test("T11 parseNotebook: 基本转换", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: "## Title\n\nHello" },
      { cell_type: "code", source: "print('hi')" },
    ],
    metadata: { kernelspec: { name: "python3", language: "Python" } },
  });
  const result = parseNotebook(nb);
  assert.ok(result.markdown.includes("## Title"));
  assert.ok(result.markdown.includes("```python\nprint('hi')\n```"));
  assert.strictEqual(result.stats.markdownCells, 1);
  assert.strictEqual(result.stats.codeCells, 1);
  assert.strictEqual(result.stats.totalCells, 2);
  assert.strictEqual(result.language, "python");
});

// === T12: parseNotebook — source 是数组也正确处理 ===
test("T12 parseNotebook: source 数组拼接", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["line1\n", "line2"] },
      { cell_type: "code", source: ["import os\n", "print(os.getcwd())"] },
    ],
    metadata: {},
  });
  const result = parseNotebook(nb);
  assert.ok(result.markdown.includes("line1\nline2"));
  assert.ok(result.markdown.includes("import os\nprint(os.getcwd())"));
});

// === T13: parseNotebook — code output 图片提取 ===
test("T13 parseNotebook: code output 图片提取", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "code", source: "plt.plot()", outputs: [
        { data: { "image/png": "iVBOR=" } },
      ] },
    ],
    metadata: {},
  });
  const result = parseNotebook(nb);
  assert.strictEqual(result.images.length, 1);
  assert.strictEqual(result.images[0].base64, "iVBOR=");
});

// === T14: parseNotebook — 无效 JSON 抛错 ===
test("T14 parseNotebook: 无效 JSON 抛错", () => {
  assert.throws(() => parseNotebook("not json"), /无效的 JSON/);
  assert.throws(() => parseNotebook(""), /无效的 JSON/);
});

// === T15: parseNotebook — 空 cells 返回空 ===
test("T15 parseNotebook: 空 cells", () => {
  const result = parseNotebook('{"cells":[],"metadata":{}}');
  assert.strictEqual(result.markdown, "");
  assert.strictEqual(result.images.length, 0);
  assert.strictEqual(result.stats.totalCells, 0);
});

// === T16: parseNotebook — raw cell 跳过 ===
test("T16 parseNotebook: raw cell 跳过", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: "text" },
      { cell_type: "raw", source: "raw content" },
      { cell_type: "code", source: "x=1" },
    ],
    metadata: {},
  });
  const result = parseNotebook(nb);
  assert.strictEqual(result.stats.totalCells, 3);
  assert.strictEqual(result.stats.markdownCells, 1);
  assert.strictEqual(result.stats.codeCells, 1);
  // raw cell 内容不出现在 markdown 里
  assert.ok(!result.markdown.includes("raw content"));
});

// === T17: parseNotebook — 多个 output 图片全提取 ===
test("T17 parseNotebook: 多个 output 图片全提取", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "code", source: "c1", outputs: [{ data: { "image/png": "img1" } }] },
      { cell_type: "code", source: "c2", outputs: [
        { data: { "image/png": "img2" } },
        { data: { "image/png": "img3" } },
      ] },
    ],
    metadata: {},
  });
  const result = parseNotebook(nb);
  assert.strictEqual(result.images.length, 3);
});

// 运行
let passed = 0;
let failed = 0;
for (const { name, fn } of TESTS) {
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
console.log(`\n=== Notebook 解析器: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
