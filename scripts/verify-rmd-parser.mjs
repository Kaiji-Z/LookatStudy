/** R Markdown 解析器验证 */
import assert from "node:assert";
import { parseRmd } from "../src/main/services/pure/rmd-parser.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

test("T1 剥 YAML front matter", () => {
  const rmd = "---\ntitle: \"My Report\"\nauthor: \"Test\"\n---\n\n# Introduction\n\nText.";
  const md = parseRmd(rmd).markdown;
  assert.ok(!md.includes('title:'), "YAML 被剥");
  assert.ok(md.includes("# Introduction"), "正文保留");
});

test("T2 ```{r} → ```r", () => {
  const rmd = "```{r}\nx <- 1\n```";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("```r"), "```{r} → ```r");
  assert.ok(md.includes("x <- 1"), "代码保留");
});

test("T3 ```{r chunk-name, echo=FALSE} → ```r(剥参数)", () => {
  const rmd = "```{r my-chunk, echo=FALSE, fig.width=6}\nplot(1:10)\n```";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("```r\n"), "含 ```r\\n(无 chunk 名/参数)");
  assert.ok(!md.includes("echo=FALSE"), "参数被剥");
  assert.ok(md.includes("plot(1:10)"), "代码保留");
});

test("T4 ```{python} → ```python", () => {
  const rmd = "```{python}\nimport pandas\n```";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("```python"), "```{python} → ```python");
});

test("T5 正文 markdown 原样保留", () => {
  const rmd = "# Title\n\nSome **bold** text and `code`.\n\n- Item 1\n- Item 2";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("# Title"));
  assert.ok(md.includes("**bold**"));
  assert.ok(md.includes("`code`"));
  assert.ok(md.includes("- Item 1"));
});

test("T6 无 front matter 不崩", () => {
  const rmd = "# Title\n\nText";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("# Title"));
});

test("T7 空文件不崩", () => {
  assert.ok(parseRmd("").markdown !== undefined);
});

test("T8 多个代码块都归一化", () => {
  const rmd = "```{r}\na<-1\n```\n\nText\n\n```{python}\nb=2\n```";
  const md = parseRmd(rmd).markdown;
  assert.ok(md.includes("```r"), "第一个块 → ```r");
  assert.ok(md.includes("```python"), "第二个块 → ```python");
});

let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
}
console.log(`\n=== RMD 解析器: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
