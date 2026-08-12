/**
 * Proposal 流水线验证 —— 测真实 proposal-service.ts。
 *
 * 核心不变量（VERIFICATION §M2 + ARCHITECTURE 原则 2）：
 *   - AI 创建 proposal → status=pending，不立即改学习者状态
 *   - apply → 回放 operations，状态真改了
 *   - reject → 不改任何状态
 *   - apply 失败的部分 → status=stale + applyError，已执行的不回滚
 *   - 非_pending 状态再 apply/reject 抛错（幂等保护）
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  createProposal,
  getProposal,
  applyProposal,
  rejectProposal,
  listPendingProposals,
} from "../src/main/services/proposal-service.ts";
import { getProgress } from "../src/main/services/progress-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  // 预置一个课程 + 节点（progress.node_id 外键到 content_nodes）
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(
    `INSERT INTO content_nodes (id, course_id, type, title) VALUES ('n1','c1','lesson','L1')`,
  );
  sqljs.run(
    `INSERT INTO content_nodes (id, course_id, type, title) VALUES ('n2','c1','lesson','L2')`,
  );
  return { db: drizzle(sqljs, { schema }), sqljs };
}

// === T1: createProposal → pending，不改学习者状态 ===
const { db } = await makeDb();
const p = createProposal(db, {
  nodeId: "n1",
  operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
  rationale: "答对一题，提议升掌握度",
});
assert.strictEqual(p.status, "pending", "T1: 新 proposal 应 pending");
assert.strictEqual(getProgress(db, "n1"), null, "T1: 未 apply 前不该有进度行");
console.log(`✓ T1 createProposal: pending + 不立即改状态`);

// === T2: listPendingProposals ===
const pending = listPendingProposals(db);
assert.strictEqual(pending.length, 1, "T2: 应有 1 条 pending");
console.log(`✓ T2 listPendingProposals: 找到 ${pending.length} 条 pending`);

// === T3: apply → 回放，掌握度真改了 ===
const applied = applyProposal(db, p.id);
assert.strictEqual(applied.status, "applied", "T3: apply 后 status=applied");
const progAfter = getProgress(db, "n1");
assert.ok(progAfter, "T3: apply 后应有进度行");
assert.ok(
  progAfter.mastery != null && progAfter.mastery > 0.5,
  `T3: 掌握度应 > 0.5, 实际 ${progAfter.mastery}`,
);
console.log(`✓ T3 apply: status=applied, mastery=${progAfter.mastery.toFixed(3)}（真改了）`);

// === T4: 重复 apply 非pending 抛错 ===
assert.throws(() => applyProposal(db, p.id), /not pending/, "T4: 重复 apply 应抛错");
console.log(`✓ T4 重复 apply 抛错（幂等保护）`);

// === T5: reject → 不改状态 ===
const p2 = createProposal(db, {
  operations: [{ type: "update_mastery", nodeId: "n2", correct: true }],
});
const masteryBeforeN2 = getProgress(db, "n2")?.mastery ?? null;
const rejected = rejectProposal(db, p2.id);
assert.strictEqual(rejected.status, "rejected");
assert.strictEqual(
  getProgress(db, "n2"),
  null,
  "T5: reject 不该建进度行",
);
console.log(`✓ T5 reject: status=rejected, n2 无进度行（状态没动）`);

// === T6: reject 后再 reject 抛错 ===
assert.throws(() => rejectProposal(db, p2.id), /not pending/, "T6: 重复 reject 抛错");
console.log(`✓ T6 重复 reject 抛错`);

// === T7: apply 多操作原子语义——部分失败 → stale + applyError ===
// 故意塞一个操作指向不存在的节点（外键会失败），混在一个合法操作前后
const { db: db2, sqljs: sqljs2 } = await makeDb();
const p3 = createProposal(db2, {
  operations: [
    { type: "update_mastery", nodeId: "n1", correct: true }, // 合法
    { type: "update_mastery", nodeId: "ghost", correct: true }, // 非法（外键）
    { type: "update_mastery", nodeId: "n2", correct: false }, // 合法
  ],
});
const result3 = applyProposal(db2, p3.id);
assert.strictEqual(result3.status, "stale", "T7: 部分失败 → stale");
assert.ok(result3.applyError, `T7: 应有 applyError, 实际 ${result3.applyError}`);
// 合法的两个应该落库了（部分应用语义）
assert.ok(getProgress(db2, "n1"), "T7: n1 合法操作应已落库");
assert.ok(getProgress(db2, "n2"), "T7: n2 合法操作应已落库");
console.log(`✓ T7 部分失败 → stale + applyError（合法操作部分应用）`);

// === T8: mark_mastered 操作真的把 status/crown/mastery 都设了 ===
const { db: db3 } = await makeDb();
const p4 = createProposal(db3, {
  operations: [{ type: "mark_mastered", nodeId: "n1" }],
});
applyProposal(db3, p4.id);
const mastered = getProgress(db3, "n1");
assert.strictEqual(mastered.status, "mastered", "T8: mark_mastered → status");
assert.strictEqual(mastered.crownLevel, 5, "T8: crown=5");
assert.ok(mastered.mastery && mastered.mastery >= 0.9, "T8: mastery≥0.9");
console.log(`✓ T8 mark_mastered: status=mastered, crown=5, mastery=${mastered.mastery}`);

// === T9: update_mastery 跨过 0.5 阈值 → 级联解锁下一课(填原测试缺口)===
// 原 T3 只测 mastery 变化,没测 proposal 路径的解锁级联。这里补:建章节+2课,
// apply update_mastery(correct=true)让课1 mastery 涨过 0.5 → 课2 应解锁 available。
const { db: db4, sqljs: sqljs4 } = await makeDb();
sqljs4.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-x','c1',NULL,'section','X',0)`);
sqljs4.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('px-1','c1','sec-x','lesson','PX1',0)`);
sqljs4.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('px-2','c1','sec-x','lesson','PX2',1)`);
sqljs4.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('px-1','available',0)`);
sqljs4.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('px-2','locked',0)`);
const p5 = createProposal(db4, {
  operations: [{ type: "update_mastery", nodeId: "px-1", correct: true }],
});
applyProposal(db4, p5.id);
const px1mastery = getProgress(db4, "px-1")?.mastery ?? 0;
const px2status = getProgress(db4, "px-2")?.status;
assert.ok(px1mastery >= 0.5, `T9: 课1 mastery 应 ≥0.5, 实际 ${px1mastery}`);
assert.strictEqual(px2status, "available", "T9: proposal update_mastery 级联 → 课2 应解锁 available");
console.log(`✓ T9 proposal 级联解锁: update_mastery(px-1)→mastery=${px1mastery.toFixed(2)}→px-2 unlocked`);

// === T10 (P4 毕业检测): update_mastery 反复答对让 mastery 跨过 0.9 → 自动 status=mastered + crown=5。
//     quiz:recordAnswer 的 mastered flag 就是检测这个过渡(本次从非mastered→mastered)。 ===
const { db: dbG } = await makeDb();
let masteredAt = -1;
for (let i = 0; i < 10; i++) {
  const pg = createProposal(dbG, {
    nodeId: "n1",
    operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
  });
  applyProposal(dbG, pg.id);
  if (getProgress(dbG, "n1")?.status === "mastered") {
    masteredAt = i;
    break;
  }
}
assert.ok(masteredAt >= 0, "T10: 反复答对应最终毕业(status=mastered)");
const gm = getProgress(dbG, "n1");
assert.strictEqual(gm.status, "mastered", "T10: 毕业后 status=mastered");
assert.strictEqual(gm.crownLevel, 5, "T10: 毕业后 crown=5");
assert.ok(gm.mastery && gm.mastery >= 0.9, `T10: 毕业后 mastery≥0.9, 实际 ${gm.mastery}`);
console.log(`✓ T10 毕业过渡: ${masteredAt + 1} 次答对后 status=mastered, crown=5, mastery=${gm.mastery.toFixed(3)}`);

console.log("\n=== ALL PROPOSAL TESTS PASSED ✅ ===");
