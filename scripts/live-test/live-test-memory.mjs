/**
 * Live test: 记忆系统的 LLM 路径(确定性测试 stub 掉的部分)用真模型验证。
 *
 * 跑法: npx tsx scripts/live-test/live-test-memory.mjs  (需 .env 里有 Z_AI_API_KEY)
 *
 * 验证真实代码路径(不是重写一遍 prompt):
 *   T1  defaultLlmConsolidate:喂真实对话+friction 窗口 → 产出合法 + 有意义(含相关关键词)
 *   T2  defaultLlmMerge:existing + 新事实 → 合并成一条(不丢旧、合理)
 *   T3  端到端 consolidate(db, window, defaultLlmConsolidate) → memory 真写入 + 可读回
 *   T4  agent 路径 remember(db, input, defaultLlmMerge) 连续两次 → 第二次与第一次合并
 *
 * 断言偏结构/相关性(LLM 输出有方差):合法 JSON/对象、非空、含窗口相关词。
 * 失败 → 直接看打印 debug(prompt/解析/模型行为)。
 */
import { readApiKey } from "./_load-env.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { resolveLlm } from "../../src/main/services/agent/llm-client.ts";
import {
  consolidate,
  getSlot,
  defaultLlmConsolidate,
  defaultLlmMerge,
  remember,
} from "../../src/main/services/memory-service.ts";

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("skip: no API key configured（.env 里设 Z_AI_API_KEY）");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
// 配 custom provider(id 带 custom- 前缀,resolveLlm 才走 custom 分支)
sqljs.run(
  "INSERT INTO custom_providers (id, label, protocol, base_url, api_key, default_model) VALUES ('custom-zai','zai','openai-compatible','https://api.z.ai/api/coding/paas/v4',?,'glm-5.2')",
  [API_KEY],
);
sqljs.run("INSERT INTO settings (key, value, is_secret) VALUES ('active_provider','custom-zai',0)");
sqljs.run("INSERT INTO settings (key, value, is_secret) VALUES ('active_model','glm-5.2',0)");
const db = drizzle(sqljs, { schema });

const llm = resolveLlm(db);
console.log(`[model] ${llm.model} @ custom-zai\n`);

// 真实窗口:递归课,学习者卡基线条件 + 想要例子
const win = {
  courseId: "c1",
  nodeId: "n1",
  conversation: [
    { role: "user", content: "递归的基线条件到底什么意思?我老搞混" },
    { role: "assistant", content: "基线条件就是递归停下来不再调自己的条件,没它会无限递归。" },
    { role: "user", content: "哦 能不能举个斐波那契的例子,光定义我记不住" },
    { role: "assistant", content: "好,fib(n):基线 n<=1 直接返回 n;否则 fib(n-1)+fib(n-2)。" },
  ],
  frictionEntries: [
    { category: "confused", summary: "基线条件反复搞混" },
    { category: "blocked", summary: "不会写递归的返回值" },
  ],
  answers: [],
};

// ============================================================
// T1: defaultLlmConsolidate 产出
// ============================================================
console.log("=== T1: defaultLlmConsolidate 产出 ===");
const conso = await defaultLlmConsolidate(llm.languageModel)(win, {
  global: null,
  node: null,
  friction_pattern: null,
});
console.log(JSON.stringify(conso, null, 2));
const vals = Object.values(conso).filter((v) => typeof v === "string" && v.trim());
assert.ok(vals.length >= 1, "T1 FAIL: 至少一个类别有非空产出");
const allText = vals.join(" ");
assert.ok(
  /递归|基线|例子|斐波那契|返回值/.test(allText),
  `T1 FAIL: 产出应含窗口相关词(递归/基线/例子/返回值),实际:${allText}`,
);
console.log(`✓ T1 defaultLlmConsolidate 产出 ${vals.length} 类,内容相关\n`);

// ============================================================
// T2: defaultLlmMerge(existing + 新)
// ============================================================
console.log("=== T2: defaultLlmMerge ===");
const merged = await defaultLlmMerge(llm.languageModel)(
  "学习者偏好用例子讲解,光给定义记不住",
  "节奏偏快,可一次推进两步",
);
console.log(merged);
assert.ok(typeof merged === "string" && merged.trim().length > 0, "T2 FAIL: 合并产出非空");
assert.ok(/例子|定义/.test(merged), "T2 FAIL: 合并应保留'例子/定义'(existing)");
console.log("✓ T2 defaultLlmMerge 合并 + 保留 existing\n");

// ============================================================
// T3: 端到端 consolidate → memory 真写入
// ============================================================
console.log("=== T3: 端到端 consolidate(真写库) ===");
const written = await consolidate(db, win, defaultLlmConsolidate(llm.languageModel));
console.log("written keys:", Object.keys(written));
const g = getSlot(db, "global")?.summary;
const n = getSlot(db, "node", "n1")?.summary;
const fp = getSlot(db, "friction_pattern", undefined, "c1")?.summary;
console.log({ global: g, node: n, friction_pattern: fp });
assert.ok(Object.keys(written).length >= 1, "T3 FAIL: 至少写入一类");
assert.ok(fp || n, "T3 FAIL: 窗口有 friction,应产出 node 或 friction_pattern");
console.log("✓ T3 端到端:memory 写入 + 可读回\n");

// ============================================================
// T4: agent 路径 remember + defaultLlmMerge 连续两次合并
// ============================================================
console.log("=== T4: remember + defaultLlmMerge 连续合并 ===");
await remember(db, { category: "global", content: "学习者偏好类比" }, defaultLlmMerge(llm.languageModel));
const first = getSlot(db, "global").summary;
await remember(db, { category: "global", content: "节奏偏快" }, defaultLlmMerge(llm.languageModel));
const second = getSlot(db, "global").summary;
console.log("第一次:", first);
console.log("第二次:", second);
assert.ok(second.length >= first.length, "T4 FAIL: 第二次合并后应不短于第一次(保留 existing)");
assert.ok(/类比|偏好/.test(second), "T4 FAIL: 第二次仍含第一次的'类比/偏好'");
console.log("✓ T4 remember 连续两次合并:existing 保留\n");

console.log("=== ALL LIVE MEMORY TESTS PASSED ✅ ===");
