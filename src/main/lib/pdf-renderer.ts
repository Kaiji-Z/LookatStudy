/**
 * PDF 渲染器 —— 从 PDF 提取文字 + 嵌入图片,无需 canvas(纯 JS / WASM)。
 *
 * 核心洞察:pdfjs-dist 的渲染走 canvas(renderToCanvas),Node 没有 canvas。
 * 但图片提取走 getOperatorList() —— 不需要 canvas,直接拿 PDF 内嵌的图片对象。
 * 这覆盖所有场景:
 *   - 纯文字 PDF → getTextContent 提文字,无图片对象
 *   - 纯图片 PDF(扫描件/幻灯片)→ 文字层为空,整页是一个大图片对象
 *   - 混合 PDF → 文字 + 内嵌示意图都拿到
 *
 * RGBA → PNG 用纯 JS 编码(Node 内置 zlib 做 deflate),零原生依赖。
 *
 * 纯函数设计:classifyPdfPageByTextRatio / encodePng 可脱离 pdfjs 直接测。
 * processPdf 本身用 pdfjs(动态 import,避免打包时解析 worker)。
 */
import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";

/** 图片提取结果 */
export interface ExtractedImage {
  /** PNG buffer(已编码) */
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** 来源页码(1-based) */
  pageNumber: number;
}

/** PDF 处理结果 */
export interface PdfProcessResult {
  /** 提取的文字层(纯文字 PDF 这是全部内容;混合 PDF 这是文字部分) */
  text: string;
  /** 提取的图片(纯图片 PDF 是每页整页;混合 PDF 是内嵌示意图) */
  images: ExtractedImage[];
}

/**
 * 根据文字字符数和页数判断 PDF 形态。
 * 纯函数,便于测试(不依赖 pdfjs)。
 *
 * 启发式:
 *   - 文字密度 = 总字符数 / 页数
 *   - 每页 < 50 字符 → 极可能是纯图片(扫描件/幻灯片截图)
 *   - 每页 ≥ 50 字符 → 文字为主(可能含内嵌图)
 */
export function classifyPdfPageByTextRatio(
  totalChars: number,
  pageCount: number,
): "text-heavy" | "image-heavy" | "mixed" {
  if (pageCount === 0) return "text-heavy";
  const charsPerPage = totalChars / pageCount;
  // 阈值:50 字符/页。一张扫描页通常 OCR 前文字层为空(0 字符),
  // 一页正常正文至少几百字符。50 是宽容线。
  if (charsPerPage < 50) return "image-heavy";
  // 文字为主,但可能混合(有内嵌图)——下游提取图片对象时自然区分
  return "text-heavy";
}

/* ============================================================
 * 纯 JS PNG 编码器 —— RGBA Uint8Array → PNG Buffer
 * 用 Node 内置 zlib deflate,零原生依赖。
 * ============================================================ */

/** CRC32 表(懒初始化) */
let _crcTable: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  _crcTable = t;
  return t;
}

/** 算一段字节 + 前 CRC 的 CRC32 */
function crc32(buf: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG chunk: [length(4)][type(4)][data][crc(4)] */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  // CRC 覆盖 type + data
  const crcInput = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crcVal = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([lengthBuf, typeBytes, Buffer.from(data), crcBuf]);
}

/**
 * 编码 RGBA Uint8Array 为 PNG Buffer。
 *
 * @param rgba 宽×高×4 字节(RGBA 顺序,alpha 在第 4 字节)
 * @param width 像素宽
 * @param height 像素高
 * @returns PNG Buffer
 *
 * 纯函数,可直接测试(编码 → 用 pngjs 解码验证,或不依赖外部库手验魔数)。
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: rgba 长度 ${rgba.length} != ${width}*${height}*4=${width * height * 4}`);
  }
  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR: width(4) height(4) bitDepth(1) colorType(1) compression(1) filter(1) interlace(1)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression (deflate)
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace (none)
  // IDAT: 每行前加 filter byte(0=None),然后 deflate
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    const srcStart = y * stride;
    rgba.subarray(srcStart, srcStart + stride).forEach((b, i) => {
      raw[y * (stride + 1) + 1 + i] = b;
    });
  }
  const compressed = deflateSync(raw);
  // 组装
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * 把任意格式的 pdfjs 图片数据归一成 RGBA Uint8Array。
 * pdfjs 图片对象可能有:
 *   - {kind: ImageKind.RGBA_32BPP, width, height, data} — 直接用
 *   - {kind: ImageKind.RGB_24BPP, width, height, data} — RGB→RGBA 补 alpha
 *   - {kind: 1(GRAYSCALE_1BPP), ...} — 少见,转 RGBA
 *   - {data: Uint8ClampedArray, ...} — 已是 RGBA(渲染产物)
 */
