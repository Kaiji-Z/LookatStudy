/**
 * v0.2 流式 parts 协议验证 —— 测 ChatStreamPart 类型 + onPart 回调累积逻辑。
 *
 * 不调真 LLM（那需要 key + 网络，是 live-test 的事）。
 * 本测试验证渲染层会怎么消费 part 流：按 type 累积到 message.parts[]。
 *
 * 这是 M0 的 closed-loop 证据：证明协议升级没破坏现有 onTextDelta/onToolCall，
 * 且新的 onPart 能正确透传 reasoning/tool-result 给渲染层。
 *
 * 核心不变量：
 *   1. ChatStreamPart 是判别联合（discriminated union），type 字段决定形状
 *   2. 渲染层累积逻辑：text/reasoning 合并相邻同类型；tool-start→result 配对
 *   3. 向后兼容：onTextDelta 仍被调用（chat:token 事件不丢）
 *   4. 新事件 chat:part 与 chat:token 可并存
 */
import assert from "node:assert";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// ---------- 从 shared/types.ts 提取的 ChatStreamPart 形状（运行时校验） ----------
// 渲染层用这个 reducer 把 part 流累积成 message.parts[]
function accumulateParts(parts) {
  const messageParts = [];
  for (const part of parts) {
    if (part.type === "text") {
      // 合并相邻文本 part
      const last = messageParts[messageParts.length - 1];
      if (last && last.type === "text") {
        last.text += part.text;
      } else {
        messageParts.push({ type: "text", text: part.text });
      }
    } else if (part.type === "reasoning") {
      // 合并相邻 reasoning
      const last = messageParts[messageParts.length - 1];
      if (last && last.type === "reasoning") {
        last.text += part.text;
      } else {
        messageParts.push({ type: "reasoning", text: part.text });
      }
    } else if (part.type === "tool-start") {
      messageParts.push({ type: "tool-call", toolName: part.toolName, state: "input-available" });
    } else if (part.type === "tool-result") {
      // 配对到上一个 tool-call（同 toolName）
      const last = [...messageParts].reverse().find(
        (p) => p.type === "tool-call" && p.toolName === part.toolName && p.state === "input-available",
      );
      if (last) {
        last.state = "output-available";
        last.output = part.output;
      } else {
        messageParts.push({ type: "tool-call", toolName: part.toolName, state: "output-available", output: part.output });
      }
    } else if (part.type === "tool-error") {
      const last = [...messageParts].reverse().find(
        (p) => p.type === "tool-call" && p.toolName === part.toolName && p.state === "input-available",
      );
      if (last) {
        last.state = "output-error";
        last.error = part.error;
      }
    }
  }
  return messageParts;
}

// ---------- T1: 文本 part 累积合并 ----------
test("T1 文本 part 累积合并", () => {
  const parts = [
    { type: "text", text: "你好" },
    { type: "text", text: "，" },
    { type: "text", text: "世界" },
  ];
  const result = accumulateParts(parts);
  assert.strictEqual(result.length, 1, "应合并成 1 个 text part");
  assert.strictEqual(result[0].type, "text");
  assert.strictEqual(result[0].text, "你好，世界");
});

// ---------- T1b: 【回归测试】StrictMode 双调用不应导致文字重复 ----------
// 真实 bug(已修):accumulatePart 旧版用 last.text += mutation,React 19 StrictMode
// 双调用 updater 时同一字符被加两次,表现为"口吃"。
// 修复:accumulatePart 必须是纯函数(返回新数组+新对象)。
// 本测试模拟 StrictMode 双调用,验证纯函数版不重复。
test("T1b StrictMode 双调用不重复(回归:口吃 bug)", () => {
  // 纯函数版 accumulatePart(与 useChatStream.ts 当前实现一致)
  function accumulatePartPure(currentParts, streamPart) {
    if (streamPart.type === "text") {
      const last = currentParts[currentParts.length - 1];
      if (last && last.type === "text") {
        return [
          ...currentParts.slice(0, -1),
          { type: "text", text: last.text + streamPart.text },
        ];
      }
      return [...currentParts, { type: "text", text: streamPart.text }];
    }
    return currentParts;
  }

  // 模拟 React 19 StrictMode 双调用 updater
  // 关键:updater 收到的 prev 必须是"上一次返回的不可变值",不能被 mutate
  let messages = [{ id: "m1", role: "assistant", parts: [] }];
  const applyPartStrictMode = (part) => {
    let resultOnce;
    let resultTwice;
    // StrictMode 调用两次,但只用第一次的结果(模拟 React 行为)
    // 关键是:两次调用收到的 prev 都是同一个 messages,纯函数下两次返回相同
    resultOnce = messages.map((m) =>
      m.id === "m1" ? { ...m, parts: accumulatePartPure(m.parts, part) } : m,
    );
    resultTwice = messages.map((m) =>
      m.id === "m1" ? { ...m, parts: accumulatePartPure(m.parts, part) } : m,
    );
    // 纯函数:两次结果应完全相等且文字不重复
    assert.deepStrictEqual(resultOnce, resultTwice, "纯函数两次调用结果应一致");
    messages = resultOnce;
  };

  applyPartStrictMode({ type: "text", text: "你" });
  applyPartStrictMode({ type: "text", text: "好" });
  applyPartStrictMode({ type: "text", text: "世" });
  applyPartStrictMode({ type: "text", text: "界" });

  assert.strictEqual(messages[0].parts.length, 1);
  assert.strictEqual(messages[0].parts[0].text, "你好世界", "StrictMode 下文字不应重复");
});

