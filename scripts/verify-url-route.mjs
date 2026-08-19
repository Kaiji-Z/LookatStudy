/**
 * 智能 URL 路由验证 —— routeImportUrl 三分流(github/arxiv/article)+ 身份归一。
 * 纯函数直测。跑法: npx tsx scripts/verify-url-route.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { routeImportUrl, normalizeUrlIdentity } from "../src/main/services/pure/url-route.ts";
import { extractArxivTitle } from "../src/main/services/url-import-service.ts";

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

test("T1 github 链接 → github 路由(含 .git 后缀/子路径)", () => {
  assert.deepEqual(routeImportUrl("https://github.com/microsoft/AI-For-Beginners"), { kind: "github", url: "https://github.com/microsoft/AI-For-Beginners" });
  assert.equal(routeImportUrl("https://github.com/o/r/tree/main/docs")?.kind, "github");
  assert.equal(routeImportUrl("github.com/o/r")?.kind, "github", "无协议前缀也认");
});

test("T2 arXiv 链接 → arxiv 路由(abs/pdf/export/带版本/旧式 ID)", () => {
  const r1 = routeImportUrl("https://arxiv.org/abs/2401.12345");
  assert.equal(r1?.kind, "url");
  assert.equal(r1.flavor, "arxiv");
  assert.equal(r1.arxivId, "2401.12345");
  assert.equal(r1.pdfUrl, "https://export.arxiv.org/pdf/2401.12345");
  const r2 = routeImportUrl("https://arxiv.org/pdf/2401.12345v2");
  assert.equal(r2?.flavor, "arxiv");
  assert.equal(r2.arxivId, "2401.12345v2");
  const r3 = routeImportUrl("https://export.arxiv.org/abs/cs.CL/2401001");
  assert.equal(r3?.flavor, "arxiv");
  assert.equal(r3.arxivId, "cs.CL/2401001", "旧式 ID(archive/7位数字)");
});

test("T3 其余 http(s) → article 路由", () => {
  const r = routeImportUrl("https://example.com/blog/some-post?utm=1");
  assert.equal(r?.kind, "url");
  assert.equal(r.flavor, "article");
  assert.equal(r.url, "https://example.com/blog/some-post?utm=1");
  // 无协议前缀自动补 https
  assert.equal(routeImportUrl("example.com/post")?.flavor, "article");
});

test("T4 arXiv 非论文页(列表页)降级为 article", () => {
  assert.equal(routeImportUrl("https://arxiv.org/list/cs.CL/recent")?.flavor, "article");
});

test("T5 非法输入 → null", () => {
  assert.equal(routeImportUrl(""), null);
  assert.equal(routeImportUrl("   "), null);
  assert.equal(routeImportUrl("not a url"), null);
  assert.equal(routeImportUrl("ftp://example.com/x"), null);
});

test("T6 身份归一:去 hash/去尾斜杠,保留 query", () => {
  assert.equal(normalizeUrlIdentity("https://a.com/x/#section"), "https://a.com/x");
  assert.equal(normalizeUrlIdentity("https://a.com/x/"), "https://a.com/x");
  assert.equal(normalizeUrlIdentity("https://a.com/x?p=1"), "https://a.com/x?p=1");
});

test("T7 arXiv 标题抽取:meta 优先/<title> 剥 [id]/实体解码/退化形状(真实事故回归)", () => {
  // 真实 abs 页形状:citation_title meta + <title> 带 [id] 前缀
  const real = `<html><head><meta name="citation_title" content="Attention Is All You Need" />
<title>[1706.03762] Attention Is All You Need</title></head><body></body></html>`;
  assert.equal(extractArxivTitle(real), "Attention Is All You Need", "citation_title 优先");
  // 事故回归:旧贪婪正则在这形状下把标题抓成最后一个字符("d"/"k")
  const titleOnly = `<title>[1706.03762] Attention Is All You Need</title>`;
  assert.equal(extractArxivTitle(titleOnly), "Attention Is All You Need", "<title> 剥 [id] 前缀");
  // 镜像/降级形状:标题只剩 arXiv 字样 → null(调用方用 ID 当标题)
  assert.equal(extractArxivTitle(`<title>arXiv: 1706.03762</title>`), null);
  assert.equal(extractArxivTitle(`<html></html>`), null);
  // 实体解码 + 多空格折叠
  assert.equal(extractArxivTitle(`<meta name="citation_title" content="A &amp; B &lt;C&gt;  D" />`), "A & B <C> D");
});

console.log(`\n${passed} passed`);
