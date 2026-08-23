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

/* ─────────────────────────────────────────────────────────────────────────────
 * 章内二次拆分与噪声清理(2026-08-23,8 本 Gutenberg 真书采样驱动;真书语料
 * 核查在 scripts/live-test/live-test-epub-corpus.mjs,需网络。这里用合成
 * fixture 锁拆分器核心行为,CI 无网络可跑):
 *   采样事实:spine 文件≠章是常态(P&P 15 文件装 61 章),章号常是裸文本行
 *   (原书 html 里章号不是标题标签),license 是尾块或整文件。
 * ───────────────────────────────────────────────────────────────────────────── */
import { splitChaptersInBody, sanitizeEpubBody } from "../src/main/lib/epub-parser.ts";

await test("T5 裸行章标记:单文件多章(P&P 型)按标记切,标题=标记行", async () => {
  const body = [
    "卷头的引语段落,一点点铺垫文字。",
    "",
    "CHAPTER I.",
    "",
    "第一章的内容,足够长。第一章的内容,足够长。第一章的内容,足够长。",
    "",
    "CHAPTER II.",
    "",
    "第二章的内容,不同的文字。第二章的内容,不同的文字。第二章的内容,不同的文字。",
    "",
    "CHAPTER III.",
    "",
    "第三章的内容,又是新的一段。第三章的内容,又是新的一段。第三章的内容,又是新的一段。",
  ].join("\n");
  const r = splitChaptersInBody(body);
  assert.ok(r, "应触发拆分");
  assert.equal(r.length, 3);
  assert.equal(r[0].title, "CHAPTER I.");
  assert.ok(r[1].content.includes("第二章的内容"), "章内容归属正确");
  assert.ok(!r[1].content.includes("第一章的内容"), "不串章");
});

await test("T6 heading 章标记(Moby 型)同样可切", async () => {
  const body = "## CHAPTER 1. Loomings.\n\n开篇内容。\n\n## CHAPTER 2. The Carpet-Bag.\n\n行李章内容。";
  const r = splitChaptersInBody(body);
  assert.equal(r.length, 2);
  assert.equal(r[1].title, "CHAPTER 2. The Carpet-Bag.");
});

await test("T7 罗马数字:须连续递增序列(≥3)才切,孤立数字不切", async () => {
  const roman = "## I\n\n第一段。\n\n## II\n\n第二段。\n\n## III\n\n第三段。";
  const r = splitChaptersInBody(roman);
  assert.equal(r.length, 3, "heading 罗马序列应切");
  const isolated = "正文里出现 2 这个数字,还有 5,都不是章。";
  assert.equal(splitChaptersInBody(isolated), null, "孤立数字不切");
  const two = "## I\n\n短。\n\n## II\n\n也短。"; // 罗马只有 2 个,不够 3
  assert.equal(splitChaptersInBody(two), null, "罗马序列 <3 不切");
});

await test("T8 单章标记不切(一章一文件常态),minHighConf=1 时可切(license 救章)", async () => {
  const body = "尾章引言段。\n\nCHAPTER LXI.\n\n最后一章的正文,足够长。最后一章的正文,足够长。";
  assert.equal(splitChaptersInBody(body), null, "默认单标记不切");
  const r = splitChaptersInBody(body, { minHighConf: 1 });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "CHAPTER LXI.");
  assert.ok(r[0].content.includes("尾章引言段"), "前置短引言并入");
});

await test("T9 sanitize:license 尾截断 + PG 头段删除 + 装饰行清理 + 空标题行", async () => {
  const body = [
    "## The Project Gutenberg eBook of X",
    "This eBook is for the use of anyone anywhere in the United States and most other parts of the world.",
    "",
    "## 正文标题",
    "",
    "“对话引语” \\[_Copyright 1894 by George Allen._\\]",
    "",
    "正文内容。",
    "",
    "##   ",
    "",
    "THE FULL PROJECT GUTENBERG™ LICENSE",
    "",
    "License 的长篇正文……",
  ].join("\n");
  const out = sanitizeEpubBody(body);
  assert.ok(!out.includes("FULL PROJECT GUTENBERG"), "license 尾截断");
  assert.ok(!out.includes("This eBook is for the use"), "PG 头段删除");
  assert.ok(!out.includes("Copyright 1894"), "装饰片段清理");
  assert.ok(!/^##\s*$/m.test(out), "空标题行清理");
  assert.ok(out.includes("正文内容。"), "正文保留");
});

await test("T10 端到端:多章一文件 epub 拆出对齐的真章(裸行标记+歪 toc)", async () => {
  // 一个 spine 文件装 3 章(裸行标记),toc 标签是末章(歪)
  const multi = xhtml("CHAPTER III.", "<p>每章前的引语。</p><p>CHAPTER I.</p><p>第一章正文。</p><p>CHAPTER II.</p><p>第二章正文。</p><p>CHAPTER III.</p><p>第三章正文。</p>");
  const containerXml = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="b.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>多章一书</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`;
  const epub = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "b.opf": strToU8(opf),
    "c1.xhtml": strToU8(multi),
    "nav.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="c1.xhtml">CHAPTER III.</a></li></ol></nav></body></html>`),
  });
  const book = await parseEpub(epub);
  const titles = book.chapters.map((c) => c.title);
  assert.equal(book.chapters.length, 3, `应拆 3 章,实际 ${book.chapters.length}(${titles.join(",")})`);
  assert.equal(titles[0], "CHAPTER I.", "首章标题=首个标记(不是 toc 的末章标签)");
  assert.ok(book.chapters[0].markdown.startsWith("# CHAPTER I."), "H1 对齐");
  assert.ok(book.chapters[1].markdown.includes("第二章正文"), "内容归属正确");
});

