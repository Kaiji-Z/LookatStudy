/**
 * 进度 IPC 业务逻辑的无头验证 —— 不依赖 Electron / UI。
 *
 * VERIFICATION §2.1: 工作流必须有 headless 形态。progress IPC 之前只能从渲染层触发，
 * 现在逻辑抽到了 progress-service.ts，本脚本用真实 sql.js DB + 真实 drizzle 直接调真实函数，
 * 覆盖 progress:get / progress:update / progress:markAttempted 三条路径。
 *
 * 关键：markNodeAttempted 的 streak 副作用用回调注入 —— 这里塞个 flag 验证"被调了一次"，
 * 不引入 streak.ts 的 DB 写入（那是 streak 自己测试的职责）。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  getProgress,
  updateProgress,
  markNodeAttempted,
} from "../src/main/services/progress-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 建真实 sql.js DB + schema
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const sqljs = new SQL.Database();
sqljs.run("PRAGMA foreign_keys = ON;");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

// 注意：progress.node_id 有外键到 content_nodes，需要先建节点 + 课程
const NODE_ID = "node-test-1";
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1', 'r', 'T')`);
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, 'c1', 'lesson', 'L1')`,
  [NODE_ID],
);

// === T1: getProgress 不存在 → null ===
const none = getProgress(db, NODE_ID);
assert.strictEqual(none, null, "T1: 未创建的节点进度应为 null");
console.log(`✓ T1 getProgress(不存在): 返回 null`);

// === T2: updateProgress 插入（patch 部分） → 合并默认值 ===
const created = updateProgress(db, NODE_ID, { status: "available" });
assert.strictEqual(created.status, "available", "T2: status 应为 patch 值");
assert.strictEqual(created.crownLevel, 0, "T2: crownLevel 默认 0");
assert.ok(created.lastAttemptAt, "T2: lastAttemptAt 应被填默认 now");
console.log(`✓ T2 updateProgress(插入): status=available, crown=0, lastAttemptAt 已填`);

// === T3: updateProgress 更新（已存在）→ 合并旧值 ===
const updated = updateProgress(db, NODE_ID, { crownLevel: 3 });
assert.strictEqual(updated.status, "available", "T3: 旧 status 应保留");
assert.strictEqual(updated.crownLevel, 3, "T3: 新 crownLevel 应生效");
console.log(`✓ T3 updateProgress(更新): status 保留=available, crown→3`);

// === T4: getProgress 读回 ===
const read = getProgress(db, NODE_ID);
assert.strictEqual(read?.status, "available", "T4: 读回 status");
assert.strictEqual(read?.crownLevel, 3, "T4: 读回 crownLevel");
console.log(`✓ T4 getProgress(读回): status=available, crown=3`);

// === T5: markNodeAttempted 副作用：回调触发 + 状态变 in_progress ===
let callbackCount = 0;
const marked = markNodeAttempted(db, NODE_ID, () => {
  callbackCount++;
});
assert.strictEqual(callbackCount, 1, "T5: onAttempted 回调应被调一次");
assert.strictEqual(marked.status, "in_progress", "T5: 标记后 status=in_progress");
console.log(`✓ T5 markNodeAttempted: status→in_progress, streak 回调触发 1 次`);

// === T6: markNodeAttempted 在节点无进度行时也能插入 ===
const NODE2 = "node-test-2";
sqljs.run(
  `INSERT INTO content_nodes (id, course_id, type, title) VALUES (?, 'c1', 'lesson', 'L2')`,
  [NODE2],
);
const markedNew = markNodeAttempted(db, NODE2, undefined);
assert.strictEqual(markedNew.status, "in_progress", "T6: 新节点标记后 in_progress");
const row2 = getProgress(db, NODE2);
assert.ok(row2, "T6: 新节点进度行应被创建");
console.log(`✓ T6 markNodeAttempted(新节点): 行被创建 + status=in_progress`);

// === T7: updateProgress patch 不传 status → 保留旧值 ===
updateProgress(db, NODE_ID, { status: "mastered" }); // 先 mastered
const t7 = updateProgress(db, NODE_ID, { crownLevel: 5 }); // 不传 status
assert.strictEqual(t7.status, "mastered", "T7: 不传 status 应保留 mastered");
assert.strictEqual(t7.crownLevel, 5, "T7: crownLevel=5");
console.log(`✓ T7 updateProgress(patch 缺 status): mastered 保留, crown→5`);

console.log("\n=== ALL PROGRESS SERVICE TESTS PASSED ✅ ===");
