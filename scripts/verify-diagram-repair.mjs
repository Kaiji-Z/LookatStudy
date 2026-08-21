/**
 * verify-diagram-repair —— v0.20 draw_diagram 产物 mermaid 语法自动修复
 * (archify 思想适配:验证回执 → 带错误定点修 → 限轮数)。
 * T1 修复提示词纯函数;T2 回复剥离;T3 形态校验;T4 四端接线 + 渲染层修复
 * 状态机守卫(一轮封顶/只修原始稿/会话缓存);T5 无模型时失败路径(不抛)。
 * run: tsx scripts/verify-diagram-repair.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  buildRepairPrompt,
  extractMermaidFromReply,
  isPlausibleMermaid,
  repairMermaidDiagram,
} from "../src/main/services/agent/diagram-repair-service.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

console.log("T1 修复提示词(带原始码/错误/类型,只输出代码,语义不变)");
{
  const p = buildRepairPrompt({ mermaid: "flowchart TD\n  A[步骤(一)]-->B", errorMessage: "Parse error on line 2", diagramType: "flowchart" });
  assert.ok(p.includes("flowchart TD"), "T1: 含原始代码");
  assert.ok(p.includes("Parse error on line 2"), "T1: 含渲染错误");
  assert.ok(p.includes("flowchart"), "T1: 图类型进入上下文");
  assert.ok(p.includes("只输出修复后的 Mermaid 代码"), "T1: 只输出代码");
  assert.ok(p.includes("语义不变"), "T1: 修语法不重画");
  // 超长输入截断保护
  const long = buildRepairPrompt({ mermaid: "x".repeat(9000), errorMessage: "e".repeat(2000), diagramType: "state" });
  assert.ok(!long.includes("e".repeat(700)), "T1: 错误信息截断到 600");
}
console.log("✓ T1 修复提示词");

console.log("T2 回复剥离(围栏/前言/裸代码)");
{
  assert.equal(extractMermaidFromReply("```mermaid\nflowchart TD\n  A-->B\n```"), "flowchart TD\n  A-->B", "T2: mermaid 围栏剥");
  assert.equal(extractMermaidFromReply("```\nsequenceDiagram\n  A->>B: hi\n```"), "sequenceDiagram\n  A->>B: hi", "T2: 无语言围栏剥");
  assert.equal(
    extractMermaidFromReply("修复如下:\nflowchart TD\n  A-->B"),
    "flowchart TD\n  A-->B",
    "T2: 前言剥到声明行",
  );
  assert.equal(extractMermaidFromReply("stateDiagram-v2\n  s1 --> s2"), "stateDiagram-v2\n  s1 --> s2", "T2: 裸代码原样");
}
console.log("✓ T2 回复剥离");

console.log("T3 形态校验(类型感知,拒空/超长/错型)");
{
  assert.ok(isPlausibleMermaid("flowchart TD\n  A-->B", "flowchart"), "T3: flowchart 过");
  assert.ok(isPlausibleMermaid("graph LR\n  A-->B", "flowchart"), "T3: graph 别名过");
  assert.ok(isPlausibleMermaid("sequenceDiagram\n  A->>B: x", "sequence"), "T3: sequence 过");
  assert.ok(isPlausibleMermaid("stateDiagram-v2\n  [*] --> s1", "state"), "T3: state 过");
  assert.ok(!isPlausibleMermaid("", "flowchart"), "T3: 空拒");
  assert.ok(!isPlausibleMermaid("A".repeat(2500), "flowchart"), "T3: 超长拒");
  assert.ok(!isPlausibleMermaid("sequenceDiagram\n  A->>B: x", "flowchart"), "T3: 类型不匹配拒");
  assert.ok(!isPlausibleMermaid("我无法修复这段代码", "flowchart"), "T3: 自然语言拒");
}
console.log("✓ T3 形态校验");

console.log("T4 接线守卫(通道四端 + 渲染层状态机 + 提示词升级)");
{
  assert.ok(read("shared/api-channels.ts").includes('repairMermaidDiagram: "artifact:repairMermaid"'), "T4: 通道表");
  const types = read("shared/types.ts");
  assert.ok(types.includes("repairMermaidDiagram(input: DiagramRepairCall)"), "T4: ApiExpose 签名");
  assert.ok(read("src/preload/index.ts").includes('invoke("artifact:repairMermaid"'), "T4: preload");
  assert.ok(read("src/main/ipc/index.ts").includes('handle("artifact:repairMermaid"'), "T4: 主进程 handler");

  const mmd = read("src/renderer/components/artifacts/MermaidArtifact.tsx");
  assert.ok(mmd.includes("repairMermaidDiagram("), "T4: 渲染层调用修复");
  assert.ok(mmd.includes("if (code !== d.mermaid) return;"), "T4: 只修原始稿(修复稿再败不循环)");
  assert.ok(mmd.includes("setRepairAttempted(true)"), "T4: 一轮封顶");
  assert.ok(mmd.includes('data-testid="mermaid-repairing"'), "T4: 修复中可见状态");
  assert.ok(mmd.includes("sessionStorage.setItem(`mmdfix:"), "T4: 修复稿会话缓存");

  const engine = read("src/main/services/agent/agent-engine.ts");
  assert.ok(engine.includes("按内容选最合适的类型"), "T4: 选型指南进 tool 描述");
  const harness = read("src/main/services/artifact-harness.ts");
  assert.ok(harness.includes("步骤(一)") && harness.includes("必须用双引号包裹"), "T4: 标签引号规则进质量指南");

  const i18n = read("src/renderer/lib/i18n.ts");
  assert.equal(i18n.split('"artifact.mermaid.repairing"').length - 1, 2, "T4: i18n 双语键");
}
console.log("✓ T4 接线守卫");

console.log("T5 失败路径(无模型环境不抛,ok:false 守 fallback)");
{
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  sqldb.run(readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8"));
  const db = drizzle(sqldb, { schema });
  const res = await repairMermaidDiagram(db, { mermaid: "flowchart TD\n  A-->B", errorMessage: "boom", diagramType: "flowchart" });
  assert.equal(res.ok, false, "T5: 未配置模型 → ok:false");
  assert.ok(typeof res.reason === "string" && res.reason.length > 0, "T5: 失败带原因");
}
console.log("✓ T5 失败路径");

console.log("\nverify-diagram-repair: ALL PASS");
