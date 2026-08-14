/**
 * 本地导入管线端到端 live test（隔离验证 Layer A 修复）。
 *
 * 目的：证明 import:localFolder 整条链路（扫描→docsToDiscoveredFiles→LLM 分类→
 * LLM 结构设计→executeImport）对一个纯 .txt/.html/.pdf 的文件夹**真的能产出非空课程**。
 * 这正是用户的 Bug（D:\...\mathematics-for-machine-learning-and-data-science_files，
 * 438 .txt + 91 .html + 11 .pdf → 空课程）。修复前 fileList 被滤空 → sections=[] → 空课程。
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

// ── 构造一个纯 .txt/.html/.pdf 的测试文件夹（镜像用户 Bug 场景的格式组合）──
const folder = join(tmpdir(), `lookatstudy-local-import-test-${Date.now()}`);
mkdirSync(folder, { recursive: true });
try {
  writeFileSync(join(folder, "01-derivatives.txt"),
    "# 导数\n\n导数衡量函数在某一点的瞬时变化率。几何上它等于切线的斜率。\n\n例如 f(x)=x^2 的导数是 f'(x)=2x。导数是微积分的核心概念之一。\n");
  writeFileSync(join(folder, "02-integrals.html"),
    "<!DOCTYPE html><html><head><title>积分</title></head><body><h1>积分</h1><p>定积分计算函数曲线下的面积。它是求导的逆运算。例如 x 从 0 到 1 的积分等于 1/2。</p></body></html>");
  writeFileSync(join(folder, "03-matrices.pdf"), makeMinimalPdf("Matrices and vectors are the core of linear algebra."));

  console.log(`=== 测试文件夹: ${folder}（含 .txt/.html/.pdf 各 1）===\n`);

  // Step 1: 扫描
  console.log("=== Step 1: buildLocalInventory 扫描 ===");
  const inventory = await buildLocalInventory(folder);
  console.log(`  docs: ${inventory.docs.length} 个 → 扩展名: ${inventory.docs.map((d) => d.path.split(".").pop()).join(", ")}`);
  assert.equal(inventory.docs.length, 3, "扫描器应识别 3 个文档（txt/html/pdf）");

  // Step 2: docsToDiscoveredFiles（本修复的核心）—— 修复前 pathsToDiscoveredFiles 会丢光
  console.log("\n=== Step 2: docsToDiscoveredFiles（Layer A 修复点）===");
  const fileList = docsToDiscoveredFiles(inventory.docs);
  console.log(`  fileList: ${fileList.length} 个 → ${fileList.map((f) => f.path.split("/").pop()).join(", ")}`);
  assert.equal(fileList.length, 3, "docsToDiscoveredFiles 必须保留全部 3 个（含 txt/html/pdf）");
  const exts = fileList.map((f) => f.path.split(".").pop()).sort();
  assert.deepEqual(exts, ["html", "pdf", "txt"], "txt/html/pdf 三种格式都在");

  // Step 3: LLM 分类
  console.log("\n=== Step 3: classifyFileRoles（LLM）===");
  const roles = await classifyFileRoles(db, inventory.readmeMd, fileList, inventory.fullTree,
    (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`));
  console.log(`\n  original: ${roles.original.length} · practice: ${roles.practice.length} · skip: ${roles.skip.length}`);
  const candidateCount = roles.original.length + roles.practice.length;
  assert.ok(candidateCount > 0, `LLM 应至少把 1 个文档判为 original/practice（不能全 skip），实际 candidate=${candidateCount}`);

  // Step 4: 大纲
  console.log("\n=== Step 4: extractOutlineWithCharCounts ===");
  const allFiles = [...roles.original, ...roles.practice];
  const outlines = new Map();
  for (const p of allFiles) {
    const c = inventory.docs.find((d) => d.path === p)?.content;
    if (c) outlines.set(p, extractOutlineWithCharCounts(c, p));
  }
  console.log(`  提取 ${outlines.size} 个文件大纲`);

  // Step 5: LLM 结构设计
  console.log("\n=== Step 5: designCourseStructure（LLM）===");
  const standaloneImgList = inventory.standaloneImages.map((i) => ({ path: i.path, alt: i.altText }));
  const structure = await designCourseStructure(db, inventory.readmeMd, outlines,
    roles.original, roles.practice, (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`), standaloneImgList);
  const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
  console.log(`\n  课程标题: ${structure.courseTitle || "(空)"} · sections: ${structure.sections.length} · lessons: ${lessonCount}`);

  // Step 6: executeImport 落库
  console.log("\n=== Step 6: executeImport 落库 ===");
  const docsMap = new Map();
  for (const d of inventory.docs) docsMap.set(d.path, d.content);
  const result = await executeImport(db, structure, {
    source: new LocalContentSource(folder, docsMap),
    repoUrl: null,
    repoName: "local-test-course",
    langCode: null,
    translationFiles: null,
    sourceLang: roles.sourceLang,
    markDirty: () => {},
  }, (m) => process.stdout.write(`\r  ${m.slice(0, 70).padEnd(70)}`));

  console.log(`\n  courseId: ${result.courseId}`);
  console.log(`  验证: ${result.verification.ok ? "✅ 通过" : "❌ 有问题"}`);
  console.log(`  stats: ${JSON.stringify(result.verification.stats)}`);

  // ── 核心断言：非空课程（修复前这里是 0 lessons 的空课程）──
  assert.ok(result.verification.stats.lessons > 0,
    `【关键】本地管线必须产出非空课程！lessons=${result.verification.stats.lessons}（修复前为 0）`);
  const dbLessonCount = sqljs.exec("SELECT COUNT(*) FROM content_nodes WHERE type='lesson'")[0].values[0][0];
  assert.equal(dbLessonCount, result.verification.stats.lessons, "DB lesson 数应与验证统计一致");
  console.log(`\n✅✅✅ 本地管线端到端成功：产出 ${dbLessonCount} 个 lesson 的课程（修复前=空课程）✅✅✅`);

  console.log("\n=== live-test-local-import 通过 ✅ ===");
} finally {
  // 清理临时文件夹
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
