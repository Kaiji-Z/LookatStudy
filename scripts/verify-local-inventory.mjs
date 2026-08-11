/**
 * 本地导入清点验证 —— 测 buildLocalInventory + findStandaloneImages + LocalContentSource。
 *
 * 不变量:
 *   - findStandaloneImages: 不被 md 引用的独立图 = standalone, 被引用的不算
 *   - buildLocalInventory: docs + images + translations + readmeMd + fullTree + standaloneImages
 *   - LocalContentSource: getFile 从 docsMap, getImageDataUrl 从磁盘, fallback 返回 null
 */
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findStandaloneImages,
  buildLocalInventory,
} from "../src/main/services/pure/local-folder-scanner.ts";
import { LocalContentSource } from "../src/main/services/content-source.ts";

// === T1: findStandaloneImages — 被引用的不算 standalone ===
{
  const docs = [
    {
      path: "ch1/lesson1.md",
      title: "L1",
      content: "# L1\n\n![ref](images/diagram.png)\n\n正文内容。",
      lang: "other",
      kind: "md",
    },
  ];
  const images = [
    { path: "ch1/images/diagram.png", absPath: "/tmp/x.png", title: "D", mime: "image/png", source: "image_file", altText: "ref" },
    { path: "ch1/images/orphan.png", absPath: "/tmp/o.png", title: "O", mime: "image/png", source: "image_file", altText: "orphan" },
    { path: "ch1/lesson1.md#page1.png", absPath: "", title: "P", mime: "image/png", source: "pdf_page", altText: "pdf" },
  ];
  const standalone = findStandaloneImages(images, docs);
  assert.strictEqual(standalone.length, 1, `T1: 1 standalone (orphan), got ${standalone.length}`);
  assert.strictEqual(standalone[0].path, "ch1/images/orphan.png", "T1: orphan 是 standalone");
  assert.ok(!standalone.some((i) => i.path.includes("diagram")), "T1: 被 md 引用的 diagram 不是 standalone");
  assert.ok(!standalone.some((i) => i.source === "pdf_page"), "T1: PDF 图(buffer 型)不算 standalone");
  console.log("✓ T1 findStandaloneImages: 被引用的不算, PDF 图不算, 只留独立文件孤儿图");
}

// === T2: findStandaloneImages — txt/html 文档的引用不算 ===
{
  const docs = [
    { path: "notes.txt", title: "N", content: "see image.png", lang: "other", kind: "txt" },
    { path: "page.html", title: "P", content: "<p>img</p>", lang: "other", kind: "html" },
  ];
  const images = [
    { path: "image.png", absPath: "/tmp/i.png", title: "I", mime: "image/png", source: "image_file", altText: "I" },
  ];
  const standalone = findStandaloneImages(images, docs);
  assert.strictEqual(standalone.length, 1, "T2: txt/html 不解析图片引用, image.png 是 standalone");
  console.log("✓ T2 findStandaloneImages: txt/html 文档不产生图片引用");
}

