/**
 * 无标题长文分段器验证 —— chunkHeadinglessText + prepareSingleDoc。
 * 粘贴文本 / arXiv 论文 /(M3)转写文本共用的预分段。
 * 跑法: npx tsx scripts/verify-text-chunk.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { chunkHeadinglessText, prepareSingleDoc } from "../src/main/services/pure/text-chunk.ts";

let passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

test("T1 句子边界切分:不切断句子,每段带 `# 第 n 部分`", () => {
  const sentences = Array.from({ length: 50 }, (_, i) => `这是第${i + 1}句话,内容完整。`);
  const parts = chunkHeadinglessText(sentences.join(""), "notes", 100);
  assert.ok(parts.length >= 5, `应切成多段,实际 ${parts.length}`);
  parts.forEach((p, i) => {
    assert.ok(p.content.startsWith(`# 第 ${i + 1} 部分`), `第 ${i + 1} 段标题`);
    const body = p.content.split("\n\n")[1] ?? "";
    assert.ok(body.endsWith("。"), `段 ${i + 1} 不应切断句子,结尾: …${body.slice(-12)}`);
  });
  assert.equal(parts[0].path, "notes-01.md");
});

test("T2 段落优先:段落小于目标时整段聚合,不硬拆", () => {
  const paras = Array.from({ length: 5 }, () => "短段落内容。");
  const parts = chunkHeadinglessText(paras.join("\n\n"), "p", 4000);
  assert.equal(parts.length, 1, "总量小于目标应一段");
});

test("T3 每段长度受目标约束(允许最后一个短段)", () => {
  const long = ("句子内容在这里。".repeat(20) + "\n\n").repeat(30);
  const parts = chunkHeadinglessText(long, "x", 400);
  for (const p of parts.slice(0, -1)) {
    assert.ok(p.content.length <= 400 + 30, `段长 ${p.content.length} 应 ≈ 目标(含标题行)`);
  }
});

test("T4 空文本 → 空数组;硬切超长单句", () => {
  assert.equal(chunkHeadinglessText("", "a").length, 0);
  assert.equal(chunkHeadinglessText("   \n\n  ", "a").length, 0);
  const mega = "字".repeat(1000); // 无任何标点的单段
  const parts = chunkHeadinglessText(mega, "m", 300);
  assert.ok(parts.length >= 3, `无标点硬切,实际 ${parts.length}`);
});

test("T5 prepareSingleDoc:短文/有结构文 → 整体单文件", () => {
  const short = prepareSingleDoc("我的笔记", "就是一小段话。");
  assert.equal(short.length, 1);
  assert.equal(short[0].path, "我的笔记.md");
  const structured = prepareSingleDoc("教程", ["# 教程", ...Array.from({ length: 4 }, (_, i) => `## 第${i}节\n\n${"内容。".repeat(50)}`)].join("\n\n"));
  assert.equal(structured.length, 1, "≥3 个 H2 视为有结构,不预分段");
});

test("T6 prepareSingleDoc:超长无结构 → 预分段", () => {
  const flat = "这是一句完整的话。".repeat(1500); // 13500 字,无标题
  const parts = prepareSingleDoc("论文翻译", flat, "paper");
  assert.ok(parts.length > 1, `应分段,实际 ${parts.length}`);
  assert.ok(parts[0].path.startsWith("paper-"), `分段路径用 stem: ${parts[0].path}`);
  assert.ok(parts[0].content.startsWith("# 第 1 部分"));
});

test("T7 文件名净化:非法字符替换", () => {
  const parts = prepareSingleDoc('报告: 2026"上半年"//总结', "正文内容若干。");
  assert.ok(!/[\\/:*?"<>|#]/.test(parts[0].path), `净化后的路径: ${parts[0].path}`);
});

console.log(`\n${passed} passed`);
