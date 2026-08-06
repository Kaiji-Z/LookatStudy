/**
 * 可拖拽分隔线 —— 双栏布局里调节左聊天栏宽度。
 *
 * pointer capture 实现拖拽：按下后即使鼠标移出分隔线也能继续追踪。
 * 拖动时把 delta（相对窗口宽度的百分比）回调给父组件改 chatWidth。
 */
import { useCallback } from "react";

export function Divider({
  onResize,
  onDoubleClick,
}: {
  /** 拖动时回调，参数是本次移动的宽度百分比 delta（正=变宽，负=变窄） */
  onResize: (deltaPct: number) => void;
  /** 双击重置到默认宽度 */
  onDoubleClick?: () => void;
}) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      let startX = e.clientX;
      const winWidth = window.innerWidth || 1;
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);

      const handleMove = (ev: PointerEvent) => {
        const deltaPx = ev.clientX - startX;
        const deltaPct = deltaPx / winWidth * 100;
        onResize(deltaPct);
        startX = ev.clientX;
      };
      const handleUp = (ev: PointerEvent) => {
        (e.target as HTMLDivElement).releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [onResize],
  );

  return (
    <div
      data-testid="divider"
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
      className="w-1.5 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-brand/40 transition-colors relative group"
      title="拖动调节宽度（双击重置）"
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-neutral-700 group-hover:bg-brand/60" />
    </div>
  );
}