// === T3: buildLocalInventory — 完整流程 ===
{
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-inv-"));
  try {
    // 造一个迷你课程: README + lesson + 独立图 + 被引用图 + translations
    writeFileSync(join(tmp, "README.md"), "# Test Course\n\n这是测试课程。");
    mkdirSync(join(tmp, "lessons"));
    writeFileSync(join(tmp, "lessons", "intro.md"), "# Intro\n\n![diagram](diagram.png)\n\n讲解内容足够长不会过滤掉。");
    // 被引用的图
    writeFileSync(join(tmp, "lessons", "diagram.png"), Buffer.from("iVBORw0KGgo=", "base64"));
    // 独立图(不被任何 md 引用)
    writeFileSync(join(tmp, "lessons", "extra.png"), Buffer.from("iVBORw0KGgo=", "base64"));
    // translations
    mkdirSync(join(tmp, "translations", "zh-CN", "lessons"), { recursive: true });
    writeFileSync(join(tmp, "translations", "zh-CN", "lessons", "intro.md"), "# 简介\n\n这是翻译后的简介内容。");

    const inv = await buildLocalInventory(tmp);

    // docs: README + intro (不包含 translations)
    assert.ok(inv.docs.length >= 2, `T3: docs >= 2 (README + intro), got ${inv.docs.length}`);
    assert.ok(!inv.docs.some((d) => d.path.startsWith("translations/")), "T3: docs 不含 translations");

    // translations
    assert.strictEqual(inv.translationLangs.length, 1, "T3: 检测到 1 种翻译语言");
    assert.strictEqual(inv.translationLangs[0], "zh-CN", "T3: 翻译语言是 zh-CN");
    assert.ok(inv.translations.some((t) => t.path === "translations/zh-CN/lessons/intro.md"), "T3: 翻译文件在列表");

    // readmeMd
    assert.ok(inv.readmeMd.includes("Test Course"), "T3: readmeMd 是 README 内容");

    // fullTree 包含所有路径
    assert.ok(inv.fullTree.some((p) => p === "README.md"), "T3: fullTree 含 README");
    assert.ok(inv.fullTree.some((p) => p === "lessons/intro.md"), "T3: fullTree 含 lesson");
    assert.ok(inv.fullTree.some((p) => p.includes("diagram.png")), "T3: fullTree 含图片");
    assert.ok(inv.fullTree.some((p) => p.startsWith("translations/")), "T3: fullTree 含翻译");

    // standaloneImages: extra.png 不被引用
    assert.ok(inv.standaloneImages.some((i) => i.path.includes("extra.png")), "T3: extra.png 是 standalone");
    assert.ok(!inv.standaloneImages.some((i) => i.path.includes("diagram.png")), "T3: diagram.png 被引用, 不是 standalone");

    console.log(`✓ T3 buildLocalInventory: ${inv.docs.length} docs · ${inv.translations.length} trans · ${inv.standaloneImages.length} standalone · readme ${inv.readmeMd.length} 字`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// === T4: LocalContentSource getFile / getImageDataUrl ===
{
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-src-"));
  try {
    writeFileSync(join(tmp, "test.md"), "# Hello\n\nWorld");
    // 1x1 PNG
    const pngBuf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    writeFileSync(join(tmp, "img.png"), pngBuf);

    const docsMap = new Map([["test.md", "# Hello\n\nWorld"]]);
    const source = new LocalContentSource(tmp, docsMap);

    // getFile 从 docsMap
    const content = await source.getFile("test.md");
    assert.ok(content?.includes("Hello"), "T4: getFile 返回 docsMap 内容");

    // getFile 不存在 → null
    const missing = await source.getFile("nonexistent.md");
    assert.strictEqual(missing, null, "T4: getFile 不存在 → null");

    // getImageDataUrl 从磁盘读
    const dataUrl = await source.getImageDataUrl("img.png");
    assert.ok(dataUrl?.startsWith("data:image/png;base64,"), "T4: getImageDataUrl 返回 data URL");

    // getImageDataUrl 不存在 → null
    const missingImg = await source.getImageDataUrl("nope.png");
    assert.strictEqual(missingImg, null, "T4: getImageDataUrl 不存在 → null");

    // getImageFallbackUrl → null (本地无 CDN)
    assert.strictEqual(source.getImageFallbackUrl("img.png"), null, "T4: fallback 返回 null");

    console.log("✓ T4 LocalContentSource: getFile(docsMap) + getImageDataUrl(磁盘) + fallback=null");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// === T5: LocalContentSource 翻译文件 getFile ===
{
  const docsMap = new Map([
    ["lessons/intro.md", "# Intro"],
    ["translations/zh-CN/lessons/intro.md", "# 简介"],
  ]);
  const source = new LocalContentSource("/tmp", docsMap);

  const original = await source.getFile("lessons/intro.md");
  const translation = await source.getFile("translations/zh-CN/lessons/intro.md");

  assert.ok(original?.includes("Intro"), "T5: 原文可读");
  assert.ok(translation?.includes("简介"), "T5: 翻译可读(约定路径 translations/{lang}/{file})");

  console.log("✓ T5 LocalContentSource: 翻译文件按约定路径 translations/{lang}/{file} 读取");
}

console.log("\n=== ALL LOCAL INVENTORY TESTS PASSED ✅ ===");
