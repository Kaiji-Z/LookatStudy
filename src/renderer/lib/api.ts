/**
 * 渲染层访问主进程 IPC 的统一入口。
 *
 * window.api 由 preload 注入；这里做一层类型包装，
 * 同时提供"未注入时的友好提示"（开发时 preload 没加载）。
 */
import type { LookatStudyApi } from "../../preload/index.js";

declare global {
  interface Window {
    api: LookatStudyApi;
  }
}

export const api: LookatStudyApi = new Proxy({} as LookatStudyApi, {
  get(_target, prop: string) {
    if (typeof window === "undefined" || !window.api) {
      throw new Error(
        `window.api 未注入（尝试访问 ${prop}）。请检查 preload 是否正确加载。`,
      );
    }
    const fn = (window.api as any)[prop];
    if (typeof fn !== "function") {
      throw new Error(`window.api.${prop} 不是函数`);
    }
    return fn;
  },
});
