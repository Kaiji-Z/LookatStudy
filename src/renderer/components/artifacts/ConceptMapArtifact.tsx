/**
 * ConceptMapArtifact —— 概念图产物(M2)。
 *
 * tool show_concept_map 返回 { nodes, edges },这里渲染成简单的节点-关系图。
 * 不用重型图库(避免 native dep),用纯 SVG + flex 布局。
 * 节点按拓扑层级排列(简化版),边用贝塞尔曲线。
 */
import { useMemo } from "react";

interface ConceptMapData {
  artifactType: "concept_map";
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
}

export function ConceptMapArtifact({ data }: { data: unknown }) {
  const d = data as ConceptMapData;
  const layout = useMemo(() => computeLayout(d.nodes, d.edges), [d.nodes, d.edges]);

  return (
    <div className="surface-card p-4" data-testid="artifact-concept-map">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🗺️</span>
        <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{d.title}</h3>
      </div>
      <div className="relative bg-neutral-100 dark:bg-neutral-900/40 rounded-lg p-4 overflow-x-auto">
        <svg width="100%" height={Math.max(160, layout.maxDepth * 90 + 40)} className="block">
          {/* 边 */}
          {d.edges.map((edge, i) => {
            const from = layout.positions.get(edge.from);
            const to = layout.positions.get(edge.to);
            if (!from || !to) return null;
            return (
              <g key={`e-${i}`}>
                <path
                  d={`M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`}
                  stroke="rgb(115 115 115)"
                  strokeWidth={1.5}
                  fill="none"
                  markerEnd="url(#arrow)"
                />
                {edge.label && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2}
                    textAnchor="middle"
                    className="fill-neutral-500 text-[9px]"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {/* 箭头标记定义 */}
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="rgb(115 115 115)" />
            </marker>
          </defs>
          {/* 节点 */}
          {d.nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            return (
              <g key={node.id}>
                <rect
                  x={pos.x - 60}
                  y={pos.y - 16}
                  width={120}
                  height={32}
                  rx={16}
                  className="fill-brand/15 stroke-brand"
                  strokeWidth={1.5}
                />
                <text
                  x={pos.x}
                  y={pos.y + 4}
                  textAnchor="middle"
                  className="fill-neutral-800 dark:fill-neutral-200 text-[11px] font-medium"
                >
                  {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 text-[10px] text-neutral-400 dark:text-neutral-600">
        {d.nodes.length} 个概念 · {d.edges.length} 个关系
      </div>
    </div>
  );
}

/** 简化拓扑分层(不引图库)。按入度做 BFS 分层。 */
function computeLayout(
  nodes: { id: string; label: string }[],
  edges: { from: string; to: string; label?: string }[],
) {
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));
  edges.forEach((e) => inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1));

  // 分层:入度 0 的放第 0 层,逐层往下
  const layer = new Map<string, number>();
  let frontier = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  let depth = 0;
  while (frontier.length > 0) {
    for (const id of frontier) layer.set(id, depth);
    const next: string[] = [];
    for (const e of edges) {
      if (frontier.includes(e.from) && !layer.has(e.to)) next.push(e.to);
    }
    frontier = [...new Set(next)];
    depth++;
  }
  // 未分层的(可能有环)放最后一层
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, depth);

  // 按层排列位置
  const positions = new Map<string, { x: number; y: number }>();
  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  }
  const xCenter = 200;
  for (const [l, ids] of byLayer) {
    const count = ids.length;
    ids.forEach((id, i) => {
      const x = count === 1 ? xCenter : xCenter + (i - (count - 1) / 2) * 140;
      positions.set(id, { x, y: l * 90 + 30 });
    });
  }
  return { positions, maxDepth: depth };
}
