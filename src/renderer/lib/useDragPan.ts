/**
 * useDragPan —— 可滚动视口的"抓手拖动平移"hook(v0.2.2)。
 *
 * 解决产物放大后查看的痛点:
 *   - 滚轮只能上下滚,横向溢出看不到
 *   - 有 cursor-grab 光标但实际不能拖(之前 mermaid 的 bug)
 *
 * 用法:把返回的 handlers 挂到滚动容器的 ref 上,内容即可拖动平移。
 * 实现:监听 mousedown/move/up,拖动时调整 scrollLeft/scrollTop。
 *   - mousedown 记录起点 + 设置 isDragging
 *   - mousemove 计算 delta,scrollLeft/scrollTop 同步减去 delta
 *   - mouseup/mouseleave 清除状态
 *   - 拖动时光标变 grabbing(用户感知"抓住了")
 *
 * 不依赖任何库,纯 React + DOM API。
 */
import { useCallback, useRef, useState } from "react";

export interface DragPanHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  // 以下挂在 document/window 上,通过 effect 订阅;这里只暴露给组件决定挂法
}

export function useDragPan() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    // 防止"点击"被误判为拖动(< 3px 位移算点击,不阻止文本选择等)
    moved: false,
  });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    // 只响应左键(右键留给上下文菜单)
    if (e.button !== 0) return;
    dragState.current = {
      startX: e.pageX,
      startY: e.pageY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moved: false,
    };
    setIsDragging(true);
    // 防止拖动时选中文本/图片
    e.preventDefault();
  }, []);

  // 全局监听 move/up(用 native event,不经过 React 合成事件,避免拖出元素后丢失)
  // 用 useEffect + window.addEventListener,但为简化这里用 ref + React onMouseMove/onMouseUp
  // —— 实际更稳的是 window 监听。下面用 document 事件:
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const el = containerRef.current;
    if (!el) return;
    const dx = e.pageX - dragState.current.startX;
    const dy = e.pageY - dragState.current.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.current.moved = true;
    el.scrollLeft = dragState.current.scrollLeft - dx;
    el.scrollTop = dragState.current.scrollTop - dy;
  }, [isDragging]);

  const endDrag = useCallback(() => {
    if (isDragging) setIsDragging(false);
  }, [isDragging]);

  return {
    containerRef,
    isDragging,
    /** 挂到容器 div 的 onMouseDown */
    onMouseDown,
    /** 挂到 window 的 mousemove/mouseup(组件用 useEffect 订阅) */
    onMouseMove,
    onMouseUp: endDrag,
    onMouseLeave: endDrag,
  };
}
