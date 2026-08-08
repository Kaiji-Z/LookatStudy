/**
 * artifact-harness 验证套件(v0.2.1 closed-loop)。
 *
 * 验证 sanitizeArtifact 对 5 种产物的语义校验 + graceful 修复:
 *   1. 合法数据 → warnings 空,数据不变
 *   2. 非法数据(坏 edge / 坏索引 / 坏行号 / 行列不齐)→ 自动修复 + warnings 记录
 *   3. 超限数据(节点过多 / 代码过长)→ 截断 + warnings
 *   4. 边界数据(空 / 单元素)→ 不 crash
 *
 * 核心不变量:
 *   - sanitize 永不 throw(任何输入都返回 { data, warnings })
 *   - 修复后的数据一定能被渲染层渲染(不会因数据问题白屏)
 *
 * 闭环证明(VERIFICATION §4):写完后临时注释掉 sanitizeConceptMap 的 edge 过滤逻辑 →
 * T2 应当红 → 证明 harness 有效。
 */
import assert from "node:assert";
import { sanitizeArtifact, QUALITY_GUIDE } from "../src/main/services/artifact-harness.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// ============================================================
// § concept_map
// ============================================================

test("T1 concept_map 合法数据通过,无 warning", () => {
  const r = sanitizeArtifact(
    {
      title: "Transformer 架构",
      nodes: [
        { id: "enc", label: "编码器" },
        { id: "dec", label: "解码器" },
      ],
      edges: [{ from: "enc", to: "dec", label: "传递" }],
    },
    "concept_map",
  );
  assert.strictEqual(r.warnings.length, 0);
  assert.strictEqual(r.data.nodes.length, 2);
  assert.strictEqual(r.data.edges.length, 1);
});

test("T2 concept_map 坏 edge 被丢弃 + warning", () => {
  const r = sanitizeArtifact(
    {
      title: "X",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [
        { from: "a", to: "b" }, // 合法
        { from: "a", to: "ghost" }, // to 不存在
        { from: "phantom", to: "b" }, // from 不存在
      ],
    },
    "concept_map",
  );
  assert.strictEqual(r.data.edges.length, 1, "应该只保留合法边");
  assert.ok(r.warnings.length >= 2, "每条坏边应有 warning");
});

test("T3 concept_map 节点缺 label 被过滤", () => {
  const r = sanitizeArtifact(
    {
      title: "X",
      nodes: [
        { id: "a", label: "A" },
        { id: "b" }, // 缺 label → 过滤
        { id: "", label: "空 id" }, // 空 id → 过滤
      ],
      edges: [],
    },
    "concept_map",
  );
  assert.strictEqual(r.data.nodes.length, 1, "过滤掉无 id 或无 label 的节点,只剩 a");
  assert.ok(r.warnings.length >= 1, "节点 < 2 应有 warning");
});

// ============================================================
// § quiz
// ============================================================

test("T4 quiz answer 越界被 clamp", () => {
  const r = sanitizeArtifact(
    {
      questions: [
        {
          prompt: "1+1=?",
          options: ["1", "2", "3"],
          answer: 5, // 越界
          explanation: "1+1=2",
        },
      ],
    },
    "quiz",
  );
  assert.strictEqual(r.data.questions[0].answer, 0, "越界 answer clamp 到 0");
  assert.ok(r.warnings.length >= 1);
});

test("T5 quiz 负数 answer 被 clamp", () => {
  const r = sanitizeArtifact(
    {
      questions: [
        {
          prompt: "Q",
          options: ["A", "B"],
          answer: -1,
          explanation: "x",
        },
      ],
    },
    "quiz",
  );
  assert.strictEqual(r.data.questions[0].answer, 0);
});

test("T6 quiz options 少于 2 的题目被丢弃", () => {
  const r = sanitizeArtifact(
    {
      questions: [
        { prompt: "Q1", options: ["仅一个"], answer: 0, explanation: "x" }, // options<2
        { prompt: "Q2", options: ["A", "B"], answer: 0, explanation: "x" }, // 合法
      ],
    },
    "quiz",
  );
  assert.strictEqual(r.data.questions.length, 1, "丢弃 options<2 的题");
});

test("T7 quiz 超过 5 题被截断", () => {
  const questions = Array.from({ length: 8 }, (_, i) => ({
    prompt: `Q${i}`,
    options: ["A", "B"],
    answer: 0,
    explanation: "x",
  }));
  const r = sanitizeArtifact({ questions }, "quiz");
  assert.strictEqual(r.data.questions.length, 5, "最多 5 题");
});

// ============================================================
// § compare_table
// ============================================================

test("T8 compare_table 行列不齐被对齐", () => {
  const r = sanitizeArtifact(
    {
      title: "对比",
      headers: ["维度", "A", "B"], // 3 列
      rows: [
        ["速度", "快", "慢", "多余"], // 4 格,多
        ["价格", "贵"], // 1 格,少
      ],
    },
    "compare_table",
  );
  assert.strictEqual(r.data.headers.length, 3);
  assert.strictEqual(r.data.rows[0].length, 3, "行 0 截断到 3");
  assert.strictEqual(r.data.rows[1].length, 3, "行 1 补齐到 3");
  assert.ok(r.warnings.length >= 2);
});

