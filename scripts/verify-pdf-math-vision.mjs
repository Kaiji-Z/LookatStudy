/**
 * verify-pdf-math-vision —— v0.20 P6 PDF 公式视觉转写。
 * T1 密集页检测纯函数直测;T2 管线接线源级守卫(flag 默认 off/两入口注入/
 *   Path2D 胶水/外部化/设置页开关);T3 真渲染单测(手工构造矢量 PDF,
 *   @napi-rs/canvas + pdfjs 整页 PNG,零 LLM)。
 * run: tsx scripts/verify-pdf-math-vision.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  mathGlyphsPerKiloChars,
  symbolSoupLineRatio,
  isMathDensePage,
  mathDensePageIndexes,
} from "../src/main/services/pure/math-dense.js";
import { openPdfPages } from "../src/main/services/pdf-page-image.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

console.log("T1 公式密集页检测(密度/符号汤/短文本/阈值/整本索引)");
{
  assert.equal(mathGlyphsPerKiloChars(""), 0, "空文本密度 0");
  // 11 字符里 3 个数学字形 → 3*1000/11
  assert.ok(Math.abs(mathGlyphsPerKiloChars("ab∑cd∫ef√gh") - (3 * 1000) / 11) < 1e-9, "密度公式");

  const prose = "This is ordinary prose about machine learning. ".repeat(10);
  assert.ok(!isMathDensePage(prose), "普通散文页不密集");
  assert.ok(!isMathDensePage("∑ ∫"), "短文本(<40字)一律不密集");

  // 符号汤:10 行里 5 行是 ≤4 词且 ≥3 字形
  const soup = Array.from({ length: 5 }, () => "∑ ∫ √ ≤\nnormal line of text here ok").join("\n");
  assert.ok(symbolSoupLineRatio(soup) === 0.5, "符号汤行占比 0.5");
  assert.ok(isMathDensePage(soup.padEnd(120, " x")), "符号汤超阈判密集");

  // 密度信号:长页里散布高密度字形(不给符号汤行)
  const dense = `${"word ".repeat(40)}∑∫√≤≥±≠∂∇${" tail ".repeat(40)}`;
  assert.ok(isMathDensePage(dense), "字形密度超阈判密集");
  assert.ok(isMathDensePage(`a ${"×".repeat(4)} b ${"x y ".repeat(24)}`), "× 密度信号(WinAnsi 可提取)");
  assert.ok(!isMathDensePage(dense, { glyphsPerKilo: 999, soupRatio: 0.99 }), "阈值可调收紧");

  assert.deepEqual(mathDensePageIndexes([prose, soup, "too short", dense]), [1, 3], "整本索引");
  assert.deepEqual(mathDensePageIndexes([]), [], "空书零密集页");
}
console.log("✓ T1 密集页检测");

console.log("T2 管线接线(flag 默认 off / 两入口注入 / 渲染胶水 / 外部化 / 设置开关)");
{
  const flags = read("src/main/services/pure/flag-defaults.ts");
  assert.ok(flags.includes("math_vision: false"), "T2: flag_math_vision 默认 off");
  assert.ok(read("shared/types.ts").includes('"flag_math_vision"'), "T2: SettingKey 登记");

  const job = read("src/main/services/import-job-service.ts");
  const hits = job.split("parsePdfTextSmart(").length - 1;
  assert.equal(hits, 2, "T2: 文件夹 + arXiv 两入口都注入 parsePdfTextSmart");
  assert.ok(job.includes('readSettingsMap(db)["flag_math_vision"] === "true"'), "T2: 门控读 flag(值约定 true)");

  const scanner = read("src/main/services/pure/local-folder-scanner.ts");
  assert.ok(scanner.includes("parsePdf?: (buf: Buffer) => Promise<string>"), "T2: scanner parsePdf 注入位");
  assert.ok(scanner.includes("readFileWithKind(f.absPath, kind, options?.parsePdf)"), "T2: scanFolder 透传");

  const urlImport = read("src/main/services/url-import-service.ts");
  assert.ok(urlImport.includes("opts?.parsePdf") && urlImport.includes("parsePdfText(buf)"), "T2: arXiv 注入 + 缺省文本层");

  const vision = read("src/main/services/pdf-math-vision.ts");
  assert.ok(vision.includes("ctx.flagOn !== true"), "T2: flag 关=文本层零变化");
  assert.ok(vision.includes("visionPdfReady(ctx.db)"), "T2: 视觉覆盖前提(BYOK)");
  assert.ok(vision.includes("$$..$$"), "T2: 页转写提示词要求 LaTeX");
  assert.ok(vision.includes('signal?.aborted) throw'), "T2: 取消穿透不吞");

  const page = read("src/main/services/pdf-page-image.ts");
  assert.ok(page.includes(').Path2D = Path2D'), "T2: Path2D 全局胶水(spike 实测必坑)");
  assert.ok(page.includes('await import("pdfjs-dist")'), "T2: 与 pdf-renderer 同入口(打包链已验证)");
  assert.ok(page.includes("standardFontDir()"), "T2: base-14 字体目录候选");
  assert.ok(page.includes("return null;"), "T2: 单页渲染失败不炸整本");

  assert.ok(read("vite.config.ts").includes('"@napi-rs/canvas"'), "T2: Electron 主束外部化 napi canvas");
  assert.ok(read("scripts/lib/build-server.mjs").includes('"@napi-rs/canvas"'), "T2: 移动束外部化(Android 无预编译)");

  const settings = read("src/renderer/components/SettingsView.tsx");
  assert.ok(settings.includes('setSetting("flag_math_vision"'), "T2: 设置页写 flag");
  assert.ok(settings.includes('testid="math-vision-toggle"'), "T2: 设置页开关行");
  const i18n = read("src/renderer/lib/i18n.ts");
  assert.equal(i18n.split('"settings.mathvision.toggle"').length - 1, 2, "T2: i18n 双语键");
}
console.log("✓ T2 管线接线");

console.log("T3 整页渲染单测(手工矢量 PDF → 文本层 + PNG,零 LLM)");
{
  // 手工构造最小单页 PDF(Helvetica 基础14 + 矢量矩形),字节级 ASCII 无偏移坑
  const content = "q 1 0 0 rg 50 50 200 100 re f Q BT /F1 24 Tf 60 700 Td (HELLO VISION PAGE) Tj ET";
  const objs = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    4: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  let pdf = "%PDF-1.4\n";
  const offsets = {};
  for (const i of [1, 2, 3, 4, 5]) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const i of [1, 2, 3, 4, 5]) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new TextEncoder().encode(pdf);

  const pages = await openPdfPages(bytes);
  try {
    assert.equal(pages.pageCount, 1, "单页文档");
    const text = await pages.pageText(0);
    assert.ok(text.includes("HELLO VISION PAGE"), `文本层含嵌入文本(实得: ${JSON.stringify(text.slice(0, 60))})`);
    const png = await pages.renderPage(0, 2);
    assert.ok(png && png.length > 2000, `整页渲染出非平凡 PNG(实得 ${png ? png.length : 0} 字节)`);
    assert.equal(png[0], 0x89, "PNG 魔数 0x89");
    assert.ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, "PNG 签名");
    assert.equal(await pages.renderPage(99, 2), null, "越界页返回 null 不炸");
  } finally {
    await pages.dispose();
  }
}
console.log("✓ T3 整页渲染");

console.log("\nverify-pdf-math-vision: ALL PASS");
