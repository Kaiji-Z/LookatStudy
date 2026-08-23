/**
 * MindmapView —— 讲解内容 → 交互思维导图(v0.21,markmap)。
 *
 * 讲解区工具栏 Brain 按钮一键切换:markdown 层级(标题/列表)→ 可折叠脑图。
 * 结构概览定位,预处理剥离代码块/图片(lib/mindmap-markdown.ts 纯函数;
 * v13 起段落也降为节点——无标题的导入课时不再整篇缩成一个节点)。
 *
 * - markmap-lib/markmap-view 全部动态 import(懒 chunk,主束零增加);
   加载/初始化失败回退提示,不炸讲解区。
 * - 手势/缩放/适屏复用 CanvasStage(纯 transform,锚定缩放,双击适屏)——
   markmap 自带 pan/zoom 全关,节点点击折叠仍由 markmap 接管(点击未被
   CanvasStage 手势吞掉,pan 只在拖动后生效)。
 * - 颜色:分支线按深度吃应用 token(brand/accent/gold/…,读一次 CSS 变量),
   节点文字经 foreignObject 继承 .mindmap-view 的 --ink-strong,双主题自适应。
 * - 切节点:markdown prop 变化 → 重新 setData + fit(挂载态保留,连续浏览)。
 * - v13 渲染不全两修:①fit 需等节点 foreignObject 布局沉降,同步调用会按空/旧
   边界适配(首绘偶发裁切)→ 双 rAF 后 fit + 300ms 延迟补一次;②autoFit 关掉
   后用户展开折叠节点改变内容边界 → svg 点击后双 rAF 重适配,防展开内容出界。
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

/** v13 双 rAF 重适配(见文件头注释);fit 失败静默,不炸视图。 */
function refitSoon(mm: { fit: () => void } | null): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        mm?.fit();
      } catch {
        /* 忽略:detached svg 上的 fit 无害 */
      }
    }),
  );
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
    let lateTimer = 0;
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
          // v13 展开重适配:节点点击折叠/展开改变内容边界,autoFit 关着不管——
          // 点击后双 rAF 重 fit。监听器随 svg 元素生命周期(挂载态复用,不重复挂)
          svg.addEventListener("click", () => refitSoon(mmRef.current));
        }
        const { root } = new Transformer().transform(src);
        mmRef.current.setData(root);
        refitSoon(mmRef.current);
        // v13 首绘兜底:布局沉降偶发慢于两帧(长文 foreignObject),300ms 再补一次
        lateTimer = window.setTimeout(() => refitSoon(mmRef.current), 300);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(lateTimer);
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