// ── 出版社形态三修(2026-08-23,沉思录真书驱动) ──
/** 出版社式 epub:多 spine 文件(版权页/目录页/卷扉页/无标题正文页)。 */
function buildPublisherEpub(files) {
  const containerXml = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="b.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const items = files.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const refs = files.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>出版社书</dc:title></metadata><manifest>${items}</manifest><spine>${refs}</spine></package>`;
  const zip = { mimetype: strToU8("application/epub+zip"), "META-INF/container.xml": strToU8(containerXml), "b.opf": strToU8(opf) };
  files.forEach(([title, body], i) => { zip[`c${i}.xhtml`] = strToU8(xhtml(title, body)); });
  return zipSync(zip);
}

await test("T11 标题兜底不编造:无 toc 无 H1 的文件 → 未命名章节(不是'第 N 章')", async () => {
  const epub = buildPublisherEpub([["", "<p>一段没有标题的正文内容,足够长以通过最小过滤。</p><p>第二段内容继续补充。</p>"]]);
  const book = await parseEpub(epub);
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].title, "未命名章节", `兜底应诚实未命名,实际 ${book.chapters[0].title}`);
});

await test("T12 扉页配对:短扉页(有标题) + 紧随的无标题正文页 → 合并成一章", async () => {
  const epub = buildPublisherEpub([
    ["第一卷", "<p>一句卷首格言,非常短。</p>"],
    ["", "<p>第一卷的真正正文,这里写满足够长的内容让它成为显著的一章。</p><p>再一段正文内容。</p>"],
    ["第二卷", "<p>第二卷的卷首格言,同样简短。</p>"],
    ["", "<p>第二卷正文内容,同样足够长以构成独立一章。</p>"],
  ]);
  const book = await parseEpub(epub);
  const titles = book.chapters.map((c) => c.title);
  assert.equal(book.chapters.length, 2, `扉页应并入后章,实际 ${book.chapters.length} 章(${titles.join(",")})`);
  assert.equal(titles[0], "第一卷", "标题取扉页");
  assert.ok(book.chapters[0].markdown.includes("一句卷首格言"), "扉页格言并入正文");
  assert.ok(book.chapters[0].markdown.includes("第一卷的真正正文"), "正文页内容并入");
  assert.ok(!book.chapters[0].markdown.includes("第二卷正文内容"), "不许连锁吞并下一卷正文");
  assert.equal(titles[1], "第二卷");
});

await test("T13 不误合并:后一章自己有标题 → 短章保持独立(配对条件=下一章未命名)", async () => {
  const epub = buildPublisherEpub([
    ["献词", "<p>给某人的短短献词。</p>"],
    ["第一章 起点", "<p>正文内容,标题来自首行 H1。</p><p>继续正文。</p>"],
  ]);
  const book = await parseEpub(epub);
  assert.equal(book.chapters.length, 2, "两章都应独立(后章有标题不合并)");
  assert.equal(book.chapters[0].title, "献词");
});

await test("T14 版权页不成课:著录字段密度(书名:/作者:/出版社:)是版权页机器指纹", async () => {
  const epub = buildPublisherEpub([
    ["版权信息", "<p>书名：沉思录</p><p>作者：马可·奥勒留</p><p>编者：衷雅琴</p><p>出版社：上海译文出版社</p><p>关注微博与公众号的推广文字若干。</p>"],
    ["", "<p>书名：无名书</p><p>译者：某人</p><p>ISBN：978-7-5327-0000-0</p><p>版次：2026 年 1 月第 1 版。</p><p>无标题的版权页,只靠著录字段密度识别。</p>"],
    ["第一卷", "<p>正文第一章内容,足够长。</p><p>继续正文。</p>"],
  ]);
  const book = await parseEpub(epub);
  const titles = book.chapters.map((c) => c.title);
  assert.ok(!titles.includes("版权信息"), `标题点名的版权页应过滤,实际 ${titles.join(",")}`);
  assert.ok(book.chapters.length === 1, `无标题版权页也应被字段密度过滤(只留正文),实际 ${titles.join(",")}`);
});

await test("T15 链接目录页不成课:标题'目录'且六成行是链接 → 过滤", async () => {
  const epub = buildPublisherEpub([
    ["目 录", `<p><a href="c1.xhtml">第一卷</a></p><p><a href="c1.xhtml">第二卷</a></p><p><a href="c1.xhtml">第三卷</a></p><p><a href="c1.xhtml">第四卷</a></p>`],
    ["第一卷", "<p>正文内容开始,足够长不被当封面。</p><p>第二段内容。</p>"],
  ]);
  const book = await parseEpub(epub);
  const titles = book.chapters.map((c) => c.title);
  assert.ok(!titles.some((t) => /^目\s*录$/.test(t)), `链接目录页应过滤,实际 ${titles.join(",")}`);
  assert.equal(book.chapters.length, 1);
});

console.log(`\n${passed} passed`);
