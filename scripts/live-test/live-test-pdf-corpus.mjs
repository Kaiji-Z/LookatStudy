/**
 * live: PDF 提取语料核查(2026-08-23,多样本采样驱动)。
 *
 * 8 个真实样本(缓存 scripts/fixtures/pdf-corpus/,gitignored;缺则按 URL 下载,
 * 不可达记 SKIP):arXiv 双栏论文×2 / 表格密集论文(GPT-3)/ beamer 课件型 /
 * 中文单栏技术书(d2l-zh,GitHub release,gh CLI 可代下)/ 英文单栏 RFC 长文 /
 * 合成扫描版(无文本层)。断言四类硬指标:
 *   1. 正文量:每真样本 inspector 输出 ≥ 1 万字符(扫描版除外);
 *   2. 康熙部首区零残留:中文提取不落在 U+2F00 区(d2l-zh 实测曾 2.3 万字符,
 *      画线/朗读/检索在部首区全断——normalizeRadicals 修);
 *   3. 标题可辨:输出头部含来源标题关键词;
 *   4. 扫描版分层诚实:pdf-text 层返回空(文件夹路径容错),不产出垃圾字符。
 * 跑法: npx tsx scripts/live-test/live-test-pdf-corpus.mjs(需网络首次)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试不需要 key —— no key ok,纯下载+解析)
let failed = 0, skipped = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const skip = (m) => { console.log(`  ⏭️  SKIP ${m}`); skipped++; };
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

const SAMPLES = [
  // [id, 说明, 下载URL|null=本地合成, 期望头关键词, 最小字数]
  ["arxiv-attention", "双栏论文", "https://export.arxiv.org/pdf/1706.03762", "Attention", 20000],
  ["arxiv-bert", "双栏论文", "https://export.arxiv.org/pdf/1810.04805", "BERT", 40000],
  ["arxiv-gpt3", "表格密集论文", "https://export.arxiv.org/pdf/2005.14165", "Language Models", 150000],
  ["arxiv-beamer", "beamer 课件型", "https://export.arxiv.org/pdf/1606.05908", "Tutorial", 30000],
  ["d2l-zh-pytorch", "中文单栏技术书", "https://github.com/d2l-ai/d2l-zh/releases/download/v2.0.0/d2l-zh-pytorch-2.0.0.pdf", "深度学习", 500000],
  ["rfc2616", "英文单栏RFC长文", "https://www.rfc-editor.org/rfc/rfc2616.pdf", "Hypertext", 300000],
];

mkdirSync("scripts/fixtures/pdf-corpus", { recursive: true });
const { parsePdfText } = await import("../../src/main/lib/pdf-text.ts");

for (const [id, note, url, headKeyword, minChars] of SAMPLES) {
  const cache = `scripts/fixtures/pdf-corpus/${id}.pdf`;
  if (!existsSync(cache)) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("非 PDF");
      writeFileSync(cache, b);
    } catch (e) {
      skip(`${id} [${note}] 下载失败: ${e.message}(可用 gh release download 手动补 d2l)`);
      continue;
    }
  }
  try {
    const md = await parsePdfText(readFileSync(cache));
    const radicals = (md.match(/[\u2F00-\u2FDF]/g) ?? []).length;
    const headOk = md.slice(0, 3000).includes(headKeyword);
    if (md.length >= minChars && radicals === 0 && headOk) {
      ok(`${note}(${id}): ${md.length} 字,部首 0,标题可辨`);
    } else {
      bad(`${note}(${id}): len=${md.length}(≥${minChars}?) 部首=${radicals} 标题命中=${headOk}`);
    }
  } catch (e) { bad(`${id}: ${e.message}`); }
}

// 合成扫描版:无文本层 → pdf-text 返回空(文件夹路径容错),不产垃圾
try {
  const scannedPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Resources<</XObject<</Im0 5 0 R>>>>/Contents 4 0 R>>endobj\n" +
    "4 0 obj<</Length 44>>stream\nq 200 0 0 100 0 0 cm /Im0 Do Q\nendstream\nendobj\n" +
    "5 0 obj<</Type/XObject/Subtype/Image/Width 2/Height 1/ColorSpace/DeviceGray/BitsPerComponent 8/Length 2>>stream\n\xff\x80\nendstream\nendobj\n" +
    "trailer<</Root 1 0 R>>", "latin1");
  const r = await parsePdfText(scannedPdf);
  if (r === "") ok(`扫描版(合成): 空串返回(文件夹路径容错,arXiv 路径上层另有"扫描版"诚实报错)`);
  else bad(`扫描版应返回空,实际 "${r.slice(0, 40)}"`);
} catch (e) { bad(`扫描版: ${e.message}`); }

console.log(`\n=== PDF 语料核查: ${failed === 0 ? "✅ 全部通过" : "❌"} (skip ${skipped}) ===`);
process.exit(failed === 0 ? 0 : 1);
