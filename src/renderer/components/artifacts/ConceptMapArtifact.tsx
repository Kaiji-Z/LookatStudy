/**
 * ConceptMapArtifact —— 概念图产物(v0.2.2, dagre 布局重写)。
 *
 * 之前用手写 BFS 拓扑分层,真实概念图(交叉边、不等长子树、环)布局效果差。
 * v0.2.2 改用 dagre —— 业界标准的 DAG 分层布局库(React Flow dagre 示例同款),
 * 处理交叉边、节点尺寸差异、边路由都远比手写好。
 *
 * dagre 静态 import(~140KB gzip,比 mermaid 小),它本身是纯 JS 无 wasm,打包开销可接受。
 *
 * 视觉升级(参考 Cambridge Intelligence / Tom Sawyer 图可视化最佳实践):
 *   - 卡片式节点(圆角矩形 + 柔阴影 + 左侧色条),替代单色椭圆
 *   - 边用 dagre 路由点画平滑贝塞尔曲线(不是直线/直角)
 *   - 边标签用胶囊背景(可读性)
 *   - 节点宽度按 label 长度自适应,dagre 据此布局不重叠
 *   - 缩放 + 滚动视口(同 mermaid:大图可缩放查看)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "dagre";
import { Share2, AlertTriangle } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { useTouchPanPinch } from "../../lib/useTouchPanPinch.js";

interface ConceptMapData {
  artifactType: "concept_map";
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.2;

/** 估算节点尺寸:dagre 需要明确宽高来布局。label 长度 → 像素宽。 */
function nodeSize(label: string): { width: number; height: number } {
  // 中文约 16px/字,英文约 9px/字,取中间 12 估算 + padding
  const charWidth = /[\u4e00-\u9fa5]/.test(label) ? 16 : 9;
  const textWidth = label.length * charWidth;
  return {
    width: Math.min(200, Math.max(90, textWidth + 32)),
    height: 40,
  };
}

/** 用 dagre 计算所有节点和边的布局位置 + 图尺寸。 */
function computeLayout(data: ConceptMapData) {
  const g = new dagre.graphlib.Graph();
  // rankdir TB = 自上而下分层(Top→Bottom);LR 横向。概念图用 TB 最直观。
  g.setGraph({ rankdir: "TB", ranksep: 70, nodesep: 36, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { width: number; height: number }>();
  for (const n of data.nodes) {
    const size = nodeSize(n.label);
    sizes.set(n.id, size);
    g.setNode(n.id, { label: n.label, width: size.width, height: size.height });
  }
  for (const e of data.edges) {
    // 避免重复边(dagre 允许,但会画重叠曲线)
    try {
      g.setEdge(e.from, e.to);
    } catch {
      /* 节点不存在的边已被 harness 过滤,这里防御 */
    }
  }
  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of data.nodes) {
    const pos = g.node(n.id);
    if (pos) positions.set(n.id, { x: pos.x, y: pos.y });
  }

  // 边路由点(dagre 给出折线/曲线控制点)
  const edgePoints = data.edges.map((e) => ({
    edge: e,
    points: (() => {
      try {
        const edge = g.edge(e.from, e.to);
        return edge?.points ?? [];
      } catch {
        return [];
      }
    })(),
  }));

  return {
    positions,
    sizes,
    edgePoints,
    width: g.graph().width ?? 400,
    height: g.graph().height ?? 300,
  };
}

/** 把 dagre 的折线点连成平滑贝塞尔路径(SVG path)。 */
function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const [first, ...rest] = points;
  let path = `M ${first.x} ${first.y}`;
  // 用相邻点中点做控制点,画 quadratic/cubic 平滑曲线
  for (let i = 0; i < rest.length - 1; i++) {
    const cp = rest[i];
    const next = rest[i + 1];
    const midX = (cp.x + next.x) / 2;
    const midY = (cp.y + next.y) / 2;
    path += ` Q ${cp.x} ${cp.y} ${midX} ${midY}`;
  }
  const last = rest[rest.length - 1] ?? first;
  path += ` L ${last.x} ${last.y}`;
  return path;
}

