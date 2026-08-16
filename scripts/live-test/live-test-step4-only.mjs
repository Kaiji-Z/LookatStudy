/**
 * Live test: 只跑 Step 4(结构设计)—— 用 plan 快照里的前三步产物直喂,零 GitHub 网络。
 *
 * 背景:Step1-3 已验证无问题,Step4 是截断事发地;网络(fastgithub 半死/CDN 抖)与
 * LLM 问题无关,直接绕开。
 *
 * 跑法: npx tsx scripts/live-test/live-test-step4-only.mjs <plan.json>
 * plan 来自被杀实测的快照(reachedStep≥3:readme/classification/outlines 全)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { designCourseStructure } from "../../src/main/services/import-llm-service.ts";

const planPath = process.argv[2];
if (!planPath) {
  console.error("用法: npx tsx live-test-step4-only.mjs <plan.json>");
  process.exit(1);
}
const API_KEY = readApiKey();
if (!API_KEY) {
  console.error("❌ 无 Z_AI_API_KEY");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (!plan.classification || !plan.outlines) {
  console.error(`❌ 快照不完整(reachedStep=${plan.reachedStep}),需要含 classification+outlines`);
  process.exit(1);
}

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const sqljs = new SQL.Database();
sqljs.run(readFileSync(new URL("../../src/main/db/schema.sql", import.meta.url), "utf8"));
sqljs.run(
  `INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model)
   VALUES ('custom-live-test', 'ZAI CodingPlan (live test)', 'openai-compatible',
           'https://api.z.ai/api/coding/paas/v4', ?, 'glm-5.2')`,
  [API_KEY],
);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-live-test')`);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')`);
const db = drizzle(sqljs, { schema });

const outlines = new Map(Object.entries(plan.outlines));
const t0 = Date.now();
const send = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);
console.log(`=== Step 4 直通: ${plan.classification.original.length} original + ${plan.classification.practice.length} practice,共 ${outlines.size} 大纲 ===\n`);

try {
  const structure = await designCourseStructure(
    db,
    plan.readmeMd,
    outlines,
    plan.classification.original,
    plan.classification.practice,
    send,
    [],
  );
  const lessons = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
  console.log(`\n=== Step 4 完成 === ${structure.sections.length} 章 · ${lessons} 课 · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const s of structure.sections) console.log(`  [${s.world}] ${s.title} (${s.lessons.length} 课)`);
} catch (e) {
  console.error(`\n=== Step 4 失败 === ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
