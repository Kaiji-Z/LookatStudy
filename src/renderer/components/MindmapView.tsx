/**
 * MindmapView —— 讲解内容 → 交互思维导图(v0.21,markmap)。
 *
 * 讲解区工具栏 Brain 按钮一键切换:markdown 层级(标题/列表)→ 可折叠脑图。
 * 结构概览定位,预处理剥离代码块/图片(lib/mindmap-markdown.ts 纯函数)。
 *
 * - markmap-lib/markmap-view 全部动态 import(懒 chunk,主束零增加);
   加载/初始化失败回退提示,不炸讲解区。
 * - 手势/缩放/适屏复用 CanvasStage(纯 transform,锚定缩放,双击适屏)——
   markmap 自带 pan/zoom 全关,节点点击折叠仍由 markmap 接管(点击未被
   CanvasStage 手势吞掉,pan 只在拖动后生效)。
 * - 颜色:分支线按深度吃应用 token(brand/accent/gold/…,读一次 CSS 变量),
   节点文字经 foreignObject 继承 .mindmap-view 的 --ink-strong,双主题自适应。
 * - 切节点:markdown prop 变化 → 重新 setData + fit(挂载态保留,连续浏览)。
 */
import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { useLang } from "../lib/i18n.js";
import { CanvasStage } from "./CanvasStage.js";
import { mindmapMarkdown } from "../lib/mindmap-markdown.js";

/** 深度 → 分支色(读一次应用 token;markmap 每节点回调一次,缓存住) */
function depthPalette(): string[] {
  if (typeof document === "undefined") {
    return ["#58cc02", "#1cb0f6", "#ffc800", "#a67cd8", "#ff7a00"];
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => {
    const raw = cs.getPropertyValue(name).trim();
    return raw ? `rgb(${raw})` : fallback;
  };
  return [
    v("--brand-rgb", "#58cc02"),
    v("--accent-rgb", "#1cb0f6"),
    v("--gold-rgb", "#ffc800"),
    "#a67cd8",
    v("--warning-rgb", "#ff7a00"),
  ];
}

export function MindmapView({ markdown }: { markdown: string }) {
  const t = useLang();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<{ setData: (root: unknown) => void; fit: () => void } | null>(null);
  const [failed, setFailed] = useState(false);
  const src = mindmapMarkdown(markdown);

  // 懒加载 markmap → 建实例 → setData。切节点(src 变)复用实例只换数据。
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import("markmap-lib"),
          import("markmap-view"),
        ]);
        const svg = svgRef.current;
        if (!svg || disposed) return;
        if (!mmRef.current) {
          const palette = depthPalette();
          mmRef.current = Markmap.create(svg, {
            autoFit: false,
            duration: 0,
            pan: false,
            zoom: false,
            initialExpandLevel: 2,
            maxWidth: 260,
            spacingVertical: 10,
            spacingHorizontal: 96,
            paddingX: 12,
            color: (node: { state?: { depth?: number } }) =>
              palette[(node.state?.depth ?? 0) % palette.length] ?? palette[0]!,
          }) as unknown as { setData: (root: unknown) => void; fit: () => void };
        }
        const { root } = new Transformer().transform(src);
        mmRef.current.setData(root);
        mmRef.current.fit();
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [src]);

  if (failed) {
    return (
      <div className="text-body text-ink-muted flex items-center gap-2 my-4">
        <Brain className="w-4 h-4" />
        {t("notebook.content.render_failed")}
      </div>
    );
  }
  return (
    <div data-testid="mindmap-view" className="mindmap-view h-[68vh] min-h-[420px] my-2">
      <CanvasStage grid testid="mindmap-stage">
        <div className="w-[1280px] h-[760px]">
          <svg ref={svgRef} className="w-full h-full block" />
        </div>
      </CanvasStage>
    </div>
  );
}
