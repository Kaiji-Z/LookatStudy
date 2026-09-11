/**
 * PNG 像素进出收口 —— 双后端(napi canvas 优先,pngjs 纯 JS 兜底)。
 *
 * 为什么存在:@napi-rs/canvas 只发桌面平台预编译,Android(Termux 手机端)没有
 * ——顶层静态导入会让 server.cjs 裸起即 MODULE_NOT_FOUND,调用时动态导入也会抛。
 * 本模块把"解码 RGBA / 编码 PNG"收成两个口,业务层不感知后端:
 *   - 解码:PNG 是无损标准,两个后端对 8 位图产出逐字节相同的 RGBA
 *     (16 位源两者都降到 8 位,舍入策略可能差 ±1,AI 生成图均为 8 位,不受影响);
 *   - 编码:无损,像素一致;文件字节/体积可能不同(压缩器策略不同),无影响。
 * 切分管线的一切"决策"(切分线/rest 角/白描边)消费解码后的像素,因此手机端
 * 与电脑端产出相同的包(verify-companion-png T4 用同一 fixture 双后端全链对拍)。
 *
 * LOOKATSTUDY_PNG_BACKEND=pure 强制纯 JS 路径(对拍测试用;Android 上 napi
 * 本来就会失败自动落纯 JS,不需要设)。
 */
import { PNG } from "pngjs";

import type { RgbaImage } from "@shared/companion-cut";

/**
 * 截掉 IEND 之后的杂尾字节。pngjs 的 SyncReader 是严格解析器:IEND 后还剩
 * 任何字节就抛 "unrecognised content at end of stream"(v0.31.1 手机真机首刀
 * 即踩:生成站出的 PNG 常在 IEND 后带元数据/填充尾巴),而桌面 skia 宽容——
 * 这类文件在桌面正常、手机必炸。按 chunk 结构(4B length + 4B type + data +
 * 4B CRC)走到 IEND 截断;结构走不动(截断/坏块)就原样交回,让 pngjs 抛它
 * 自己的错,不吞真实损坏。
 */
function truncateAfterIend(buf: Buffer): Buffer {
  let off = 8; // PNG 签名 8 字节
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const end = off + 12 + len;
    if (end > buf.length) return buf;
    if (type === "IEND") return buf.subarray(0, end);
    off = end;
  }
  return buf;
}

/** 纯 JS 后端(pngjs):Buffer/Uint8Array → RGBA。palette/灰度/RGB/Adam7 全支持。 */
export function decodePngPure(png: Buffer | Uint8Array): RgbaImage {
  const buf = truncateAfterIend(Buffer.isBuffer(png) ? png : Buffer.from(png));
  const img = PNG.sync.read(buf);
  return { width: img.width, height: img.height, data: img.data };
}

/** 纯 JS 后端:RGBA → PNG(8 位 RGBA,colorType 6),无损。返回 Buffer(pngjs 原生)。 */
export function encodePngPure(img: RgbaImage): Uint8Array {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(png);
}

/** 是否强制纯 JS 后端(测试对拍用)。 */
export function wantPureBackend(): boolean {
  return process.env.LOOKATSTUDY_PNG_BACKEND === "pure";
}

let warnedFallback = false;

/** napi 失败时提示一次(不刷屏);Termux 上首刀即纯 JS 属预期,不算异常。 */
export function noteFallbackOnce(err: unknown): void {
  if (warnedFallback) return;
  warnedFallback = true;
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[companion-png] napi canvas 不可用,本次与后续落纯 JS PNG 后端:${msg.slice(0, 120)}`);
}

/**
 * 面积平均降采样(box filter,预乘 alpha 域平均后还原)——缩略图等所有缩放的
 * 唯一路径,全平台逐像素一致。透明像素的 RGB 不 bleed(预乘后加权,再除回)。
 */
export function resizeBox(img: RgbaImage, dw: number, dh: number): RgbaImage {
  const sw = img.width;
  const sh = img.height;
  const src = img.data;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy0 = (y * sh) / dh;
    const fy1 = ((y + 1) * sh) / dh;
    const iy0 = Math.floor(fy0);
    const iy1 = Math.min(sh, Math.max(iy0 + 1, Math.ceil(fy1)));
    for (let x = 0; x < dw; x++) {
      const fx0 = (x * sw) / dw;
      const fx1 = ((x + 1) * sw) / dw;
      const ix0 = Math.floor(fx0);
      const ix1 = Math.min(sw, Math.max(ix0 + 1, Math.ceil(fx1)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        for (let sx = ix0; sx < ix1; sx++) {
          const i = (sy * sw + sx) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += src[i + 3];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (n === 0) continue;
      const am = a / n;
      out[o + 3] = Math.round(am);
      if (am > 0) {
        // 预乘域均值还原:src≤255·al 保证结果 ≤255
        out[o] = Math.round(r / n / (am / 255));
        out[o + 1] = Math.round(g / n / (am / 255));
        out[o + 2] = Math.round(b / n / (am / 255));
      }
    }
  }
  return { width: dw, height: dh, data: out };
}
