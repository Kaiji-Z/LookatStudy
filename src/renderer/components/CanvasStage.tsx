/**
 * CanvasStage —— 画布式产物舞台(pan/zoom),黑板 tab 与全屏查看器共用。
 *
 * 设计(对齐 Figma/Excalidraw/ChatGPT canvas 的成熟做法):
 *   - 纯 transform:内容保持自然尺寸,translate+scale 一个包办 —— 零布局耦合,
 *     根治滚动视口方案"捏合抖动/放大不动"的实测事故(见 lib/panzoom.ts 头注)
 *   - 缩放锚定手势中点/光标:手指下的内容点数学上不动
 *   - 手势:单指(或鼠标左键)拖动平移、双指捏合、滚轮缩放、双击/双触 适屏↔100%
 *   - 挂载/内容尺寸变化自动适屏(contain);浮层工具条 −/%/适屏/+ 常驻
 *   - 点阵底纹(canvas 感),motion-safe 缩放过渡(手势期间零过渡防滞后)
 *
 * 触控隔离:stage 上 touch-action:none(手势全归这里);根节点 data-noswipe。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { useLang } from "../lib/i18n.js";
import {
  fitTransform,
  zoomAtClamped,
  clampPan,
  type PanZoomTransform,
} from "../lib/panzoom.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** 工具条触发的缩放步进(手势/滚轮是连续的,按钮给干脆的一档) */
const STEP = 1.25;

