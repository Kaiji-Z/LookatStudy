/**
 * mermaid-fence —— markdown 里 ```mermaid 围栏的渲染兜底判定(纯函数)。
 *
 * 背景:draw_diagram 工具的契约是把 mermaid 放进工具入参(渲染成图卡并进黑板
 * 生态),但模型智能程度参差——弱模型常直接在正文写 mermaid 围栏,旧链路里
 * ChatStream/NotebookPanel 的共享 CodeBlock 把它当普通代码块 shiki 高亮,
 * 学习者看到的是源码不是图。CodeBlock 对 mermaid 围栏改走懒加载的
 * MermaidArtifact 真渲染(同一渲染器:strict 安全档/ELK/LLM 修复/缩放全继承),
 * 判定逻辑收口在这里供 verify 直测。
 */

/** 是否是应渲染成图的 mermaid 围栏(lang 严格小写匹配;空代码不成图,守普通代码块路径)。 */
export function isMermaidFence(lang: string, text: string): boolean {
  return lang === "mermaid" && text.trim().length > 0;
}

/** 从 mermaid 源码推图类型(只影响图卡角标与修复回路的提示词;渲染本身是通用的)。 */
export function diagramTypeFromMermaid(code: string): "flowchart" | "sequence" | "state" {
  const head = code.trimStart().slice(0, 40).toLowerCase();
  if (head.startsWith("sequencediagram")) return "sequence";
  if (head.startsWith("statediagram")) return "state";
  return "flowchart";
}
