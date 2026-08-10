/**
 * MermaidArtifact —— Mermaid 图产物,真渲染版(v0.2.1)。
 *
 * 改动:从"只显示代码 + 外链"升级为 dynamic import mermaid 真渲染 SVG。
 * ~500KB 的 mermaid 只在产生 diagram 产物时才加载,首屏不增加。
 *
 * 渲染流程:
 *   1. useEffect 里 loadMermaid() + renderMermaid(id, code) → 拿 SVG
 *   2. 成功 → dangerouslySetInnerHTML 显示 SVG(可缩放 + 滚动查看)
 *   3. 失败 → fallback 显示源码(可复制到 mermaid.live)
 *
 * 交互:缩放(+/- 按钮 + Ctrl+滚轮)+ 可滚动视口(内容大时双向滚动,不限死高度)
 */
import { useCallback, useEffect, useId, useState } from "react";
import { renderMermaid } from "../../lib/lazy-mermaid.js";
import { useDragPan } from "../../lib/useDragPan.js";

interface MermaidData {
  artifactType: "diagram";
  title: string;
  diagramType: "flowchart" | "sequence" | "state";
  mermaid: string;
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

const TYPE_LABELS: Record<string, string> = {
  flowchart: "流程图",
  sequence: "时序图",
  state: "状态图",
};

type RenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error"; message: string };

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;

export function MermaidArtifact({ data }: { data: unknown }) {
  const d = data as MermaidData;
  // useId 保证 SSR-safe 唯一 id,mermaid v11 需要它作为内部 dom 节点 id
  const reactId = useId().replace(/[:]/g, "_");
  const [state, setState] = useState<RenderState>({ status: "loading" });
  // 渲染后测量到的 svg 实际尺寸(用于撑开滚动区,让 scale 后能滚动看到全部)
  const [svgSize, setSvgSize] = useState<{ width: number; height: number } | null>(null);
  // 缩放等级:1 = 原始尺寸。< 1 缩小看全貌,> 1 放大看细节
  const [zoom, setZoom] = useState(1);
  // 拖动平移:放大后可抓手拖动查看(替代只能滚轮滚动)
  const dragPan = useDragPan();
  // 拖动事件订阅到 window(拖出元素也能继续)
  useEffect(() => {
    window.addEventListener("mousemove", dragPan.onMouseMove);
    window.addEventListener("mouseup", dragPan.onMouseUp);
    return () => {
      window.removeEventListener("mousemove", dragPan.onMouseMove);
      window.removeEventListener("mouseup", dragPan.onMouseUp);
    };
  }, [dragPan.onMouseMove, dragPan.onMouseUp]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSvgSize(null); // 新图重置尺寸,重新测量
    renderMermaid(`mmd-${reactId}`, d.mermaid)
      .then((svg) => {
        if (!cancelled) setState({ status: "rendered", svg });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // 打印完整错误到渲染器 console(便于调试 CSP/DOM/import 问题)
          console.error("[MermaidArtifact] render failed:", err);
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [d.mermaid, reactId]);

  const liveUrl = `https://mermaid.live/edit#${encodeURIComponent(d.mermaid)}`;

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // Ctrl + 滚轮缩放(不干扰普通页面滚动)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))));
  }, []);

  return (
    <div className="surface-card p-4" data-testid="artifact-mermaid">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-body shrink-0">📐</span>
          <h3 className="text-body font-bold text-neutral-800 dark:text-neutral-200 truncate">
            {d.title}
          </h3>
          <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0">
            {TYPE_LABELS[d.diagramType] ?? d.diagramType}
          </span>
        </div>
        {/* 缩放控制(仅渲染成功时显示) */}
        {state.status === "rendered" && (
          <div className="flex items-center gap-1 shrink-0" data-testid="mermaid-zoom-controls">
            <button
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="w-6 h-6 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 text-label font-bold flex items-center justify-center"
              title="缩小"
              data-testid="mermaid-zoom-out"
            >
              −
            </button>
            <button
              onClick={zoomReset}
              className="px-1.5 h-6 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-caption font-bold tabular-nums"
              title="重置缩放"
              data-testid="mermaid-zoom-reset"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="w-6 h-6 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 text-label font-bold flex items-center justify-center"
              title="放大"
              data-testid="mermaid-zoom-in"
            >
              +
            </button>
          </div>
        )}
        <button
          onClick={() => window.open(liveUrl, "_blank")}
          className="text-caption text-accent hover:underline font-bold shrink-0"
          data-testid="mermaid-open-live"
          title="在 mermaid.live 打开(可编辑)"
        >
          mermaid.live ↗
        </button>
      </div>

      {/* 渲染视口:不限死高度,内容按缩放后尺寸显示,溢出双向滚动 */}
      <div
        ref={dragPan.containerRef}
        onMouseDown={dragPan.onMouseDown}
        onWheel={handleWheel}
        className={`bg-neutral-50 dark:bg-neutral-900/40 rounded-lg p-3 overflow-auto min-h-[120px] max-h-[500px] select-none ${dragPan.isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ touchAction: "pinch-zoom" }}
        data-testid="mermaid-render-area"
      >
        {state.status === "loading" && (
          <div className="flex items-center gap-2 text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400 my-8 justify-center" data-testid="mermaid-loading">
            <span className="typing-dot w-1.5 h-1.5 bg-accent rounded-full inline-block" />
            <span>渲染图中…</span>
          </div>
        )}
        {state.status === "rendered" && (
          // 外层固定原始尺寸撑开滚动区(同 conceptmap 方案):
          // 有明确 width/height,margin auto 居中不会裁内容(inline-block 无明确尺寸会裁)。
          <div
            style={{
              width: svgSize ? svgSize.width * zoom : "auto",
              height: svgSize ? svgSize.height * zoom : "auto",
              margin: "0 auto",
            }}
          >
            <div
              ref={(el) => {
                // 渲染后测量 svg 实际尺寸(只测一次,存 state 触发重渲染撑开外层)
                if (el && !svgSize) {
                  const svgEl = el.querySelector("svg");
                  if (svgEl) {
                    const bbox = svgEl.getBoundingClientRect();
                    // 用 viewBox 优先(更准),fallback 到 bbox
                    const vb = svgEl.viewBox?.baseVal;
                    const w = vb && vb.width ? vb.width : bbox.width;
                    const h = vb && vb.height ? vb.height : bbox.height;
                    if (w > 0 && h > 0) setSvgSize({ width: w, height: h });
                  }
                }
              }}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                width: svgSize?.width ?? undefined,
                height: svgSize?.height ?? undefined,
              }}
              // SVG 是 mermaid 渲染产物(纯图形 + 文本),无脚本;CSP style-src 'unsafe-inline' 已允许
              dangerouslySetInnerHTML={{ __html: state.svg }}
              data-testid="mermaid-svg"
            />
          </div>
        )}
        {state.status === "error" && (
          <div className="w-full text-center my-4" data-testid="mermaid-fallback">
            <div className="text-body text-warning mb-2">
              ⚠️ 渲染失败,显示源码(可复制到 mermaid.live 查看)
            </div>
            <pre className="text-label bg-neutral-100 dark:bg-neutral-900/60 rounded p-2 overflow-x-auto text-neutral-700 dark:text-neutral-300 font-mono text-left">
              {d.mermaid}
            </pre>
            <div className="text-caption text-neutral-600 dark:text-neutral-400 mt-2">错误: {state.message}</div>
          </div>
        )}
      </div>

      {(state.status === "rendered") && (
        <div className="mt-1.5 text-caption text-neutral-600 dark:text-neutral-400 dark:text-neutral-600 flex items-center gap-2">
          <span>Ctrl+滚轮缩放 · 拖动平移查看</span>
        </div>
      )}

      {/* harness 修复警告 */}
      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-amber-600 dark:text-amber-400" data-testid="artifact-warnings">
          ⚠️ {d.warnings.join("; ")}
        </div>
      )}
    </div>
  );
}
