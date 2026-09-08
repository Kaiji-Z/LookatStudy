/**
 * PaneResizeHandle —— 三栏拖拽调宽手柄(issue #14)。
 *
 * 栏间 6px 竖条(视觉握线 hover/拖拽亮起),命中区触屏 44px 红线 / 细指针
 * 收窄 12px(index.css ::before)。拖拽期宽度直写目标元素 style.width
 * (imperative,不过 React —— 目标树很重:左栏是物理地图整树、中栏是消息流,
 * 逐帧 setState 重渲染不可接受);松手才回 React 状态 + 持久化。
 * 写宽节流 100ms:左栏物理岛按 ResizeObserver→containerW 重建,逐帧重建
 * 是真实性能风险(goal 预授权节流;岛重建自带 spawn 续接,宽度跳变球不闪回)。
 * 中栏有 motion-safe width transition:拖拽中置 none(不跟手),松手恢复。
 * 双击 = 重置回响应式默认(onCommit(null) + 清 inline width 让默认类/clamp 接管)。
 * a11y:role=separator + aria-label;键盘调整不在本期范围。
 */
import { useEffect, useRef, useState } from "react";

/** 拖拽中宽度应用节流(松手必应用终值,不受节流影响)。 */
const DRAG_APPLY_MIN_MS = 100;

export function PaneResizeHandle(props: {
  /** 哪条边界(测试钩子 + 语义)。 */
  side: "rail" | "mid";
  /** 拖拽目标栏元素(渲染期由 App 闭包提供;拖拽中实时取)。 */
  target: () => HTMLElement | null;
  /** 实时钳制(视口感知,pane-resize 纯函数;App 组装 reserved)。 */
  clampLive: (px: number) => number;
  /** 松手提交(px=终值;null=双击重置)。 */
  onCommit: (px: number | null) => void;
  ariaLabel: string;
  tooltip: string;
}) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number; lastAppliedAt: number } | null>(null);
  /** props 进 effect 闭包会滞后:拖拽全程用 ref 取最新。 */
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("pane-dragging");
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const el = propsRef.current.target();
      if (!d || !el) return;
      const now = performance.now();
      if (now - d.lastAppliedAt < DRAG_APPLY_MIN_MS) return;
      d.lastAppliedAt = now;
      el.style.width = `${propsRef.current.clampLive(d.startW + (e.clientX - d.startX))}px`;
    };
    const finish = (e: PointerEvent) => {
      const d = dragRef.current;
      const el = propsRef.current.target();
      dragRef.current = null;
      setDragging(false);
      if (el) el.style.transition = "";
      if (!d) return;
      // 终值必达:节流窗内松手也按全程位移结算
      const finalW = propsRef.current.clampLive(d.startW + (e.clientX - d.startX));
      if (el) el.style.width = `${finalW}px`;
      propsRef.current.onCommit(finalW);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      document.body.classList.remove("pane-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.ariaLabel}
      data-tooltip={props.tooltip}
      data-testid={`pane-handle-${props.side}`}
      data-dragging={dragging ? "true" : undefined}
      className="pane-resize-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = props.target();
        if (!el) return;
        e.preventDefault();
        dragRef.current = {
          startX: e.clientX,
          startW: el.getBoundingClientRect().width,
          lastAppliedAt: 0,
        };
        el.style.transition = "none"; // 中栏 width transition 拖拽中不跟手 → 关
        setDragging(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // 合成事件无活跃指针 id(ui-test)会抛 InvalidPointerId:window 兜底监听已够
        }
      }}
      onDoubleClick={() => {
        const el = props.target();
        if (el) el.style.width = ""; // 清 inline,默认类/clamp 接管
        props.onCommit(null);
      }}
    />
  );
}
