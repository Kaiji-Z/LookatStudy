/**
 * live: 非仓库来源导入的真实链路核查(arXiv/网页/EPUB/docx/Whisper/yt-dlp)。
 * 解析层不需要 API key;末尾另有「全程落库」两档(2026-08-23):
 *   - 无 key 降级档:获取→解析→规则结构化→落库,断言最终课程形状(空 settings
 *     的内存库 → isLlmReady false → 管线自动走降级路径,与生产无 key 行为同构);
 *   - 有 key LLM 档:Z_AI_API_KEY 存在时完整跑 Step2/4 真实 LLM,再落库断言。
 * yt-dlp 未装、Whisper 模型缺、python-docx 缺时对应项 SKIP。
 * 跑法: npx tsx scripts/live-test/live-test-import-sources.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 有 key 灌 env(LLM 档用);无 key 也能跑(降级档+解析层)
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
/** 全程落库档复用(避免二次下载);用后由全程档清理 */
let epubBytes = null;
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
      epubBytes = new Uint8Array(readFileSync(tmp));
      book = await parseEpub(epubBytes);
    } catch (e) { lastErr = e.message; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// 全程落库两档(2026-08-23):不止验获取与解析,把真实来源一路跑到课程落库,
// 断言最终生成的课程形状。层与层的接缝(真实形状喂 Step4、Step4 产物落库)
// 是桩测不到的地方。无 key 档与生产"未配 key"行为同构;有 key 档跑真 LLM。
// ─────────────────────────────────────────────────────────────────────────────
const SQLW = await import("sql.js");
const initSqlJs = SQLW.default;
const { drizzle } = await import("drizzle-orm/sql-js");
const schemaMod = await import("../../src/main/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { runSmartImport } = await import("../../src/main/services/import-job-service.ts");
const { createPlanStore } = await import("../../src/main/services/import-plan-store.ts");
const schemaSqlLive = readFileSync(new URL("../../src/main/db/schema.sql", import.meta.url), "utf8");

/** 空设置内存库(→ isLlmReady=false → 管线自动降级);withKey 时按 .env 端点建
 *  custom provider 走真 LLM(不写死 glm 标准预设——.env 的 key 可能是 CodingPlan
 *  端点的,标准端点下会 401/余额不通,LLM 档就退化成了兜底分课,验不到真结构化) */
async function mkDeps(withKey = false) {
  const sqljs = new (await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) })).Database();
  sqljs.run(schemaSqlLive);
  const db = drizzle(sqljs, { schema: schemaMod });
  if (withKey && process.env.Z_AI_API_KEY) {
    const { settings: settingsTable, customProviders } = schemaMod;
    const pid = "custom-live-import";
    const baseUrl = process.env.Z_AI_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
    const model = process.env.Z_AI_MODEL || "glm-4.7";
    db.insert(customProviders).values({ id: pid, label: "live-import (.env)", kind: "llm", protocol: "openai-compatible", baseUrl, apiKey: process.env.Z_AI_API_KEY, defaultModel: model }).run();
    db.insert(settingsTable).values([
      { key: "active_provider", value: pid },
      { key: "active_model", value: model },
    ]).run();
  }
  return {
    db,
    store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-live-store-"))),
    markDirty: () => {},
    onProgress: (m) => console.log(`      · ${m}`),
    shouldAbort: () => false,
  };
}

/** 课程形状断言:标题非空/有章节/每课有正文/课数在合理区间 */
function assertCourseShape(deps, courseId, tag, { minLessonChars = 100 } = {}) {
  const { courses, contentNodes } = schemaMod;
  const course = deps.db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course || !course.title.trim()) throw new Error(`${tag}: 课程或标题缺失`);
  const nodes = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, courseId)).all();
  const sections = nodes.filter((n) => n.type === "section");
  const lessons = nodes.filter((n) => n.type === "lesson");
  if (sections.length < 1) throw new Error(`${tag}: 无章节`);
  if (lessons.length < 1) throw new Error(`${tag}: 无课时`);
  if (lessons.length > 60) throw new Error(`${tag}: 课时数异常上浮(${lessons.length})`);
  const empty = lessons.filter((l) => (l.content ?? "").trim().length < minLessonChars);
  if (empty.length > 0) throw new Error(`${tag}: ${empty.length} 节课正文过短(首例「${empty[0].title}」)`);
  return { title: course.title, sections: sections.length, lessons: lessons.length };
}

