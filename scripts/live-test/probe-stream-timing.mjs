/**
 * 探针:流事件时间线 —— 每个 fullStream part 的到达时刻+类型。
 * 区分三种"静默":真排队(首 part 前长静默)/思考被 SDK 丢弃(reasoning part 缺失)
 * /正常流(text-delta 密集到达)。用默认模型(不干预思考)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readApiKey } from "./_load-env.mjs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { resolveLlm } from "../../src/main/services/agent/llm-client.ts";
import { streamText } from "ai";

const API_KEY = readApiKey();
const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const sqljs = new SQL.Database();
sqljs.run(readFileSync(new URL("../../src/main/db/schema.sql", import.meta.url), "utf8"));
sqljs.run(
  `INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model)
   VALUES ('custom-live-test', 'ZAI', 'openai-compatible', 'https://api.z.ai/api/coding/paas/v4', ?, 'glm-5.2')`,
  [API_KEY],
);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_provider', 'custom-live-test')`);
sqljs.run(`INSERT INTO settings (key, value) VALUES ('active_model', 'glm-5.2')`);
const db = drizzle(sqljs, { schema });
const llm = resolveLlm(db);

const prompt = process.argv[2] ?? "设计一个 3 节的 Python 入门课程结构(节标题+每节 2 课的标题),直接给 JSON。";
console.log(`模型: ${llm.model} @ CodingPlan(默认思考,无任何干预)\n`);
const t0 = Date.now();
const result = streamText({ model: llm.languageModel, prompt, maxOutputTokens: 8192 });
const counts = {};
let lastLog = 0;
for await (const part of result.fullStream) {
  counts[part.type] = (counts[part.type] ?? 0) + 1;
  const now = Date.now() - t0;
  // 每种类型首次到达 + 每 5s 心跳打印
  if (counts[part.type] === 1 || now - lastLog > 5000) {
    console.log(`[+${(now / 1000).toFixed(1)}s] part: ${part.type}${part.type === "text-delta" ? ` "${String(part.text).slice(0, 30)}"` : ""}`);
    lastLog = now;
  }
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  part 统计:`, JSON.stringify(counts));