test("T9 compare_table headers 少于 2 有 warning", () => {
  const r = sanitizeArtifact(
    { title: "X", headers: ["仅一列"], rows: [["a"]] },
    "compare_table",
  );
  assert.ok(r.warnings.length >= 1);
});

// ============================================================
// § diagram
// ============================================================

test("T10 diagram 空 mermaid 用占位图", () => {
  const r = sanitizeArtifact(
    { title: "X", diagramType: "flowchart", mermaid: "" },
    "diagram",
  );
  assert.ok(r.data.mermaid.length > 0, "空 mermaid 替换为占位图");
  assert.ok(r.warnings.length >= 1);
});

test("T11 diagram 超长 mermaid 截断", () => {
  // 确保超过 2000 字符(每行 ~50 字符 × 60 行)
  const longLine = "  A-->B\n".repeat(260); // ~2080 字符
  const longCode = "flowchart TD\n" + longLine;
  assert.ok(longCode.length > 2000, "测试数据本身应 > 2000 字符");
  const r = sanitizeArtifact(
    { title: "X", diagramType: "flowchart", mermaid: longCode },
    "diagram",
  );
  assert.ok(r.data.mermaid.length <= 2000, "截断到 2000 字符");
  assert.ok(r.warnings.length >= 1);
});

test("T12 diagram 非法 diagramType 默认 flowchart", () => {
  const r = sanitizeArtifact(
    { title: "X", diagramType: "gantt", mermaid: "flowchart TD\n  A-->B" },
    "diagram",
  );
  assert.strictEqual(r.data.diagramType, "flowchart");
});

test("T12b diagram 剥离 markdown 围栏(LLM 常见:syntax error 主因)", () => {
  const r = sanitizeArtifact(
    {
      title: "X",
      diagramType: "flowchart",
      mermaid: "```mermaid\nflowchart TD\n  A-->B\n```",
    },
    "diagram",
  );
  assert.ok(!r.data.mermaid.includes("```"), "围栏应被剥离");
  assert.ok(r.data.mermaid.startsWith("flowchart"), "剥离后应以 flowchart 开头");
  assert.ok(r.warnings.length >= 1, "应有剥离 warning");
});

test("T12c diagram 无语言标签的围栏也剥离", () => {
  const r = sanitizeArtifact(
    { title: "X", diagramType: "flowchart", mermaid: "```\nflowchart TD\n  A-->B\n```" },
    "diagram",
  );
  assert.ok(!r.data.mermaid.includes("```"));
});

// ============================================================
// § code_walkthrough
// ============================================================

test("T13 code_walkthrough lineEnd 超出代码行数被 clamp", () => {
  const r = sanitizeArtifact(
    {
      title: "X",
      language: "ts",
      code: "line1\nline2\nline3", // 3 行
      annotations: [
        { lineStart: 1, lineEnd: 10, note: "超界" }, // lineEnd > 3
        { lineStart: 2, lineEnd: 3, note: "合法" },
      ],
    },
    "code_walkthrough",
  );
  assert.strictEqual(r.data.annotations[0].lineEnd, 3, "lineEnd clamp 到 3");
  assert.ok(r.warnings.length >= 1);
});

test("T14 code_walkthrough lineStart > lineEnd 自动修正", () => {
  const r = sanitizeArtifact(
    {
      title: "X",
      language: "ts",
      code: "a\nb\nc", // 3 行
      annotations: [{ lineStart: 5, lineEnd: 2, note: "倒置" }],
    },
    "code_walkthrough",
  );
  const a = r.data.annotations[0];
  assert.ok(a.lineStart <= a.lineEnd, "修正后 lineStart <= lineEnd");
  assert.ok(a.lineStart <= 3 && a.lineEnd <= 3, "都在代码行数内");
});

// ============================================================
// § 鲁棒性
// ============================================================

test("T15 未知类型不 crash,原样返回 + warning", () => {
  const r = sanitizeArtifact({ foo: "bar" }, "nonexistent_type");
  assert.deepStrictEqual(r.data, { foo: "bar" });
  assert.ok(r.warnings.length >= 1);
});

test("T16 null/undefined 输入不 crash", () => {
  const r1 = sanitizeArtifact(null, "concept_map");
  const r2 = sanitizeArtifact(undefined, "quiz");
  assert.ok(Array.isArray(r1.data.nodes));
  assert.ok(Array.isArray(r2.data.questions));
});

test("T17 QUALITY_GUIDE 5 种类型都有指南", () => {
  const types = ["concept_map", "quiz", "compare_table", "diagram", "code_walkthrough"];
  for (const t of types) {
    assert.ok(typeof QUALITY_GUIDE[t] === "string" && QUALITY_GUIDE[t].length > 10, `${t} 应有质量指南`);
  }
});

// ---------- 跑测 ----------
let passed = 0,
  failed = 0;
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
console.log(
  `\n=== artifact-harness: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`,
);
if (failed > 0) process.exit(1);
