/**
 * 探针:验证 buildImportModel 的"禁思考"对当前端点是否真生效。
 * 同生产链路(resolveLlm → buildImportModel → generateTextWithTimeout)发极小请求,
 * 打耗时 + usage + finish。思考若真关:秒回、out 个位数 token;若端点无视
 * thinking.type=disabled:耗时数十秒/思考 token 计入 out。
 *
 * 跑法: npx tsx scripts/live-test/probe-thinking.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { resolveLlm } from "../../src/main/services/agent/llm-client.ts";
import { buildImportModel, generateTextWithTimeout } from "../../src/main/services/import-llm-service.ts";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.error("❌ 无 Z_AI_API_KEY");
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

const llm = resolveLlm(db);
const im = buildImportModel(llm);
console.log(`provider=${llm.provider.id} model=${llm.model} patchApplied=${im.model !== llm.languageModel}`);
console.log("发了两次对照:导入模型(禁思考) vs 原始模型(原样)\n");

for (const [name, model, opts] of [
  ["导入模型(禁思考)", im.model, { providerOptions: im.providerOptions }],
  ["原始模型(对照)", llm.languageModel, {}],
]) {
  const t0 = Date.now();
  try {
    const text = await generateTextWithTimeout(model, "一个三位数,各位数字之和为 15,百位比个位大 3,十位是偶数。列出所有满足条件的三位数,只输出数字列表。", opts);
    console.log(`[${name}] ${(Date.now() - t0) / 1000}s 返回 ${text.length} 字符: ${JSON.stringify(text.slice(0, 40))}`);
  } catch (e) {
    console.error(`[${name}] ${(Date.now() - t0) / 1000}s 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
