/**
 * verify-mermaid-fence —— ```mermaid 围栏渲染兜底(v0.37)确定性测试。
 *
 * 背景:模型不调 draw_diagram 工具、把 mermaid 直接写进正文时,共享 CodeBlock
 * (ChatStream + NotebookPanel 讲解区)要对 mermaid 围栏兜底渲染成图(懒加载
 * MermaidArtifact,主束零污染),而不是按普通代码块 shiki 高亮成源码。
 *
 * T1 isMermaidFence 判定矩阵(严格 lang / 空代码 / 其他语言不误伤)
 * T2 diagramTypeFromMermaid 推断矩阵(sequence/state/flowchart 家族/未知默认)
 * T3 源级接线守卫:CodeBlock mermaid 分支 + 懒加载纪律(禁止静态 import
 *    MermaidArtifact——v0.22 主束瘦身红线)+ data-md-diagram 包装
 * T4 getTextModel 跳过图卡(画线/朗读跟句不被图卡 chrome 与 SVG 标签文本污染)
 * T5 朗读对称性:normalizeSpeechText 剥 mermaid 围栏(朗读流本就不含源码,
 *    DOM 侧跳过图卡后两侧文本空间对称)
 * T6 双渲染面接线(ChatStream + NotebookPanel 的 pre 都走共享 CodeBlock)
 * T7 verify:core 链注册自检(package.json 源级)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMermaidFence, diagramTypeFromMermaid } from "../src/renderer/lib/mermaid-fence.ts";
import { normalizeSpeechText } from "../shared/speech-text.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url.slice(0, import.meta.url.lastIndexOf("/")) + "/"), "utf8");
const codeBlockSrc = read("../src/renderer/components/CodeBlock.tsx");
const highlightSrc = read("../src/renderer/lib/highlightText.ts");
const chatSrc = read("../src/renderer/components/ChatStream.tsx");
const nbSrc = read("../src/renderer/components/NotebookPanel.tsx");
const i18nSrc = read("../src/renderer/lib/i18n.ts");

// ---------------------------------------------------------------- T1 判定矩阵
{
  assert.equal(isMermaidFence("mermaid", "flowchart LR\n  A-->B"), true, "T1 mermaid+代码");
  assert.equal(isMermaidFence("mermaid", "  \n  "), false, "T1 空白代码不成图(守代码块路径)");
  assert.equal(isMermaidFence("mermaid", ""), false, "T1 空代码");
  assert.equal(isMermaidFence("graph", "A-->B"), false, "T1 graph 语言名不认(围栏语言约定=mermaid)");
  assert.equal(isMermaidFence("js", "flowchart LR"), false, "T1 js 围栏不误伤");
  assert.equal(isMermaidFence("", "flowchart LR\n A-->B"), false, "T1 无语言标记不认(防裸围栏误判)");
  assert.equal(isMermaidFence("Mermaid", "A-->B"), false, "T1 大写不认(extractCode 的 language-\\w+ 原样透传,严格小写)");
  console.log("T1 isMermaidFence 判定矩阵✓");
}

// ---------------------------------------------------------------- T2 类型推断
{
  assert.equal(diagramTypeFromMermaid("flowchart LR\n  A-->B"), "flowchart", "T2 flowchart");
  assert.equal(diagramTypeFromMermaid("graph TD\n  A-->B"), "flowchart", "T2 graph TD 是 flowchart 家族");
  assert.equal(diagramTypeFromMermaid("sequenceDiagram\n  A->>B: hi"), "sequence", "T2 时序图");
  assert.equal(diagramTypeFromMermaid("  sequenceDiagram\n  A->>B: hi"), "sequence", "T2 前导空白");
  assert.equal(diagramTypeFromMermaid("stateDiagram-v2\n  [*]-->S1"), "state", "T2 状态图 v2");
  assert.equal(diagramTypeFromMermaid("stateDiagram\n  [*]-->S1"), "state", "T2 状态图无版本");
  assert.equal(diagramTypeFromMermaid("SequenceDiagram\n  A->>B"), "sequence", "T2 大写归一");
  assert.equal(diagramTypeFromMermaid("mindmap\n  root((x))"), "flowchart", "T2 未知类型默认 flowchart(角标/修复提示用,渲染通用)");
  assert.equal(diagramTypeFromMermaid(""), "flowchart", "T2 空串安全");
  assert.equal(
    diagramTypeFromMermaid("flowchart LR\n" + "x".repeat(100) + "\nsequenceDiagram"),
    "flowchart",
    "T2 只看头部(正文里出现 sequenceDiagram 字样不劫持)",
  );
  console.log("T2 diagramTypeFromMermaid 推断矩阵✓");
}

// ---------------------------------------------------------------- T3 CodeBlock 接线+懒加载纪律
{
  assert.ok(codeBlockSrc.includes("isMermaidFence"), "T3 CodeBlock 消费判定函数");
  assert.ok(
    /isMermaidFence\(lang,\s*text\)/.test(codeBlockSrc),
    "T3 判定必须实接在 extractCode 产物上(防 import 在、接线被删的假绿)",
  );
  assert.ok(codeBlockSrc.includes("diagramTypeFromMermaid"), "T3 CodeBlock 消费类型推断");
  assert.ok(
    /lazy\(\(\)\s*=>\s*import\(["']\.\/artifacts\/MermaidArtifact/.test(codeBlockSrc),
    "T3 MermaidArtifact 必须懒加载(dynamic import)",
  );
  assert.ok(
    !/^import\s+\{[^}]*MermaidArtifact/m.test(codeBlockSrc),
    "T3 禁止静态 import MermaidArtifact(v0.22 主束瘦身:artifact 渲染器不进主束)",
  );
  assert.ok(!/from ["'].*CanvasStage/.test(codeBlockSrc), "T3 不经 CanvasStage 间接入主束");
  assert.ok(codeBlockSrc.includes("data-md-diagram"), "T3 图卡包装带 data-md-diagram 标记(T4 的锚)");
  assert.ok(codeBlockSrc.includes("Suspense"), "T3 懒 chunk 就位前的 Suspense 兜底");
  // mermaid 分支应旁路 shiki 高亮(不浪费一次引擎往返)
  assert.ok(
    /if\s*\(!text\s*\|\|\s*diagram[^\n]*return/.test(codeBlockSrc) || /diagram[^\n]*\)\s*return;/.test(codeBlockSrc),
    "T3 shiki 高亮 effect 对 mermaid 围栏旁路",
  );
  console.log("T3 CodeBlock 接线+懒加载纪律✓");
}

// ---------------------------------------------------------------- T4 getTextModel 跳过图卡
{
  assert.ok(
    highlightSrc.includes('[data-md-diagram]'),
    "T4 getTextModel 拒收图卡子树(画线/跟句匹配不被 chrome 文字与 SVG 标签污染)",
  );
  console.log("T4 getTextModel 跳过图卡✓");
}

// ---------------------------------------------------------------- T5 朗读对称性
{
  const md = '前文\n\n```mermaid\nflowchart LR\n  T["泰勒斯"] --> A["阿那克西曼德"]\n```\n\n后文';
  const spoken = normalizeSpeechText(md);
  assert.ok(!spoken.includes("flowchart"), "T5 朗读流不含 mermaid 源码(围栏整体剥除)");
  assert.ok(spoken.includes("前文") && spoken.includes("后文"), "T5 围栏外正文保留");
  console.log("T5 朗读对称性(normalizeSpeechText 剥围栏)✓");
}

// ---------------------------------------------------------------- T6 双渲染面接线
{
  assert.ok(/import \{ CodeBlock \} from ["']\.\/CodeBlock\.js["']/.test(chatSrc), "T6 ChatStream 走共享 CodeBlock");
  assert.ok(/import \{ CodeBlock \} from ["']\.\/CodeBlock\.js["']/.test(nbSrc), "T6 NotebookPanel 走共享 CodeBlock");
  const i18nHits = (i18nSrc.match(/artifact\.mermaid\.inlineTitle/g) ?? []).length;
  assert.ok(i18nHits >= 2, "T6 inlineTitle 双语键齐(zh/en)");
  console.log("T6 双渲染面接线+双语键✓");
}

// ---------------------------------------------------------------- T7 verify:core 链注册自检
{
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts["verify:core"].includes("verify-mermaid-fence"), "T7 verify:core 链含 verify-mermaid-fence");
  console.log("T7 verify:core 链注册自检✓");
}

console.log("verify-mermaid-fence 全部通过 ✓");
