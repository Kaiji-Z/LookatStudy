/**
 * Proposal 流水线验证 —— 测真实 proposal-service.ts。
 *
 * 核心不变量（VERIFICATION §M2 + ARCHITECTURE 原则 2）：
 *   - AI 创建 proposal → status=pending，不立即改学习者状态
 *   - apply → 回放 operations，状态真改了
 *   - reject → 不改任何状态
 *   - apply 失败的部分 → status=stale + applyError，已执行的不回滚
 *   - 非_pending 状态再 apply/reject 抛错（幂等保护）
 *
 * v0.41 撤销（issue #19）T11-T19：
 *   - apply 抓受管表 diff 快照；undo 状态行还原 before + XP 逆补偿
 *   - 交错保护：apply 后再挣的 XP 不被撤销误伤；状态行冲突被标记
 *   - 守卫：非 applied / 已撤销 / 旧提议无快照 / stale 部分应用 → 不可撤销
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/main/db/schema.ts";
import {
  createProposal,
  applyProposal,
  rejectProposal,
  listPendingProposals,
  undoProposal,
} from "../src/main/services/proposal-service.ts";
import { getProgress } from "../src/main/services/progress-service.ts";
import { markHumanObservation } from "../src/main/services/human-observation.ts";
import { getXpStatus, addXpCorrect } from "../src/main/services/xp-service.ts";

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
const { db: db2 } = await makeDb();
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

// === T10 (P4 毕业检测 · IP3 语义更新): 反复答对的 mastery 累积分两段——
//     纯 AI 观测(无人工判分标记)封顶 0.85,永不毕业;人工观测置位后(quiz 点选/
//     exercise 判分的等价模拟)继续答对跨过 0.9 → 自动 status=mastered + crown=5。
//     quiz:recordAnswer 的 mastered flag 就是检测这个过渡(本次从非mastered→mastered)。 ===
const { db: dbG } = await makeDb();
// 段一:纯 AI 观测 10 次 → 封顶内,不毕业
for (let i = 0; i < 10; i++) {
  const pg = createProposal(dbG, {
    nodeId: "n1",
    operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
  });
  applyProposal(dbG, pg.id);
}
const capped = getProgress(dbG, "n1");
assert.ok(capped && capped.mastery !== null, "T10: AI 观测应有进度行");
assert.ok(capped.mastery <= 0.85 + 1e-9, `T10: 纯 AI 观测封顶 0.85, 实际 ${capped.mastery}`);
assert.notStrictEqual(capped.status, "mastered", "T10: 纯 AI 观测不得毕业");
// 段二:人工观测置位 → 解封 → 继续答对到毕业
markHumanObservation(dbG, "n1");
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
assert.ok(masteredAt >= 0, "T10: 人工观测解封后反复答对应最终毕业(status=mastered)");
const gm = getProgress(dbG, "n1");
assert.strictEqual(gm.status, "mastered", "T10: 毕业后 status=mastered");
assert.strictEqual(gm.crownLevel, 5, "T10: 毕业后 crown=5");
assert.ok(gm.mastery && gm.mastery >= 0.9, `T10: 毕业后 mastery≥0.9, 实际 ${gm.mastery}`);
console.log(`✓ T10 毕业过渡(IP3 封顶后): AI 观测卡 0.85 → 人工解封 → ${masteredAt + 1} 次答对毕业, mastery=${gm.mastery.toFixed(3)}`);

// ============================================================
// v0.41 撤销(issue #19)
// ============================================================

// === T11: mark_mastered apply → undo:progress/KC 行还原 + XP 逆补偿 ===
const { db: dbU1 } = await makeDb();
const pu1 = createProposal(dbU1, {
  nodeId: "n1",
  operations: [{ type: "mark_mastered", nodeId: "n1" }],
  rationale: "收尾提议",
});
const appliedU1 = applyProposal(dbU1, pu1.id);
assert.strictEqual(appliedU1.status, "applied", "T11: apply");
assert.strictEqual(appliedU1.canUndo, true, "T11: applied+有快照 → canUndo");
const xpAfterApply = getXpStatus(dbU1).totalXp;
assert.ok(xpAfterApply >= 50, `T11: mark_mastered 应 +50 XP, 实际 total=${xpAfterApply}`);
const undo1 = undoProposal(dbU1, pu1.id);
assert.strictEqual(undo1.proposal.undoneAt !== null, true, "T11: undoneAt 落地");
assert.strictEqual(undo1.proposal.status, "applied", "T11: status 保持 applied(历史真实性)");
assert.strictEqual(undo1.proposal.canUndo, false, "T11: 撤销后 canUndo=false");
assert.strictEqual(getProgress(dbU1, "n1"), null, "T11: undo → apply 前无进度行,行被删");
assert.strictEqual(
  getXpStatus(dbU1).totalXp,
  0,
  `T11: XP 逆补偿 → total 回 0, 实际 ${getXpStatus(dbU1).totalXp}`,
);
assert.strictEqual(undo1.conflicts.length, 0, "T11: 无交错 → 无冲突");
console.log(`✓ T11 mark_mastered 撤销: 进度行删除 + XP ${xpAfterApply}→0 + canUndo 翻转`);

// === T12: 撤销恢复到 apply 前的"中间状态"(不是一律清零) ===
const { db: dbU2 } = await makeDb();
// 先学一轮(mastery ≈0.75),这轮不撤
const pu2a = createProposal(dbU2, {
  nodeId: "n1",
  operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
});
applyProposal(dbU2, pu2a.id);
const mid = getProgress(dbU2, "n1");
assert.ok(mid && mid.mastery != null && mid.mastery > 0.5, "T12: 前置一轮 mastery>0.5");
// 再 apply mark_mastered → 撤销 → 应回到 mid(而非无行)
const pu2b = createProposal(dbU2, {
  nodeId: "n1",
  operations: [{ type: "mark_mastered", nodeId: "n1" }],
});
applyProposal(dbU2, pu2b.id);
assert.strictEqual(getProgress(dbU2, "n1").status, "mastered", "T12: apply 后 mastered");
undoProposal(dbU2, pu2b.id);
const restored = getProgress(dbU2, "n1");
assert.ok(restored, "T12: undo 后进度行还在(apply 前就存在)");
assert.strictEqual(restored.status, mid.status, "T12: status 还原到 apply 前");
assert.ok(Math.abs((restored.mastery ?? 0) - (mid.mastery ?? 0)) < 1e-9, "T12: mastery 还原到 apply 前");
// XP:第一轮 update_mastery 不加分(未毕业),mark_mastered +50 → 撤销后 0
assert.strictEqual(getXpStatus(dbU2).totalXp, 0, "T12: XP 逆补偿只扣 mark_mastered 的 50");
console.log(`✓ T12 撤销恢复中间态: mastery ${mid.mastery.toFixed(3)} 保留, mastered 清除`);

// === T13: XP 交错保护——apply 后又答对挣的 10 XP 不被撤销误伤 ===
const { db: dbU3 } = await makeDb();
const pu3 = createProposal(dbU3, {
  nodeId: "n1",
  operations: [{ type: "mark_mastered", nodeId: "n1" }],
});
applyProposal(dbU3, pu3.id); // +50
addXpCorrect(dbU3); // 答对 +10(与该提议无关的后续学习记录)
assert.strictEqual(getXpStatus(dbU3).totalXp, 60, "T13: 前置 50+10");
undoProposal(dbU3, pu3.id);
assert.strictEqual(
  getXpStatus(dbU3).totalXp,
  10,
  `T13: 撤销只逆补偿 50,后挣的 10 保留, 实际 ${getXpStatus(dbU3).totalXp}`,
);
console.log(`✓ T13 XP 逆补偿交错保护: 60 → 10(不是 → 0)`);

// === T14: 状态行冲突标记——apply 后同节点又有学习记录,undo 恢复 before 并标记 ===
const { db: dbU4 } = await makeDb();
// 第 0 轮:建行(v1,不撤)
const pu4a0 = createProposal(dbU4, {
  nodeId: "n1",
  operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
});
applyProposal(dbU4, pu4a0.id);
const v1 = getProgress(dbU4, "n1");
assert.ok(v1 && v1.mastery != null, "T14: 前置 v1 行存在");
// 撤销目标(pu4a):v1 → v2
const pu4a = createProposal(dbU4, {
  nodeId: "n1",
  operations: [{ type: "update_mastery", nodeId: "n1", correct: true }],
});
applyProposal(dbU4, pu4a.id);
// 交错:又毕一次业(v2 → v3:status/crown/mastery 全变,不撤这轮)
const pu4b = createProposal(dbU4, {
  nodeId: "n1",
  operations: [{ type: "mark_mastered", nodeId: "n1" }],
});
applyProposal(dbU4, pu4b.id);
assert.strictEqual(getProgress(dbU4, "n1").status, "mastered", "T14: 前置交错毕业(v3)");
// 撤销 pu4a:其 after(v2)≠ 当前行(v3)→ conflict 标记 + 恢复 before(v1)
const undo4 = undoProposal(dbU4, pu4a.id);
assert.ok(
  undo4.conflicts.some((c) => c.startsWith("progress:")),
  `T14: 应标记 progress 冲突, 实际 ${JSON.stringify(undo4.conflicts)}`,
);
const afterUndo4 = getProgress(dbU4, "n1");
assert.ok(afterUndo4, "T14: 行还在(pu4a 的 before 就存在)");
assert.ok(
  Math.abs((afterUndo4.mastery ?? 0) - (v1.mastery ?? 0)) < 1e-9,
  "T14: 恢复到 pu4a 的 before(v1)——pu4b 的增量被一并回退,git revert 任意顺序语义",
);
console.log(`✓ T14 冲突标记+恢复: conflicts=${undo4.conflicts.join(",")}`);

// === T15: 双重撤销拒绝 ===
assert.throws(() => undoProposal(dbU1, pu1.id), /already undone/, "T15: 双重撤销抛错");
console.log(`✓ T15 双重撤销拒绝`);

// === T16: 非 applied(_PENDING/rejected/stale)不可撤销 ===
const { db: dbU5 } = await makeDb();
const pu5 = createProposal(dbU5, {
  operations: [{ type: "set_node_status", nodeId: "n1", status: "in_progress" }],
});
assert.throws(() => undoProposal(dbU5, pu5.id), /not applied/, "T16: pending 不可撤");
rejectProposal(dbU5, pu5.id);
assert.throws(() => undoProposal(dbU5, pu5.id), /not applied/, "T16: rejected 不可撤");
// stale:混一个非法操作
const pu5b = createProposal(dbU5, {
  operations: [
    { type: "update_mastery", nodeId: "n1", correct: true },
    { type: "update_mastery", nodeId: "ghost", correct: true },
  ],
});
const staleRes = applyProposal(dbU5, pu5b.id);
assert.strictEqual(staleRes.status, "stale", "T16: 前置 stale");
assert.strictEqual(staleRes.canUndo, false, "T16: stale 无快照 canUndo=false");
// stale 被 status 守卫先拦(部分应用不可撤,不是"缺快照"路径)
assert.throws(() => undoProposal(dbU5, pu5b.id), /not applied/, "T16: stale 不可撤");
console.log(`✓ T16 守卫: pending/rejected/stale 全拒`);

// === T17: 旧提议(功能上线前,无快照列值)不可撤销 ===
const { db: dbU6, sqljs: sqljs6 } = await makeDb();
const pu6 = createProposal(dbU6, {
  operations: [{ type: "set_node_status", nodeId: "n1", status: "in_progress" }],
});
applyProposal(dbU6, pu6.id);
// 手工抹掉快照,模拟 v0.41 前的旧库行
sqljs6.run(`UPDATE proposals SET snapshot_json = NULL WHERE id = ?`, [pu6.id]);
const rowU6 = dbU6.select().from(schema.proposals).where(eq(schema.proposals.id, pu6.id)).get();
assert.strictEqual(rowU6.snapshotJson, null, "T17: 前置快照已抹");
assert.throws(() => undoProposal(dbU6, pu6.id), /no undo snapshot/, "T17: 旧提议抛错");
console.log(`✓ T17 旧提议(无快照)不可撤销`);

// === T18: 快照覆盖面——unlockNextLessonIfEligible 翻转的"其他节点"也在恢复范围 ===
const { db: dbU7, sqljs: sqljs7 } = await makeDb();
sqljs7.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('sec-y','c1',NULL,'section','Y',0)`);
sqljs7.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('uy-1','c1','sec-y','lesson','UY1',0)`);
sqljs7.run(`INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES ('uy-2','c1','sec-y','lesson','UY2',1)`);
sqljs7.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('uy-1','available',0)`);
sqljs7.run(`INSERT INTO progress (node_id, status, crown_level) VALUES ('uy-2','locked',0)`);
const pu7 = createProposal(dbU7, {
  nodeId: "uy-1",
  operations: [{ type: "mark_mastered", nodeId: "uy-1" }],
});
applyProposal(dbU7, pu7.id);
assert.strictEqual(getProgress(dbU7, "uy-2").status, "available", "T18: 前置毕业→解锁下一课");
undoProposal(dbU7, pu7.id);
assert.strictEqual(
  getProgress(dbU7, "uy-2").status,
  "locked",
  "T18: 撤销毕业 → 下一课重新上锁(service 内部跨节点副作用被快照兜住)",
);
console.log(`✓ T18 跨节点副作用(解锁翻转)随撤销回退`);

// === T19: 画像 patch 撤销——learner_profile 还原 before ===
const { db: dbU8 } = await makeDb();
// 预置画像(apply 前已有)
dbU8.insert(schema.settings)
  .values({
    key: "learner_profile",
    value: JSON.stringify({ schemaVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", name: "旧名字" }),
    isSecret: false,
  })
  .run();
const pu8 = createProposal(dbU8, {
  operations: [{
    type: "update_learner_profile",
    nodeId: "n1",
    profilePatch: { name: "新名字" },
  }],
});
applyProposal(dbU8, pu8.id);
assert.ok(
  dbU8.select().from(schema.settings).where(eq(schema.settings.key, "learner_profile")).get().value.includes("新名字"),
  "T19: 前置 patch 已应用",
);
undoProposal(dbU8, pu8.id);
const profileAfter = dbU8.select().from(schema.settings).where(eq(schema.settings.key, "learner_profile")).get();
assert.ok(profileAfter.value.includes("旧名字"), "T19: 撤销 → 画像还原 before");
assert.ok(!profileAfter.value.includes("新名字"), "T19: patch 内容清除");
console.log(`✓ T19 画像 patch 撤销还原`);

console.log("\n=== ALL PROPOSAL TESTS PASSED ✅ ===");
