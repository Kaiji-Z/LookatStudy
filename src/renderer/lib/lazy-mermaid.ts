/**
 * lazy-mermaid —— mermaid 动态加载 + 渲染封装(v0.2.1)。
 *
 * mermaid ~500KB,首屏不需要。只有产生 diagram 产物时才 dynamic import。
 * 用模块级 promise 缓存,多次调用只加载一次。
 *
 * API 参考 Rick Strahl 2025 实践:
 *   - import('mermaid') 拿到模块
 *   - mermaid.initialize({ startOnLoad: false, theme })  // 关掉自动渲染,手动控制
 *   - mermaid.render(id, code) → { svg }  // 拿 SVG 字符串,前端 dangerouslySetInnerHTML
 *
 * Mermaid v11 的 render 是 async,返回 { svg, bindFunctions? }。
 * CSP:script-src 'self' 允许 dynamic import 同源 chunk;style-src 'unsafe-inline' 已开,SVG 内联样式可用。
 */
import type { Mermaid } from "mermaid";

let mermaidPromise: Promise<Mermaid> | null = null;

/** 动态加载 mermaid(只加载一次,后续复用)。 */
export function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "loose", // 允许 label 带 HTML/特殊字符(学习内容常有)
        flowchart: { useMaxWidth: true, htmlLabels: true },
        sequence: { useMaxWidth: true },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/**
 * 渲染 mermaid 代码 → SVG 字符串。
 * 失败时抛错(调用方 catch 后 fallback 到源码显示)。
 *
 * 双重防护:
 *   1. render 前先 parse() 预检语法 —— mermaid.parse 失败会真 throw,带具体错误位置
 *   2. render 后检测返回的 SVG 是否是 error SVG(mermaid v11 的坑:语法错不 throw 而是画炸弹图)
 *
 * @param id 唯一 id(mermaid v11 需要,作为内部 dom 节点 id)
 * @param code mermaid 语法代码
 */
export async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  // 预检语法:parse 失败会 throw,带具体行号/原因(比 render 的炸弹图友好)
  try {
    await mermaid.parse(code);
  } catch (e) {
    throw new Error(
      `mermaid 语法校验失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const { svg } = await mermaid.render(id, code);
  // mermaid v11 的坑:语法错误时不 throw,返回 error SVG —— 检测并转成真错误
  if (
    svg.includes('aria-roledescription="error"') ||
    svg.includes('class="error-text"') ||
    svg.includes("Syntax error")
  ) {
    throw new Error("mermaid 渲染失败(语法错误或节点 label 含未转义特殊字符)");
  }
  return svg;
}
