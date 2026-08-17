/**
 * GlobalTooltip —— 全局悬浮提示。挂在 document.body(Portal),脱离所有 stacking context,
 * 永远在最上层。任何带 data-tooltip 属性的元素会显示提示。组件在 App 里挂一次即可。
 *
 * 双通道触发(v0.11):
 * - 精确指针(鼠标):hover 跟随光标(原行为不变)。
 * - 粗指针(触屏):hover 不存在、tap 是误触不弹 —— 长按 500ms 显示(Material Design
 *   触屏 tooltip 规范,Android 原生 View tooltip 同款),手指抬起即消失;移动(滚动意图)
 *   取消长按。锚定元素矩形上方居中。
 *
 * 两个通道都做视口钳制:左右 clamp 进视口,上方放不下翻到元素/光标下方 —— 手机上不再溢出屏幕。
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/** 触屏长按到显示的延迟(Material 规范 ~500ms,低于长按选字的系统时序不影响它:tooltip 只挂在按钮/chrome 上) */
const LONG_PRESS_MS = 500;
/** 与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8;

interface Anchor {
  mode: "cursor" | "rect";
  x: number; // cursor 模式:光标位置
  y: number;
  rect?: DOMRect; // rect 模式:目标元素矩形
}

export function GlobalTooltip() {
  const [tip, setTip] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor>({ mode: "cursor", x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const tipRef = useRef<HTMLDivElement | null>(null);

  const isCoarse = useCallback(() => window.matchMedia("(pointer: coarse)").matches, []);

  // ---- 鼠标通道(精确指针) ----
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isCoarse()) return;
      setAnchor((a) => (a.mode === "cursor" ? { ...a, x: e.clientX, y: e.clientY } : a));
    },
    [isCoarse],
  );
  const handleMouseOver = useCallback(
    (e: MouseEvent) => {
      if (isCoarse()) return; // 触屏 tap 的合成 mouseover 不是悬停,不弹
      const target = (e.target as HTMLElement)?.closest<HTMLElement>("[data-tooltip]");
      const text = target?.getAttribute("data-tooltip");
      if (text) {
        setTip(text);
        setAnchor({ mode: "cursor", x: e.clientX, y: e.clientY });
        return;
      }
      setTip(null);
    },
    [isCoarse],
  );
  const handleMouseOut = useCallback(
    (e: MouseEvent) => {
      if (isCoarse()) return;
      const target = (e.target as HTMLElement)?.closest?.("[data-tooltip]");
      if (target) setTip(null);
    },
    [isCoarse],
  );

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

  // ---- 触屏通道(粗指针):长按显示,抬手/移动消失 ----
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (!isCoarse() || e.touches.length !== 1) return clear();
      const target = (e.target as HTMLElement)?.closest<HTMLElement>("[data-tooltip]");
      const text = target?.getAttribute("data-tooltip");
      if (!text || !target) return clear();
      const el = target; // 闭包内保持非空
      clear();
      timer = setTimeout(() => {
        if (el.isConnected) {
          setTip(text);
          setAnchor({ mode: "rect", x: 0, y: 0, rect: el.getBoundingClientRect() });
        }
      }, LONG_PRESS_MS);
    };
    const onTouchEnd = () => {
      clear();
      setTip((t) => (t ? null : t)); // 抬手即收
    };
    const onTouchMove = () => clear(); // 移动=滚动意图,取消长按(已显示的保留到抬手)
    const onTouchCancel = () => {
      clear();
      setTip(null);
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      clear();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [isCoarse]);

  // 文本变化后量一次尺寸,钳制计算要用(visibility hidden 到量完,无闪跳)
  useLayoutEffect(() => {
    if (tipRef.current && tip) setSize({ w: tipRef.current.offsetWidth, h: tipRef.current.offsetHeight });
  }, [tip]);

  if (!tip) return null;

  // ---- 定位 + 视口钳制 ----
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  let transform: string;
  if (anchor.mode === "rect" && anchor.rect) {
    const r = anchor.rect;
    left = r.left + r.width / 2 - size.w / 2;
    top = r.top - size.h - 6;
    transform = "none";
    if (top < VIEWPORT_MARGIN) top = r.bottom + 6; // 上方放不下 → 元素下方
  } else {
    left = anchor.x;
    top = anchor.y - 6;
    transform = "translate(0, -100%)"; // 光标左下角对齐(原行为)
  }
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - size.w - VIEWPORT_MARGIN));
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - size.h - VIEWPORT_MARGIN));

  return createPortal(
    <div
      ref={tipRef}
      style={{
        position: "fixed",
        left,
        top,
        transform,
        zIndex: 99999,
        pointerEvents: "none",
        visibility: size.w ? "visible" : "hidden",
        // 用 CSS 变量自动跟随主题(浅色=深字浅底,深色=浅字深底)
        background: "rgb(var(--surface-0-rgb) / 0.92)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "var(--ink)",
        border: "1px solid rgb(var(--border-rgb) / 0.5)",
        fontSize: "0.875rem", // text-body,跟随全局 html font-size(useFontSize)
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "4px 10px",
        borderRadius: "8px",
        maxWidth: "260px",
        wordBreak: "break-word",
        boxShadow: "0 4px 12px rgb(var(--shadow-rgb) / 0.15)",
        whiteSpace: "normal",
      }}
    >
      {tip}
    </div>,
    document.body,
  );
}
