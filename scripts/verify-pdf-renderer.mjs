/**
 * PDF 渲染器验证 —— 测 pdf-renderer.ts 的纯函数:
 *   classifyPdfPageByTextRatio / encodePng
 *
 * 注意:processPdf 本身依赖 pdfjs-dist + 真 PDF 文件,不在这里测(那是 live-test 的事)。
 * 这里只测可纯函数化的部分(页面分类启发式 + PNG 编码正确性)。
 *
 * PNG 编码验证策略:编码 → 检查 PNG 签名 + IHDR + 用 zlib 解 IDAT 验证数据完整性。
 * 不引入 pngjs 依赖(项目无),用 node:zlib 手验。
 */
import assert from "node:assert";
import { inflateSync } from "node:zlib";
import {
  classifyPdfPageByTextRatio,
  encodePng,
} from "../src/main/lib/pdf-renderer.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// === T1: classifyPdfPageByTextRatio 纯文字 PDF ===
test("T1 classify: 纯文字 PDF → text-heavy", () => {
  // 10 页,共 5000 字符 → 500 字符/页 → 文字为主
  assert.strictEqual(classifyPdfPageByTextRatio(5000, 10), "text-heavy");
  assert.strictEqual(classifyPdfPageByTextRatio(100000, 50), "text-heavy");
});

// === T2: classifyPdfPageByTextRatio 纯图片 PDF(扫描件)===
test("T2 classify: 纯图片 PDF → image-heavy", () => {
  // 5 页,共 20 字符(基本是空文字层)→ 4 字符/页 → 图片为主
  assert.strictEqual(classifyPdfPageByTextRatio(20, 5), "image-heavy");
  assert.strictEqual(classifyPdfPageByTextRatio(0, 10), "image-heavy", "0 字符也是 image-heavy");
});

// === T3: classifyPdfPageByTextRatio 边界阈值 ===
test("T3 classify: 边界阈值 50 字符/页", () => {
  // 恰好 50 字符/页 → text-heavy(阈值 < 50 是 image-heavy,≥ 50 是 text-heavy)
  assert.strictEqual(classifyPdfPageByTextRatio(50, 1), "text-heavy", "50 字符/页 → text-heavy");
  assert.strictEqual(classifyPdfPageByTextRatio(49, 1), "image-heavy", "49 字符/页 → image-heavy");
});

// === T4: classifyPdfPageByTextRatio 0 页防护 ===
test("T4 classify: 0 页防护 → text-heavy", () => {
  assert.strictEqual(classifyPdfPageByTextRatio(100, 0), "text-heavy");
});

// === T5: encodePng 基本输出(签名 + IHDR + IEND)===
test("T5 encodePng: 签名正确", () => {
  // 2x2 全红 RGBA
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
  ]);
  const png = encodePng(rgba, 2, 2);
  // PNG 签名
  assert.strictEqual(png[0], 137);
  assert.strictEqual(png[1], 80); // P
  assert.strictEqual(png[2], 78); // N
  assert.strictEqual(png[3], 71); // G
  assert.strictEqual(png[4], 13);
  assert.strictEqual(png[5], 10);
  assert.strictEqual(png[6], 26);
  assert.strictEqual(png[7], 10);
});

// === T6: encodePng IHDR 正确(width/height/bitDepth/colorType)===
test("T6 encodePng: IHDR 含正确宽高", () => {
  const rgba = new Uint8Array(4 * 4 * 4); // 4x4
  rgba.fill(255);
  const png = encodePng(rgba, 4, 4);
  // IHDR 紧跟签名(8 字节)+ length(4)+ type(4) = 偏移 16 开始是 IHDR data
  // 但更简单:搜 "IHDR" ASCII 位置
  const typeStr = png.subarray(12, 16).toString("ascii");
  assert.strictEqual(typeStr, "IHDR", "第一个 chunk 类型是 IHDR");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.strictEqual(width, 4, "IHDR width = 4");
  assert.strictEqual(height, 4, "IHDR height = 4");
  assert.strictEqual(png[24], 8, "bit depth = 8");
  assert.strictEqual(png[25], 6, "color type = 6 (RGBA)");
});

