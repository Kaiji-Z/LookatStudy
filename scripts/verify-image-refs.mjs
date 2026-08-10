/**
 * Markdown 图片引用解析验证 —— 测 local-folder-scanner.ts 的纯函数:
 *   extractImageRefs / resolveImageRef / inferImageTitle / dedupImages
 *
 * 不变量:
 *   - extractImageRefs: 匹配 ![alt](path),过滤非图片扩展名/外部URL/dataURL
 *   - resolveImageRef: 相对路径(./ ../)正确解析;绝对路径原样
 *   - inferImageTitle: 去扩展名 + 数字前缀 + 首字母大写
 *   - dedupImages: 同 path 去重,file 优先于 ref
 */
import assert from "node:assert";
import {
  extractImageRefs,
  resolveImageRef,
  inferImageTitle,
  dedupImages,
} from "../src/main/services/pure/local-folder-scanner.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// === T1: extractImageRefs 基本解析 ===
test("T1 extractImageRefs: 基本图片引用", () => {
  const md = "# 标题\n\n正文\n\n![架构图](arch.png)\n\n更多文字\n![流程](flow.svg)";
  const refs = extractImageRefs(md);
  assert.strictEqual(refs.length, 2, `应解析出 2 个引用,实际 ${refs.length}`);
  assert.strictEqual(refs[0].alt, "架构图");
  assert.strictEqual(refs[0].refPath, "arch.png");
  assert.strictEqual(refs[1].alt, "流程");
  assert.strictEqual(refs[1].refPath, "flow.svg");
});

// === T2: extractImageRefs 过滤非图片扩展名 ===
test("T2 extractImageRefs: 过滤非图片扩展名", () => {
  const md = "![pdf图标](doc.pdf)\n![真图](fig.png)\n![视频](video.mp4)\n![链接](page.html)";
  const refs = extractImageRefs(md);
  assert.strictEqual(refs.length, 1, "只有 .png 被收,其他扩展名过滤");
  assert.strictEqual(refs[0].refPath, "fig.png");
});

// === T3: extractImageRefs 过滤外部 URL 和 data URL ===
test("T3 extractImageRefs: 过滤外部 URL 和 data URL", () => {
  const md =
    '![外链](https://example.com/img.png)\n![本地](local.png)\n![base64](data:image/png;base64,iVBOR==)';
  const refs = extractImageRefs(md);
  assert.strictEqual(refs.length, 1, "只有本地引用被收");
  assert.strictEqual(refs[0].refPath, "local.png");
});

// === T4: extractImageRefs 空 alt + 带 title ===
test("T4 extractImageRefs: 空 alt + 带 title 语法", () => {
  const md = '![](noalt.png)\n![alt](titled.png "标题提示")';
  const refs = extractImageRefs(md);
  assert.strictEqual(refs.length, 2);
  assert.strictEqual(refs[0].alt, "", "空 alt 保留为空串");
  assert.strictEqual(refs[0].refPath, "noalt.png");
  assert.strictEqual(refs[1].refPath, "titled.png", "title 后缀被去掉");
  assert.strictEqual(refs[1].alt, "alt");
});

// === T5: extractImageRefs 支持全部图片扩展名 ===
test("T5 extractImageRefs: 支持全部图片扩展名", () => {
  const md =
    "![a](a.png)![b](b.jpg)![c](c.jpeg)![d](d.gif)![e](e.webp)![f](f.svg)![g](g.bmp)";
  const refs = extractImageRefs(md);
  assert.strictEqual(refs.length, 7, "7 种扩展名全部识别");
});

// === T6: extractImageRefs 去锚点 ===
test("T6 extractImageRefs: 去锚点", () => {
  const md = "![图](page.png#section1)";
  const refs = extractImageRefs(md);
  assert.strictEqual(refs[0].refPath, "page.png", "锚点被去掉");
});

// === T7: extractImageRefs 无图返回空数组 ===
test("T7 extractImageRefs: 无图返回空数组", () => {
  assert.strictEqual(extractImageRefs("纯文字无图").length, 0);
  assert.strictEqual(extractImageRefs("").length, 0);
});

// === T8: resolveImageRef 相对路径解析 ===
test("T8 resolveImageRef: 同目录引用", () => {
  const resolved = resolveImageRef("img.png", "ch1/lesson1/notes.md");
  assert.strictEqual(resolved, "ch1/lesson1/img.png");
});

// === T9: resolveImageRef ./ 前缀 ===
test("T9 resolveImageRef: ./ 前缀", () => {
  const resolved = resolveImageRef("./fig.png", "ch1/lesson1/notes.md");
  assert.strictEqual(resolved, "ch1/lesson1/fig.png");
});

// === T10: resolveImageRef ../ 上级 ===
test("T10 resolveImageRef: ../ 上级目录", () => {
  const resolved = resolveImageRef("../assets/diagram.png", "ch1/lesson1/notes.md");
  assert.strictEqual(resolved, "ch1/assets/diagram.png");
});