function normalizeToRgba(
  img: { kind?: number; width: number; height: number; data: Uint8Array | Uint8ClampedArray },
): { rgba: Uint8Array; width: number; height: number } {
  const { width, height } = img;
  const data = new Uint8Array(img.data); // 归一成 Uint8Array
  // 多数情况:data 长度 = w*h*4 → 当 RGBA
  if (data.length >= width * height * 4) {
    return { rgba: data.subarray(0, width * height * 4), width, height };
  }
  // data 长度 = w*h*3 → RGB,补 alpha=255
  if (data.length >= width * height * 3) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
    return { rgba, width, height };
  }
  // 兜底:灰度或其他,逐像素重复成灰 RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = data[i] ?? 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width, height };
}

/**
 * 处理一个 PDF:提取文字 + 嵌入图片。
 *
 * 用 pdfjs-dist 的 getDocument + getTextContent + getOperatorList。
 * 不渲染到 canvas(纯 JS,无需 canvas 依赖)。
 *
 * @param pdfBuffer PDF 文件的 Buffer
 * @param onProgress 可选进度回调(已处理页数,总页数)
 * @returns { text, images }
 */
export async function processPdf(
  pdfBuffer: Buffer,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfProcessResult> {
  // 动态 import pdfjs(避免打包时解析 worker 入口)
  const pdfjs = await import("pdfjs-dist");
  // pdfjs-dist v4 在 Node 无 DOM worker 时会 fallback 到主线程同步执行。
  // 设置 workerSrc 为 worker 文件路径(Electron 主进程可加载本地文件)。
  // 不设会警告但不阻塞(某些版本用伪 worker 兜底)。
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  } catch {
    /* 解析失败时用伪 worker 兜底,不阻塞 */
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    // 少加载一些次要资源
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const total = doc.numPages;
  let text = "";
  const images: ExtractedImage[] = [];

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    onProgress?.(pageNum, total);
    const page = await doc.getPage(pageNum);

    // 1. 提文字(TextItem 有 str,TextMarkedContent 没有)
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (pageText) {
      text += (text ? "\n\n" : "") + `--- Page ${pageNum} ---\n${pageText}`;
    }

    // 2. 提图片对象(从 operator list)
    try {
      const ops = await page.getOperatorList();
      const OPS = pdfjs.OPS;
      const fnArray = ops.fnArray as number[];
      const argsArray = ops.argsArray as unknown[][];
      // paintImageXObject: [objId, width, height]
      // paintInlineImageXObject: [imgObject{width,height,data,...}]
      // paintImageMaskXObject: 掩码图(跳过,通常不是教学内容)
      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i] ?? [];
        if (fn === OPS.paintImageXObject) {
          const [objId, w, h] = args as [string, number, number];
          if (!objId || typeof objId !== "string") continue;
          // 从 page commonObjs 拿图片(异步→同步等待)
          let resolved: { width: number; height: number; data: Uint8Array | Uint8ClampedArray } | null = null;
          try {
            const obj = await page.objs.get(objId);
            if (obj && typeof obj === "object" && "data" in obj && "width" in obj) {
              resolved = obj as { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
            }
          } catch {
            /* 单个图片对象拿不到跳过 */
          }
          if (resolved && resolved.data.length > 0 && (resolved.width ?? w) > 1 && (resolved.height ?? h) > 1) {
            const norm = normalizeToRgba({
              width: resolved.width || w,
              height: resolved.height || h,
              data: resolved.data,
            });
            // 跳过极小图片(< 32x32,通常是 logo/图标,非教学内容)
            if (norm.width >= 32 && norm.height >= 32) {
              const buf = encodePng(norm.rgba, norm.width, norm.height);
              images.push({
                buffer: buf,
                mimeType: "image/png",
                width: norm.width,
                height: norm.height,
                pageNumber: pageNum,
              });
            }
          }
        } else if (fn === OPS.paintInlineImageXObject) {
          const [imgObj] = args as [{ width: number; height: number; data: Uint8Array | Uint8ClampedArray }];
          if (imgObj && imgObj.data && imgObj.width > 1 && imgObj.height > 1) {
            const norm = normalizeToRgba({ width: imgObj.width, height: imgObj.height, data: imgObj.data });
            if (norm.width >= 32 && norm.height >= 32) {
              const buf = encodePng(norm.rgba, norm.width, norm.height);
              images.push({
                buffer: buf,
                mimeType: "image/png",
                width: norm.width,
                height: norm.height,
                pageNumber: pageNum,
              });
            }
          }
        }
      }
    } catch {
      /* operator list 失败跳过,文字已拿到 */
    }
  }

  // 清理
  try {
    await doc.destroy();
  } catch {
    /* 忽略 */
  }

  return { text, images };
}
