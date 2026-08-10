/**
 * 扫描器图片收集验证 —— 测 scanFolder 的 collectImages 选项。
 *
 * 不变量:
 *   - 默认(不传 options)→ 返回 ScannedDoc[](向后兼容)
 *   - collectImages=true → 返回 { docs, images }
 *   - 独立图片文件被收集(.png/.jpg/.svg 等)
 *   - 非图片文件被忽略(.txt 之外的杂项)
 *   - markdown ![](img) 引用被解析
 *   - 同图既被 .md 引用又是独立文件 → 去重(file 优先)
 *   - node_modules 里的图片被排除
 */
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFolder } from "../src/main/services/pure/local-folder-scanner.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// === T1: 向后兼容 — 不传 options 返回 ScannedDoc[] ===
test("T1 向后兼容: 不传 options 返回 ScannedDoc[]", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-bc-"));
  try {
    writeFileSync(join(tmp, "a.txt"), "内容足够长不会被过滤掉。");
    const result = await scanFolder(tmp);
    assert.ok(Array.isArray(result), "不传 options 返回数组(不是 {docs,images})");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, "a.txt");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T2: collectImages=true 返回 { docs, images } ===
test("T2 collectImages: 返回 { docs, images } 结构", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-img-"));
  try {
    writeFileSync(join(tmp, "notes.md"), "# 笔记\n\n正文内容足够长。");
    // 写假图片文件(内容不重要,只看文件名被收)
    writeFileSync(join(tmp, "fig.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(tmp, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    assert.ok(!Array.isArray(result), "collectImages 返回对象不是数组");
    assert.ok("docs" in result && "images" in result);
    assert.strictEqual(result.docs.length, 1, "1 个文档");
    assert.ok(result.docs[0].path === "notes.md");
    assert.strictEqual(result.images.length, 2, "2 张图(png + jpg)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T3: 独立图片文件全格式收集 ===
test("T3 独立图片: 全格式收集", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-fmt-"));
  try {
    writeFileSync(join(tmp, "doc.txt"), "文档内容足够长。");
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]) {
      writeFileSync(join(tmp, `img.${ext}`), Buffer.from([0x00]));
    }
    // 非图片扩展名不收
    writeFileSync(join(tmp, "file.zip"), Buffer.from([0x00]));
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    assert.strictEqual(result.images.length, 7, "7 种图片格式全收");
    assert.ok(!result.images.some((i) => i.path.endsWith(".zip")), "zip 不收");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T4: 图片 mime 推断 ===
test("T4 图片 mime 推断", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-mime-"));
  try {
    writeFileSync(join(tmp, "doc.txt"), "文档内容。");
    writeFileSync(join(tmp, "a.png"), Buffer.from([0x00]));
    writeFileSync(join(tmp, "b.jpg"), Buffer.from([0x00]));
    writeFileSync(join(tmp, "c.svg"), Buffer.from([0x00]));
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    const png = result.images.find((i) => i.filename === undefined && i.path === "a.png") ?? result.images.find((i) => i.path === "a.png");
    assert.strictEqual(png.mime, "image/png");
    const jpg = result.images.find((i) => i.path === "b.jpg");
    assert.strictEqual(jpg.mime, "image/jpeg");
    const svg = result.images.find((i) => i.path === "c.svg");
    assert.strictEqual(svg.mime, "image/svg+xml");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T5: markdown 引用被解析 ===
test("T5 markdown 引用解析", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-mdref-"));
  try {
    mkdirSync(join(tmp, "ch1"), { recursive: true });
    writeFileSync(
      join(tmp, "ch1", "notes.md"),
      "# 笔记\n\n正文内容。\n\n![架构图](arch.png)\n\n![流程](flow.svg)",
    );
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    const imgPaths = result.images.map((i) => i.path);
    assert.ok(imgPaths.includes("ch1/arch.png"), `arch.png 被解析,实际 ${imgPaths}`);
    assert.ok(imgPaths.includes("ch1/flow.svg"), `flow.svg 被解析`);
    // 来源是 markdown_ref
    const archImg = result.images.find((i) => i.path === "ch1/arch.png");
    assert.strictEqual(archImg.source, "markdown_ref");
    assert.strictEqual(archImg.altText, "架构图");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T6: 同图既是文件又被引用 → 去重(file 优先)===
test("T6 去重: file 优先于 markdown_ref", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-dedup-"));
  try {
    mkdirSync(join(tmp, "ch1"), { recursive: true });
    writeFileSync(join(tmp, "ch1", "shared.png"), Buffer.from([0x00]));
    writeFileSync(join(tmp, "ch1", "notes.md"), "# 笔记\n\n![](shared.png)");
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    const shared = result.images.filter((i) => i.path === "ch1/shared.png");
    assert.strictEqual(shared.length, 1, "同图去重为 1");
    assert.strictEqual(shared[0].source, "image_file", "file 来源优先");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T7: node_modules 图片被排除 ===
test("T7 排除: node_modules 图片不收", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-excl-"));
  try {
    mkdirSync(join(tmp, "node_modules"), { recursive: true });
    writeFileSync(join(tmp, "doc.txt"), "文档内容。");
    writeFileSync(join(tmp, "real.png"), Buffer.from([0x00]));
    writeFileSync(join(tmp, "node_modules", "junk.png"), Buffer.from([0x00]));
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    assert.strictEqual(result.images.length, 1, "只有 real.png");
    assert.strictEqual(result.images[0].path, "real.png");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T8: collectImages 但无图 → images 空数组 ===
test("T8 无图: images 空数组", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-noimg-"));
  try {
    writeFileSync(join(tmp, "a.txt"), "文档内容。");
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    assert.strictEqual(result.images.length, 0);
    assert.strictEqual(result.docs.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// === T9: 图片 absPath 正确 ===
test("T9 absPath: 图片绝对路径正确", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-abs-"));
  try {
    writeFileSync(join(tmp, "doc.txt"), "x");
    writeFileSync(join(tmp, "fig.png"), Buffer.from([0x00]));
    const result = await scanFolder(tmp, undefined, { collectImages: true });
    const img = result.images[0];
    assert.ok(img.absPath.includes("fig.png"), "absPath 含文件名");
    assert.ok(img.absPath.includes(tmp.split(/[\\/]/).pop()), "absPath 含根目录");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 运行
let passed = 0;
let failed = 0;
for (const { name, fn } of TESTS) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 扫描器图片收集: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
