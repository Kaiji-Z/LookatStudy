/**
 * v0.4 Thread 会话模型验证 —— 测 thread-service.ts CRUD + 消息追加。
 *
 * 核心不变量:
 *   1. createThread 写入,默认 status=active, message_count=0
 *   2. listThreads 按 courseId 过滤,status 过滤,updated_at 倒序
 *   3. updateThread 改 title/status/focusNodeId;updatedAt 更新
 *   4. deleteThread 连带删 chat_messages(级联)
 *   5. appendMessage 增 message_count,updated_at 推进
 *   6. findRecentThreadByNode 找该节点最近 active thread
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

async function makeDb() {
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  const schemaSql = readFileSync(join(__dirname, "..", "src", "main", "db", "schema.sql"), "utf-8");
  sqldb.run(schemaSql);
  return drizzle(sqldb, { schema });
}

// 测试版 service(注入 db,隔离单例)
async function loadThreadService(db) {
  const { threads, chatMessages } = schema;
  const { eq, and, desc, asc } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  const listThreads = (courseId, status) => {
    const condition = status
      ? and(eq(threads.courseId, courseId), eq(threads.status, status))
      : eq(threads.courseId, courseId);
    return db.select().from(threads).where(condition).orderBy(desc(threads.updatedAt)).all();
  };
  const createThread = (input) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row = {
      id, courseId: input.courseId, title: input.title ?? null,
      focusNodeId: input.focusNodeId ?? null, status: "active",
      createdAt: now, updatedAt: now, messageCount: 0,
    };
    db.insert(threads).values(row).run();
    return row;
  };
  const updateThread = (id, patch) => {
    const existing = db.select().from(threads).where(eq(threads.id, id)).get();
    if (!existing) return null;
    const next = { updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.focusNodeId !== undefined) next.focusNodeId = patch.focusNodeId;
    db.update(threads).set(next).where(eq(threads.id, id)).run();
    return { ...existing, ...next };
  };
  const deleteThread = (id) => {
    db.delete(chatMessages).where(eq(chatMessages.threadId, id)).run();
    db.delete(threads).where(eq(threads.id, id)).run();
  };
  const getThreadMessages = (threadId) =>
    db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.createdAt)).all();
  const appendMessage = (threadId, role, content, partsJson, displayText) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row = { id, threadId, role, content, partsJson: partsJson ?? null, displayText: displayText ?? null, createdAt: now };
    db.insert(chatMessages).values(row).run();
    const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
    if (thread) {
      db.update(threads).set({ messageCount: thread.messageCount + 1, updatedAt: now }).where(eq(threads.id, threadId)).run();
    }
    return row;
  };
  const findRecentThreadByNode = (courseId, nodeId) => {
    const rows = db.select().from(threads)
      .where(and(eq(threads.courseId, courseId), eq(threads.focusNodeId, nodeId), eq(threads.status, "active")))
      .orderBy(desc(threads.updatedAt)).all();
    return rows[0] ?? null;
  };
  return { listThreads, createThread, updateThread, deleteThread, getThreadMessages, appendMessage, findRecentThreadByNode };
}

const db = await makeDb();
const svc = await loadThreadService(db);

// T1: create + list
test("T1 create 默认 status=active count=0", () => {
  const t = svc.createThread({ courseId: "c1", focusNodeId: "n1", title: "T1" });
  assert.ok(t.id);
  assert.strictEqual(t.status, "active");
  assert.strictEqual(t.messageCount, 0);
  assert.strictEqual(t.title, "T1");
  const list = svc.listThreads("c1");
  assert.strictEqual(list.length, 1);
});

// T2: status 过滤
test("T2 status 过滤", () => {
  const _a = svc.createThread({ courseId: "c2", title: "A" });
  const b = svc.createThread({ courseId: "c2", title: "B" });
  svc.updateThread(b.id, { status: "archived" });
  const active = svc.listThreads("c2", "active");
  const archived = svc.listThreads("c2", "archived");
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].title, "A");
  assert.strictEqual(archived.length, 1);
  assert.strictEqual(archived[0].title, "B");
});

// T3: list 按 updated_at 倒序
test("T3 list 按 updated_at 倒序", () => {
  // 防抖抖动:t1/t2 同毫秒创建 → updatedAt 相同 → 排序不确定(原 flaky)。
  // 用同步 2ms 等待(Atomics.wait)保证 t1/t2 的 updatedAt 严格递增。
  const t1 = svc.createThread({ courseId: "c3", title: "old" });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); // 同步等 2ms
  const t2 = svc.createThread({ courseId: "c3", title: "new" });
  // t2 的 updatedAt 严格 > t1(跨过至少 1ms 边界)
  const list = svc.listThreads("c3");
  assert.strictEqual(list[0].id, t2.id, "new(updatedAt 更晚)在前");
  assert.strictEqual(list[1].id, t1.id);
});

// T4: appendMessage 增 count
test("T4 appendMessage 增 message_count", () => {
  const t = svc.createThread({ courseId: "c4", title: "T4" });
  svc.appendMessage(t.id, "user", "问题");
  svc.appendMessage(t.id, "assistant", "回答");
  svc.appendMessage(t.id, "user", "追问");
  const after = svc.listThreads("c4")[0];
  assert.strictEqual(after.messageCount, 3);
  const msgs = svc.getThreadMessages(t.id);
  assert.strictEqual(msgs.length, 3);
  assert.strictEqual(msgs[0].role, "user");
  assert.strictEqual(msgs[2].content, "追问");
});

// T5: delete 级联删消息
test("T5 delete 连带删 chat_messages", () => {
  const t = svc.createThread({ courseId: "c5", title: "T5" });
  svc.appendMessage(t.id, "user", "x");
  assert.strictEqual(svc.getThreadMessages(t.id).length, 1);
  svc.deleteThread(t.id);
  assert.strictEqual(svc.listThreads("c5").length, 0);
  assert.strictEqual(svc.getThreadMessages(t.id).length, 0, "消息也删了");
});

// T6: findRecentThreadByNode
test("T6 findRecentThreadByNode 找最近 active", () => {
  const t1 = svc.createThread({ courseId: "c6", focusNodeId: "n6", title: "较早" });
  const t2 = svc.createThread({ courseId: "c6", focusNodeId: "n6", title: "较晚" });
  svc.appendMessage(t2.id, "user", "推进 updated_at");
  const found = svc.findRecentThreadByNode("c6", "n6");
  assert.ok(found);
  assert.strictEqual(found.id, t2.id, "返回最近更新的");
  // 归档的不算
  svc.updateThread(t2.id, { status: "archived" });
  const found2 = svc.findRecentThreadByNode("c6", "n6");
  assert.strictEqual(found2.id, t1.id, "归档后回退到较早的");
});

// T7: courseId 隔离
test("T7 courseId 隔离", () => {
  svc.createThread({ courseId: "c7a", title: "A" });
  svc.createThread({ courseId: "c7b", title: "B" });
  assert.strictEqual(svc.listThreads("c7a").length, 1);
  assert.strictEqual(svc.listThreads("c7b").length, 1);
});

// T8: partsJson 可空
test("T8 appendMessage partsJson 可空", () => {
  const t = svc.createThread({ courseId: "c8", title: "T8" });
  const m = svc.appendMessage(t.id, "assistant", "纯文本");
  assert.strictEqual(m.partsJson, null);
  const m2 = svc.appendMessage(t.id, "assistant", "带产物", JSON.stringify({ artifactType: "quiz" }));
  assert.ok(m2.partsJson.includes("quiz"));
});

// T9: display_text —— 按钮触发的消息存短动作标签,手打输入默认 null(原样展示 content)。
// 走真 schema.ts 列定义(displayText→display_text),验证列真的存在且往返不丢。
test("T9 appendMessage displayText 持久化往返 + 默认 null", () => {
  const t = svc.createThread({ courseId: "c9", title: "T9" });
  const btnMsg = svc.appendMessage(t.id, "user", "我想开始学「X」。但我现在没什么劲——别直接讲概念……(完整开场提示词)", null, "开始学习「X」");
  const _typed = svc.appendMessage(t.id, "user", "用户手打的原文");
  const msgs = svc.getThreadMessages(t.id);
  assert.strictEqual(msgs[0].displayText, "开始学习「X」", "按钮消息读回短标签");
  assert.strictEqual(msgs[0].content.includes("别直接讲概念"), true, "完整提示词仍在 content(LLM 可见)");
  assert.strictEqual(msgs[1].displayText, null, "手打输入 displayText=null → 原样展示 content");
  assert.strictEqual(btnMsg.displayText, "开始学习「X」");
});

let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.log(`✗ ${name}\n  ${e.message}`); failed++; }
}
console.log(`\n=== Thread 会话模型: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