export function ConceptMapArtifact({ data }: { data: unknown }) {
  const d = data as ConceptMapData;
  const t = useLang();
  const layout = useMemo(() => computeLayout(d), [d]);
  const [zoom, setZoom] = useState(1);
  /* 触控/鼠标统一视口控制(#1):单指平移 + 双指捏合缩放(旧实现只有 mouse 事件,
     手机上被 touch-action:pinch-zoom 拦死单指,拖不动看不全) */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panPinch = useTouchPanPinch(
    useCallback((factor: number) => {
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z * factor).toFixed(3))));
    }, []),
  );
  // 窄屏初始适宽:内容比视口宽时自动缩到整图可见(手机一眼看全,再捏合看细节)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const fit = () => {
      const ratio = (el.clientWidth - 16) / layout.width;
      if (ratio < 1) setZoom(Math.max(MIN_ZOOM, +ratio.toFixed(2)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))));
  }, []);

  return (
    <div className="surface-card p-4" data-testid="artifact-concept-map">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Share2 className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-body font-bold text-ink truncate">
            {d.title}
          </h3>
        </div>
        {/* 缩放控制 */}
        <div className="flex items-center gap-1 shrink-0" data-testid="conceptmap-zoom-controls">
          <button
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-1 hover:bg-surface-3 disabled:opacity-30 text-label font-bold flex items-center justify-center"
            title={t("artifact.zoomOut")}
          >
            −
          </button>
          <button
            onClick={zoomReset}
            className="px-1.5 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-1 hover:bg-surface-3 text-caption font-bold tabular-nums"
            title={t("artifact.zoomReset")}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-1 hover:bg-surface-3 disabled:opacity-30 text-label font-bold flex items-center justify-center"
            title={t("artifact.zoomIn")}
          >
            +
          </button>
        </div>
      </div>

      {/* 渲染视口:可双向滚动 + 抓手拖动。
          方案(Excalidraw/Figma 同款):外层固定原始尺寸撑开滚动区,内层 transform scale。
          不用 flex 居中(flex 会抑制横向溢出滚动);不用 mx-auto(内容超容器时算负 margin 裁内容)。
          左对齐 + overflow-auto,zoom=1 时居中靠外层 margin 实现,放大后左上对齐可滚到全部。 */}
      <div
        ref={viewportRef}
        onPointerDown={panPinch.onPointerDown}
        onPointerMove={panPinch.onPointerMove}
        onPointerUp={panPinch.onPointerUp}
        onPointerCancel={panPinch.onPointerUp}
        onWheel={handleWheel}
        className={`bg-surface-0/40 rounded-lg p-2 overflow-auto min-h-[160px] max-h-[500px] select-none cursor-grab ${panPinch.isPanning() ? "cursor-grabbing" : ""}`}
        style={{ touchAction: "none" }}
        data-testid="conceptmap-render-area"
        data-noswipe="" /* 视口内手势归平移/捏合,T3 切栏滑动手势不接管 */
      >
        <div
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
            // 内容居中:zoom=1 且容器比内容宽时居中;放大后内容超容器,margin auto 不裁(因为有明确 width)
            margin: "0 auto",
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              display: "block",
            }}
            data-testid="conceptmap-svg"
          >
            <defs>
            {/* 箭头标记 */}
            <marker
              id="cm-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-neutral-400 dark:fill-neutral-500" />
            </marker>
            {/* 节点柔阴影 */}
            <filter id="cm-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#00000022" />
            </filter>
          </defs>

          {/* 边(先画,在节点下层) */}
            {layout.edgePoints.map(({ edge, points }, i) => {
              if (points.length === 0) return null;
              const path = pointsToPath(points);
              const midIdx = Math.floor(points.length / 2);
              const midPoint = points[midIdx] ?? points[0];
              return (
                <g key={`e-${i}`}>
                  <path
                    d={path}
                    className="fill-none stroke-neutral-400 dark:stroke-neutral-500"
                    strokeWidth={1.8}
                    markerEnd="url(#cm-arrow)"
                  />
                  {edge.label && (
                    <g>
                      {/* 胶囊背景 */}
                      <rect
                        x={midPoint.x - edge.label.length * 4 - 6}
                        y={midPoint.y - 9}
                        width={edge.label.length * 8 + 12}
                        height={18}
                        rx={9}
                        className="fill-white dark:fill-neutral-800 stroke-neutral-200 dark:stroke-neutral-700"
                        strokeWidth={1}
                      />
                      <text
                        x={midPoint.x}
                        y={midPoint.y + 3.5}
                        textAnchor="middle"
                        className="fill-neutral-600 dark:fill-neutral-300 text-caption font-medium"
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 节点(卡片式:圆角矩形 + 左色条 + 文字) */}
            {d.nodes.map((node) => {
              const pos = layout.positions.get(node.id);
              const size = layout.sizes.get(node.id) ?? { width: 100, height: 40 };
              if (!pos) return null;
              const x = pos.x - size.width / 2;
              const y = pos.y - size.height / 2;
              return (
                <g key={node.id} filter="url(#cm-shadow)">
                  {/* 卡片背景 */}
                  <rect
                    x={x}
                    y={y}
                    width={size.width}
                    height={size.height}
                    rx={10}
                    className="fill-white dark:fill-neutral-800 stroke-neutral-200 dark:stroke-neutral-700"
                    strokeWidth={1.2}
                  />
                  {/* 左侧品牌色条(视觉锚点,区分节点类型) */}
                  <rect
                    x={x}
                    y={y}
                    width={4}
                    height={size.height}
                    rx={2}
                    className="fill-brand"
                  />
                  <text
                    x={pos.x + 2}
                    y={pos.y + 4.5}
                    textAnchor="middle"
                    className="fill-neutral-800 dark:fill-neutral-100 text-label font-semibold"
                  >
                    {node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label}
                  </text>
                </g>
              );
            })}
        </svg>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-caption text-ink-muted">
        <span>{t("artifact.conceptmap.stats", { nodes: d.nodes.length, edges: d.edges.length })}</span>
      </div>

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-1 text-caption text-warning flex items-start gap-1" data-testid="artifact-warnings">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{d.warnings.join("; ")}</span>
        </div>
      )}
    </div>
  );
}
