/**
 * useTheme —— 全局主题切换(v0.7 浅色模式支持)。
 *
 * 三态:auto(跟随系统)/ light / dark。
 * - auto:监听 matchMedia('(prefers-color-scheme: dark)'),系统暗→dark,系统亮→light
 * - light/dark:手动锁定,忽略系统
 *
 * 在 <html> 上设 class(二选一,永不为空):html.dark 或 html.light。
 * 切换时派发 'theme-changed' 事件(供 Mermaid 等需要重初始化的消费者监听)。
 * localStorage 持久化(mode 字段)。
 *
 * 防闪烁:index.html 有一段 inline 脚本在 React mount 前就读 localStorage 设 class,
 * 避免 SSR/mount 延迟导致深色内容闪一下浅色(FOUC)。
 */
import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "lookatstudy-theme";
const DEFAULT_MODE: ThemeMode = "auto";

const DARK_MQ = "(prefers-color-scheme: dark)";

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(DARK_MQ).matches ? "dark" : "light";
}

function readStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  return saved === "auto" || saved === "light" || saved === "dark" ? saved : DEFAULT_MODE;
}

/** 把 resolved theme 写到 <html> class(二选一:dark 或 light,永不为空)。 */
function applyHtmlClass(resolved: ResolvedTheme): void {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  html.classList.add(resolved);
  // 派发事件:Mermaid 等消费者监听此事件重初始化
  window.dispatchEvent(new CustomEvent("theme-changed", { detail: { resolved } }));
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  // resolved = 实际生效的(light/dark)。auto 模式下随系统变。
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    mode === "auto" ? readSystemTheme() : (mode as ResolvedTheme),
  );

  // mode 变化 → 重算 resolved + 写 localStorage
  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
    const r = m === "auto" ? readSystemTheme() : (m as ResolvedTheme);
    setResolved(r);
    applyHtmlClass(r);
  }, []);

  // auto 模式:监听系统主题变化(用户改系统设置时跟随)
  useEffect(() => {
    if (mode !== "auto") return;
    const mq = window.matchMedia(DARK_MQ);
    const handler = (e: MediaQueryListEvent) => {
      const r: ResolvedTheme = e.matches ? "dark" : "light";
      setResolved(r);
      applyHtmlClass(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  // mount 时同步一次(防 inline 脚本与 React 状态漂移)
  useEffect(() => {
    const r = mode === "auto" ? readSystemTheme() : (mode as ResolvedTheme);
    setResolved(r);
    applyHtmlClass(r);
  }, [mode]);

  return { mode, resolved, setMode };
}
