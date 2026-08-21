/**
 * pdf-page-image —— PDF 整页渲染(v0.20 P6)。
 *
 * @napi-rs/canvas(预编译 napi,与 pdf-inspector 同类先例)给主进程补上 canvas,
 * pdfjs-dist legacy 把整页画成 PNG —— vision 转写公式密集页的取图源。
 * 关键胶水:pdfjs 的字形填充用**全局 Path2D**,@napi-rs/canvas 有类但不挂全局,
 * 必须在 import pdfjs 之前补上(spike 实测)。
 * 同模块还提供逐页文本(getTextContent),密集页检测与文本层合并共用一次解析。
 * 每页渲染独立 try/catch:单页失败返回 null,绝不让整本导入挂掉。
 */
import { existsSync } from "node:fs";
import { join, sep } from "node:path";

export interface PdfPageImage {
  pageIndex: number;
  png: Uint8Array;
}

/** 打开一次文档:逐页文本 + 惰性整页渲染。用完必须 dispose(worker 持有资源)。 */
export interface PdfPageContext {
  pageCount: number;
  pageText(i: number): Promise<string>;
  /** 渲染单页(scale 2 ≈ 154dpi,公式够清晰);失败返回 null。 */
  renderPage(i: number, scale?: number): Promise<Uint8Array | null>;
  dispose(): Promise<void>;
}

/** pdfjs base-14 字体目录(存在才返回,双环境:打包 dist-electron / tsx cwd)。 */
function standardFontDir(): string | undefined {
  const candidates = [
    join(__dirname, "..", "..", "node_modules", "pdfjs-dist", "standard_fonts"),
    join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts"),
  ];
  for (const c of candidates) if (existsSync(c)) return c + sep;
  return undefined;
}

export async function openPdfPages(data: Uint8Array): Promise<PdfPageContext> {
  // 动态加载(重依赖):不走 vision 的导入永远不加载 canvas/pdfjs 渲染器
  const { createCanvas, Path2D } = await import("@napi-rs/canvas");
  // pdfjs 字形填充读全局 Path2D(@napi-rs/canvas 不自动挂)—— spike 实测必坑
  (globalThis as { Path2D?: unknown }).Path2D = Path2D;
  // 与 lib/pdf-renderer.ts 同入口(bare "pdfjs-dist",打包链已被 PDF 图片提取验证)
  const pdfjs = await import("pdfjs-dist");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    // base-14 字体兜底(嵌入字体的真实 PDF 不需要;目录不对时 pdfjs 仅告警不炸)。
    // 候选双路径:打包后 __dirname=dist-electron/main → 仓库 node_modules;
    // tsx 直跑(verify)时 __dirname 在源码树 → 退 process.cwd() 的 node_modules。
    standardFontDataUrl: standardFontDir(),
  }).promise;

  const textCache = new Map<number, string>();
  return {
    pageCount: doc.numPages,
    async pageText(i) {
      const hit = textCache.get(i);
      if (hit !== undefined) return hit;
      const page = await doc.getPage(i + 1);
      const tc = await page.getTextContent();
      const t = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
      textCache.set(i, t);
      return t;
    },
    async renderPage(i, scale = 2) {
      try {
        const page = await doc.getPage(i + 1);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const buf = canvas.toBuffer("image/png");
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch {
        return null; // 单页失败不炸整本(文本层兜底)
      }
    },
    async dispose() {
      try {
        await doc.destroy();
      } catch {
        /* 已销毁 */
      }
    },
  };
}
