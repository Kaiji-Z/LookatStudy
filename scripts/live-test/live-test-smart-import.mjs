/**
 * 新智能导入管线完整测试（Step 1 → 5）。
 * 不依赖 electron，直接用 in-memory DB 跑。
 *
 * 用法: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/live-test/live-test-smart-import.mjs
 * 需要: Z_AI_API_KEY
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { fetchRepoInventory, fetchFileOutlines } from "../../src/main/services/pure/repo-fetcher.ts";
import { classifyFileRoles, designCourseStructure } from "../../src/main/services/import-llm-service.ts";
import { executeImport } from "../../src/main/services/import-pipeline.ts";

const API_KEY = readApiKey();
if (!API_KEY) { console.error("⏭️ 跳过:需要 Z_AI_API_KEY(live-test 可选,缺 key 时 graceful skip)"); process.exit(0); }
console.log(`API key: ✅\n`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// === 建 in-memory DB ===
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
try { sqljs.run("ALTER TABLE content_nodes ADD COLUMN world TEXT NOT NULL DEFAULT 'study'"); } catch {}

if (API_KEY) {
  sqljs.run("INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES (?, ?, ?, ?, ?, ?)",
    ["custom-test", "ZAI", "openai-compatible", "https://api.z.ai/api/coding/paas/v4", API_KEY, "glm-4.6"]);
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-test')");
  sqljs.run("INSERT INTO settings (key, value) VALUES ('active_model', 'glm-4.6')");
}
const db = drizzle(sqljs, { schema });

const OWNER = "microsoft";
const REPO = "AI-For-Beginners";

// === Step 1: 拉取仓库清单 ===
console.log("=== Step 1: 拉取仓库清单 ===");
const inventory = await fetchRepoInventory(OWNER, REPO, "main", fetch, (msg) => process.stdout.write(`\r  ${msg.slice(0,70).padEnd(70)}`));
console.log(`\n  README: ${inventory.readmeMd.length} 字符`);
console.log(`  文件: ${inventory.fileList.length} 个`);
console.log(`  形态: ${inventory.detection.pattern}`);

// === Step 2: LLM 判文件角色 ===
console.log("\n=== Step 2: LLM 判文件角色 ===");
const roles = await classifyFileRoles(db, inventory.readmeMd, inventory.fileList, (msg) => process.stdout.write(`\r  ${msg.slice(0,70).padEnd(70)}`));
console.log(`\n  原文课程: ${roles.original.length} 个`);
console.log(`  实操: ${roles.practice.length} 个`);
console.log(`  噪声: ${roles.skip.length} 个`);
console.log(`  翻译语言: ${roles.languages.length} 种 → ${roles.languages.map(l => l.code).join(", ")}`);

// === Step 3: 提取标题大纲 ===
console.log("\n=== Step 3: 提取标题大纲 ===");
const allFiles = [...roles.original, ...roles.practice];
const outlines = await fetchFileOutlines(allFiles, OWNER, REPO, inventory.branch, fetch, (done, total) => process.stdout.write(`\r  ${done}/${total}`));
console.log(`\n  提取了 ${outlines.size} 个文件的标题大纲`);

// === Step 4: LLM 设计课程结构 ===
console.log("\n=== Step 4: LLM 设计课程结构 ===");
const structure = await designCourseStructure(db, inventory.readmeMd, outlines, roles.original, roles.practice, (msg) => process.stdout.write(`\r  ${msg.slice(0,70).padEnd(70)}`));
console.log(`\n  课程标题: ${structure.courseTitle}`);
console.log(`  sections: ${structure.sections.length}`);
for (const sec of structure.sections) {
  const icon = sec.world === "practice" ? "🔧" : "📚";
  console.log(`  ${icon} [${sec.world}] ${sec.title} (${sec.lessons.length} lessons)`);
}

// === Step 5: 拉正文 + 图片内联 + 落库 ===
console.log("\n=== Step 5: 拉正文 + 图片 + 落库 ===");
const result = await executeImport(db, structure, {
  owner: OWNER, repo: REPO, branch: inventory.branch, fetchFn: fetch,
  repoUrl: `https://github.com/${OWNER}/${REPO}`, repoName: REPO,
  langCode: null, translationFiles: null,
  markDirty: () => {},
}, (msg) => process.stdout.write(`\r  ${msg.slice(0,70).padEnd(70)}`));
console.log(`\n  courseId: ${result.courseId}`);
console.log(`  验证: ${result.verification.ok ? "✅ 通过" : "❌ 有问题"}`);
console.log(`  stats: ${JSON.stringify(result.verification.stats, null, 2)}`);
if (result.verification.issues.length > 0) {
  console.log(`  issues:`);
  result.verification.issues.slice(0, 5).forEach(i => console.log(`    - ${i}`));
}

console.log("\n=== 测试完成 ===");
