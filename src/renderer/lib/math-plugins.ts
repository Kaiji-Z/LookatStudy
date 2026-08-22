/**
 * math-plugins —— 数学渲染插件集按需加载(入口包瘦身)。
 *
 * katex+remark-math+rehype-katex 合计 ~70KB(gzip),只对含数学记法的
 * 内容才有用。基础管线(gfm/raw/sanitize)同步常驻;useMarkdownPipeline
 * 检测到数学记法($、$$、\(、\[)时动态加载数学插件集,就位后 ReactMarkdown
 * 换管线重渲染(加载前公式按原文显示一拍)。插件序保持 raw→sanitize→katex。
 */
import { useEffect, useState } from "react";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "./markdown-sanitize.js";
import type { PluggableList } from "unified";

export interface MarkdownPipeline {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

/** 无数学基础管线(同步,零额外 chunk)。 */
export const BASE_PIPELINE: MarkdownPipeline = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]],
};

let mathPipeline: MarkdownPipeline | null = null;
let mathPipelineLoading: Promise<MarkdownPipeline> | null = null;

/** 数学插件集(remark-math+rehype-katex,连带 katex 本体):单例,首个含公式内容触发加载。 */
export function loadMathPipeline(): Promise<MarkdownPipeline> {
  if (mathPipeline) return Promise.resolve(mathPipeline);
  mathPipelineLoading ??= Promise.all([import("remark-math"), import("rehype-katex")]).then(
    ([{ default: remarkMath }, { default: rehypeKatex }]) => {
      mathPipeline = {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeKatex],
      };
      return mathPipeline;
    },
  );
  return mathPipelineLoading;
}

/** 内容是否含数学记法:归一前的 $ 与 \( \[ 都算(宁多加载不漏渲染)。 */
export function hasMathNotation(md: string): boolean {
  return md.includes("$") || md.includes("\\(") || md.includes("\\[");
}

/** 组件钩子:按内容切基础/数学管线;数学插件集加载完成后触发一次重渲染。 */
export function useMarkdownPipeline(content: string): MarkdownPipeline {
  const [math, setMath] = useState<MarkdownPipeline | null>(mathPipeline);
  const needsMath = hasMathNotation(content ?? "");
  useEffect(() => {
    if (!needsMath || math) return;
    let alive = true;
    loadMathPipeline().then((p) => {
      if (alive) setMath(p);
    });
    return () => {
      alive = false;
    };
  }, [needsMath, math]);
  return math ?? BASE_PIPELINE;
}
