/**
 * useFontSize —— 全局字号系统(A-/A+),v0.7。
 *
 * 三档基准 html font-size:small(16px)/ medium(17px,默认)/ large(18px)。
 * 以 16px 为地板(浏览器标准/a11y 正文最小共识),small 档下最小 caption=12px 正好踩可读线。
 * 设到 html 元素的 font-size,所有 rem 单位自动跟随。
 *
 * 6 级语义字号(见 index.css .text-caption ~ .text-hero):
 *   caption 0.75rem  badge/计数/logo(刻意最小,12px@small 踩可读线)
 *   label   0.825rem 表单label/timestamp/小标题
 *   body    0.875rem 按钮/输入框/对话/tooltip(主要交互文字)
 *   lead    1rem     正文(讲解/笔记主体)
 *   title   1.125rem 卡片标题
 *   hero    1.5rem   大标题/空状态
 *
 * localStorage 持久化。
 */
import { useState, useEffect, useCallback } from "react";

export type FontSize = "small" | "medium" | "large";

const SIZE_PX: Record<FontSize, number> = {
  small: 16,
  medium: 17,
  large: 18,
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
    document.documentElement.style.fontSize = `${SIZE_PX[size]}px`;
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

  return { size, bump };
}