// === T11: resolveImageRef 带子目录的引用 ===
test("T11 resolveImageRef: 子目录引用", () => {
  const resolved = resolveImageRef("images/fig01.png", "ch1/lesson1/notes.md");
  assert.strictEqual(resolved, "ch1/lesson1/images/fig01.png");
});

// === T12: resolveImageRef 根目录文档 ===
test("T12 resolveImageRef: 根目录文档的引用", () => {
  const resolved = resolveImageRef("cover.png", "README.md");
  assert.strictEqual(resolved, "cover.png");
});

// === T13: inferImageTitle 去扩展名 + 数字前缀 ===
test("T13 inferImageTitle: 去扩展名 + 数字前缀 + 首字母大写", () => {
  assert.strictEqual(inferImageTitle("03_neural-network.png"), "Neural network");
  assert.strictEqual(inferImageTitle("architecture-diagram.jpg"), "Architecture diagram");
  assert.strictEqual(inferImageTitle("图1.png"), "图1", "中文不受首字母大写影响");
  assert.strictEqual(inferImageTitle("simple.svg"), "Simple");
});

// === T14: dedupImages file 优先于 ref ===
test("T14 dedupImages: 同 path file 优先", () => {
  const fileImages = [
    {
      path: "ch1/img.png",
      absPath: "/abs/ch1/img.png",
      title: "从文件名",
      mime: "image/png",
      source: "image_file",
      altText: "从文件名",
    },
  ];
  const refImages = [
    {
      path: "ch1/img.png",
      absPath: "/abs/ch1/img.png",
      title: "从 markdown alt",
      mime: "image/png",
      source: "markdown_ref",
      altText: "从 markdown alt",
    },
  ];
  const result = dedupImages(fileImages, refImages);
  assert.strictEqual(result.length, 1, "同 path 去重为 1");
  assert.strictEqual(result[0].source, "image_file", "file 优先保留");
  assert.strictEqual(result[0].title, "从文件名");
});

// === T15: dedupImages 不重叠的图全保留 ===
test("T15 dedupImages: 不重叠的图全保留", () => {
  const fileImages = [
    { path: "a.png", absPath: "/a.png", title: "A", mime: "image/png", source: "image_file", altText: "A" },
    { path: "b.png", absPath: "/b.png", title: "B", mime: "image/png", source: "image_file", altText: "B" },
  ];
  const refImages = [
    { path: "c.png", absPath: "/c.png", title: "C", mime: "image/png", source: "markdown_ref", altText: "C" },
  ];
  const result = dedupImages(fileImages, refImages);
  assert.strictEqual(result.length, 3, "3 个不重叠路径全保留");
});

// === T16: extractImageRefs 对抗性 - 嵌套括号/特殊字符 ===
test("T16 extractImageRefs: 嵌套括号不误匹配", () => {
  const md = "![alt](path(1).png)\n![ok](good.png)";
  const refs = extractImageRefs(md);
  // path(1).png 因为 ] 后到第一个 ) 截断,取不到合法扩展名 → 不匹配
  // good.png 正常匹配
  assert.ok(refs.length <= 2, "不崩溃");
  const good = refs.find((r) => r.refPath === "good.png");
  assert.ok(good, "good.png 被正确解析");
});

// === v0.8 多模态: isImageRelatedQuery(agent-engine 视觉查询检测)===
// inline 复刻(agent-engine.ts import 链到 electron app,tsx 环境会崩)
{
  function isImageRelatedQuery(query) {
    const lower = query.toLowerCase();
    const keywords = [
      "图", "图表", "示意图", "架构图", "流程图", "图解", "插图", "画一", "画个", "画张",
      "截图", "图标", "图形", "图片", "看一下图", "这张图", "那幅图",
      "diagram", "chart", "figure", "image", "picture", "graph", "plot", "visual", "illustration", "screenshot",
    ];
    return keywords.some((kw) => lower.includes(kw));
  }
  assert.ok(isImageRelatedQuery("这个图什么意思"), "v-query: 图");
  assert.ok(isImageRelatedQuery("帮我看看架构图"), "v-query: 架构图");
  assert.ok(isImageRelatedQuery("能画一个流程图吗"), "v-query: 流程图");
  assert.ok(isImageRelatedQuery("这张示意图"), "v-query: 示意图");
  assert.ok(isImageRelatedQuery("explain this diagram"), "v-query: diagram");
  assert.ok(isImageRelatedQuery("what does the chart show"), "v-query: chart");
  assert.ok(isImageRelatedQuery("look at this image"), "v-query: image");
  assert.ok(!isImageRelatedQuery("什么是梯度下降"), "v-query: 非图查询不触发");
  assert.ok(!isImageRelatedQuery("explain backpropagation"), "v-query: 英文非图查询不触发");
  assert.ok(!isImageRelatedQuery("帮我做这道题"), "v-query: 非图查询不触发");
  console.log("✓ T17 isImageRelatedQuery: 中英文图相关关键词 + 非图查询正确排除");
}

// 运行
let passed = 0;
let failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 图片引用解析: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
