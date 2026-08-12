/**
 * usePrefersReducedMotion —— 响应式检测系统"减少动效"偏好。
 *
 * 这是 a11y 底线(WCAG),不是审美:前庭敏感/晕动症用户选"减少动效"后,
 * 所有动效必须降级为淡入/瞬时。游戏感升级给默认用户更丰富的反馈,
 * 对选择减少动效的用户走另一套静态降级路径(双轨)。
 *
 * 实现:useSyncExternalStore 订阅 matchMedia change,偏好变化时组件自动重渲染。
 * 比 skyCanvas.ts 里的一次性 matchMedia().matches 读取更强(那个不响应变化)。
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** SSR/初始兜底(本应用 renderer 总有 window,但 useSyncExternalStore 要求 3 参安全)。 */
function getServerSnapshot(): boolean {
  return false;
}

/** 返回当前是否"减少动效";偏好变化时触发组件重渲染。 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 非组件上下文用的一次性读取(如 skyCanvas 闭包内,无法用 hook)。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}
