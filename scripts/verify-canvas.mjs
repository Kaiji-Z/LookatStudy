/**
 * v0.3 Canvas 画布服务验证 —— 测 canvas-service.ts 的 CRUD + 去重 + 注释。
 *
 * ⚠️ 注意:本文件用 inline 实现复刻 canvas-service.ts 的逻辑,
 * 因为生产 service 经 db/index.ts → schema.sql?raw,tsx 无法解析 ?raw。
 * 改 canvas-service.ts 的去重/注释/CRUD 逻辑时,必须同步更新这里的 inline 实现。
 * 真实生产函数的端到端验证由 self-test(electron 环境)兜底。
 *
 * 核心不变量:
 *   1. saveCanvasItem 写入,返回带 id 的完整 item
 *   2. listCanvasItems 按 courseId 过滤;按 nodeId 二级过滤;置顶优先 + 时间倒序
 *   3. deleteCanvasItem 硬删(删后 list 找不到)
 *   4. togglePinCanvasItem 翻转 pinned(0↔1)
 *   5. data 字段是 JSON 字符串(存时 stringify,读时是字符串)
 *   6. saveCanvasItem 幂等去重:同 (courseId, nodeId, artifactType, data) 不重复插入
 *   7. saveUserNote 带 comment → notes 列写入
 *   8. updateUserNoteComment 更新 notes;空串 → null(删除注释)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// 用 sql.js 内存 DB + drizzle 初始化(含 canvas_items 表)
async function makeDb() {
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  const schemaSql = readFileSync(join(__dirname, "..", "src", "main", "db", "schema.sql"), "utf-8");
  sqldb.run(schemaSql);
  return drizzle(sqldb, { schema });
}

// 把 canvas-service 改造成接受 db 注入的测试版本(inline 复刻,与生产逻辑保持同步)
async function loadCanvasServiceWithDb(db) {
  const { canvasItems } = schema;
  const { eq, and, desc, isNull } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  // —— 与 canvas-service.ts:saveCanvasItem 同步(含去重)——
  const save = (input) => {
    const dataStr = JSON.stringify(input.data);
    const nodeId = input.nodeId ?? null;
    const dedupConds = [
      eq(canvasItems.courseId, input.courseId),
      eq(canvasItems.artifactType, input.artifactType),
      eq(canvasItems.data, dataStr),
      nodeId === null
        ? isNull(canvasItems.nodeId)
        : eq(canvasItems.nodeId, nodeId),
    ];
    const existing = db.select().from(canvasItems).where(and(...dedupConds)).all();
    if (existing.length > 0) return existing[0];
    const id = randomUUID();
    const item = {
      id,
      nodeId,
      courseId: input.courseId,
      artifactType: input.artifactType,
      title: input.title ?? null,
      data: dataStr,
      pinned: 0,
      createdAt: new Date().toISOString(),
      notes: null,
      sourceType: "ai",
      sourceAnchor: null,
      lastResult: null,
      resultAt: null,
    };
    db.insert(canvasItems).values(item).run();
    return item;
  };

  // —— 与 canvas-service.ts:saveUserNote 同步(含 comment)——
  const saveUserNote = (input) => {
    const id = randomUUID();
    const item = {
      id,
      nodeId: input.nodeId,
      courseId: input.courseId,
      artifactType: "user_note",
      title: input.text.slice(0, 40) + (input.text.length > 40 ? "…" : ""),
      data: JSON.stringify({ text: input.text }),
      pinned: 0,
      createdAt: new Date().toISOString(),
      notes: input.comment && input.comment.trim() ? input.comment.trim() : null,
      sourceType: input.sourceType,
      sourceAnchor: JSON.stringify(input.sourceAnchor),
      lastResult: null,
      resultAt: null,
    };
    db.insert(canvasItems).values(item).run();
    return item;
  };

  // —— 与 canvas-service.ts:updateUserNoteComment 同步 ——
  const updateUserNoteComment = (id, comment) => {
    const existing = db.select().from(canvasItems).where(eq(canvasItems.id, id)).get();
    if (!existing) return null;
    const trimmed = comment.trim();
    db.update(canvasItems)
      .set({ notes: trimmed.length > 0 ? trimmed : null })
      .where(eq(canvasItems.id, id))
      .run();
    return { ...existing, notes: trimmed.length > 0 ? trimmed : null };
  };

  // —— 与 canvas-service.ts:recordQuizResult 同步 ——
  const recordQuizResult = (id, correct) => {
    const existing = db.select().from(canvasItems).where(eq(canvasItems.id, id)).get();
    if (!existing) return null;
    db.update(canvasItems)
      .set({ lastResult: correct ? "correct" : "wrong", resultAt: new Date().toISOString() })
      .where(eq(canvasItems.id, id))
      .run();
    return { ...existing, lastResult: correct ? "correct" : "wrong", resultAt: new Date().toISOString() };
  };

  const list = (courseId, nodeId) => {
    const condition = nodeId
      ? and(eq(canvasItems.courseId, courseId), eq(canvasItems.nodeId, nodeId))
      : eq(canvasItems.courseId, courseId);
    return db.select().from(canvasItems).where(condition).orderBy(desc(canvasItems.pinned), desc(canvasItems.createdAt)).all();
  };
  const remove = (id) => {
    db.delete(canvasItems).where(eq(canvasItems.id, id)).run();
  };
  const togglePin = (id) => {
    const existing = db.select().from(canvasItems).where(eq(canvasItems.id, id)).get();
    if (!existing) return null;
    const newPinned = existing.pinned ? 0 : 1;
    db.update(canvasItems).set({ pinned: newPinned }).where(eq(canvasItems.id, id)).run();
    return { ...existing, pinned: newPinned };
  };
  return { save, saveUserNote, updateUserNoteComment, recordQuizResult, list, remove, togglePin };
}

// 顶层初始化(所有 test 共享同一个内存 DB)
const db = await makeDb();
const canvas = await loadCanvasServiceWithDb(db);

// ---------- T1: save + list 基础 ----------
test("T1 save 写入,list 按 courseId 读取", () => {
  const item = canvas.save({
    courseId: "c1",
    nodeId: "n1",
    artifactType: "concept_map",
    title: "Transformer 架构",
    data: { nodes: [], edges: [] },
  });
  assert.ok(item.id, "save 返回带 id");
  assert.strictEqual(item.data, JSON.stringify({ nodes: [], edges: [] }), "data 是 JSON 字符串");
  const list = canvas.list("c1");
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, "Transformer 架构");
});

// ---------- T2: 按 nodeId 二级过滤 ----------
test("T2 nodeId 过滤", () => {
  canvas.save({ courseId: "c1", nodeId: "n1", artifactType: "quiz", data: { q: "a" } });
  canvas.save({ courseId: "c1", nodeId: "n2", artifactType: "quiz", data: { q: "b" } });
  canvas.save({ courseId: "c1", nodeId: "n1", artifactType: "compare_table", data: { t: 1 } });

  const n1Items = canvas.list("c1", "n1");
  assert.ok(n1Items.length >= 2, "n1 至少 2 个(T1 的 + 这次的)");
  const n2Items = canvas.list("c1", "n2");
  assert.strictEqual(n2Items.length, 1, "n2 只有 1 个");
});

// ---------- T3: courseId 隔离 ----------
test("T3 courseId 隔离", () => {
  canvas.save({ courseId: "c2", nodeId: null, artifactType: "diagram", data: { d: 1 } });
  const c1 = canvas.list("c1");
  const c2 = canvas.list("c2");
  assert.ok(c1.length > 0);
  assert.ok(c2.length === 1, "c2 隔离只有 1 个");
  assert.ok(c1.every((i) => i.courseId === "c1"));
});

// ---------- T4: delete 硬删 ----------
test("T4 delete 硬删", () => {
  const item = canvas.save({ courseId: "c3", nodeId: null, artifactType: "code_walkthrough", data: { x: 1 } });
  assert.strictEqual(canvas.list("c3").length, 1);
  canvas.remove(item.id);
  assert.strictEqual(canvas.list("c3").length, 0, "删后 list 找不到");
});

// ---------- T5: togglePin 翻转 ----------
test("T5 togglePin 0→1→0", () => {
  const item = canvas.save({ courseId: "c4", nodeId: null, artifactType: "quiz", data: { q: 1 } });
  assert.strictEqual(item.pinned, 0);
  const pinned = canvas.togglePin(item.id);
  assert.strictEqual(pinned.pinned, 1, "第一次 toggle → 1");
  const unpinned = canvas.togglePin(item.id);
  assert.strictEqual(unpinned.pinned, 0, "第二次 toggle → 0");
});

// ---------- T6: list 排序(置顶优先 + 时间倒序) ----------
test("T6 list 排序:置顶优先", () => {
  const a = canvas.save({ courseId: "c5", nodeId: null, artifactType: "quiz", title: "A", data: { q: "a1" } });
  const _b = canvas.save({ courseId: "c5", nodeId: null, artifactType: "quiz", title: "B", data: { q: "b1" } });
  canvas.togglePin(a.id); // A 置顶
  const list = canvas.list("c5");
  assert.strictEqual(list[0].title, "A", "置顶项优先");
  assert.strictEqual(list[1].title, "B");
});

// ---------- T7: data 可空对象 ----------
test("T7 data 接受任意可序列化对象", () => {
  const complex = { nested: { arr: [1, 2, { x: "y" }] }, num: 42 };
  const item = canvas.save({ courseId: "c6", nodeId: null, artifactType: "concept_map", data: complex });
  const parsed = JSON.parse(item.data);
  assert.deepStrictEqual(parsed, complex);
});

// ---------- T8: saveCanvasItem 幂等去重(根治 quiz 重复)----------
test("T8 save 幂等去重:同 (courseId,nodeId,type,data) 只存一份", () => {
  const before = canvas.list("c7").length;
  const data = { prompt: "2+2=?", options: ["3", "4", "5"], answer: 1 };
  const a = canvas.save({ courseId: "c7", nodeId: "n7", artifactType: "quiz", data });
  const b = canvas.save({ courseId: "c7", nodeId: "n7", artifactType: "quiz", data }); // 完全相同
  assert.strictEqual(a.id, b.id, "重复内容返回同一行 id");
  assert.strictEqual(canvas.list("c7").length, before + 1, "只新增 1 行,不是 2 行");
});

// ---------- T9: 去重维度——不同 nodeId 不算重复 ----------
test("T9 不同 nodeId 的同内容产物各自独立", () => {
  const data = { prompt: "同题不同节点", options: ["x", "y"], answer: 0 };
  canvas.save({ courseId: "c8", nodeId: "nA", artifactType: "quiz", data });
  canvas.save({ courseId: "c8", nodeId: "nB", artifactType: "quiz", data });
  assert.strictEqual(canvas.list("c8").length, 2, "不同 node 各一份");
});

// ---------- T10: 去重维度——不同内容不算重复 ----------
test("T10 不同 data 内容各自独立", () => {
  canvas.save({ courseId: "c9", nodeId: "n9", artifactType: "quiz", data: { q: "第一题" } });
  canvas.save({ courseId: "c9", nodeId: "n9", artifactType: "quiz", data: { q: "第二题" } });
  assert.strictEqual(canvas.list("c9").length, 2, "不同内容各一份");
});

// ---------- T11: saveUserNote 带 comment ----------
test("T11 saveUserNote 带 comment 写入 notes 列", () => {
  const item = canvas.saveUserNote({
    nodeId: "n11",
    courseId: "c11",
    text: "重要概念",
    sourceType: "content",
    sourceAnchor: { type: "content", surroundingText: "上下文" },
    comment: "  我的注解  ",
  });
  assert.strictEqual(item.notes, "我的注解", "comment 被 trim 后写入 notes");
  // 无 comment → notes 为 null
  const noComment = canvas.saveUserNote({
    nodeId: "n11",
    courseId: "c11",
    text: "另一条",
    sourceType: "chat",
    sourceAnchor: { type: "chat", threadId: "t1", msgId: "m1" },
  });
  assert.strictEqual(noComment.notes, null, "无 comment → notes null");
});

// ---------- T12: updateUserNoteComment 增/改/删 ----------
test("T12 updateUserNoteComment 新增、修改、删除(空串)", () => {
  const item = canvas.saveUserNote({
    nodeId: "n12",
    courseId: "c12",
    text: "原文",
    sourceType: "content",
    sourceAnchor: { type: "content", surroundingText: "ctx" },
  });
  // 新增注释
  const added = canvas.updateUserNoteComment(item.id, "第一条注释");
  assert.strictEqual(added.notes, "第一条注释");
  // 修改注释
  const modified = canvas.updateUserNoteComment(item.id, "  改过的  ");
  assert.strictEqual(modified.notes, "改过的", "修改 + trim");
  // 其它字段不变
  assert.strictEqual(modified.id, item.id);
  assert.strictEqual(modified.data, item.data, "data 不被注释更新影响");
  assert.strictEqual(modified.artifactType, "user_note");
  // 空串 → 删除注释
  const cleared = canvas.updateUserNoteComment(item.id, "   ");
  assert.strictEqual(cleared.notes, null, "空串 → notes 置 null");
  // 找不到的 id → null
  assert.strictEqual(canvas.updateUserNoteComment("nonexistent", "x"), null);
});

// ---------- T13: recordQuizResult 更新 last_result ----------
test("T13 recordQuizResult 记录答题结果", () => {
  const item = canvas.save({ courseId: "c13", nodeId: "n13", artifactType: "quiz", data: { q: 1 } });
  assert.strictEqual(item.lastResult, null);
  const correct = canvas.recordQuizResult(item.id, true);
  assert.strictEqual(correct.lastResult, "correct");
  const wrong = canvas.recordQuizResult(item.id, false);
  assert.strictEqual(wrong.lastResult, "wrong", "覆盖上次结果(只保留最近)");
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    console.log(e.stack?.split("\n")[1]?.trim());
    failed++;
  }
}
console.log(`\n=== Canvas 画布服务: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
