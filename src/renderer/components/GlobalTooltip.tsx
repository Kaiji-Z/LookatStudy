/**
 * GlobalTooltip —— 全局悬浮提示。挂在 document.body(Portal),脱离所有 stacking context,
 * 永远在最上层。任何带 data-tooltip 属性的元素 hover 时显示提示,跟随鼠标,锚点在左下角。
 *
 * 用法:给元素加 data-tooltip="要显示的文字" 即可。不需要额外绑定。
 * 组件只需在 App 里挂一次(<GlobalTooltip />)。
 */
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export function GlobalTooltip() {
  const [tip, setTip] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseOver = useCallback((e: MouseEvent) => {
    // 从事件目标往上找带 data-tooltip 的元素
    const target = (e.target as HTMLElement)?.closest<HTMLElement>("[data-tooltip]");
    if (target) {
      const text = target.getAttribute("data-tooltip");
      if (text) {
        setTip(text);
        setPos({ x: e.clientX, y: e.clientY });
        return;
      }
    }
    setTip(null);
  }, []);

  const handleMouseOut = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest<HTMLElement>("[data-tooltip]");
    if (target) setTip(null);
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseover", handleMouseOver, { passive: true });
    document.addEventListener("mouseout", handleMouseOut, { passive: true });
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
    };
  }, [handleMouseMove, handleMouseOver, handleMouseOut]);

  if (!tip) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        transform: "translate(0, -100%)", // 左下角对齐鼠标:Y 轴上移自身高度
        zIndex: 99999,
        pointerEvents: "none",
        background: "rgba(8, 10, 20, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "#fff",
        fontSize: "11px",
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "4px 10px",
        borderRadius: "8px",
        maxWidth: "260px",
        wordBreak: "break-word",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        whiteSpace: "normal",
      }}
    >
      {tip}
    </div>,
    document.body,
  );
}
