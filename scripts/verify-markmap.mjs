/**
 * verify-markmap —— 思维导图(v0.21)确定性测试。
 *
 * T1 源文本预处理纯函数(围栏剥离/占位/图片取 alt/注释剥除/未闭合容错)
 * T2 markmap-lib transform 真集成(标题/列表层级、确定性、预处理后无代码内容)
 * T3 接线守卫(源码级:Brain 按钮 + MindmapView 渲染分支 + CanvasStage 宿主 +
 *    markmap 全动态 import 懒加载 + i18n 键在)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mindmapMarkdown } from "../src/renderer/lib/mindmap-markdown.ts";

// ---------------------------------------------------------------- T1 预处理
{
  const md = [
    "# 标题",
    "",
    "```ts",
    "const secret = 1;",
    "```",
    "",
    "正文一段,含 ![截图](http://x/y.png) 图片。",
    "",
    "~~~",
    "围栏里任意内容 ``` 也不闭合错",
    "~~~",
    "",
    "<!-- 隐藏注释 -->",
    "结尾",
  ].join("\n");
  const out = mindmapMarkdown(md);
  assert.ok(!out.includes("secret"), "T1 围栏内容被剥");
  assert.ok(!out.includes("```") && !out.includes("~~~"), "T1 围栏标记不残留");
  assert.ok(!out.includes("http://x/y.png"), "T1 图片 URL 剥除");
  assert.ok(out.includes("截图"), "T1 图片 alt 保留");
  assert.ok(!out.includes("隐藏注释"), "T1 HTML 注释剥除");
  assert.ok(out.includes("# 标题") && out.includes("正文一段") && out.includes("结尾"), "T1 正文骨架原样");
  assert.equal((out.match(/代码块/g) ?? []).length, 2, "T1 两个围栏各一个占位");
  // 未闭合围栏:吃到结尾,不吞之前的内容
  const unclosed = mindmapMarkdown("# A\n\n```js\ncode\nno close");
  assert.ok(unclosed.includes("# A"), "T1 未闭合围栏前的内容保留");
  assert.ok(!unclosed.includes("code"), "T1 未闭合围栏内容仍被剥");
  // 行内代码(单反引号)不受影响(v13:单段成列表项节点,不再是裸段落)
  assert.equal(mindmapMarkdown("用 `x` 变量"), "- 用 `x` 变量", "T1 行内代码不动+段落降节点");
  assert.equal(mindmapMarkdown(""), "", "T1 空输入不炸");
  console.log("T1 源文本预处理(围栏/图片/注释/未闭合/行内代码)✓");
}

// ------------------------------------------------- T1b v13 段落降节点(结构保真)
{
  const { paragraphTopic } = await import("../src/renderer/lib/mindmap-markdown.ts");
  // 粗体引导段 → 粗体内容做节点文案(用户手写的小节主题)
  assert.equal(paragraphTopic("**核心思想**:一切从简"), "核心思想", "T1b 粗体引导段取粗体");
  // 首句截取(句终标点收尾,标点本身不进节点)
  assert.equal(paragraphTopic("第一句。第二句。"), "第一句", "T1b 取首句");
  // 超长截断加省略号
  const long = paragraphTopic("一二三四五六七八九十".repeat(6));
  assert.ok(long && long.length <= 41 && long.endsWith("…"), "T1b 超长截断");
  // 空/纯空白 → null
  assert.equal(paragraphTopic("   "), null, "T1b 空段不产节点");
  // 链接取文字、引语标记剥除
  assert.equal(paragraphTopic("> 看 [这份文档](http://x) 的说明"), "看 这份文档 的说明", "T1b 链接文字+引语剥除");

  // 无标题课时:整篇段落不再缩成一个节点——每段一个列表项节点
  const flat = mindmapMarkdown(
    ["第一段讲背景与动机。这里展开很多字。", "", "第二段讲方法。", "", "第三段讲结论。"].join("\n"),
  );
  const items = flat.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(items.length, 3, "T1b 无标题课时三段三个节点");
  assert.ok(items[0].includes("第一段讲背景与动机"), "T1b 节点文案=首句");

  // 有标题课时:标题/列表原样,段落悬在最近标题下成子节点
  const withH = mindmapMarkdown(
    ["## 方法", "", "先讲线性代数。再多讲一点。", "", "- 已有列表项", "", "## 结论", "", "总之可行。"].join("\n"),
  );
  const hl = withH.split("\n");
  assert.ok(hl.includes("## 方法") && hl.includes("## 结论"), "T1b 标题原样");
  assert.ok(hl.includes("- 已有列表项"), "T1b 列表原样");
  assert.ok(withH.includes("- 先讲线性代数"), "T1b 段落节点悬在标题下");
  const mi = hl.indexOf("- 先讲线性代数");
  const mh = hl.indexOf("## 方法");
  const mc = hl.indexOf("## 结论");
  assert.ok(mi > mh && mi < mc, "T1b 段落节点落在所属标题区间");

  // 表格/分隔线不产节点
  const noisy = mindmapMarkdown(["| a | b |", "|---|---|", "---", "正文。"].join("\n"));
  assert.ok(noisy.includes("- 正文") && !noisy.includes("| a |"), "T1b 表格/分隔线跳过");
  console.log("T1b v13 段落降节点(粗体/首句/截断/悬标题/跳噪声)✓");
}

// ---------------------------------------------------------------- T2 transform 集成
{
  const { Transformer } = await import("markmap-lib");
  const tr = new Transformer();
  const src = mindmapMarkdown(
    ["# Root Lesson", "", "## Part A", "", "- point 1", "- point 2", "  - nested", "", "## Part B", "", "```py", "hidden()", "```", "", "- point 3", "- 示例", "  ```js", "  buried()", "  ```", "  - 占位应成列表子节点"].join("\n"),
  );
  const a = tr.transform(src);
  assert.ok(a.root, "T2 根节点存在");
  assert.ok(!src.includes("hidden") && !src.includes("buried"), "T2 预处理已剥代码");
  const flat = [];
  // markmap-lib 对非 ASCII 内容做 HTML 实体编码,断言前解码
  const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  const walk = (n, d = 0) => {
    flat.push(d + ":" + decode(n.content ?? ""));
    for (const c of n.children ?? []) walk(c, d + 1);
  };
  walk(a.root);
  assert.ok(flat.some((s) => s.includes("Root Lesson")), "T2 根=H1");
  assert.ok(flat.some((s) => s.includes("Part A")) && flat.some((s) => s.includes("Part B")), "T2 H2 成枝");
  assert.ok(flat.some((s) => s.includes("nested")), "T2 列表嵌套成层");
  // markmap 的 markdown-it 会把松列表项包进 <p data-lines> 并带前导换行,断言包装无关
  assert.equal(flat.filter((s) => s.includes("代码块")).length, 2, "T2 两处代码占位都成节点(标题下+列表项内)");
  const b = tr.transform(src);
  assert.equal(JSON.stringify(a.root), JSON.stringify(b.root), "T2 确定性:同输入逐字节一致");
  console.log("T2 markmap-lib transform(层级/占位/确定性)✓");
}

// ---------------------------------------------------------------- T3 接线守卫
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const nb = read("../src/renderer/components/NotebookPanel.tsx");
  assert.ok(nb.includes('data-testid="node-content-mindmap"'), "T3 Brain 按钮在场");
  assert.ok(nb.includes("<MindmapView markdown={content} />"), "T3 讲解区渲染分支接 MindmapView");
  const mv = read("../src/renderer/components/MindmapView.tsx");
  assert.ok(mv.includes('import("markmap-lib")') && mv.includes('import("markmap-view")'), "T3 markmap 全动态 import(懒 chunk)");
  assert.ok(mv.includes("CanvasStage"), "T3 复用 CanvasStage(手势/适屏)");
  assert.ok(/pan:\s*false/.test(mv) && /zoom:\s*false/.test(mv), "T3 markmap 自带 pan/zoom 关闭(手势归 CanvasStage)");
  // v13 渲染不全两修接线:双 rAF 重适配 + svg 点击(展开/折叠)后重 fit + 300ms 兜底
  assert.ok(mv.includes("function refitSoon") && mv.includes("svg.addEventListener(\"click\""), "T3 展开/折叠重适配接线");
  assert.ok(mv.includes("300") && mv.includes("refitSoon(mmRef.current)"), "T3 首绘 300ms 补 fit 兜底");
  const i18n = read("../src/renderer/lib/i18n.ts");
  assert.ok(i18n.includes("notebook.mindmap.toggle"), "T3 i18n 键在");
  console.log("T3 接线守卫(按钮/渲染分支/懒加载/CanvasStage/i18n)✓");
}

console.log("verify-markmap: 4 组全部通过");