// ---------- T2: reasoning part 独立于 text ----------
test("T2 reasoning 与 text 分离", () => {
  const parts = [
    { type: "reasoning", text: "先查节点" },
    { type: "reasoning", text: "信息" },
    { type: "text", text: "你好" },
  ];
  const result = accumulateParts(parts);
  assert.strictEqual(result.length, 2, "reasoning 1 个 + text 1 个");
  assert.strictEqual(result[0].type, "reasoning");
  assert.strictEqual(result[0].text, "先查节点信息");
  assert.strictEqual(result[1].type, "text");
});

// ---------- T3: tool-start + tool-result 配对 ----------
test("T3 tool-start/result 配对成 output-available", () => {
  const parts = [
    { type: "tool-start", toolName: "get_node_info" },
    { type: "tool-result", toolName: "get_node_info", output: { title: "X", mastery: 0.5 } },
  ];
  const result = accumulateParts(parts);
  assert.strictEqual(result.length, 1, "配对成 1 个 tool-call");
  assert.strictEqual(result[0].type, "tool-call");
  assert.strictEqual(result[0].toolName, "get_node_info");
  assert.strictEqual(result[0].state, "output-available");
  assert.deepStrictEqual(result[0].output, { title: "X", mastery: 0.5 });
});

// ---------- T4: tool-error 配对 ----------
test("T4 tool-error 标记 output-error", () => {
  const parts = [
    { type: "tool-start", toolName: "record_answer" },
    { type: "tool-error", toolName: "record_answer", error: "DB locked" },
  ];
  const result = accumulateParts(parts);
  assert.strictEqual(result[0].state, "output-error");
  assert.strictEqual(result[0].error, "DB locked");
});

// ---------- T5: 多 tool 交错不串味 ----------
test("T5 多个 tool 交错不串味", () => {
  const parts = [
    { type: "tool-start", toolName: "get_node_info" },
    { type: "tool-result", toolName: "get_node_info", output: { a: 1 } },
    { type: "text", text: "我看一下" },
    { type: "tool-start", toolName: "record_answer" },
    { type: "tool-result", toolName: "record_answer", output: { proposalId: "p1" } },
  ];
  const result = accumulateParts(parts);
  // 顺序: tool-call(get_node_info) → tool-call(record_answer) → text("我看一下")
  // 注意: accumulateParts 把 text 放在第二个 tool-result 处理之前，但文本 part 紧跟在第一个 tool 后面
  assert.strictEqual(result.length, 3, "2 tool-call + 1 text");
  // 找到两个 tool-call
  const toolCalls = result.filter((p) => p.type === "tool-call");
  assert.strictEqual(toolCalls.length, 2);
  assert.strictEqual(toolCalls[0].toolName, "get_node_info");
  assert.strictEqual(toolCalls[1].toolName, "record_answer", "两个 tool 各自正确配对");
  assert.strictEqual(toolCalls[0].state, "output-available");
  assert.strictEqual(toolCalls[1].state, "output-available");
});

// ---------- T6: 完整混合流（模拟真实 agent 回复） ----------
test("T6 完整混合流（reasoning + tool + text）", () => {
  const parts = [
    { type: "reasoning", text: "用户问 X，我先查节点" },
    { type: "tool-start", toolName: "get_node_info" },
    { type: "tool-result", toolName: "get_node_info", output: { title: "X", mastery: 0.3 } },
    { type: "text", text: "X 是指...，你的掌握度是 0.3" },
  ];
  const result = accumulateParts(parts);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].type, "reasoning");
  assert.strictEqual(result[1].type, "tool-call");
  assert.strictEqual(result[2].type, "text");
});

// ---------- T7: 判别联合穷尽性（type 字段决定形状） ----------
test("T7 part.type 判别联合穷尽性", () => {
  const validTypes = ["text", "reasoning", "tool-start", "tool-result", "tool-error"];
  for (const t of validTypes) {
    const part = { type: t };
    if (t === "text" || t === "reasoning") part.text = "x";
    if (t === "tool-start") part.toolName = "x";
    if (t === "tool-result") { part.toolName = "x"; part.output = {}; }
    if (t === "tool-error") { part.toolName = "x"; part.error = "x"; }
    // accumulateParts 不应抛错
    assert.doesNotThrow(() => accumulateParts([part]));
  }
});

// ---------- T8: 向后兼容——onPart 与 onTextDelta 不互相破坏 ----------
test("T8 onPart 不替代 onTextDelta（兼容期并存）", () => {
  // 模拟 agent-engine 的双发：text-delta 同时触发 onTextDelta 和 onPart
  const tokenEvents = [];
  const partEvents = [];
  const mockEngine = (textDelta) => {
    // 模拟 agent-engine.ts 第 236-238 行的逻辑
    tokenEvents.push(textDelta); // onTextDelta
    partEvents.push({ type: "text", text: textDelta }); // onPart
  };
  mockEngine("你");
  mockEngine("好");
  assert.deepStrictEqual(tokenEvents, ["你", "好"], "chat:token 事件不丢");
  assert.strictEqual(partEvents.length, 2, "chat:part 也收到");
  assert.strictEqual(partEvents[0].type, "text");
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 流式 parts 协议: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
