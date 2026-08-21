/**
 * Live test: PDF 公式密集页 vision 转写(v0.20 P6 端到端,需真实视觉模型)
 *
 * 跑法: npx tsx scripts/live-test/live-test-pdf-math-vision.mjs
 * 环境变量(可选):
 *   Z_AI_API_KEY            —— 智谱 key(_load-env 统一读)
 *   LOOKATSTUDY_VISION_MODEL —— 视觉模型名,默认 glm-4.6v
 *
 * 链路:手工构造"公式密集"PDF(WinAnsi ± 字形触发密度检测)→ parsePdfTextSmart
 * (flag on + 内存库视觉覆盖)→ 整页渲染 PNG → 真实 vision LLM 转 LaTeX →
 * 断言密集页被替换为含 $..$ 的 Markdown。零 key 时跳过(exit 0)。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { parsePdfTextSmart } from "../../src/main/services/pdf-math-vision.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("⚠️  无 API key,跳过 pdf-math-vision live test");
  process.exit(0);
}
const VISION_MODEL = process.env.LOOKATSTUDY_VISION_MODEL || "glm-4.6v";

// 内存库:视觉覆盖指向智谱(转写只碰视觉模型,主模型无关)
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
sqljs.run(
  "INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES ('custom-visiontest', 'visiontest', 'openai-compatible', 'https://api.z.ai/api/coding/paas/v4', ?, ?)",
  [API_KEY, VISION_MODEL],
);
sqljs.run("INSERT INTO settings (key, value) VALUES ('vision_provider_override', 'custom-visiontest')");
sqljs.run(`INSERT INTO settings (key, value) VALUES ('vision_model_override', '${VISION_MODEL}')`);
const db = drizzle(sqljs, { schema });

// 手工 PDF(latin1 字节级组装):一行正文 + 多行 × 密集行(WinAnsi 0xD7,
// pdfjs 提取为 × U+00D7 → 密度检测命中;± 会被替换成 – 不可用,实测)。
// 页面语义:几行 "a × b × c × d = n",视觉模型应转写为 $a \times b \times ...$。
const MUL = String.fromCharCode(0xd7);
const lineStr = (i) => `BT /F1 14 Tf 60 ${700 - i * 40} Td (x ${MUL} y ${MUL} z ${MUL} w = ${i + 1}) Tj ET`;
const contentLines = ["BT /F1 12 Tf 60 750 Td (Math worksheet) Tj ET", ...Array.from({ length: 8 }, (_, i) => lineStr(i))];
const content = Buffer.from(contentLines.join("\n"), "latin1");
const objs = {
  1: "<< /Type /Catalog /Pages 2 0 R >>",
  2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
};
const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
const offsets = {};
const sizeSoFar = () => parts.reduce((n, p) => n + p.length, 0);
for (const i of [1, 2, 3]) {
  offsets[i] = sizeSoFar();
  parts.push(Buffer.from(`${i} 0 obj\n${objs[i]}\nendobj\n`, "latin1"));
}
offsets[4] = sizeSoFar();
parts.push(
  Buffer.from(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`, "latin1"),
  content,
  Buffer.from("\nendstream\nendobj\n", "latin1"),
);
offsets[5] = sizeSoFar();
parts.push(Buffer.from(`5 0 obj\n${objs[5]}\nendobj\n`, "latin1"));
const xref = sizeSoFar();
parts.push(Buffer.from("xref\n0 6\n0000000000 65535 f \n", "latin1"));
for (const i of [1, 2, 3, 4, 5]) parts.push(Buffer.from(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`, "latin1"));
parts.push(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, "latin1"));
const pdfBytes = new Uint8Array(Buffer.concat(parts));

const progress = [];
const md = await parsePdfTextSmart(pdfBytes, {
  db,
  flagOn: true,
  onProgress: (m) => {
    progress.push(m);
    console.log("  [进度]", m);
  },
});

console.log("\n=== 断言 ===");
let pass = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (cond) pass++;
};

ok(progress.some((m) => m.includes("页公式密集")), "检测到公式密集页");
ok(md.includes("$"), "转写结果含 LaTeX($)");
ok(md.length > 40, `转写非平凡(${md.length} 字符)`);
ok(/Math|worksheet/i.test(md), "正文文字被转写(非幻觉)");
console.log("\n--- 转写片段 ---");
console.log(md.slice(0, 400));

if (pass < 4) {
  console.error(`\nlive-test-pdf-math-vision: FAIL (${pass}/4)`);
  process.exit(1);
}
console.log(`\nlive-test-pdf-math-vision: PASS (${pass}/4)`);
