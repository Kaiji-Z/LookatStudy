/**
 * verify-mermaid-elk —— mermaid ELK 布局接线(v0.21)确定性测试。
 *
 * T1 前缀改写纯函数(flowchart/graph/已 ELK 幂等/其他图型不动/注释指令行跳过)
 * T2 真集成:真 mermaid + 注册 layout-elk 后,改写产物 parse 通过(含 flowchart-elk 家族)
 * T3 接线守卫(源码级):lazy-mermaid 注册 "elk" 布局 + renderMermaid 改写后才 parse;
 *    修复回路与出题提示词零污染(继续吃/吐原版 flowchart 语法)
 * T4 修复回路不回归:verify-diagram-repair 在链上(本套不重复其断言,只守源头)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rewriteFlowchartToElk } from "../src/renderer/lib/mermaid-elk-rewrite.ts";

// ---------------------------------------------------------------- T1 纯函数
{
  const cases = [
    ["flowchart TD\n  a --> b", "flowchart-elk TD\n  a --> b"],
    ["graph LR\n  a --> b", "flowchart-elk LR\n  a --> b"],
    ["Flowchart TD\n  a --> b", "flowchart-elk TD\n  a --> b"], // 大小写不敏感
    ["flowchart\n  a --> b", "flowchart-elk\n  a --> b"], // 无方向词也改
    ["flowchart-elk TD\n  a --> b", "flowchart-elk TD\n  a --> b"], // 幂等
    ["  flowchart TD\n  a --> b", "  flowchart-elk TD\n  a --> b"], // 保留缩进
    ["\n%%{init: {\"theme\":\"dark\"}}%%\nflowchart TD\n  a --> b", "\n%%{init: {\"theme\":\"dark\"}}%%\nflowchart-elk TD\n  a --> b"],
    ["%% 注释\nflowchart TD\n  a --> b", "%% 注释\nflowchart-elk TD\n  a --> b"],
    // 其他图类型零改动
    ["sequenceDiagram\n  A->>B: hi", "sequenceDiagram\n  A->>B: hi"],
    ["stateDiagram-v2\n  s1 --> s2", "stateDiagram-v2\n  s1 --> s2"],
    ["classDiagram\n  A <|-- B", "classDiagram\n  A <|-- B"],
    // 正文里出现 graph 词不误伤(声明只在首个内容行)
    ["sequenceDiagram\n  A->>B: see graph TD\n", "sequenceDiagram\n  A->>B: see graph TD\n"],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    assert.equal(rewriteFlowchartToElk(input), expected, `T1 改写: ${JSON.stringify(input.slice(0, 30))}`);
  }
  // 二次改写幂等
  const once = rewriteFlowchartToElk("flowchart TD\n  a --> b");
  assert.equal(rewriteFlowchartToElk(once), once, "T1 幂等");
  console.log("T1 前缀改写纯函数(13 例+幂等)✓");
}

// ---------------------------------------------------------------- T2 真集成
{
  const { default: mermaid } = await import("mermaid");
  const { default: elkLayouts } = await import("@mermaid-js/layout-elk");
  mermaid.registerLayoutLoaders(elkLayouts);
  // 改写产物 parse 通过 = flowchart-elk 图型 + 方向 + 语法在真 mermaid 里成立。
  // 只用裸 id(label 文本会走 DOMPurify → 需要 DOM;带 label/subgraph 的全语法
  // 集成由 ui-test 真 Chromium 断言,那里还带 ELK 生效的 console.warn 哨兵)。
  await mermaid.parse(rewriteFlowchartToElk("flowchart TD\n  a --> b\n  b --> c"));
  await mermaid.parse(rewriteFlowchartToElk("graph LR\n  a --> b"));
  // 非改写图型照常
  await mermaid.parse("sequenceDiagram\n  A->>B: hi");
  // 注册表形状:含 name "elk" 的 LayoutLoaderDefinition
  assert.ok(Array.isArray(elkLayouts) && elkLayouts.some((l) => l && l.name === "elk"), "T2 layout-elk 导出含 'elk' 布局");
  console.log("T2 真集成(注册+parse 改写产物;带 label 语法归 ui-test 真 DOM)✓");
}

// ---------------------------------------------------------------- T3 接线守卫
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const lazy = read("../src/renderer/lib/lazy-mermaid.ts");
  assert.ok(lazy.includes("registerLayoutLoaders"), "T3 lazy-mermaid 注册布局");
  assert.ok(lazy.includes('@mermaid-js/layout-elk'), "T3 布局来自官方包");
  assert.ok(
    /rewriteFlowchartToElk\(code\)/.test(lazy) && /parse\(elkCode\)/.test(lazy) && /render\(id, elkCode\)/.test(lazy),
    "T3 renderMermaid 改写→parse→render 全吃改写产物",
  );
  const repair = read("../src/main/services/agent/diagram-repair-service.ts");
  assert.ok(!repair.includes("flowchart-elk") && !repair.includes("rewriteFlowchartToElk"), "T3 修复回路零污染(只吃吐原版语法)");
  const artifact = read("../src/renderer/components/artifacts/MermaidArtifact.tsx");
  assert.ok(!artifact.includes("flowchart-elk"), "T3 组件层零耦合(修复缓存/展示仍用原版)");
  console.log("T3 接线守卫(注册/改写位置/修复回路零污染)✓");
}

console.log("verify-mermaid-elk: 3 组全部通过");
