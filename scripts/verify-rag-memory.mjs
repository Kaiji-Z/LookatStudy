/**
 * M3 轻量 RAG（LIKE 兜底）+ 记忆系统验证 —— 测真实 search-service.ts。
 *
 * RAG 不变量（v0.1 LIKE）：
 *   - searchContent 能按子串命中 title 或 content
 *   - 不相关词搜不到
 *   - 多关键词 AND 关系
 *   - snippet 含命中上下文
 * 记忆不变量：
 *   - updateMemory 是 upsert（同 nodeId+category 二次更新覆盖，不新增行）
 *   - getMemory 能读到
 *   - global 记忆 nodeId=null，独立于节点记忆
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { searchContent, updateMemory, getMemory } from "../src/main/services/search-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

const { sqljs, db } = await makeDb();
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, content) VALUES ('n1','c1','lesson','数据管道','ETL 是数据工程的根基，把数据从源抽出来转换后加载到目标库')`,
);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, content) VALUES ('n2','c1','lesson','云架构','Kubernetes 是容器编排标准，管理集群里的 pod 调度')`,
);

// === T1: 搜子串命中 content ===
let hits = searchContent(sqljs, "ETL");
assert.ok(hits.length >= 1, `T1: 搜 ETL 应命中, 实际 ${hits.length}`);
assert.ok(hits.some((h) => h.nodeId === "n1"), "T1: 应命中 n1");
console.log(`✓ T1 search: 搜"ETL"命中 ${hits.length} 条（含 n1）`);

// === T2: 搜 title 也能命中 ===
hits = searchContent(sqljs, "云架构");
assert.ok(hits.some((h) => h.nodeId === "n2"), "T2: 搜 title 应命中 n2");
console.log(`✓ T2 search title: 搜"云架构"命中 n2`);

// === T3: 不相关词搜不到 ===
hits = searchContent(sqljs, "量子物理");
assert.strictEqual(hits.length, 0, `T3: 搜量子物理应为 0, 实际 ${hits.length}`);
console.log(`✓ T3 不相关词：搜"量子物理" = 0 条`);

// === T4: 多关键词 AND 关系（两个都得命中）===
hits = searchContent(sqljs, "ETL 数据");
assert.ok(hits.some((h) => h.nodeId === "n1"), "T4: n1 含 ETL 和 数据");
hits = searchContent(sqljs, "ETL Kubernetes");
assert.ok(
  !hits.some((h) => h.nodeId === "n1"),
  "T4: n1 不含 Kubernetes，AND 不该命中",
);
console.log(`✓ T4 多词 AND：n1 命中"ETL 数据"，不命中"ETL Kubernetes"`);

// === T5: snippet 非空 + 含命中词上下文 ===
hits = searchContent(sqljs, "Kubernetes");
const hit = hits.find((h) => h.nodeId === "n2");
assert.ok(hit && hit.snippet.length > 0, "T5: snippet 应非空");
assert.ok(
  hit.snippet.toLowerCase().includes("kubernetes") || hit.snippet.includes("…"),
  "T5: snippet 应含命中词或省略号",
);
console.log(`✓ T5 snippet：${hit.snippet.slice(0, 50)}…`);

// === T6: content 改了直接搜到新内容（LIKE 不需 sync）===
sqljs.run(`UPDATE content_nodes SET content = 'Airflow 是工作流调度工具' WHERE id = 'n1'`);
hits = searchContent(sqljs, "Airflow");
assert.ok(hits.some((h) => h.nodeId === "n1"), "T6: 改 content 直接搜到新词");
console.log(`✓ T6 content 即改即搜：搜到 Airflow（LIKE 无需 sync）`);

// === T7: 空查询返回空 ===
hits = searchContent(sqljs, "");
assert.strictEqual(hits.length, 0, "T7: 空查询应返回空");
console.log(`✓ T7 空查询 = 0`);

// === T8: limit 生效 ===
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, content) VALUES ('n3','c1','lesson','L3','机器学习 ML 概念')`,
);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title, content) VALUES ('n4','c1','lesson','L4','深度学习 ML 概念')`,
);
hits = searchContent(sqljs, "ML", 1);
assert.ok(hits.length <= 1, `T8: limit=1 应 ≤1, 实际 ${hits.length}`);
console.log(`✓ T8 limit 生效：搜"ML" limit=1 → ${hits.length} 条`);

// ============================================================
// 记忆系统
// ============================================================

// === T9: updateMemory 插入 + getMemory 读 ===
updateMemory(db, { nodeId: "n1", summary: "学习者在 ETL 上卡过两次", category: "node" });
const mem = getMemory(db, "n1");
assert.ok(mem.length >= 1, "T9: 应有记忆");
assert.ok(mem.some((m) => m.summary.includes("ETL")), "T9: 内容正确");
console.log(`✓ T9 updateMemory + getMemory：插入并读回`);

// === T10: upsert 覆盖不新增 ===
updateMemory(db, { nodeId: "n1", summary: "更新后的摘要", category: "node" });
const mem2 = getMemory(db, "n1", "node");
assert.strictEqual(mem2.length, 1, `T10: upsert 应只 1 条, 实际 ${mem2.length}`);
assert.strictEqual(mem2[0].summary, "更新后的摘要", "T10: 内容被覆盖");
console.log(`✓ T10 upsert：同 nodeId+category 覆盖不新增（${mem2.length} 条）`);

// === T11: global 记忆 nodeId=null ===
updateMemory(db, { summary: "全局：偏好中文回答", category: "global" });
const globalMem = getMemory(db, null, "global");
assert.strictEqual(globalMem.length, 1, "T11: 全局记忆 1 条");
assert.strictEqual(globalMem[0].nodeId, null, "T11: nodeId=null");
console.log(`✓ T11 global 记忆：nodeId=null，独立于节点记忆`);

// === T12: 不同 category 独立 ===
updateMemory(db, { nodeId: "n1", summary: "节点摘要", category: "node" });
updateMemory(db, { nodeId: "n1", summary: "卡壳模式", category: "friction_pattern" });
const byCat = getMemory(db, "n1");
const cats = byCat.map((m) => m.category);
assert.ok(cats.includes("node"), "T12: 含 node");
assert.ok(cats.includes("friction_pattern"), "T12: 含 friction_pattern");
console.log(`✓ T12 多 category 独立（${cats.join(",")}）`);

console.log("\n=== ALL RAG + MEMORY TESTS PASSED ✅ ===");
