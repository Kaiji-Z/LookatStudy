/**
 * 网页文章正文抽取验证 —— linkedom + readability + turndown 全链纯函数测试。
 * 覆盖:导航噪声剥离 / 标题保留与补回 / 图片地址绝对化 / 非文章页诚实失败 /
 * epub 共用的 htmlToMarkdown(标题+代码块+图片剥除)。
 * 跑法: npx tsx scripts/verify-html-article.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { extractArticle, htmlToMarkdown, stripTailNavigation } from "../src/main/services/pure/html-article.ts";

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

/** 一篇"像样"的中文文章:有 nav/footer 噪声、正文多段、h2 小节、相对路径图。 */
const ARTICLE_HTML = `<!doctype html>
<html><head><title>深度学习入门指南 - 某某博客</title></head>
<body>
<nav><a href="/">首页</a> <a href="/about">关于</a> <a href="/tags">标签</a></nav>
<article>
  <h1>深度学习入门指南</h1>
  <p>深度学习是机器学习的一个分支,通过多层神经网络自动学习数据的表示。过去十年里,它彻底改变了计算机视觉、自然语言处理和语音识别的格局。理解深度学习,需要从最基础的概念开始。</p>
  <p>神经网络的本质是一连串的线性变换与非线性激活。每一层把上一层的输出作为输入,经过权重矩阵相乘,再通过激活函数引入非线性。层层叠加之后,网络便能拟合极其复杂的函数关系。</p>
  <h2>为什么需要激活函数</h2>
  <p>如果没有非线性激活,多层网络会退化成一个线性模型,表达能力与单层无异。ReLU 因计算简单、缓解梯度消失而被广泛使用。</p>
  <img src="/images/relu.png" alt="ReLU 曲线">
  <h2>训练是怎么回事</h2>
  <p>训练就是不断调整权重让损失变小。反向传播算法高效地计算梯度,优化器沿负梯度方向更新参数,循环往复直到收敛。</p>
  <pre><code>loss = cross_entropy(model(x), y)
loss.backward()</code></pre>
</article>
<footer>© 2026 某某博客 | 备案号 xxx</footer>
</body></html>`;

test("T1 正文抽取:导航/页脚噪声剥离,标题与小节保留", () => {
  const r = extractArticle(ARTICLE_HTML, "https://blog.example.com/posts/dl-guide");
  assert.ok(r, "应抽取成功");
  // readability 的 title 保留 document.title 原文(含站点名后缀),诚实不裁剪
  assert.equal(r.title, "深度学习入门指南 - 某某博客");
  assert.ok(r.markdown.startsWith("# 深度学习入门指南 - 某某博客"), `应以 H1 标题开头,实际: ${r.markdown.slice(0, 40)}`);
  assert.ok(r.markdown.includes("## 为什么需要激活函数"), "h2 保留为 ## ");
  assert.ok(r.markdown.includes("反向传播"), "正文保留");
  assert.ok(!/首页|备案号/.test(r.markdown), "导航/页脚噪声不进正文");
  assert.ok(r.markdown.includes("```"), "代码块保留");
});

test("T2 图片相对地址绝对化(基于 baseUrl)", () => {
  const r = extractArticle(ARTICLE_HTML, "https://blog.example.com/posts/dl-guide");
  assert.ok(r.markdown.includes("https://blog.example.com/images/relu.png"), `相对图应绝对化,实际片段: ${(r.markdown.match(/!\[[^\]]*\]\([^)]*\)/) ?? ["(无图)"])[0]}`);
});

test("T3 非文章页(空壳)→ null 诚实失败", () => {
  const r = extractArticle("<html><body><div></div></body></html>", "https://x.com");
  assert.equal(r, null);
});

test("T4 htmlToMarkdown(epub 章节用):标题保留 + 代码块 + 图片剥除", () => {
  const md = htmlToMarkdown(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch</title><style>p{}</style></head>
<body><h1>第一章</h1><p>本章讲解基础概念,内容充实足以被识别为正文。</p><h2>1.1 背景</h2><p>背景说明文字。</p>
<img src="ch1.png" alt="图"/><pre><code>x = 1</code></pre></body></html>`, { stripImages: true });
  assert.ok(md.startsWith("# 第一章"), `H1 保留: ${md.slice(0, 20)}`);
  assert.ok(md.includes("## 1.1 背景"), "h2 保留");
  assert.ok(!/!\[|<img/.test(md), "图片剥除");
  assert.ok(md.includes("`x = 1`") || md.includes("```"), "代码保留");
  assert.ok(!md.includes("p{}"), "style 剥除");
});

test("T5 htmlToMarkdown 默认不剥图片(epub 之外的通用转换)", () => {
  const md = htmlToMarkdown(`<body><p>一段正文。</p><img src="https://a.com/i.png" alt="图"></body>`);
  assert.ok(md.includes("![图](https://a.com/i.png)"), "图片保留为 markdown 语法");
});

test("T6 尾部站点模板指纹清理(搜狐返回行/阿里云侧栏三行)", () => {
  const md1 = ["# 标题", "", "正文第一段。", "", "[返回搜狐,查看更多](//www.sohu.com)"].join("\n");
  assert.ok(!stripTailNavigation(md1).includes("返回搜狐"), "搜狐模板行应删");
  const md2 = ["# 标题", "", "正文。", "", "目录", "", "热门文章", "", "最新文章"].join("\n");
  const out2 = stripTailNavigation(md2);
  assert.ok(!out2.endsWith("最新文章"), "阿里云侧栏三行应删");
  assert.ok(out2.includes("正文。"), "正文保留");
});

test("T7 行内模板后缀剥离(正文与模板同行)", () => {
  const md3 = "正文最后一句。 目录 热门文章 最新文章";
  assert.equal(stripTailNavigation(md3), "正文最后一句。", "行内精确短语剥掉,正文保留");
});

test("T8 裸图路径行清理(CSDN 尾形态)", () => {
  const md4 = ["# 标题", "", "正文。", "", "https://img-blog.csdnimg.cn/x.jpeg)"].join("\n");
  assert.ok(!stripTailNavigation(md4).includes("csdnimg"), "裸图路径行应删");
});

test("T9 模板带 markdown 前缀(## / > 形态)也识别", () => {
  const md5 = ["# 标题", "", "正文。", "", "## END 本文版权所有"].join("\n");
  assert.ok(!stripTailNavigation(md5).includes("END"), "## 前缀模板行应删");
});

test("T10 原则守卫:作者推广尾段是正文,规则层不删(语义边界交 Step4 LLM)", () => {
  const md6 = ["# 标题", "", "正文。", "", "## 欢迎关注我的微信公众号!!!会不断分享统计学、机器学习知识"].join("\n");
  const out6 = stripTailNavigation(md6);
  assert.ok(out6.includes("欢迎关注我的微信公众号"), "作者推广段必须保留(规则只管机器模板,不猜语义)");
});

test("T11 正文文字+图片链接行不受影响", () => {
  const md7 = ["# 标题", "", "详见[文档](https://a.com/doc.png)。"].join("\n");
  assert.ok(stripTailNavigation(md7).includes("](https://a.com/doc.png)"), "文字+图扩展链接行保留");
});

console.log(`\n${passed} passed`);
