/**
 * 本地导入管线端到端 live test（隔离验证 Layer A 修复 + 双语翻译管线）。
 *
 * 场景镜像用户 Bug：xxx.en.txt / xxx.zh-CN.txt 成对的双语文件夹。
 * 断言：
 *   1. txt/html/pdf 全部进入 fileList（修复前被 pathsToDiscoveredFiles 滤光）
 *   2. zh-CN 翻译文件被分流（不重复成课）+ 显式配对
 *   3. 落库后 content_node_translations 有 zh-CN 行（修复前翻译表全空）
 *   4. 课程非空
 *
 * 用法: npx tsx scripts/live-test/live-test-local-import.mjs
 * 需要: Z_AI_API_KEY（缺则 graceful skip, exit 0）
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { readApiKey } from "./_load-env.mjs";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { buildLocalInventory } from "../../src/main/services/pure/local-folder-scanner.ts";
import { docsToDiscoveredFiles, extractOutlineWithCharCounts } from "../../src/main/services/pure/repo-fetcher.ts";
import { classifyFileRoles, designCourseStructure } from "../../src/main/services/import-llm-service.ts";
import { executeImport } from "../../src/main/services/import-pipeline.ts";
import { LocalContentSource } from "../../src/main/services/content-source.ts";
import { resolveImportLang } from "../../src/main/services/lang-pref.ts";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.error("⏭️ 跳过: 需要 Z_AI_API_KEY（live-test 可选, 缺 key 时 graceful skip）");
  process.exit(0);
}
console.log("API key: ✅\n");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// ── 建 in-memory DB + 注入 ZAI provider（复刻 dev seed: glm-5.2）──
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
sqljs.run("INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES (?, ?, ?, ?, ?, ?)",
  ["custom-test", "ZAI", "openai-compatible", "https://api.z.ai/api/coding/paas/v4", API_KEY, "glm-5.2"]);
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-test')");
sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')");
const db = drizzle(sqljs, { schema });

// ── 构造双语测试文件夹（en.txt/zh-CN.txt 成对 + html + pdf，镜像用户场景）──
const folder = join(tmpdir(), `lookatstudy-local-import-test-${Date.now()}`);
mkdirSync(folder, { recursive: true });
const EN_TXT = "01-derivatives.en.txt";
const ZH_TXT = "01-derivatives.zh-CN.txt";
const EN = "# Derivatives\n\nA derivative measures the rate of change of a function. For f(x)=x^2, the derivative is f'(x)=2x.";
const ZH = "# 导数\n\n导数衡量函数在某一点的瞬时变化率。例如 f(x)=x^2 的导数是 f'(x)=2x。";
try {
  writeFileSync(join(folder, EN_TXT), EN);
  writeFileSync(join(folder, ZH_TXT), ZH);
  writeFileSync(join(folder, "02-integrals.html"),
    "<!DOCTYPE html><html><head><title>Integrals</title></head><body><h1>Integrals</h1><p>A definite integral computes the area under a curve.</p></body></html>");
  writeFileSync(join(folder, "03-matrices.pdf"), makeMinimalPdf("Matrices and vectors are the core of linear algebra."));

  console.log(`=== 测试文件夹: ${folder}（en.txt/zh-CN.txt 成对 + html + pdf）===\n`);

  // Step 1: 扫描
  console.log("=== Step 1: buildLocalInventory 扫描 ===");
  const inventory = await buildLocalInventory(folder);
  console.log(`  docs: ${inventory.docs.length} 个`);
  assert.equal(inventory.docs.length, 4, "扫描器应识别 4 个文档（en.txt/zh-CN.txt/html/pdf）");

  // Step 2: docsToDiscoveredFiles（本修复的核心）
  console.log("\n=== Step 2: docsToDiscoveredFiles（Layer A 修复点）===");
  const fileList = docsToDiscoveredFiles(inventory.docs);
  assert.equal(fileList.length, 4, "必须保留全部 4 个（含 txt/html/pdf）");
  console.log(`  fileList: ${fileList.length} 个 ✅`);

  // Step 3: LLM 分类（含双语分流断言）
  console.log("\n=== Step 3: classifyFileRoles（LLM + 规则分流）===");
  const roles = await classifyFileRoles(db, inventory.readmeMd, fileList, inventory.fullTree,
    (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`));
  console.log(`\n  original: ${roles.original.length} · practice: ${roles.practice.length} · skip: ${roles.skip.length}`);
  console.log(`  翻译语言: ${roles.languages.map((l) => l.code).join(", ")} · layout: ${roles.translationLayout} · sourceLang: ${roles.sourceLang}`);
  const candidates = [...roles.original, ...roles.practice];
  assert.ok(candidates.length > 0, "应有原文候选");
  // ★ 双语分流: zh-CN 文件不进原文候选（修复前会混进去重复成课）
  assert.ok(!candidates.includes(ZH_TXT), `zh-CN 翻译文件必须被分流出原文候选, 实际: ${candidates.join(",")}`);
  // ★ 翻译表 + 显式配对
  assert.ok(roles.translations.get("zh-CN")?.includes(ZH_TXT), "zh-CN 文件应进 translations 表");
  assert.equal(roles.translationPairs.get(EN_TXT), ZH_TXT, "应有 en→zh-CN 显式配对");
  assert.ok(roles.languages.some((l) => l.code === "zh-CN"), "语言列表应含 zh-CN");
  console.log("  ★ 双语分流 + 配对 + 语言列表 全部正确 ✅");

  // Step 4: 大纲
  console.log("\n=== Step 4: extractOutlineWithCharCounts ===");
  const outlines = new Map();
  for (const p of candidates) {
    const c = inventory.docs.find((d) => d.path === p)?.content;
    if (c) outlines.set(p, extractOutlineWithCharCounts(c, p));
  }
  console.log(`  提取 ${outlines.size} 个文件大纲`);

  // Step 5: LLM 结构设计
  console.log("\n=== Step 5: designCourseStructure（LLM）===");
  const structure = await designCourseStructure(db, inventory.readmeMd, outlines,
    roles.original, roles.practice, (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`), []);
  const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
  console.log(`\n  课程: ${structure.sections.length} 章 · ${lessonCount} 课`);

  // Step 6: executeImport 落库（语言决策复刻 handler: pref=zh-CN）
  console.log("\n=== Step 6: executeImport 落库（含翻译）===");
  const { langCode: selectedLang, reason } = resolveImportLang("zh-CN", roles.sourceLang, roles.languages);
  console.log(`  语言决策: ${reason} → langCode=${selectedLang ?? "(原文)"}`);
  const docsMap = new Map();
  for (const d of inventory.docs) docsMap.set(d.path, d.content);
  const result = await executeImport(db, structure, {
    source: new LocalContentSource(folder, docsMap),
    repoUrl: null,
    repoName: "local-bilingual-test",
    langCode: selectedLang,
    translationFiles: selectedLang ? new Map([[selectedLang, roles.translations.get(selectedLang) ?? []]]) : null,
    translationPairs: roles.translationPairs,
    sourceLang: roles.sourceLang,
    translationLayout: roles.translationLayout,
    markDirty: () => {},
  }, (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`));

  console.log(`\n  验证: ${result.verification.ok ? "✅ 通过" : "❌ 有问题"} · stats: ${JSON.stringify(result.verification.stats)}`);

  // ── 核心断言 ──
  const dbLessons = sqljs.exec("SELECT COUNT(*) FROM content_nodes WHERE type='lesson'")[0].values[0][0];
  assert.ok(dbLessons > 0, `课程非空, lessons=${dbLessons}`);
  // zh-CN 文件绝不成为 lesson（无重复课）
  const zhAsLesson = sqljs.exec(`SELECT COUNT(*) FROM content_nodes WHERE source_path = '${ZH_TXT}'`)[0].values[0][0];
  assert.equal(zhAsLesson, 0, "zh-CN 翻译文件不应成为 lesson（不重复成课）");
  // 翻译表有 zh-CN 行且内容正确
  const transRows = sqljs.exec("SELECT locale, content FROM content_node_translations");
  assert.ok(transRows.length >= 1, `翻译表应有 zh-CN 行, 实际 ${transRows.length}`);
  assert.equal(transRows[0].values[0][0], "zh-CN", "locale=zh-CN");
  assert.equal(transRows[0].values[0][1], ZH, "翻译内容 = 中文文件全文");

  // ── 首次点击预热：一次 LLM 调用同时落 summary + knowledge_points ──
  console.log("\n=== 首次点击预热: generateLessonSummary（真实 LLM, 摘要+KC 一次产出）===");
  const { generateLessonSummary } = await import("../../src/main/services/course-structure-service.ts");
  const firstLessonId = sqljs.exec("SELECT id FROM content_nodes WHERE type='lesson' LIMIT 1")[0].values[0][0];
  const summary = await generateLessonSummary(db, firstLessonId, () => {});
  assert.ok(summary && summary.length >= 8, `应生成摘要, got ${JSON.stringify(summary)}`);
  const rowAfter = sqljs.exec(`SELECT summary, knowledge_points FROM content_nodes WHERE id = '${firstLessonId}'`)[0].values[0];
  assert.equal(rowAfter[0], summary, "summary 已落库（非内存缓存）");
  assert.ok(rowAfter[1], "knowledge_points 已落库");
  const kps = JSON.parse(rowAfter[1]);
  assert.ok(Array.isArray(kps) && kps.length >= 2 && kps.length <= 7, `KC 应 2-7 个, 实际 ${kps?.length}`);
  assert.ok(kps.every((k) => typeof k.title === "string" && k.title.trim() && typeof k.description === "string"), "KC title/description 格式");
  // 二次调用：摘要+KC 双字段齐备 → 纯 DB 命中，不再调 LLM（省 token）
  const again = await generateLessonSummary(db, firstLessonId, () => {});
  assert.equal(again, summary, "二次调用纯命中（幂等）");
  console.log(`  摘要: ${summary.slice(0, 50)}`);
  console.log(`  KC(${kps.length}): ${kps.map((k) => k.title).join(" / ")}`);
  console.log("  ★ 摘要+KC 一次调用双落库 + 二次命中 ✅");

  console.log(`\n✅✅✅ 双语本地导入端到端成功：${dbLessons} 课（无重复）+ zh-CN 翻译落库 + 首点 KC 预热 ✅✅✅`);

  console.log("\n=== live-test-local-import 通过 ✅ ===");
} finally {
  try { rmSync(folder, { recursive: true, force: true }); } catch {}
}

/** 生成一个最小但合法的单页 PDF（含可提取文本），供 parsePdfText 验证 .pdf 路径。 */
function makeMinimalPdf(text) {
  const safe = text.replace(/[()\\]/g, "\\$&");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ];
  const stream = `BT /F1 24 Tf 70 700 Td (${safe}) Tj ET`;
  objs.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}
