/**
 * verify-tool-part-summary.mjs —— 工具调用历史标记纯函数验证(tool-part-summary.ts)。
 *
 * 背景:parts_json 只用于渲染,历史喂 LLM 只有 role+content → 模型对自己上回合的
 * 工具调用失忆(真实事故:发过答题卡,下回合道歉说"没真正发题"重发)。
 * summarizeToolParts 把持久化形状的 tool-call parts(state=output-available/error)
 * 压成「[工具调用已执行] …」标记。
 *
 * 跑法: npx tsx scripts/verify-tool-part-summary.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { summarizeToolParts, summarizeToolPartsJson } from "../src/main/services/pure/tool-part-summary.ts";

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

test("quiz 工具 → 标记含答题卡 + 题数", () => {
  const s = summarizeToolParts([
    { type: "text", text: "来做题吧" },
    { type: "tool-call", toolName: "generate_quiz", state: "output-available", output: { artifactType: "quiz", title: "递归检验", questions: [{}, {}, {}] } },
  ]);
  assert.ok(s.includes("[工具调用已执行] generate_quiz"));
  assert.ok(s.includes("交互答题卡《递归检验》"));
  assert.ok(s.includes("共 3 题"));
  assert.ok(!s.includes("来做题吧"), "text part 不进标记");
});

test("concept_map → 概念图 + 节点数;diagram → 流程图", () => {
  const s = summarizeToolParts([
    { type: "tool-call", toolName: "show_concept_map", state: "output-available", output: { artifactType: "concept_map", title: "BKT 关系", nodes: [{}, {}, {}, {}], edges: [] } },
    { type: "tool-call", toolName: "draw_diagram", state: "output-available", output: { artifactType: "diagram", title: "导入管线", diagramType: "flowchart" } },
  ]);
  assert.ok(s.includes("概念图《BKT 关系》(4 个节点)"));
  assert.ok(s.includes("流程图《导入管线》"));
  assert.equal(s.split("\n").length, 2);
});

test("未知工具 → 兜底一句'已执行',绝不让模型以为没发", () => {
  const s = summarizeToolParts([{ type: "tool-call", toolName: "attach_node_images", state: "output-available", output: { images: 3 } }]);
  assert.ok(s.includes("已执行工具 attach_node_images"));
});

test("output-error → [工具调用失败] 可见(失败 ≠ 忘了发)", () => {
  const s = summarizeToolParts([{ type: "tool-call", toolName: "generate_quiz", state: "output-error", error: "boomed" }]);
  assert.ok(s.includes("[工具调用失败] generate_quiz"));
  assert.ok(s.includes("boomed"));
});

test("input-available(流中断未完成)→ 不标,如实留白", () => {
  const s = summarizeToolParts([{ type: "tool-call", toolName: "generate_quiz", state: "input-available" }]);
  assert.equal(s, "");
});

test("空数组 / 纯文本 parts → 空串", () => {
  assert.equal(summarizeToolParts([]), "");
  assert.equal(summarizeToolParts([{ type: "text", text: "hi" }, { type: "reasoning", text: "想想" }]), "");
});

test("Json 包装:null/损坏/非数组 → 空串静默降级", () => {
  assert.equal(summarizeToolPartsJson(null), "");
  assert.equal(summarizeToolPartsJson("{broken"), "");
  assert.equal(summarizeToolPartsJson('{"a":1}'), "");
  const s = summarizeToolPartsJson(JSON.stringify([{ type: "tool-call", toolName: "generate_quiz", state: "output-available", output: { artifactType: "quiz", questions: [{}] } }]));
  assert.ok(s.includes("答题卡"));
});

test("无 title 的 quiz → 不出现空书名号", () => {
  const s = summarizeToolParts([{ type: "tool-call", toolName: "generate_quiz", state: "output-available", output: { artifactType: "quiz", questions: [] } }]);
  assert.ok(!s.includes("《》"));
});

console.log(`\n${passed} passed`);
