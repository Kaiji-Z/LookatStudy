/**
 * useFontSize —— v0.3 中栏字号调节(A-/A+)。
 *
 * 三档:small(13px)/ medium(15px,默认)/ large(17px)。
 * 用 CSS 变量 --chat-font-size 控制,localStorage 持久化。
 * 影响范围:ChatStream 文字 + NotebookPanel 讲解 + 产物卡。
 */
import { useState, useEffect, useCallback } from "react";

export type FontSize = "small" | "medium" | "large";

const SIZE_PX: Record<FontSize, number> = {
  small: 13,
  medium: 15,
  large: 17,
};

const STORAGE_KEY = "lookatstudy-font-size";
const DEFAULT: FontSize = "medium";

export function useFontSize() {
  const [size, setSize] = useState<FontSize>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as FontSize | null;
      if (saved && saved in SIZE_PX) return saved;
    }
    return DEFAULT;
  });

  useEffect(() => {
    // 写 CSS 变量到 :root,全局生效
    document.documentElement.style.setProperty("--chat-font-size", `${SIZE_PX[size]}px`);
    localStorage.setItem(STORAGE_KEY, size);
  }, [size]);

  const bump = useCallback((dir: "up" | "down") => {
    setSize((prev) => {
      const order: FontSize[] = ["small", "medium", "large"];
      const idx = order.indexOf(prev);
      const next = dir === "up" ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0);
      return order[next]!;
    });
  }, []);

  return { size, bump, px: SIZE_PX[size] };
}
