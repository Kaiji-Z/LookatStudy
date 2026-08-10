/** Org-mode 解析器验证 */
import assert from "node:assert";
import { parseOrg } from "../src/main/services/pure/org-parser.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

test("T1 标题: * Title → # Title", () => {
  const org = "* Main Topic\n** Subtopic\n*** Detail";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("# Main Topic"), `应含 # Main Topic`);
  assert.ok(md.includes("## Subtopic"), "应含 ## Subtopic");
  assert.ok(md.includes("### Detail"), "应含 ### Detail");
});

test("T2 #+BEGIN_SRC python → ```python", () => {
  const org = "#+BEGIN_SRC python\nprint('hi')\n#+END_SRC";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("```python"), "含 ```python");
  assert.ok(md.includes("print('hi')"), "代码保留");
});

test("T3 #+BEGIN_EXAMPLE → ```", () => {
  const org = "#+BEGIN_EXAMPLE\nsome output\n#+END_EXAMPLE";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("```"), "含 ``` 代码块");
  assert.ok(md.includes("some output"), "内容保留");
});

test("T4 [[url][text]] → [text](url)", () => {
  const org = "See [[https://example.com][Example]] for details.";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("[Example](https://example.com)"), `应含 [Example](url),实际: ${md}`);
});

test("T5 [[url]] → [url](url)", () => {
  const org = "Visit [[https://example.com]] now.";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("[https://example.com](https://example.com)"), `单链接格式,实际: ${md}`);
});

test("T6 *bold* → **bold**", () => {
  const org = "This is *important* text.";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("**important**"), `应含 **important**,实际: ${md}`);
});

test("T7 /italic/ → *italic*", () => {
  const org = "This is /emphasized/ word.";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("*emphasized*"), `应含 *emphasized*,实际: ${md}`);
});

test("T8 #+KEYWORD: 元数据行被剥除", () => {
  const org = "#+TITLE: My Document\n#+AUTHOR: Test\n\nReal content";
  const md = parseOrg(org).markdown;
  assert.ok(!md.includes("#+TITLE"), "元数据行被剥");
  assert.ok(md.includes("Real content"), "正文保留");
});

test("T9 列表项保留", () => {
  const org = "- Item 1\n- Item 2\n- Item 3";
  const md = parseOrg(org).markdown;
  assert.ok(md.includes("- Item 1"));
  assert.ok(md.includes("- Item 2"));
});

test("T10 空文件不崩", () => {
  assert.strictEqual(parseOrg("").markdown, "");
});

let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
}
console.log(`\n=== Org 解析器: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
