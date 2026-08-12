/**
 * PDF 文本提取路由 —— 优先 pdf-inspector(layout-aware markdown), 失败回退 pdf-parse。
 *
 * 为什么需要路由: pdf-inspector 是预编译 napi-rs, 只 ship
 * darwin-arm64 / win32-x64-msvc / linux-x64+arm64; Intel Mac / Windows ARM 上
 * require 会抛。任何解析异常也不能让整个 PDF 导入挂。两层兜底: 平台不支持或解析崩
 * → pdf-parse 接管(老库, 扁平文本, 但全平台可用)。
 *
 * 环境变量 LOOKATSTUDY_NO_PDF_INSPECTOR=1 强制走 pdf-parse(测试/调试/手动回退)。
 *
 * 职责边界: PDF **图片**提取不在此处 —— 那是 lib/pdf-renderer.ts processPdf 的职责
 * (生产里只取它的 images, text 丢弃)。本文件只管**文本座**, 替换原 local-folder-scanner
 * 里对 pdf-parse 的直接调用。
 *
 * 局限(诚实): pdf-inspector 不解码数学公式(实测把 attention 公式提成语义错乱碎片),
 * 这是文本层赛道的本质局限, 非 bug。STEM 数学密集教材的正确路径是未来的 vision 渲染喂图,
 * 不在本文件职责内。
 */
export async function parsePdfText(buf: Buffer): Promise<string> {
  if (!process.env.LOOKATSTUDY_NO_PDF_INSPECTOR) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pi = require("@firecrawl/pdf-inspector");
      const result = await pi.processPdfAsync(buf);
      const md = (result?.markdown ?? "").trim();
      if (md) return md;
    } catch {
      /* 平台不支持 / 解析崩 → 回退 pdf-parse */
    }
  }
  // pdf-parse 兜底: 老 lib, 生产 node/Electron 下正常; 但其内置 webpack 版 pdfjs 在
  // tsx/esbuild 下 require 会抛(测试环境伪影, 非生产问题)。任何失败 → 返回空串,
  // 让上游 scanFolder 当"无文本"处理, 不让单个 PDF 崩掉整个导入。
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
    return (await pdfParse(buf)).text.trim();
  } catch {
    return "";
  }
}
