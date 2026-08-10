/** reStructuredText 解析器验证 */
import assert from "node:assert";
import { parseRst } from "../src/main/services/pure/rst-parser.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

test("T1 标题: ===== 下划线转 #", () => {
  const rst = "Main Title\n==========\n\nContent";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("# Main Title"), `应含 # Main Title,实际: ${md}`);
});

test("T2 标题: 第二个符号自动升级到 ##", () => {
  const rst = "Title 1\n=======\n\nSection A\n---------\n\nText";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("# Title 1"), "第一个符号 → #");
  assert.ok(md.includes("## Section A"), "第二个符号 → ##");
});

test("T3 code-block:: python → ```python", () => {
  const rst = ".. code-block:: python\n\n   print('hello')\n   x = 1";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("```python"), "含 ```python");
  assert.ok(md.includes("print('hello')"), "代码内容保留");
});

test("T4 image:: 指令 → ![]()", () => {
  const rst = ".. image:: diagram.png\n";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("![](diagram.png)"), `应含 ![](diagram.png),实际: ${md}`);
});

test("T5 image:: 带 :alt:", () => {
  const rst = ".. image:: arch.png\n   :alt: 架构图\n";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("![架构图](arch.png)"), `应含 ![架构图](arch.png),实际: ${md}`);
});

test("T6 note:: admonition → > 引用", () => {
  const rst = ".. note::\n\n   This is important.";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("> 📝"), "含 > 📝 注");
  assert.ok(md.includes("This is important."), "注内容保留");
});

test("T7 双反引号 → 单反引号", () => {
  const rst = "Use ``code`` here.";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("`code`"), "双反引号转单");
});

test("T8 空文件不崩", () => {
  assert.strictEqual(parseRst("").markdown, "");
});

test("T9 纯文本原样保留", () => {
  const rst = "This is plain text.\nAnother line.";
  const md = parseRst(rst).markdown;
  assert.ok(md.includes("This is plain text."));
  assert.ok(md.includes("Another line."));
});

test("T10 其他 directive 跳过(contents/toctree)", () => {
  const rst = ".. contents:: Table of Contents\n\n   :depth: 2\n\nReal content";
  const md = parseRst(rst).markdown;
  assert.ok(!md.includes("contents::"), "contents 指令被跳过");
  assert.ok(md.includes("Real content"), "正文保留");
});

let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
}
console.log(`\n=== RST 解析器: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
