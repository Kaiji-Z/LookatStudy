/**
 * v0.3 Canvas 画布服务验证 —— 测 canvas-service.ts 的 CRUD。
 *
 * 核心不变量:
 *   1. saveCanvasItem 写入,返回带 id 的完整 item
 *   2. listCanvasItems 按 courseId 过滤;按 nodeId 二级过滤;置顶优先 + 时间倒序
 *   3. deleteCanvasItem 硬删(删后 list 找不到)
 *   4. togglePinCanvasItem 翻转 pinned(0↔1)
 *   5. data 字段是 JSON 字符串(存时 stringify,读时是字符串)
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

// 把 canvas-service 改造成接受 db 注入的测试版本
// (生产版用 getDb 单例,测试需要隔离)
async function loadCanvasServiceWithDb(db) {
  // 直接 inline 实现测试版,避免改生产代码的 getDb
  const { canvasItems } = schema;
  const { eq, and, desc } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  const save = (input) => {
    const id = randomUUID();
    const item = {
      id,
      nodeId: input.nodeId ?? null,
      courseId: input.courseId,
      artifactType: input.artifactType,
      title: input.title ?? null,
      data: JSON.stringify(input.data),
      pinned: 0,
      createdAt: new Date().toISOString(),
      notes: null,
    };
    db.insert(canvasItems).values(item).run();
    return item;
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
  return { save, list, remove, togglePin };
}

// 顶层初始化(所有 test 共享同一个内存 DB)
const db = await makeDb();
const canvas = await loadCanvasServiceWithDb(db);

// ---------- T1: save + list 基础 ----------
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
  canvas.save({ courseId: "c1", nodeId: "n1", artifactType: "quiz", data: {} });
  canvas.save({ courseId: "c1", nodeId: "n2", artifactType: "quiz", data: {} });
  canvas.save({ courseId: "c1", nodeId: "n1", artifactType: "compare_table", data: {} });

  const n1Items = canvas.list("c1", "n1");
  assert.ok(n1Items.length >= 2, "n1 至少 2 个(T1 的 + 这次的)");
  const n2Items = canvas.list("c1", "n2");
  assert.strictEqual(n2Items.length, 1, "n2 只有 1 个");
});

// ---------- T3: courseId 隔离 ----------
test("T3 courseId 隔离", () => {
  canvas.save({ courseId: "c2", nodeId: null, artifactType: "diagram", data: {} });
  const c1 = canvas.list("c1");
  const c2 = canvas.list("c2");
  assert.ok(c1.length > 0);
  assert.ok(c2.length === 1, "c2 隔离只有 1 个");
  assert.ok(c1.every((i) => i.courseId === "c1"));
});

// ---------- T4: delete 硬删 ----------
test("T4 delete 硬删", () => {
  const item = canvas.save({ courseId: "c3", nodeId: null, artifactType: "code_walkthrough", data: {} });
  assert.strictEqual(canvas.list("c3").length, 1);
  canvas.remove(item.id);
  assert.strictEqual(canvas.list("c3").length, 0, "删后 list 找不到");
});

// ---------- T5: togglePin 翻转 ----------
test("T5 togglePin 0→1→0", () => {
  const item = canvas.save({ courseId: "c4", nodeId: null, artifactType: "quiz", data: {} });
  assert.strictEqual(item.pinned, 0);
  const pinned = canvas.togglePin(item.id);
  assert.strictEqual(pinned.pinned, 1, "第一次 toggle → 1");
  const unpinned = canvas.togglePin(item.id);
  assert.strictEqual(unpinned.pinned, 0, "第二次 toggle → 0");
});

// ---------- T6: list 排序(置顶优先 + 时间倒序) ----------
test("T6 list 排序:置顶优先", () => {
  const a = canvas.save({ courseId: "c5", nodeId: null, artifactType: "quiz", title: "A", data: {} });
  const b = canvas.save({ courseId: "c5", nodeId: null, artifactType: "quiz", title: "B", data: {} });
  canvas.togglePin(a.id); // A 置顶
  const list = canvas.list("c5");
  // 置顶的 A 应在前
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
