/**
 * ConceptMapArtifact —— 概念图产物(v0.12 径向重设计)。
 *
 * v0.2.2 用 dagre TB 分层,但概念图数据形态是"以中心概念展开的网",分层布局
 * 产出宽扁层+交叉边;v0.12 换径向布局(见 lib/conceptmap-layout.ts)。
 *
 * 视觉规则(yFiles 图可视化指南 + impeccable Playful Product):
 *   - 节点大小 = 重要度:hub(中心/高度数)更大、accent 描边、粗体;叶子收敛
 *   - 无装饰:去掉旧版每节点一致的左侧色条(side-stripe 禁令),颜色只编码 hub
 *   - 文字两行自适应包裹,不再 14 字硬截断
 *   - 边 = 轻弧贝塞尔 + 中点标签胶囊(宽度与文字同源估算,不再溢出)
 *   - 不加投影滤镜:清晰描边 + 面色分层即可(暗亮双色系走 token)
 *
 * 交互不变:v0.12 CanvasStage 全屏手势弹窗 / 黑板 canvas 变体 / 内联原生滚动 + 缩放按钮。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2, AlertTriangle, Maximize2 } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { DiagramViewerModal } from "./DiagramViewerModal.js";
import { CanvasStage } from "../CanvasStage.js";
import { radialLayout, labelPillSize, type CmNode, type CmEdge } from "../../lib/conceptmap-layout.js";

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

function ConceptMapSvg({ data }: { data: ConceptMapData }) {
  const L = useMemo(
    () => radialLayout(data.nodes as CmNode[], data.edges as CmEdge[]),
    [data.nodes, data.edges],
  );
  return (
    <svg
      width={L.width}
      height={L.height}
      viewBox={`0 0 ${L.width} ${L.height}`}
      style={{ display: "block" }}
      data-testid="conceptmap-svg"
    >
      <defs>
        <marker
          id="cm-arrow"
          viewBox="0 0 10 10"
          refX={9}
          refY={5}
          markerWidth={6.5}
          markerHeight={6.5}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink-faint" />
        </marker>
      </defs>

      {/* 边:先画在节点下层;标签胶囊不透明,压线可读 */}
      {L.edges.map(({ edge, d, labelPt }, i) => {
        const pill = edge.label ? labelPillSize(edge.label) : null;
        return (
          <g key={`e-${i}`}>
            <path
              d={d}
              className="fill-none stroke-ink-faint/70"
              strokeWidth={1.6}
              markerEnd="url(#cm-arrow)"
            />
            {edge.label && pill && (
              <g>
                <rect
                  x={labelPt.x - pill.width / 2}
                  y={labelPt.y - pill.height / 2}
                  width={pill.width}
                  height={pill.height}
                  rx={pill.height / 2}
                  className="fill-surface-0 stroke-[var(--border-faint)]"
                  strokeWidth={1}
                />
                <text
                  x={labelPt.x}
                  y={labelPt.y + 3.5}
                  textAnchor="middle"
                  className="fill-ink-muted text-caption font-medium"
                >
                  {edge.label}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 节点:hub = accent 描边 + 染底 + 粗体;普通 = 中性面 + 标准描边 */}
      {[...L.nodes.values()].map((n) => {
        const x = n.center.x - n.box.width / 2;
        const y = n.center.y - n.box.height / 2;
        const fs = n.box.hub ? 14 : 13;
        return (
          <g key={n.id}>
            <rect
              x={x}
              y={y}
              width={n.box.width}
              height={n.box.height}
              rx={n.box.hub ? 13 : 11}
              className={
                n.box.hub
                  ? "fill-accent/10 stroke-accent/80"
                  : "fill-surface-3 stroke-[var(--border)]"
              }
              strokeWidth={n.box.hub ? 1.6 : 1.1}
            />
            {n.box.lines.map((line, li) => (
              <text
                key={li}
                x={n.center.x}
                y={n.center.y + (li - (n.box.lines.length - 1) / 2) * 17 + 4.5}
                textAnchor="middle"
                fontSize={fs}
                className={n.box.hub ? "fill-ink-strong font-bold" : "fill-ink"}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function ConceptMapArtifact({ data, variant = "card" }: { data: unknown; variant?: "card" | "canvas" }) {
  const d = data as ConceptMapData;
  const t = useLang();
  const layout = useMemo(
    () => radialLayout(d.nodes as CmNode[], d.edges as CmEdge[]),
    [d.nodes, d.edges],
  );
  const [zoom, setZoom] = useState(1);
  /* 手势分界(v0.11):主界面内联区不吃手势(浏览器页面缩放已被 viewport 禁掉,
     内联只留原生滚动),单指平移/双指捏合只在全屏弹窗舞台里。 */
  const [expanded, setExpanded] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // 窄屏初始适宽:内容比视口宽时自动缩到整图可见(手机一眼看全,细节进弹窗捏合看)
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

  /* canvas 变体:裸内容自然尺寸 —— 黑板/全屏查看器的 CanvasStage 用 transform 接管缩放平移 */
  if (variant === "canvas") {
    return <div data-testid="conceptmap-canvas-content"><ConceptMapSvg data={d} /></div>;
  }

  return (
    <div className="surface-card p-4" data-testid="artifact-concept-map">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Share2 className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-body font-bold text-ink truncate">
            {d.title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 缩放控制 */}
          <div className="flex items-center gap-1" data-testid="conceptmap-zoom-controls">
            <button
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 disabled:opacity-30 text-label font-bold flex items-center justify-center"
              title={t("artifact.zoomOut")}
            >
              −
            </button>
            <button
              onClick={zoomReset}
              className="px-1.5 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 text-caption font-bold tabular-nums"
              title={t("artifact.zoomReset")}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 disabled:opacity-30 text-label font-bold flex items-center justify-center"
              title={t("artifact.zoomIn")}
            >
              +
            </button>
          </div>
          {/* 全屏查看:弹窗里单指拖/双指捏合 */}
          <button
            onClick={() => setExpanded(true)}
            data-testid="conceptmap-expand"
            aria-label={t("artifact.viewer.open")}
            data-tooltip={t("artifact.viewer.open")}
            className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 flex items-center justify-center"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 内联视口:原生滚动(手机上不抢手势),点击进弹窗手势操作。
          方案(Excalidraw/Figma 同款):外层固定原始尺寸撑开滚动区,内层 transform scale。 */}
      <div
        ref={viewportRef}
        onClick={() => setExpanded(true)}
        onWheel={handleWheel}
        className="bg-surface-0/40 rounded-lg p-2 overflow-auto min-h-[160px] max-h-[500px] select-none"
        style={{ touchAction: "pan-x pan-y" }}
        data-testid="conceptmap-render-area"
        data-noswipe="" /* 内联横向滚动与 T3 切栏滑动手势互斥:图上滑动不切栏 */
      >
        <div
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
            margin: "0 auto",
          }}
        >
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: layout.width, height: layout.height }}>
            <ConceptMapSvg data={d} />
          </div>
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

      {/* 全屏画布舞台:纯 transform pan/zoom(锚定手势中点,零布局耦合不抖动);
          Esc/背景/X 关闭 */}
      {expanded && (
        <DiagramViewerModal title={d.title} onClose={() => setExpanded(false)}>
          <div className="h-full w-full rounded-xl overflow-hidden bg-surface-0/60">
            <CanvasStage testid="conceptmap-modal-stage">
              <ConceptMapArtifact data={data} variant="canvas" />
            </CanvasStage>
          </div>
        </DiagramViewerModal>
      )}
    </div>
  );
}
