/**
 * verify-shiki —— shiki 语法高亮(v0.21)确定性测试。
 *
 * T1 语言归一(别名/大小写/未知/纯文本)
 * T2 双主题输出形状(.shiki 类 / --shiki-light 变量 / 确定性)
 * T3 转义安全(代码里的 <script>/&/</> 必须转义——渲染层 HTML 不经 rehype-sanitize,
 *    这条是 XSS 红线:输入永远只能是文本,转义靠 shiki/我们自己的 escape)
 * T4 未知语言回退 null
 * T5 逐行 token(CodeWalkthrough 用)形状与转义
 * T6 接线守卫(源码级:三出口 + CSS 主题翻转 + sanitize 零改动)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLang, highlightCodeBlock, highlightLines } from "../src/renderer/lib/lazy-shiki.ts";

// ---------------------------------------------------------------- T1 语言归一
{
  assert.equal(normalizeLang("ts"), "typescript", "T1 ts 别名");
  assert.equal(normalizeLang("js"), "javascript", "T1 js 别名");
  assert.equal(normalizeLang("py"), "python", "T1 py 别名");
  assert.equal(normalizeLang("sh"), "shellscript", "T1 sh 别名");
  assert.equal(normalizeLang("yml"), "yaml", "T1 yml 别名");
  assert.equal(normalizeLang("TypeScript"), "typescript", "T1 大小写不敏感");
  assert.equal(normalizeLang(""), null, "T1 空语言");
  assert.equal(normalizeLang("txt"), null, "T1 txt 纯文本");
  assert.equal(normalizeLang("brainfuckxyz"), null, "T1 未知语言");
  console.log("T1 语言归一(别名/大小写/未知/纯文本)✓");
}

// ---------------------------------------------------------------- T2 双主题形状
{
  const a = await highlightCodeBlock("const x: number = 1;", "ts");
  const b = await highlightCodeBlock("const x: number = 1;", "ts");
  assert.ok(a, "T2 高亮产出 HTML");
  assert.ok(a.includes('class="shiki'), "T2 .shiki 类");
  assert.ok(a.includes("--shiki-light:"), "T2 亮色值挂 --shiki-light 变量(CSS 翻转零闪烁)");
  assert.ok(/color:#[0-9a-f]{6}/i.test(a), "T2 内联暗色 token(默认主题=dark)");
  assert.equal(a, b, "T2 确定性:同输入逐字节一致");
  console.log("T2 双主题输出形状(.shiki/--shiki-light/确定性)✓");
}

// ---------------------------------------------------------------- T3 转义安全
{
  const evil = `const s = "<script>alert(1)</script>" & <b>`;
  const html = await highlightCodeBlock(evil, "js");
  assert.ok(html, "T3 高亮成功");
  assert.ok(!html.includes("<script>"), "T3 原样 <script> 不得出现");
  // < 与 script 是不同 token(各自着色);shiki 4 序列化用数字字符引用(&#x3C;/&#x26;)
  assert.ok(html.includes("&lt;") || html.includes("&#x3C;"), "T3 尖括号已转义");
  assert.ok(!html.slice(html.indexOf("<code>")).includes("<b>"), "T3 行内 <b> 已转义");
  assert.ok(html.includes("&amp;") || html.includes("&#x26;"), "T3 & 已转义");
  // 逐行路径同款
  const lines = await highlightLines(evil, "js");
  assert.ok(lines, "T3 逐行高亮成功");
  assert.ok(!lines.some((l) => l.includes("<script>")), "T3 逐行路径同样转义");
  console.log("T3 转义安全(渲染层 HTML 的 XSS 红线)✓");
}

// ---------------------------------------------------------------- T4 未知回退
{
  assert.equal(await highlightCodeBlock("x = 1", "brainfuckxyz"), null, "T4 未知语言 → null");
  assert.equal(await highlightCodeBlock("plain", "txt"), null, "T4 纯文本 → null(不加冗余语法)");
  console.log("T4 未知/纯文本回退 null ✓");
}

// ---------------------------------------------------------------- T5 逐行 token
{
  const code = "def f(x):\n    return x + 1\n";
  const lines = await highlightLines(code, "python");
  assert.ok(lines, "T5 逐行产出");
  assert.equal(lines.length, 3, "T5 行数与 split(\\n) 一一对应(含尾空行)");
  assert.ok(lines.every((l) => typeof l === "string"), "T5 每行是 HTML 字符串");
  assert.ok(lines[0].includes('style="color:#'), "T5 行内 token 有色");
  assert.equal(JSON.stringify(lines), JSON.stringify(await highlightLines(code, "python")), "T5 确定性");
  assert.equal(await highlightLines("x", "brainfuckxyz"), null, "T5 未知语言 → null");
  console.log("T5 逐行 token(行对齐/有 色/确定性)✓");
}

// ---------------------------------------------------------------- T6 接线守卫
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const chat = read("../src/renderer/components/ChatStream.tsx");
  assert.ok(chat.includes('from "./CodeBlock.js"'), "T6 ChatStream 用共享 CodeBlock");
  assert.ok(!/function CodeBlock\(/.test(chat), "T6 ChatStream 本地 CodeBlock 已删(无双实现漂移)");
  const nb = read("../src/renderer/components/NotebookPanel.tsx");
  assert.ok(nb.includes("CodeBlock"), "T6 NotebookPanel 接共享 CodeBlock");
  const walk = read("../src/renderer/components/artifacts/CodeWalkthroughArtifact.tsx");
  assert.ok(walk.includes("highlightLines"), "T6 CodeWalkthrough 用逐行 token");
  const css = read("../src/renderer/index.css");
  assert.ok(css.includes(".md-shiki pre.shiki"), "T6 shiki 面板样式在 index.css");
  assert.ok(
    /html\.light \.md-shiki pre\.shiki span\s*\{[^}]*--shiki-light/.test(css),
    "T6 亮色 CSS 翻转规则(--shiki-light)",
  );
  const sanitize = read("../src/renderer/lib/markdown-sanitize.ts");
  assert.ok(!sanitize.includes("shiki"), "T6 sanitize schema 零改动(shiki 不经消毒器,KaTeX 同款信任模型)");
  console.log("T6 接线守卫(三出口/CSS 翻转/sanitize 零改动)✓");
}

console.log("verify-shiki: 6 组全部通过");
