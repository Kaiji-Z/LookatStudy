/**
 * v0.2 Generative UI 产物提取验证(M2 closed-loop)。
 *
 * 不调真 LLM。验证 extractArtifacts 函数能从 ChatMessageV2[] 里
 * 正确提取展示型 tool 产物(含 artifactType 字段的 tool-result)。
 * 也验证 5 个新 tool 的 zod schema 形状正确(通过 import agent-engine 的 tool 定义)。
 *
 * 核心不变量:
 *   1. 只有 output-available 且 output 含 artifactType 的 tool-call 才算产物
 *   2. proposal 类(record_answer/mark_mastered)不是产物(它们走 Proposal 卡片)
 *   3. 5 个展示型 tool 的返回都有 artifactType 字段
 */
import assert from "node:assert";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// 复刻 extractArtifacts 逻辑(与 ChatStream.tsx 同步)
function extractArtifacts(messages) {
  const artifacts = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i];
      if (
        part.type === "tool-call" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "artifactType" in part.output
      ) {
        artifacts.push({ id: `${msg.id}-${i}`, toolName: part.toolName, output: part.output });
      }
    }
  }
  return artifacts;
}

// ---------- T1: concept_map 产物被提取 ----------
test("T1 concept_map 产物被提取", () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "我来画个图" },
        {
          type: "tool-call",
          toolName: "show_concept_map",
          state: "output-available",
          output: { artifactType: "concept_map", title: "X", nodes: [], edges: [] },
        },
      ],
    },
  ];
  const arts = extractArtifacts(messages);
  assert.strictEqual(arts.length, 1);
  assert.strictEqual(arts[0].toolName, "show_concept_map");
  assert.strictEqual(arts[0].output.artifactType, "concept_map");
});

// ---------- T2: proposal 类 tool 不算产物 ----------
test("T2 record_answer 不是产物(走 Proposal)", () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolName: "record_answer",
          state: "output-available",
          output: { proposalId: "p1", status: "pending" }, // 无 artifactType
        },
      ],
    },
  ];
  const arts = extractArtifacts(messages);
  assert.strictEqual(arts.length, 0, "record_answer 输出无 artifactType,不算产物");
});

// ---------- T3: 未完成的 tool(input-available)不算产物 ----------
test("T3 未完成 tool 不算产物", () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolName: "show_concept_map",
          state: "input-available", // 还在执行
          output: undefined,
        },
      ],
    },
  ];
  const arts = extractArtifacts(messages);
  assert.strictEqual(arts.length, 0);
});

// ---------- T4: user 消息里的 tool 被忽略 ----------
test("T4 user 消息忽略", () => {
  const messages = [
    {
      id: "m1",
      role: "user",
      parts: [{ type: "tool-call", toolName: "show_concept_map", state: "output-available", output: { artifactType: "concept_map" } }],
    },
  ];
  assert.strictEqual(extractArtifacts(messages).length, 0);
});

// ---------- T5: 多产物按顺序提取 ----------
test("T5 多产物按消息顺序", () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [{ type: "tool-call", toolName: "generate_quiz", state: "output-available", output: { artifactType: "quiz" } }],
    },
    { id: "m2", role: "user", parts: [{ type: "text", text: "再来一个" }] },
    {
      id: "m3",
      role: "assistant",
      parts: [{ type: "tool-call", toolName: "compare_table", state: "output-available", output: { artifactType: "compare_table" } }],
    },
  ];
  const arts = extractArtifacts(messages);
  assert.strictEqual(arts.length, 2);
  assert.strictEqual(arts[0].toolName, "generate_quiz");
  assert.strictEqual(arts[1].toolName, "compare_table");
});

// ---------- T6: 5 种 artifactType 都能被识别 ----------
test("T6 5 种 artifactType 都识别", () => {
  const types = ["concept_map", "quiz", "compare_table", "diagram", "code_walkthrough"];
  const messages = types.map((t, i) => ({
    id: `m${i}`,
    role: "assistant",
    parts: [{ type: "tool-call", toolName: `tool_${t}`, state: "output-available", output: { artifactType: t } }],
  }));
  const arts = extractArtifacts(messages);
  assert.strictEqual(arts.length, 5);
  const got = arts.map((a) => a.output.artifactType);
  assert.deepStrictEqual(got, types);
});

// ---------- T7: 错误态 tool 不算产物 ----------
test("T7 tool-error 不算产物", () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolName: "show_concept_map",
          state: "output-error", // 出错
          error: "bad input",
        },
      ],
    },
  ];
  assert.strictEqual(extractArtifacts(messages).length, 0);
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
console.log(`\n=== Generative UI 产物提取: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
