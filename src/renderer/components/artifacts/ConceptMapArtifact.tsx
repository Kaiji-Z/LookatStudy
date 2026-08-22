/**
 * ConceptMapArtifact —— 概念图产物(v0.21 ELK 重设计)。
 *
 * v0.12 径向布局的视觉评审结论:空白与拥挤并存、边交叉、无层级、单色调。
 * v0.21 换 elkjs 引擎(draw.io 新版同款 Eclipse Layout Kernel,懒加载 chunk),
 * 视觉换 draw.io 词汇(见 lib/cmap-elk-layout.ts 头注):
 *   - 同色系浅填充 + 深描边(色板 CSS 变量 --cm-c0..c4,暗色明度反转)
 *   - 分组 = 带标题栏的容器盒(复合图,组内紧凑组间留白)
 *   - 连线 = ELK 正交路由(直角折线绕开盒子) + 箭头
 *   - 边标签 = 胶囊 + 白晕(paint-order stroke),压线可读
 *   - hub(度数最大)更大更粗;入场 stagger,reduced-motion 静默
 *
 * 布局是异步的(elkjs 动态 import):先占位后渲染,失败保持占位不炸卡片。
 * 交互不变:CanvasStage 全屏手势弹窗 / 黑板 canvas 变体 / 内联原生滚动 + 缩放按钮。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2, AlertTriangle, Maximize2 } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { DiagramViewerModal } from "./DiagramViewerModal.js";
import { CanvasStage } from "../CanvasStage.js";
import {
  layoutConceptMap,
  estTextWidth,
  GROUP_TITLE_PX,
  type CmapLayout,
  type CmNode,
  type CmEdge,
  type CmGroup,
} from "../../lib/cmap-elk-layout.js";

interface ConceptMapData {
  artifactType: "concept_map";
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
  /** v0.21 可选概念分组(LLM 给;无效/缺省时客户端邻接聚类兜底) */
  groups?: { id: string; label: string; nodeIds: string[] }[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.2;

function pathD(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function CmapSvg({ layout }: { layout: CmapLayout }) {
  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
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

      {/* 组容器:先画(最底层);同色相 tint 面+描边(透明度走 CSS 暗亮分档)+ 标题栏条带 */}
      {layout.groups.map((g, i) => (
        <g key={`g-${g.id}`} className="cm-enter" style={{ animationDelay: `${i * 60}ms` }}>
          <rect
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            rx={14}
            className="cm-group-box"
            style={{ fill: `var(--cm-c${g.colorIdx}-fill)`, stroke: `var(--cm-c${g.colorIdx}-line)` }}
          />
          {/* 标题栏:上圆角条带(上 rect 带 rx,下 rect 补方角),组色同相加深 */}
          <rect
            x={g.x}
            y={g.y}
            width={g.w}
            height={GROUP_TITLE_PX}
            rx={14}
            className="cm-group-head"
            style={{ fill: `var(--cm-c${g.colorIdx}-line)` }}
          />
          <rect
            x={g.x}
            y={g.y + GROUP_TITLE_PX / 2}
            width={g.w}
            height={GROUP_TITLE_PX / 2}
            className="cm-group-head"
            style={{ fill: `var(--cm-c${g.colorIdx}-line)` }}
          />
          <text
            x={g.x + 14}
            y={g.y + 22}
            fontSize={12}
            fontWeight={600}
            fill={`var(--cm-c${g.colorIdx}-line)`}
            data-testid="conceptmap-group-label"
          >
            {g.label}
          </text>
        </g>
      ))}

      {/* 边:正交折线 + 箭头;标签胶囊带白晕(paint-order stroke),压线可读 */}
      {layout.edges.map((e, i) => {
        const pill = e.label
          ? { width: estTextWidth(e.label, 12) + 16, height: 19 }
          : null;
        return (
          <g key={`e-${i}`} className="cm-enter" style={{ animationDelay: `${(layout.groups.length + 1) * 60 + i * 30}ms` }}>
            <path
              d={pathD(e.pts)}
              className="fill-none stroke-ink-faint/80"
              strokeWidth={1.6}
              markerEnd="url(#cm-arrow)"
            />
            {e.label && pill && e.labelPt && (
              <g>
                <rect
                  x={e.labelPt.x - pill.width / 2}
                  y={e.labelPt.y - pill.height / 2}
                  width={pill.width}
                  height={pill.height}
                  rx={pill.height / 2}
                  className="fill-surface-0/95 stroke-[var(--border-faint)]"
                  strokeWidth={1}
                />
                <text
                  x={e.labelPt.x}
                  y={e.labelPt.y + 3.5}
                  textAnchor="middle"
                  fontSize={12}
                  className="fill-ink-muted font-medium"
                  style={{ paintOrder: "stroke" }}
                  stroke="var(--surface-0)"
                  strokeWidth={3}
                >
                  {e.label}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 节点:同色系浅填充+深描边;hub 更大更粗;无组 = 中性面 */}
      {layout.nodes.map((n, i) => {
        const fill = n.colorIdx >= 0 ? `var(--cm-c${n.colorIdx}-fill)` : "var(--surface-3)";
        const line = n.colorIdx >= 0 ? `var(--cm-c${n.colorIdx}-line)` : "var(--border)";
        const fs = n.hub ? 14 : 13;
        return (
          <g
            key={n.id}
            className="cm-enter"
            style={{ animationDelay: `${(layout.groups.length + 2) * 60 + i * 35}ms` }}
          >
            <rect
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx={n.hub ? 12 : 10}
              fill={fill}
              stroke={line}
              strokeWidth={n.hub ? 1.8 : 1.4}
            />
            {n.lines.map((l, li) => (
              <text
                key={li}
                x={n.x + n.w / 2}
                y={n.y + n.h / 2 + (li - (n.lines.length - 1) / 2) * 17 + 4.5}
                textAnchor="middle"
                fontSize={fs}
                className={n.hub ? "fill-ink-strong font-bold" : "fill-ink"}
              >
                {l}
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
  /* ELK 布局是异步的(elkjs 懒加载):先占位,坐标到了再换;key 防同形数据重复算 */
  const layoutKey = useMemo(
    () => JSON.stringify({ n: d.nodes, e: d.edges, g: d.groups ?? null }),
    [d.nodes, d.edges, d.groups],
  );
  const [layout, setLayout] = useState<CmapLayout | null>(null);
  useEffect(() => {
    let alive = true;
    setLayout(null);
    layoutConceptMap(d.nodes as CmNode[], d.edges as CmEdge[], (d.groups ?? null) as CmGroup[] | null)
      .then((l) => {
        if (alive) setLayout(l);
      })
      .catch(() => {
        /* 布局引擎失败保持占位,不炸卡片 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  const [zoom, setZoom] = useState(1);
  /* 手势分界(v0.11):主界面内联区不吃手势(浏览器页面缩放已被 viewport 禁掉,
     内联只留原生滚动),单指平移/双指捏合只在全屏弹窗舞台里。 */
  const [expanded, setExpanded] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // 窄屏初始适宽:内容比视口宽时自动缩到整图可见(手机一眼看全,细节进弹窗捏合看)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !layout) return;
    const fit = () => {
      const ratio = (el.clientWidth - 16) / layout.width;
      if (ratio < 1) setZoom(Math.max(MIN_ZOOM, +ratio.toFixed(2)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout?.width, layout]);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))));
  }, []);

  /* canvas 变体:裸内容自然尺寸 —— 黑板/全屏查看器的 CanvasStage 用 transform 接管缩放平移。
     弹窗里复用卡片已算好的 layout(不重算异步布局)。 */
  if (variant === "canvas") {
    return (
      <div data-testid="conceptmap-canvas-content">
        {layout ? <CmapSvg layout={layout} /> : <div style={{ minWidth: 320, minHeight: 160 }} />}
      </div>
    );
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
        {layout ? (
          <div
            style={{
              width: layout.width * zoom,
              height: layout.height * zoom,
              margin: "0 auto",
            }}
          >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: layout.width, height: layout.height }}>
              <CmapSvg layout={layout} />
            </div>
          </div>
        ) : (
          <div className="h-[152px] flex items-center justify-center text-caption text-ink-muted" data-testid="conceptmap-loading">
            …
          </div>
        )}
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
          Esc/背景/X 关闭。canvas 变体复用已算好的 layout。 */}
      {expanded && (
        <DiagramViewerModal title={d.title} onClose={() => setExpanded(false)}>
          <div className="h-full w-full rounded-xl overflow-hidden bg-surface-0/60">
            <CanvasStage testid="conceptmap-modal-stage">
              {layout ? (
                <CmapSvg layout={layout} />
              ) : (
                <div className="min-w-[320px] min-h-[160px]" />
              )}
            </CanvasStage>
          </div>
        </DiagramViewerModal>
      )}
    </div>
  );
}