console.log("== 全程落库 · 无 key 降级档(arXiv URL → 课程) ==");
try {
  const deps = await mkDeps(false);
  const r = await runSmartImport({ kind: "url", url: "https://arxiv.org/abs/1706.03762" }, deps);
  const shape = assertCourseShape(deps, r.courseId, "arXiv 降级档");
  ok(`「${shape.title}」${shape.sections} 章 ${shape.lessons} 课,课程形状合法`);
} catch (e) { bad(e.message); }

console.log("== 全程落库 · 无 key 降级档(EPUB 真书 → 课程) ==");
if (!epubBytes) {
  skip("EPUB 未下载成功(上方解析层已报错)");
} else {
  try {
    const deps = await mkDeps(false);
    const r = await runSmartImport({ kind: "epub", fileName: "pride.epub", bytes: epubBytes }, deps);
    const shape = assertCourseShape(deps, r.courseId, "EPUB 降级档");
    ok(`「${shape.title}」${shape.sections} 章 ${shape.lessons} 课,课程形状合法`);
  } catch (e) { bad(e.message); }
  finally { rmSync(join(tmpdir(), "ls-live-epub.epub"), { force: true }); }
}

console.log("== 全程落库 · 无 key 降级档(docx+md 临时文件夹 → 课程) ==");
const pyProbe2 = spawnSync("python", ["-c", "import docx"], { encoding: "utf8", timeout: 15000 });
if (pyProbe2.status !== 0) {
  skip("python-docx 未安装(文件夹档需要)");
} else {
  let folderPath = null;
  try {
    folderPath = mkdtempSync(join(tmpdir(), "ls-live-folder-"));
    const docxPath = join(folderPath, "lesson1.docx");
    const gen = spawnSync("python", ["-c", [
      "from docx import Document",
      "d = Document()",
      'd.add_heading("Course Notes", level=1)',
      'd.add_paragraph("Chapter one body text with enough substance for a lesson. " * 20)',
      `d.save(r"${docxPath.replace(/\\/g, "/")}")`,
    ].join("\n")], { encoding: "utf8", timeout: 30000 });
    if (gen.status !== 0 || !existsSync(docxPath)) throw new Error(`docx 生成失败: ${gen.stderr?.slice(0, 120)}`);
    writeFileSync(join(folderPath, "lesson2.md"), "# Second Lesson\n\n" + "Markdown body with real content for the second lesson. ".repeat(30));
    const deps = await mkDeps(false);
    const r = await runSmartImport({ kind: "folder", path: folderPath }, deps);
    const shape = assertCourseShape(deps, r.courseId, "文件夹降级档");
    ok(`「${shape.title}」${shape.sections} 章 ${shape.lessons} 课,课程形状合法`);
  } catch (e) { bad(e.message); }
  finally { if (folderPath) rmSync(folderPath, { recursive: true, force: true }); }
}

console.log("== 全程落库 · 有 key LLM 档(arXiv URL → 课程,真实 Step2/4) ==");
if (!process.env.Z_AI_API_KEY) {
  skip("无 Z_AI_API_KEY(配 .env 后此档跑真实 LLM 结构化)");
} else {
  try {
    const deps = await mkDeps(true);
    const r = await runSmartImport({ kind: "url", url: "https://arxiv.org/abs/1706.03762" }, deps);
    const shape = assertCourseShape(deps, r.courseId, "arXiv LLM 档");
    ok(`「${shape.title}」${shape.sections} 章 ${shape.lessons} 课,LLM 结构化课程形状合法`);
  } catch (e) { bad(e.message); }
}

console.log(`\n=== 导入来源 live 核查: ${failed === 0 ? "✅ 全部通过" : "❌"} (skip ${skipped}) ===`);
process.exit(failed === 0 ? 0 : 1);
