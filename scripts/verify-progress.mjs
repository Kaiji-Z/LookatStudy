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

// === T8: markNodeAttempted 解锁同章节下一课（Duolingo 式关卡门控）===
// 建一个新课程 + 章节 + 3 课（用 orderIdx 排序）
sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c2', 'r2', 'T2')`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-a', 'c2', NULL, 'section', '章节A', 0)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-1', 'c2', 'sec-a', 'lesson', '课1', 0)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-2', 'c2', 'sec-a', 'lesson', '课2', 1)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-3', 'c2', 'sec-a', 'lesson', '课3', 2)`);
// 初始：课1=available, 课2=locked, 课3=locked
updateProgress(db, "les-1", { status: "available" });
updateProgress(db, "les-2", { status: "locked" });
updateProgress(db, "les-3", { status: "locked" });

// 点课1 → 课1 变 in_progress，课2 应解锁成 available
markNodeAttempted(db, "les-1");
const les1p = getProgress(db, "les-1");
const les2p = getProgress(db, "les-2");
const les3p = getProgress(db, "les-3");
assert.strictEqual(les1p?.status, "in_progress", "T8: 课1 应变 in_progress");
assert.strictEqual(les2p?.status, "available", "T8: 课2 应被解锁成 available");
assert.strictEqual(les3p?.status, "locked", "T8: 课3 应仍 locked（只解锁紧邻的下一课）");
console.log(`✓ T8 markNodeAttempted 解锁下一课: 课1→in_progress, 课2→available, 课3 仍 locked`);

// === T9: 章节最后一课 → 解锁下一章节的第一课 ===
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-b', 'c2', NULL, 'section', '章节B', 1)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-4', 'c2', 'sec-b', 'lesson', '课4', 0)`);
updateProgress(db, "les-3", { status: "available" }); // 先让课3可点
// 点课3（章节A最后一课）→ 课4（章节B第一课）应解锁
markNodeAttempted(db, "les-3");
const les4p = getProgress(db, "les-4");
assert.strictEqual(les4p?.status, "available", "T9: 章节最后一课 → 下一章节第一课应解锁");
console.log(`✓ T9 跨章节解锁: 课3(章节A末)→课4(章节B首) unlocked`);

// === T10: 跳关守卫 —— locked 节点拒绝 markNodeAttempted,不解锁下一课 ===
// 场景:绕过 UI disabled(键盘/deep link)直接对 locked 节点调 markNodeAttempted。
// 守卫应拒绝:locked 节点 status 不变,下一课不解锁。
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-5', 'c2', 'sec-b', 'lesson', '课5', 1)`);
updateProgress(db, "les-5", { status: "locked" }); // les-5 初始 locked
// 直接对 locked 的 les-5 调 markNodeAttempted(模拟绕过 UI)
const lockedResult = markNodeAttempted(db, "les-5");
assert.strictEqual(lockedResult.status, "locked", "T10: locked 节点应拒绝,status 保持 locked");
// 验证 les-5 的 status 在 DB 里也保持 locked(没被改成 in_progress)
const les5db = getProgress(db, "les-5");
assert.strictEqual(les5db?.status, "locked", "T10: DB 里 les-5 status 仍 locked(守卫生效)");
console.log(`✓ T10 跳关守卫: locked 节点拒绝 markNodeAttempted, status 保持 locked`);

// === T11: 跨章节跳空 section —— 下一 section 无 lesson 时继续往后找 ===
// 场景:les-5 在 sec-b(orderIdx=1,是 sec-b 最后一课),sec-c(orderIdx=2)只有 exam 无 lesson,
// sec-d(orderIdx=3)才有 lesson。les-5(章节B末)通关 → 应跳过 sec-c 解锁 sec-d 的 les-6。
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-c', 'c2', NULL, 'section', '空章节C', 2)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('exam-c', 'c2', 'sec-c', 'exam', '空章节考试', 0)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-d', 'c2', NULL, 'section', '章节D', 3)`);
sqljs.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('les-6', 'c2', 'sec-d', 'lesson', '课6', 0)`);
updateProgress(db, "les-6", { status: "locked" });
// T10 把 les-5 置成 locked 验证守卫;这里先恢复成 available 再点击测跨空 section。
updateProgress(db, "les-5", { status: "available" });
// les-5 是 sec-b 最后一课(orderIdx=1,无更高 orderIdx 的 lesson)。
// 通关后:sec-b 无下课后 → 找后续 section;sec-c 只有 exam(无 lesson)→ 跳过 → sec-d 的 les-6
markNodeAttempted(db, "les-5");
const les6p = getProgress(db, "les-6");
assert.strictEqual(les6p?.status, "available", "T11: 跨空 section 解锁 —— les-5→跳过sec-c→les-6 unlocked");
console.log(`✓ T11 跨空 section: les-5(sec-b末)→跳过 sec-c(仅exam)→les-6(sec-d) unlocked`);

console.log("\n=== ALL PROGRESS SERVICE TESTS PASSED ✅ ===");
