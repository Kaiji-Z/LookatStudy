/** AsciiDoc 解析器验证 */
import assert from "node:assert";
import { parseAdoc } from "../src/main/services/pure/adoc-parser.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

test("T1 标题: = Title → # Title", () => {
  const adoc = "= Document Title\n\n== Section\n\n=== Subsection";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("# Document Title"), `应含 # Document Title`);
  assert.ok(md.includes("## Section"), "应含 ## Section");
  assert.ok(md.includes("### Subsection"), "应含 ### Subsection");
});

test("T2 [source,python] + ---- → ```python", () => {
  const adoc = "[source,python]\n----\nprint('hi')\n----";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("```python"), "含 ```python");
  assert.ok(md.includes("print('hi')"), "代码保留");
});

test("T3 image::path[alt] → ![alt](path)", () => {
  const adoc = "image::diagram.png[Architecture Diagram]";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("![Architecture Diagram](diagram.png)"), `应含 ![alt](path),实际: ${md}`);
});

test("T4 image::path[] 无 alt → ![](path)", () => {
  const adoc = "image::photo.png[]";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("![](photo.png)"), `应含 ![](photo.png),实际: ${md}`);
});

test("T5 link:url[text] → [text](url)", () => {
  const adoc = "See link:https://example.com[Example] for details.";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("[Example](https://example.com)"), `应含 [text](url),实际: ${md}`);
});

test("T6 *bold* → **bold**", () => {
  const adoc = "This is *important* word.";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("**important**"), `应含 **important**,实际: ${md}`);
});

test("T7 _italic_ → *italic*", () => {
  const adoc = "This is _emphasized_ word.";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("*emphasized*"), `应含 *emphasized*,实际: ${md}`);
});

test("T8 纯文本保留", () => {
  const adoc = "Plain text line.\nAnother line.";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("Plain text line."));
});

test("T9 列表项保留", () => {
  const adoc = "- Item 1\n- Item 2";
  const md = parseAdoc(adoc).markdown;
  assert.ok(md.includes("- Item 1"));
  assert.ok(md.includes("- Item 2"));
});

test("T10 空文件不崩", () => {
  assert.ok(parseAdoc("").markdown !== undefined);
});

let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
}
console.log(`\n=== AsciiDoc 解析器: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