export function CanvasStage({
  children,
  /** 画布底纹(黑板/弹窗 true;嵌进卡片等窄容器可关) */
  grid = true,
  testid,
}: {
  children: React.ReactNode;
  grid?: boolean;
  testid?: string;
}) {
  const t = useLang();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [tf, setTf] = useState<PanZoomTransform>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** 活跃手势中(禁用 transform 过渡:跟手必须即时;按钮缩放才享受平滑过渡) */
  const [gesturing, setGesturing] = useState(false);
  const lastPointerTypeRef = useRef<string>("mouse");
  /** 双击适屏↔100% 的状态翻转 */
  const atFitRef = useRef(true);
  /** 手势态(ref,不进 React 状态 —— move 高频) */
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    pinchBase: { dist: number; factorAcc: number } | null;
    lastMid: { x: number; y: number } | null;
    panning: boolean;
    moved: boolean;
  }>({ pointers: new Map(), pinchBase: null, lastMid: null, panning: false, moved: false });
  /** 双击检测 */
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const bounds = useCallback(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    return {
      min: MIN_SCALE,
      max: MAX_SCALE,
      contentW: content?.offsetWidth ?? 0,
      contentH: content?.offsetHeight ?? 0,
      viewW: stage?.clientWidth ?? 0,
      viewH: stage?.clientHeight ?? 0,
    };
  }, []);

  const refit = useCallback(() => {
    const b = bounds();
    if (!b.contentW || !b.viewW) return;
    setTf(fitTransform(b.contentW, b.contentH, b.viewW, b.viewH));
    atFitRef.current = true;
  }, [bounds]);

  // 尺寸测量:内容(自然尺寸)+ 舞台双 RO → 变化即适屏(mermaid 异步渲染出 svg 后自动回正)
  useEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const measure = () => {
      setSize({ w: content.offsetWidth, h: content.offsetHeight });
      refit();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [refit]);

  const zoomBy = useCallback(
    (factor: number, ax?: number, ay?: number) => {
      const b = bounds();
      const cx = ax ?? b.viewW / 2;
      const cy = ay ?? b.viewH / 2;
      setTf((cur) => zoomAtClamped(cur, factor, cx, cy, b));
      atFitRef.current = false;
    },
    [bounds],
  );

  // ---- 指针手势(拖动/捏合/双击) ----
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // 缩放工具条上的指针不进手势:setPointerCapture 会把后续 click 重定向到舞台,
    // 按钮就点不动了(实测)。工具条自己处理点击。
    if ((e.target as HTMLElement).closest?.("[data-testid=canvas-zoom-controls]")) return;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件无真实指针 */
    }
    const g = gesture.current;
    lastPointerTypeRef.current = e.pointerType;
    if (g.pointers.size === 0) setGesturing(true);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      const [p1, p2] = [...g.pointers.values()];
      g.pinchBase = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), factorAcc: 1 };
      g.lastMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      g.panning = false;
    } else if (g.pointers.size === 1) {
      g.panning = true;
      g.moved = false;
      g.lastMid = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g.pointers.has(e.pointerId)) return;
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();

      if (g.pointers.size >= 2 && g.pinchBase) {
        // 捏合:锚定双指中点
        const [p1, p2] = [...g.pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        if (g.pinchBase.dist > 0) {
          const factor = dist / g.pinchBase.dist / g.pinchBase.factorAcc;
          g.pinchBase.factorAcc *= factor;
          zoomBy(factor, mid.x - rect.left, mid.y - rect.top);
        }
        // 中点移动 = 平移(捏着拖)。增量先落局部常量 —— updater 必须纯函数,
        // 闭包里读可变 ref 会在延迟执行时读到 null(实测把 React 树都炸了)。
        if (g.lastMid) {
          const dx = mid.x - g.lastMid.x;
          const dy = mid.y - g.lastMid.y;
          const b = bounds();
          setTf((cur) => clampPan({ ...cur, x: cur.x + dx, y: cur.y + dy }, b.contentW, b.contentH, b.viewW, b.viewH));
        }
        g.lastMid = mid;
        return;
      }

      if (g.panning && g.lastMid) {
        const dx = e.clientX - g.lastMid.x;
        const dy = e.clientY - g.lastMid.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
        const b = bounds();
        setTf((cur) => clampPan({ ...cur, x: cur.x + dx, y: cur.y + dy }, b.contentW, b.contentH, b.viewW, b.viewH));
        g.lastMid = { x: e.clientX, y: e.clientY };
      }
    },
    [bounds, zoomBy],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current;
      const wasSingle = g.pointers.size === 1;
      g.pointers.delete(e.pointerId);
      if (g.pointers.size < 2) g.pinchBase = null;
      if (g.pointers.size === 0) {
        g.panning = false;
        g.lastMid = null;
        setGesturing(false);
        // 单指快速点按(无拖动)= 双击检测 → 适屏↔100%
        if (wasSingle && !g.moved && e.pointerType !== "mouse") {
          const now = performance.now();
          const last = lastTapRef.current;
          if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 32) {
            const b = bounds();
            if (atFitRef.current) {
              // 适屏 → 100%(顶部对齐留边,长内容向下展开)
              setTf(clampPan({ x: (b.viewW - b.contentW) / 2, y: Math.max(24, (b.viewH - b.contentH) / 2), scale: 1 }, b.contentW, b.contentH, b.viewW, b.viewH));
              atFitRef.current = false;
            } else {
              refit();
            }
            lastTapRef.current = null;
          } else {
            lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
          }
        }
      } else if (g.pointers.size === 1) {
        const only = [...g.pointers.values()][0]!;
        g.lastMid = { x: only.x, y: only.y };
        g.panning = true;
      }
    },
    [bounds, refit],
  );

  // 滚轮缩放(画布惯例:滚轮即缩放,锚定光标)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX - rect.left, e.clientY - rect.top);
    },
    [zoomBy],
  );

  // 鼠标双击:适屏↔100%
  const onDoubleClick = useCallback(() => {
    if (lastPointerTypeRef.current !== "mouse") return; // 触屏由双 tap 路径处理
    const b = bounds();
    if (atFitRef.current) {
      setTf(clampPan({ x: (b.viewW - b.contentW) / 2, y: Math.max(24, (b.viewH - b.contentH) / 2), scale: 1 }, b.contentW, b.contentH, b.viewW, b.viewH));
      atFitRef.current = false;
    } else {
      refit();
    }
  }, [bounds, refit]);

  return (
    <div
      ref={stageRef}
      data-testid={testid}
      data-noswipe=""
      className={`relative h-full w-full overflow-hidden select-none touch-none ${grid ? "canvas-grid" : ""}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      {/* 内容:自然尺寸,纯 transform 定位 */}
      <div
        ref={contentRef}
        className={`absolute top-0 left-0 canvas-stage-gesture ${!gesturing ? "motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out" : ""}`}
        style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`, transformOrigin: "0 0" }}
      >
        {children}
      </div>

      {/* 缩放工具条:底部居中悬浮(拇指区),拖动手势期间隐藏过渡不打扰 */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 p-1 rounded-xl bg-surface-0/90 backdrop-blur border border-[var(--border)] shadow-elevated" data-testid="canvas-zoom-controls">
        <button
          onClick={() => zoomBy(1 / STEP)}
          disabled={tf.scale <= MIN_SCALE + 1e-6}
          aria-label={t("artifact.zoomOut")}
          data-tooltip={t("artifact.zoomOut")}
          data-testid="canvas-zoom-out"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:bg-ink/5 hover:text-ink-strong disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="text-label font-bold tabular-nums text-ink-muted min-w-[3.25rem] text-center select-none" data-testid="canvas-zoom-pct">
          {Math.round(tf.scale * 100)}%
        </span>
        <button
          onClick={() => zoomBy(STEP)}
          disabled={tf.scale >= MAX_SCALE - 1e-6}
          aria-label={t("artifact.zoomIn")}
          data-tooltip={t("artifact.zoomIn")}
          data-testid="canvas-zoom-in"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:bg-ink/5 hover:text-ink-strong disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={refit}
          aria-label={t("artifact.canvas.fit")}
          data-tooltip={t("artifact.canvas.fit")}
          data-testid="canvas-zoom-fit"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:bg-ink/5 hover:text-ink-strong transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* 自然尺寸探针(供测试断言,零视觉) */}
      <span data-testid="canvas-natural-size" className="hidden">
        {size ? `${size.w}x${size.h}` : ""}
      </span>
    </div>
  );
}
