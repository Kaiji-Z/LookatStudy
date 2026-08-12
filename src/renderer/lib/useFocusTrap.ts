/**
 * useFocusTrap —— 把键盘焦点困在指定容器内(a11y P1)。
 *
 * 用于 modal / drawer / popover:
 *   - 挂载时记录当前焦点,把焦点移入容器第一个可聚焦元素
 *   - Tab / Shift+Tab 在容器边界循环(不逃逸到背后的页面)
 *   - 卸载或 active=false 时把焦点还原到挂载前的元素
 *
 * React 19 StrictMode 安全:effect 里不直接累加外部状态;清理函数完整还原。
 *
 * 用法:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open);
 *   return <div ref={ref} role="dialog" aria-modal="true">…</div>;
 */
import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
]
  .map((s) => `${s}:not([hidden])`)
  .join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // 记录打开前的焦点,关闭时还原
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 移入焦点(优先第一个可聚焦元素;回退到容器本身)
    const focusables = getFocusable(container);
    const target = focusables[0] ?? container;
    // 微延迟:等子元素 mount(如 portal 内的 input)
    const focusTimer = window.setTimeout(() => target.focus(), 0);

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const currentFocusables = getFocusable(container);
      if (currentFocusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = currentFocusables[0]!;
      const last = currentFocusables[currentFocusables.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handler);

    return () => {
      window.clearTimeout(focusTimer);
      container.removeEventListener("keydown", handler);
      // 还原焦点(若原元素仍在 DOM 中)
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          /* 元素可能已 unmount,忽略 */
        }
      }
    };
  }, [containerRef, active]);
}
