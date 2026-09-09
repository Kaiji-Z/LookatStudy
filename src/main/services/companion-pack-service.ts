/**
 * companion-pack-service —— 免费层供给管线主进程服务(SPEC §14/§15)。
 *
 * 输入一张不重叠 A-pose/T-pose 立绘 PNG,降级链产出可入库的切分包:
 *   T1 vision    — 用户配了多模态 key:VLM 指认部件 bbox(归一化坐标),管线
 *                  按 bbox 划分掩码("部位不重叠 = 必可切",不依赖腋缝);
 *   T2 geometric — 无 key:颈线 + 缝带逐行切(纯几何,见 shared/companion-cut.ts);
 *   T3 l1        — 都失败:整图 + 白描边作单件贴纸(恒成功)。
 *
 * 识图定位是注入式(deps.locate):生产 = resolveVisionLlm + generateTextWithTimeout,
 * verify 注入 mock 文本 —— 本文件不进 verify 导入链(它经 llm-client 连 DB)。
 */
import { resolveVisionLlm } from "./agent/llm-client.js";
import { generateTextWithTimeout } from "./import-llm-service.js";
import {
  keyFigure,
  routeCut,
  addWhiteOutline,
  parseAnchorsJson,
  type Anchors,
  type Box,
  type CutPackManifest,
  type CutRoute,
  type RgbaImage,
} from "@shared/companion-cut";

type VisionDb = Parameters<typeof resolveVisionLlm>[0];

/**
 * @napi-rs/canvas 一律动态导入:它在 serve 束里是 external(Android 无预编译),
 * 顶层静态导入会让 server.cjs 裸起即 MODULE_NOT_FOUND(verify-serve 实测)。
 * 与 pdf-page-image 的懒加载回退模式同款。
 */
async function napi(): Promise<typeof import("@napi-rs/canvas")> {
  return import("@napi-rs/canvas");
}

export interface CompanionCutDeps {
  db: VisionDb;
  /** 识图定位(注入;默认 = resolveVisionLlm + generateTextWithTimeout)。入参 = 图的 data URL,返回 VLM 原文。 */
  locate?: (imageDataUrl: string) => Promise<string>;
  /** 跳过 T1(未配多模态 key / 测试) */
  skipVision?: boolean;
}

export interface CompanionCutInput {
  png: Buffer | Uint8Array;
  id?: string;
  name?: string;
}

export interface CompanionCutOutputPart {
  name: string;
  file: string;
  box: Box;
  /** PNG 字节(部件已加白描边) */
  png: Uint8Array;
}

export interface CompanionCutOutput {
  route: CutRoute;
  failure?: string;
  parts: CompanionCutOutputPart[];
  manifest: CutPackManifest;
}

/** T1 定位 prompt:尺寸注入,要求只回 JSON。 */
function locatePrompt(W: number, H: number): string {
  return [
    `你是图像部件定位器。图中是一个Q版角色的站姿立绘(画布 ${W}x${H} 像素)。`,
    `只输出一个 JSON 对象,格式:`,
    `{"headY": <头与身体分界的y像素>, "boxes": {"head": [x,y,w,h], "armL": [x,y,w,h], "armR": [x,y,w,h]}}`,
    `headY=头部(含头发/耳朵/头饰)最底端与身体交界处的 y 坐标;`,
    `armL=画面左侧手臂(肩到指尖)的最小外接矩形;armR=画面右侧手臂;head=头部最小外接矩形。`,
    `坐标用整数像素,基于原图尺寸。armL/armR 的矩形不得包含躯干;部件不存在则省略该键。不要输出其他文字。`,
  ].join("\n");
}

function rgbaOfPng(png: Buffer | Uint8Array): Promise<RgbaImage> {
  return (async () => {
    const { loadImage, createCanvas } = await napi();
    const img = await loadImage(Buffer.isBuffer(png) ? png : Buffer.from(png));
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  })();
}

async function rgbaToPng(img: RgbaImage): Promise<Uint8Array> {
  const { createCanvas, ImageData } = await napi();
  const cv = createCanvas(img.width, img.height);
  cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Uint8Array(await cv.encode("png"));
}

/**
 * 切分主入口。降级链 T1→T2→T3,每级机器可判定;任何一级失败落到下一级,
 * T3 恒成功(整图贴纸)。
 */
export async function cutCompanionFigure(
  deps: CompanionCutDeps,
  input: CompanionCutInput,
): Promise<CompanionCutOutput> {
  const rgba = await rgbaOfPng(input.png);
  const W = rgba.width;
  const H = rgba.height;

  // T1 识图定位(key 缺失/模型不可用/解析失败 → anchors=null 落 T2)
  let anchors: Anchors | null = null;
  if (!deps.skipVision) {
    const locate =
      deps.locate ??
      (async (dataUrl: string) => {
        const llm = resolveVisionLlm(deps.db);
        return generateTextWithTimeout(
          llm.languageModel,
          [
            {
              role: "user",
              content: [
                { type: "text", text: locatePrompt(W, H) },
                { type: "image", image: dataUrl },
              ],
            },
          ],
          { maxOutputTokens: 1000 },
        );
      });
    try {
      const dataUrl = `data:image/png;base64,${Buffer.from(pngBytesOf(input)).toString("base64")}`;
      anchors = parseAnchorsJson(await locate(dataUrl), W, H);
    } catch {
      anchors = null;
    }
  }

  const result = routeCut(rgba, { anchors });
  const mode = keyFigure(rgba).mode;

  if (result.route === "l1") {
    // T3:整图贴纸(白描边),永不出错
    const outlined = addWhiteOutline(rgba, Math.max(3, Math.round(Math.min(W, H) * 0.008)));
    const png = await rgbaToPng(outlined);
    const box: Box = { x: 0, y: 0, w: W, h: H };
    return {
      route: "l1",
      failure: result.failure,
      parts: [{ name: "sticker", file: "sticker.png", box, png }],
      manifest: {
        formatVersion: 1,
        kind: "companion-cut",
        source: { width: W, height: H, keyMode: mode, route: "l1" },
        parts: { sticker: { file: "sticker.png", box } },
      },
    };
  }

  // T1/T2:部件白描边 + PNG
  const outlineRadius = Math.max(3, Math.round(Math.min(W, H) * 0.006));
  const files: CutPackManifest["parts"] = {};
  const outParts: CompanionCutOutputPart[] = [];
  for (const part of result.parts) {
    const png = await rgbaToPng(addWhiteOutline({ width: part.box.w, height: part.box.h, data: part.rgba }, outlineRadius));
    const file = `${part.name}.png`;
    files[part.name] = { file, box: part.box };
    outParts.push({ name: part.name, file, box: part.box, png });
  }
  const manifest: CutPackManifest = {
    formatVersion: 1,
    kind: "companion-cut",
    source: { width: W, height: H, keyMode: mode, route: result.route },
    parts: files,
  };
  return { route: result.route, parts: outParts, manifest };
}

function pngBytesOf(input: CompanionCutInput): Uint8Array {
  return Buffer.isBuffer(input.png) ? new Uint8Array(input.png) : input.png;
}
