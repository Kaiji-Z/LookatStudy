/**
 * live: 非仓库来源导入的真实链路核查(arXiv/网页/EPUB/docx/Whisper/yt-dlp)。
 * 不需要 API key(只测获取与解析层,不跑 LLM);yt-dlp 未装、Whisper 模型缺、
 * python-docx 缺时对应项 SKIP。跑法: npx tsx scripts/live-test/live-test-import-sources.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试本身不依赖 key)
let failed = 0, skipped = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const skip = (m) => { console.log(`  ⏭️  SKIP ${m}`); skipped++; };
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

console.log("== arXiv 真实论文(abs 标题 + PDF 正文) ==");
try {
  const { fetchArxivMarkdown } = await import("../../src/main/services/url-import-service.ts");
  const r = await fetchArxivMarkdown("1706.03762", "https://export.arxiv.org/pdf/1706.03762", "https://arxiv.org/abs/1706.03762", fetch, () => {}, undefined);
  if (r.markdown.length > 5000 && /attention/i.test(r.title)) ok(`${r.title} · ${r.markdown.length} 字`);
  else bad(`内容异常: title=${r.title} len=${r.markdown.length}`);
} catch (e) { bad(e.message); }

console.log("== 网页文章真实正文抽取 ==");
try {
  const { fetchArticleMarkdown } = await import("../../src/main/services/url-import-service.ts");
  const r = await fetchArticleMarkdown("https://paulgraham.com/greatwork.html", fetch, undefined);
  if (r.markdown.length > 10000) ok(`${r.title} · ${r.markdown.length} 字`);
  else bad(`正文过短: ${r.markdown.length}`);
} catch (e) { bad(e.message); }

console.log("== EPUB 真书(Gutenberg 傲慢与偏见) ==");
try {
  const tmp = join(tmpdir(), "ls-live-epub.epub");
  // Gutenberg 从国内直连偶发连接重置,重试 3 次 + zip 完整性校验(半截文件不是 zip)
  const { parseEpub } = await import("../../src/main/lib/epub-parser.ts");
  let book = null;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3 && !book; attempt++) {
    try {
      const resp = await fetch("https://www.gutenberg.org/ebooks/1342.epub.noimages", { redirect: "follow" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
      const head = readFileSync(tmp).subarray(0, 2).toString("latin1");
      if (head !== "PK") throw new Error("下载不完整(非 zip 头)");
      book = await parseEpub(new Uint8Array(readFileSync(tmp)));
    } catch (e) { lastErr = e.message; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
  rmSync(tmp, { force: true });
  if (!book) throw new Error(lastErr || "下载失败");
  if (book.chapters.length >= 10) ok(`${book.title} · ${book.chapters.length} 章`);
  else bad(`章节数异常: ${book.chapters.length}`);
} catch (e) { bad(e.message); }

console.log("== docx 真实 Word 生态文件(python-docx 生成) ==");
const pyProbe = spawnSync("python", ["-c", "import docx"], { encoding: "utf8", timeout: 15000 });
if (pyProbe.status !== 0) {
  skip("python-docx 未安装(pip install python-docx 后可测)");
} else {
  try {
    const docxPath = join(tmpdir(), "ls-live-docx.docx");
    const gen = spawnSync("python", ["-c", [
      "from docx import Document",
      "d = Document()",
      'd.add_heading("Live Test Doc", level=0)',
      'd.add_heading("Chapter One", level=1)',
      'd.add_paragraph("Real paragraph text for parsing.")',
      'd.add_heading("Chapter Two", level=1)',
      'd.add_paragraph("Second chapter body.")',
      `d.save(r"${docxPath.replace(/\\/g, "/")}")`,
    ].join("\n")], { encoding: "utf8", timeout: 30000 });
    if (gen.status !== 0 || !existsSync(docxPath)) throw new Error(`生成失败: ${gen.stderr?.slice(0, 120)}`);
    const { parseDocx } = await import("../../src/main/lib/docx-parser.ts");
    const md = await parseDocx(readFileSync(docxPath));
    rmSync(docxPath, { force: true });
    if (md.includes("# Live Test Doc") && md.includes("# Chapter One") && md.includes("Second chapter body.")) ok(`标题+正文保真(${md.length} 字)`);
    else bad(`解析结果异常: ${JSON.stringify(md.slice(0, 120))}`);
  } catch (e) { bad(e.message); }
}

console.log("== Whisper 真实转写(B站音轨 60s 切片,与音频导入同链) ==");
try {
  const dataDir = join(process.env.APPDATA ?? process.env.HOME ?? "", "LookatStudy");
  const { pickLocalWhisperEntry } = await import("../../src/main/services/speech/asr-service.ts");
  if (!pickLocalWhisperEntry(dataDir, {})) {
    skip("本地 Whisper 模型未就绪(设置→语音模型下载后可测,不在本测试自动下 1GB)");
  } else {
    const { fetchBilibiliAudio } = await import("../../src/main/services/video-import-service.ts");
    const v = await fetchBilibiliAudio("https://www.bilibili.com/video/BV1GJ411x7h7?p=1", fetch, () => {}, undefined);
    const { decodeAudioTo16kMono } = await import("../../src/main/services/speech/audio-file-decode.ts");
    const pcm = await decodeAudioTo16kMono(v.bytes, "m4a");
    const { transcribePcmChunked } = await import("../../src/main/services/speech/asr-service.ts");
    const r = await transcribePcmChunked(dataDir, {}, pcm.subarray(0, 16000 * 60), undefined, {});
    if (r.text.trim().length > 0) ok(`60s 音轨 → ${r.chunks} 段,文本头: ${r.text.slice(0, 50)}`);
    else bad("转写结果为空");
  }
} catch (e) { bad(e.message); }

console.log("== yt-dlp 路径(未装则 SKIP;装了用B站 URL 真测拉起/字幕探测/音轨) ==");
try {
  const { ytDlpPath, fetchViaYtDlp } = await import("../../src/main/services/video-import-service.ts");
  if (!ytDlpPath()) {
    skip("yt-dlp 未安装(Windows: winget install yt-dlp.yt-dlp)");
  } else {
    const dataDir = join(process.env.APPDATA ?? process.env.HOME ?? "", "LookatStudy");
    const r = await fetchViaYtDlp("https://www.bilibili.com/video/BV1GJ411x7h7", dataDir, () => {}, undefined);
    if (r.source === "audio" && r.bytes.length > 100000) ok(`音轨 ${r.bytes.length} bytes(YouTube 直连受网络限制,B站代测机器链路)`);
    else if (r.source === "subtitle" && r.text.length > 50) ok(`字幕路径 ${r.text.length} 字`);
    else bad(`结果异常: source=${r.source}`);
  }
} catch (e) { bad(e.message); }

console.log(`\n=== 导入来源 live 核查: ${failed === 0 ? "✅ 全部通过" : "❌"} (skip ${skipped}) ===`);
process.exit(failed === 0 ? 0 : 1);
