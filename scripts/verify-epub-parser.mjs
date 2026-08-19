/**
 * EPUB 解析器验证 —— fflate 现场构造 fixture epub,断言章节顺序/标题来源/
 * flat 压平的 H2 降级。EPUB3(nav.xhtml)与 EPUB2(toc.ncx)两种目录都测。
 * 跑法: npx tsx scripts/verify-epub-parser.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseEpub, parseEpubFlat } from "../src/main/lib/epub-parser.ts";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${body}</body></html>`;

/** 最小合法 epub(EPUB3,带 nav.xhtml 目录) */
function buildEpub3() {
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试电子书</dc:title><dc:language>zh</dc:language>
    <dc:identifier id="bookid">t-1</dc:identifier>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/cover.xhtml": strToU8(xhtml("封面", "<p><img src=" + '"cover.png"' + " alt='封面图'/></p>")),
    "OEBPS/ch1.xhtml": strToU8(xhtml("第一章 引言", "<p>第一章正文,讲基本概念与动机。</p><h2>1.1 背景</h2><p>背景说明。</p>")),
    "OEBPS/text/ch2.xhtml": strToU8(xhtml("第二章 方法", "<p>第二章正文,讲核心方法的实现步骤。</p>")),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章 引言</a></li><li><a href="text/ch2.xhtml#s1">第二章 方法(带锚点)</a></li></ol></nav>
</body></html>`),
  });
}

/** EPUB2:toc.ncx 目录 */
function buildEpub2() {
  const containerXml = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>旧版书</dc:title></metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`;
  const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint><navLabel><text>第一章 标题来自ncx</text></navLabel><content src="c1.xhtml"/></navPoint>
</navMap></ncx>`;
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "content.opf": strToU8(opf),
    "toc.ncx": strToU8(ncx),
    "c1.xhtml": strToU8(xhtml("正文第一行标题", "<p>正文内容足够长,能被识别为有实质内容的章节。</p>")),
  });
}

await test("T1 EPUB3:章节按 spine 顺序,封面页跳过,目录标题优先(带锚点路径)", async () => {
  const book = await parseEpub(buildEpub3());
  assert.equal(book.title, "测试电子书");
  assert.equal(book.chapters.length, 2, `封面(纯图)应跳过,实际 ${book.chapters.length}`);
  assert.equal(book.chapters[0].title, "第一章 引言", "TOC 标题(相对 OPF 目录)");
  assert.equal(book.chapters[1].title, "第二章 方法(带锚点)", "TOC 带锚点 href 也能对上(子目录路径)");
  assert.ok(book.chapters[0].markdown.startsWith("# 第一章 引言"));
  assert.ok(book.chapters[0].markdown.includes("## 1.1 背景"), "章内 h2 保留(Step4 anchor 拆课用)");
  assert.match(book.chapters[0].path, /^chapters\/01-/, `章节路径: ${book.chapters[0].path}`);
});

await test("T2 EPUB2:ncx 目录标题优先于正文 h1", async () => {
  const book = await parseEpub(buildEpub2());
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].title, "第一章 标题来自ncx");
  assert.ok(book.chapters[0].markdown.startsWith("# 第一章 标题来自ncx"), "标题统一为 H1 开头");
});

await test("T3 flat 压平:章标题降 H2,多个 H1 不打架", async () => {
  const md = await parseEpubFlat(buildEpub3());
  assert.ok(!/^# /m.test(md), "flat 模式不应有 H1");
  assert.ok(md.includes("## 第一章 引言"));
  assert.ok(md.includes("## 第二章 方法(带锚点)"));
});

await test("T4 结构异常:非 epub zip → 诚实报错", async () => {
  const notEpub = zipSync({ "a.txt": strToU8("hello") });
  await assert.rejects(() => parseEpub(notEpub), /container\.xml|OPF/);
});

console.log(`\n${passed} passed`);