// === T7: encodePng IEND 存在 ===
test("T7 encodePng: 含 IEND 结尾 chunk", () => {
  const rgba = new Uint8Array(1 * 1 * 4);
  rgba.fill(128);
  const png = encodePng(rgba, 1, 1);
  // IEND chunk = length(4)=0 + type(4)="IEND" + data(0) + crc(4) = 12 字节
  // 文件末尾 12 字节:IEND 的 length(4)+type(4)+crc(4)
  // type "IEND" 在 偏移 length-8 到 length-4
  const endMarker = png.subarray(png.length - 8, png.length - 4).toString("ascii");
  assert.strictEqual(endMarker, "IEND", "结尾 chunk 类型是 IEND");
  // IEND 的 length 字段 = 0
  assert.strictEqual(png.readUInt32BE(png.length - 12), 0, "IEND data 长度 = 0");
});

// === T8: encodePng 解压 IDAT 还原原始 RGBA ===
test("T8 encodePng: IDAT 解压还原像素数据", () => {
  // 3x2 渐变 RGBA
  const rgba = new Uint8Array(3 * 2 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 256;
  const png = encodePng(rgba, 3, 2);
  // 找 IDAT chunk
  const idatIdx = png.indexOf(Buffer.from("IDAT", "ascii"));
  assert.ok(idatIdx > 0, "存在 IDAT chunk");
  // IDAT data 在 type 后,type 前有 length(4 字节)
  const idatLen = png.readUInt32BE(idatIdx - 4);
  const idatData = png.subarray(idatIdx + 4, idatIdx + 4 + idatLen);
  // 解压
  const decompressed = inflateSync(idatData);
  // 每行前有 1 字节 filter(=0 None),3 像素 * 4 字节 = 12 字节/行
  // 期望:filter(0) + 12字节 + filter(0) + 12字节 = 26 字节
  assert.strictEqual(decompressed.length, 26, "解压后长度 = (stride+1)*height");
  assert.strictEqual(decompressed[0], 0, "第一行 filter = None");
  assert.strictEqual(decompressed[13], 0, "第二行 filter = None");
  // 验证像素数据:第一行像素 = rgba 的前 12 字节
  for (let i = 0; i < 12; i++) {
    assert.strictEqual(decompressed[1 + i], rgba[i], `像素[${i}] 还原正确`);
  }
});

// === T9: encodePng 尺寸不匹配抛错 ===
test("T9 encodePng: 尺寸不匹配抛错", () => {
  const rgba = new Uint8Array(10); // 不匹配 2x2*4=16
  assert.throws(() => encodePng(rgba, 2, 2), /encodePng: rgba 长度/);
});

// === T10: encodePng 1x1 单像素 ===
test("T10 encodePng: 1x1 单像素编码", () => {
  const rgba = new Uint8Array([255, 128, 0, 255]); // 橙色
  const png = encodePng(rgba, 1, 1);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.strictEqual(width, 1);
  assert.strictEqual(height, 1);
});

// === T11: encodePng 大图(100x100)不崩溃 ===
test("T11 encodePng: 100x100 不崩溃", () => {
  const rgba = new Uint8Array(100 * 100 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) % 256;
  const png = encodePng(rgba, 100, 100);
  assert.ok(png.length > 100, "大图编码产出合理大小(压缩后)");
  // 验证能解压并还原
  const idatIdx = png.indexOf(Buffer.from("IDAT", "ascii"));
  const idatLen = png.readUInt32BE(idatIdx - 4);
  const idatData = png.subarray(idatIdx + 4, idatIdx + 4 + idatLen);
  const decompressed = inflateSync(idatData);
  assert.strictEqual(decompressed.length, 100 * (100 * 4 + 1), "解压长度正确(含每行 filter 字节)");
});

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
console.log(`\n=== PDF 渲染器纯函数: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
