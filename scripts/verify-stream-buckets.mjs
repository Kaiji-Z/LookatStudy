/**
 * verify-stream-buckets.mjs —— v0.23 异步会话 per-thread 流式状态纯函数验证。
 *
 * 守护的架构性质:chat:part/done/error 按 threadId 路由进桶,跨 thread 零污染;
 * 后台 thread 流式期间切走视图,其输出继续累加在自己的桶里;LRU 淘汰永不杀
 * 流式桶。这是"思考中切节点,原会话后台继续输出"的数据层根基。
 *
 * 跑法: npx tsx scripts/verify-stream-buckets.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  ensureBucket, applyPart, applyDone, applyError, beginSend, failSend, evictLRU, touchBucket,
} from "../src/renderer/lib/stream-buckets.ts";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

const mkId = () => {
  let n = 0;
  return () => `m-${++n}`;
};
const text = (t) => ({ type: "text", text: t });
const userMsg = (id, t = "hi") => ({ id, role: "user", parts: [text(t)] });
const lastAssistantText = (buckets, tid) => {
  const msgs = buckets.get(tid).messages;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i];
  return null;
};
const bucketTextLen = (buckets, tid) =>
  buckets.get(tid).messages.filter((m) => m.role === "assistant").reduce((s, m) =>
    s + m.parts.filter((p) => p.type === "text").reduce((x, p) => x + p.text.length, 0), 0);

test("T1 part 路由:A 桶收 part,B 桶零污染", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("hello"), mkId(), 2);
  b = ensureBucket(b, "B", 3);
  assert.ok(bucketTextLen(b, "A") > 0, "A 桶应有文本");
  assert.equal(b.get("B").messages.length, 0, "B 桶必须为空");
  assert.equal(b.get("A").streaming, true, "A 桶流式中");
});

test("T2 后台续流:视图切 B 后 A 的 parts 仍进 A 桶(核心场景)", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("第一段"), mkId(), 2);
  // 用户切到 B(桶操作只碰 B)
  b = ensureBucket(b, "B", 3);
  b = beginSend(b, "B", userMsg("u2", "question B"), 3).buckets;
  b = applyPart(b, "B", text("B 的回答"), mkId(), 4);
  // A 的后台输出继续
  b = applyPart(b, "A", text("第二段"), mkId(), 5);
  const aLast = lastAssistantText(b, "A");
  const aText = aLast.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  assert.ok(aText.includes("第一段") && aText.includes("第二段"), `A 桶应含两段(实际:${aText})`);
  assert.ok(!aText.includes("B 的回答"), "A 桶不得混入 B 的输出");
  const bText = lastAssistantText(b, "B").parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  assert.equal(bText, "B 的回答", "B 桶只含自己的回答");
  assert.equal(b.get("A").streaming && b.get("B").streaming, true, "双桶并行流式");
});

test("T3 done 合桶:id 替换只发生在目标桶,流式态归位", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("answer"), mkId(), 2);
  const aTmpId = lastAssistantText(b, "A").id;
  b = ensureBucket(b, "B", 3);
  b = beginSend(b, "B", userMsg("u2", "q"), 3).buckets;
  b = applyPart(b, "B", text("b answer"), mkId(), 4);
  const bTmpId = lastAssistantText(b, "B").id;
  // A 的 done 先到
  b = applyDone(b, "A", { userMessageId: "db-u1", assistantMessageId: "db-a1" }, 5);
  assert.equal(b.get("A").messages.some((m) => m.id === "db-a1"), true, "A 桶换上 DB id");
  assert.equal(b.get("A").messages.some((m) => m.id === aTmpId), false, "A 临时 id 消失");
  assert.equal(b.get("B").messages.some((m) => m.id === bTmpId), true, "B 桶 id 不受影响");
  assert.equal(b.get("A").streaming, false, "A 流式结束");
  assert.equal(b.get("B").streaming, true, "B 仍在流式");
});

test("T4 error 归位:只动发起桶,追加 ⚠️ 消息", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("partial"), mkId(), 2);
  b = ensureBucket(b, "B", 3);
  b = applyError(b, "A", "network down", mkId(), 4);
  assert.equal(b.get("A").streaming, false, "A 流式结束");
  const texts = b.get("A").messages.map((m) => m.parts.map((p) => p.type === "text" ? p.text : "").join("")).join("|");
  assert.ok(texts.includes("⚠️ network down"), "A 桶有错误消息");
  assert.equal(b.get("B").messages.length, 0, "B 桶零污染");
});

test("T5 beginSend:同桶流式中拒发,跨桶自由", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  const r1 = beginSend(b, "A", userMsg("u1b"), 2);
  assert.equal(r1.accepted, false, "A 流式中再发应拒");
  b = ensureBucket(b, "B", 2);
  const r2 = beginSend(b, "B", userMsg("u2"), 3);
  assert.equal(r2.accepted, true, "B 新会话应自由开");
  assert.equal(r2.buckets.get("A").messages.length, b.get("A").messages.length, "拒发不动 A");
});

test("T6 failSend 归位发起桶(视图在别处也不显示错误)", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = ensureBucket(b, "B", 2);
  b = failSend(b, "A", "boom", mkId(), 3);
  assert.equal(b.get("A").streaming, false, "发起桶流式结束");
  assert.equal(b.get("B").messages.length, 0, "当前视图桶(B)不背错误");
});

test("T7 LRU:流式桶永不淘汰", () => {
  let b = new Map();
  // 10 个非流式桶 + 1 个流式桶(最旧)
  for (let i = 0; i < 10; i++) {
    b = ensureBucket(b, `t${i}`, i + 1);
    b = touchBucket(b, `t${i}`, i + 1);
  }
  b = ensureBucket(b, "streaming-old", 0.5);
  b = beginSend(b, "streaming-old", userMsg("u"), 0.6).buckets;
  b = touchBucket(b, "streaming-old", 0.6);
  const out = evictLRU(b, 5);
  assert.equal(out.has("streaming-old"), true, "最旧的流式桶必须幸存");
  assert.ok(out.size <= 5, `总量不超上限(实际 ${out.size})`);
});

test("T8 非流式态 part 强制新建消息,历史 assistant 不被追加", () => {
  let b = ensureBucket(new Map(), "A", 1);
  // 手工构造:非流式桶里已有历史 assistant 消息
  b = new Map(b);
  b.set("A", { messages: [{ id: "hist", role: "assistant", parts: [text("历史回答")] }], streaming: false, streamingMsgId: null, loaded: true, focusNodeId: null, touched: 1 });
  b = applyPart(b, "A", text("异常迟到的 part"), mkId(), 2);
  const hist = b.get("A").messages.find((m) => m.id === "hist");
  assert.equal(hist.parts.length, 1, "历史消息 parts 不变");
  assert.equal(b.get("A").messages.length, 2, "新消息被创建");
});

test("T9 streamingMsgId 优先:跨多 part 汇聚同一条消息", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  const id = mkId();
  b = applyPart(b, "A", text("a"), id, 2);
  b = applyPart(b, "A", text("b"), id, 3);
  b = applyPart(b, "A", text("c"), id, 4);
  const assistants = b.get("A").messages.filter((m) => m.role === "assistant");
  assert.equal(assistants.length, 1, "三段 part 汇聚一条消息");
  const t = assistants[0].parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  assert.equal(t, "abc", "顺序拼接");
});

console.log(`\n${passed === 9 ? "ALL PASS" : "FAILED"}: ${passed}/9`);
if (passed !== 9) process.exit(1);

// ── v0.23 补充:focusNodeId 存桶(地图球后台指示数据源) ──

const test2 = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

test2("T10 part 携带 focusNodeId 存桶,缺省保留原值", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("x"), mkId(), 2, "node-9");
  assert.equal(b.get("A").focusNodeId, "node-9", "首个 part 写入 focusNodeId");
  b = applyPart(b, "A", text("y"), mkId(), 3); // 后续 part 不带
  assert.equal(b.get("A").focusNodeId, "node-9", "缺省保留已有值");
});

test2("T11 流式节点集合:streaming 桶的 focusNodeId 去重", () => {
  let b = ensureBucket(new Map(), "A", 1);
  b = beginSend(b, "A", userMsg("u1"), 1).buckets;
  b = applyPart(b, "A", text("x"), mkId(), 2, "node-1");
  b = ensureBucket(b, "B", 3);
  b = beginSend(b, "B", userMsg("u2"), 3).buckets;
  b = applyPart(b, "B", text("y"), mkId(), 4, "node-1"); // 同节点第二条 thread
  b = applyDone(b, "A", undefined, 5); // A 结束
  const ids = Array.from(b.entries()).filter(([, x]) => x.streaming).map(([, x]) => x.focusNodeId).filter((v, i, arr) => v && arr.indexOf(v) === i);
  assert.deepEqual(ids, ["node-1"], "只有 B 流式,节点去重");
});

console.log(`\n${passed === 11 ? "ALL PASS" : "FAILED"}: ${passed}/11`);
if (passed !== 11) process.exit(1);
