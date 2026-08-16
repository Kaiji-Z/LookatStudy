/**
 * Live test: 新 5 步导入管线(runSmartImport,生产路径)实测。
 *
 * 跑法: npx tsx scripts/live-test/live-test-smart-import.mjs [owner/repo]
 * 默认仓库: microsoft/ML-For-Beginners
 *
 * 与 UI 完全同路径:Step1 清点 → Step2 LLM 分类 → Step3 大纲 → Step4 LLM 结构设计
 * → Step5 拉正文+落库(含 plan 快照落盘/复用逻辑)。内存 sql.js 库,provider 注入
 * glm-5.2 @ ZAI CodingPlan(与用户 dev 实例同款)。每条进度带相对时间戳,
 * 截断/拆半/token 上限告警直接可见 —— 用来定位"输出不完整"到底卡在哪。
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { createPlanStore } from "../../src/main/services/import-plan-store.ts";
import { runSmartImport } from "../../src/main/services/import-job-service.ts";

const REPO = process.argv[2] ?? "microsoft/ML-For-Beginners";
const MODEL = process.env.LIVE_MODEL ?? "glm-5.2";
const API_KEY = readApiKey();
if (!API_KEY) {
  console.error("❌ 无 Z_AI_API_KEY(检查 .env),LLM 步骤无法运行");
  process.exit(1);
}
console.log(`=== Live Test: runSmartImport(${REPO}) · ${MODEL} @ CodingPlan ===\n`);

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const sqljs = new SQL.Database();
sqljs.run(readFileSync(new URL("../../src/main/db/schema.sql", import.meta.url), "utf8"));
sqljs.run(
  `INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model)
   VALUES ('custom-live-test', 'ZAI CodingPlan (live test)', 'openai-compatible',
           'https://api.z.ai/api/coding/paas/v4', ?, ?)`,
  [API_KEY, MODEL],
);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-live-test')`);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_model', '${MODEL}')`);
const db = drizzle(sqljs, { schema });

const plansDir = mkdtempSync(join(tmpdir(), "ls-smart-import-"));
const t0 = Date.now();
const send = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s] ${msg}`);

try {
  const r = await runSmartImport(
    { kind: "github", url: `https://github.com/${REPO}` },
    { db, store: createPlanStore(plansDir), markDirty: () => {}, onProgress: send, shouldAbort: () => false },
  );
  const lessons = db.select().from(schema.contentNodes).all().filter((n) => n.type === "lesson").length;
  console.log(`\n=== 完成 === courseId=${r.courseId} reused=${r.reused} lessons=${lessons} 总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} catch (e) {
  console.error(`\n=== 失败 === ${(e instanceof Error ? e.message : String(e)).slice(0, 400)}`);
  console.error(`planId=${e instanceof Error && e.planId ? e.planId : "(无)"} 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exitCode = 1;
} finally {
  rmSync(plansDir, { recursive: true, force: true });
}
