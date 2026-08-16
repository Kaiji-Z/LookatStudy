/**
 * useWindowTier —— 响应式窗口档位(useSyncExternalStore 订阅 resize)。
 *
 * 快照返回 tierFor(innerWidth) 而非原始宽度:同档内拖动窗口不触发重渲染
 * (Object.is 比较,档位数字不变即跳过),跨档才渲染一次。
 */
import { useSyncExternalStore } from "react";
import { tierFor, type PaneTier } from "./paneTiers.js";

function subscribe(cb: () => void): () => void {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

function getSnapshot(): PaneTier {
  return tierFor(typeof window === "undefined" ? T1_FALLBACK : window.innerWidth);
}

/** SSR/测试兜底:拿不到 window 时按最宽档(布局最完整)。 */
const T1_FALLBACK = 99999;

export function useWindowTier(): PaneTier {
  return useSyncExternalStore(subscribe, getSnapshot, () => 1);
}
