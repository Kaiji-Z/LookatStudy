/**
 * useTouchPanPinch —— 触屏/鼠标统一的"拖拽平移 + 双指捏合缩放"视口控制。
 *
 * 概念图手机查看(#1):旧实现只挂 mouse 事件 + touch-action:pinch-zoom,
 * 手机上单指平移被 touch-action 拦死(pinch-zoom 只放行双指),拖不动也看不全。
 * 本 hook 用 Pointer Events 一套通吃:
 *   - 单指(或鼠标左键)拖动 = 平移(滚动视口)
 *   - 双指 = 捏合缩放(距离比 → zoom 回调)+ 双指中点平移
 *   - touch-action:none 由调用方设在容器上(手势全部归我们)
 * 调用方保留:滚轮 ctrl 缩放、缩放按钮、键盘。
 */
import { useCallback, useRef } from "react";

export interface TouchPanPinch {
  /** 容器上的 pointer 事件接线 */
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  /** 是否有活跃手势(光标形态用) */
  isPanning: () => boolean;
}

export function useTouchPanPinch(onZoomFactor: (factor: number) => void): TouchPanPinch {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef<{ dist: number; lastRatio: number } | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const panning = useRef(false);

  const midOf = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  };
  const distOf = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    const dx = pts[0]!.x - pts[1]!.x;
    const dy = pts[0]!.y - pts[1]!.y;
    return Math.hypot(dx, dy);
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件无真实指针,忽略 */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const d = distOf();
      pinchBase.current = d ? { dist: d, lastRatio: 1 } : null;
      lastMid.current = midOf();
      panning.current = false; // 双指 = 捏合,不是平移
    } else if (pointers.current.size === 1) {
      panning.current = true;
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const el = e.currentTarget as HTMLElement;

      if (pointers.current.size >= 2) {
        const d = distOf();
        const base = pinchBase.current;
        if (d !== null && base && base.dist > 0) {
          // 增量系数:本次距离比 / 上次距离比 —— 调用方 zoom*factor 即可,无累计误差
          const ratio = d / base.dist;
          onZoomFactor(ratio / base.lastRatio);
          base.lastRatio = ratio;
        }
        const mid = midOf();
        if (mid && lastMid.current) {
          el.scrollLeft -= mid.x - lastMid.current.x;
          el.scrollTop -= mid.y - lastMid.current.y;
        }
        lastMid.current = mid;
        return;
      }

      if (panning.current && lastMid.current) {
        el.scrollLeft -= e.clientX - lastMid.current.x;
        el.scrollTop -= e.clientY - lastMid.current.y;
      }
      lastMid.current = { x: e.clientX, y: e.clientY };
    },
    [onZoomFactor],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
    if (pointers.current.size === 0) {
      panning.current = false;
      lastMid.current = null;
    } else if (pointers.current.size === 1) {
      // 双指抬一指:余指转为平移锚
      const only = [...pointers.current.values()][0]!;
      lastMid.current = { x: only.x, y: only.y };
      panning.current = true;
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, isPanning: () => panning.current };
}
