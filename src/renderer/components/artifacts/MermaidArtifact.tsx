/**
 * MermaidArtifact —— Mermaid 图产物(M2)。
 *
 * v0.2 实现策略:不引入 mermaid 渲染库(避免 ~500KB dep + native 风险)。
 * 先展示代码 + 类型标签,让用户复制到 mermaid.live 查看。
 * M3 可评估动态 import mermaid 按需渲染。
 *
 * 这是务实的妥协:register=product,工具消失于任务。重渲染库不是现在必需。
 */
interface MermaidData {
  artifactType: "diagram";
  title: string;
  diagramType: "flowchart" | "sequence" | "state";
  mermaid: string;
}

const TYPE_LABELS: Record<string, string> = {
  flowchart: "流程图",
  sequence: "时序图",
  state: "状态图",
};

export function MermaidArtifact({ data }: { data: unknown }) {
  const d = data as MermaidData;
  const liveUrl = `https://mermaid.live/edit#${encodeURIComponent(d.mermaid)}`;
  return (
    <div className="surface-card p-4" data-testid="artifact-mermaid">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">📐</span>
          <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{d.title}</h3>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
            {TYPE_LABELS[d.diagramType] ?? d.diagramType}
          </span>
        </div>
        <button
          onClick={() => window.open(liveUrl, "_blank")}
          className="text-[10px] text-accent hover:underline font-bold"
          data-testid="mermaid-open-live"
        >
          打开渲染 ↗
        </button>
      </div>
      <pre className="text-[11px] bg-neutral-100 dark:bg-neutral-900/60 rounded-lg p-3 overflow-x-auto text-neutral-700 dark:text-neutral-300 font-mono leading-relaxed">
        {d.mermaid}
      </pre>
      <div className="mt-2 text-[10px] text-neutral-400 dark:text-neutral-600">
        复制代码到 mermaid.live 查看渲染图(M3 将内置渲染)
      </div>
    </div>
  );
}
