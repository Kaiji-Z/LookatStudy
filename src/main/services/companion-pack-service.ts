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
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { settings as settingsTable } from "../db/schema.js";
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

/** T1 定位 prompt:尺寸注入,要求只回 JSON。折线=无脖子角色的头身交界(SPEC §16.6)。 */
function locatePrompt(W: number, H: number): string {
  return [
    `你是图像部件定位器。图中是一个Q版角色的站姿立绘(画布 ${W}x${H} 像素)。`,
    `只输出一个 JSON 对象,格式:`,
    `{"headY": <头与身体分界的y像素>, "boxes": {"head": [x,y,w,h], "armL": [x,y,w,h], "armR": [x,y,w,h]}, "headBoundary": [[x,y],...]}`,
    `headY=头部(含头发/耳朵/头饰)最底端与身体交界处的 y 坐标;`,
    `armL=画面左侧手臂(肩到指尖)的最小外接矩形;armR=画面右侧手臂;head=头部最小外接矩形。`,
    `headBoundary=仅当角色没有明显脖子(头直接坐在身体上,如熊/团子)时给出:沿头身交界线`,
    `从左到右均匀取 8~16 个 [x,y] 点,坐标用 0~1 小数(相对原图宽高),首尾点要到达头部左右边缘;`,
    `有脖子的角色省略 headBoundary。坐标基于原图尺寸;armL/armR 的矩形不得包含躯干;部件不存在则省略该键。不要输出其他文字。`,
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
          { maxOutputTokens: 1400 },
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

/* ---------------- 持久化(userData/companion-packs/,settings 行驱动) ---------------- */

type PackDb = Parameters<typeof resolveVisionLlm>[0];

function settingOf(db: PackDb, key: string): string | null {
  return db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()?.value ?? null;
}

function setSettingRaw(db: PackDb, key: string, value: string): void {
  db.insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
    .run();
}

const ACTIVE_ID_KEY = "companion_pack_active";
const ACTIVE_NAME_KEY = "companion_pack_name";
const FORM_KEY = "companion_form";

export function companionPackDir(dataDir: string, id: string): string {
  // id 恒为服务端生成的 "custom-<hash8>",无穿越面;仍白名单防御
  if (!/^custom-[a-z0-9]{8}$/.test(id)) throw new Error(`非法包 id: ${id}`);
  return path.join(dataDir, "companion-packs", id);
}

export interface CompanionPackApplyInput {
  name: string;
  manifest: CutPackManifest;
  parts: Array<{ name: string; pngBase64: string }>;
}

export interface CompanionPackApplyResult {
  id: string;
  name: string;
}

/**
 * 应用切分包:写盘 + settings 行记激活。id=内容哈希(同名同图重应用=幂等覆盖)。
 * 部件名白名单(PartName|sticker),文件名不做任何用户输入拼接。
 */
export function applyCompanionPack(
  db: PackDb,
  dataDir: string,
  input: CompanionPackApplyInput,
): CompanionPackApplyResult {
  const hash = createHash("sha256").update(input.name).update(JSON.stringify(input.manifest)).digest("hex").slice(0, 8);
  const id = `custom-${hash}`;
  const dir = companionPackDir(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const validNames = new Set(Object.keys(input.manifest.parts));
  for (const part of input.parts) {
    if (!validNames.has(part.name)) throw new Error(`部件名不在 manifest 内: ${part.name}`);
    const entry = input.manifest.parts[part.name as keyof typeof input.manifest.parts];
    if (!entry) continue;
    fs.writeFileSync(path.join(dir, entry.file), Buffer.from(part.pngBase64, "base64"));
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(input.manifest, null, 2));
  setSettingRaw(db, ACTIVE_ID_KEY, id);
  setSettingRaw(db, ACTIVE_NAME_KEY, input.name);
  return { id, name: input.name };
}

export interface ActiveCompanionPack {
  id: string;
  name: string;
  manifest: CutPackManifest;
  /** 部件名 → dataURL(渲染层 <image href> 直用) */
  srcs: Record<string, string>;
}

/** 读激活包(无包/文件丢失 → null,渲染层诚实占位)。 */
export function getActiveCompanionPack(db: PackDb, dataDir: string): ActiveCompanionPack | null {
  const id = settingOf(db, ACTIVE_ID_KEY);
  if (!id) return null;
  const dir = companionPackDir(dataDir, id);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  let manifest: CutPackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CutPackManifest;
  } catch {
    return null;
  }
  const srcs: Record<string, string> = {};
  for (const [name, entry] of Object.entries(manifest.parts) as Array<[string, { file: string }]>) {
    const file = path.join(dir, entry.file);
    if (!fs.existsSync(file)) continue;
    srcs[name] = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  }
  if (Object.keys(srcs).length === 0) return null;
  return { id, name: settingOf(db, ACTIVE_NAME_KEY) ?? id, manifest, srcs };
}

export interface CompanionPackDeleteResult {
  ok: boolean;
  /** 激活形态是 custom 时重置为 ember */
  formReset: boolean;
}

export function deleteActiveCompanionPack(db: PackDb, dataDir: string): CompanionPackDeleteResult {
  const id = settingOf(db, ACTIVE_ID_KEY);
  if (id) {
    const dir = companionPackDir(dataDir, id);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  setSettingRaw(db, ACTIVE_ID_KEY, "");
  setSettingRaw(db, ACTIVE_NAME_KEY, "");
  let formReset = false;
  if (settingOf(db, FORM_KEY) === "custom") {
    setSettingRaw(db, FORM_KEY, "ember");
    formReset = true;
  }
  return { ok: true, formReset };
}
