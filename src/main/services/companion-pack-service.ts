/**
 * companion-pack-service —— 免费层供给管线主进程服务(SPEC §17)。
 *
 * 输入一张不重叠 A-pose/T-pose 立绘 PNG,降级链产出可入库的切分包:
 *   vision — 键控先行 → 键控预览(深灰底)喂 VLM → VLM 声明切分线(背景到背景
 *            的折线)→ 机器校验链 → 栅栏 BFS 划分(臂可缺席,两件套合法);
 *   l1     — 无 key / VLM 失败 / headBody 无效:整图 + 白描边作单件贴纸(恒成功)。
 *   旧几何中间层已退役(SPEC §17.6)。
 *
 * 识图定位是注入式(deps.locate):生产 = resolveVisionLlm + generateTextWithTimeout,
 * verify/ui-test 注入 mock 文本 —— 本文件不进 verify 导入链(它经 llm-client 连 DB)。
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
  applyFigureKey,
  composeKeyedPreview,
  parseCutsJson,
  locatePrompt,
  type Box,
  type CutPackManifest,
  type CutRoute,
  type CutCurves,
  type FigureMask,
  type RgbaImage,
} from "@shared/companion-cut";
import { decodePngPure, encodePngPure, noteFallbackOnce, resizeBox, wantPureBackend } from "./pure/png-codec.js";

type VisionDb = Parameters<typeof resolveVisionLlm>[0];

/**
 * @napi-rs/canvas 一律动态导入:它在 serve 束里是 external(Android 无预编译),
 * 顶层静态导入会让 server.cjs 裸起即 MODULE_NOT_FOUND(verify-serve 实测)。
 * 与 pdf-page-image 的懒加载回退模式同款。
 */
async function napi(): Promise<typeof import("@napi-rs/canvas")> {
  return import("@napi-rs/canvas");
}

/** 识图定位首发的输出上限:glm-5.3-flash 开思考时推理过程计入输出,6k 曾把
 *  JSON 掐断(用户实测放大到 128k)。部分 key 档位不允许这么大的输出上限,
 *  端点不报错而是秒回 200 空 → 空回复自动降档 8k 重试一次(cutCompanionFigure)。 */
const LOCATE_MAX_TOKENS = 128000;
const LOCATE_RETRY_TOKENS = 8192;

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
  /** 识图通道尝试过但失败的原因(401/超时/解析失败等);null=未尝试或成功 */
  visionError?: string;
  parts: CompanionCutOutputPart[];
  manifest: CutPackManifest;
}

/** vision 定位 prompt:shared 单源(v9 切分线协议,SPEC §17.1/§17.9)。 */

/**
 * 像素进出双后端(2026-09-11,Termux 手机端可用):napi 优先(桌面字节路径零
 * 变化),失败或 LOOKATSTUDY_PNG_BACKEND=pure 落 pngjs 纯 JS。两个后端解码逐
 * 字节一致、编码无损 —— 切分决策只消费像素,手机端与电脑端产出相同的包
 * (verify-companion-png T4 同 fixture 双后端全链对拍)。
 */
function rgbaOfPng(png: Buffer | Uint8Array): Promise<RgbaImage> {
  const buf = Buffer.isBuffer(png) ? png : Buffer.from(png);
  return (async () => {
    if (!wantPureBackend()) {
      try {
        const { loadImage, createCanvas } = await napi();
        const img = await loadImage(buf);
        const cv = createCanvas(img.width, img.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
      } catch (e) {
        noteFallbackOnce(e);
      }
    }
    return decodePngPure(buf);
  })();
}

async function rgbaToPng(img: RgbaImage): Promise<Uint8Array> {
  if (!wantPureBackend()) {
    try {
      const { createCanvas, ImageData } = await napi();
      const cv = createCanvas(img.width, img.height);
      cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      return new Uint8Array(await cv.encode("png"));
    } catch (e) {
      noteFallbackOnce(e);
    }
  }
  return encodePngPure(img);
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

  // 键控先行(SPEC §17.5):掩码是唯一可信几何证据,VLM 预览图由它合成。
  // 键控失败(坏尺寸/空图)→ 直接 L1,不再尝试识图。
  let fm: FigureMask | null = null;
  try {
    fm = keyFigure(rgba);
  } catch {
    fm = null;
  }

  // vision 切分线(key 缺失/模型不可用/解析失败 → cuts=null 落 L1;
  // 失败原因透出给导入卡,静默降级曾让"key 没填"藏了两天)
  let cuts: CutCurves | null = null;
  let visionError: string | undefined;
  if (fm && !deps.skipVision) {
    const locateAt = async (dataUrl: string, maxOutputTokens: number) => {
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
        { maxOutputTokens },
      );
    };
    // 注入式 locate(verify/ui-test)维持单参签名;127k 首发见下
    const locate = deps.locate ?? ((dataUrl: string) => locateAt(dataUrl, LOCATE_MAX_TOKENS));
    try {
      // 喂键控预览(深灰底上的角色),不是原图 —— 与机器掩码逐像素同源。
      // 预览缩到长边 ≤768(2026-09-11 手机真机排查):VLM 只回归一化坐标,
      // 高分辨率对切分质量无益;而 2K 级原图(1664×2496,2.4MB)的几 MB
      // dataURL 在编码端点会秒回 200 空内容(同图聊天小图正常、桌面小图
      // 正常),顺带把桌面端 20s+ 的识图延迟砍到秒级。
      let preview = composeKeyedPreview(rgba, fm);
      const longest = Math.max(preview.width, preview.height);
      if (longest > 768) {
        const k = 768 / longest;
        preview = resizeBox(preview, Math.max(1, Math.round(preview.width * k)), Math.max(1, Math.round(preview.height * k)));
      }
      const previewPng = await rgbaToPng(preview);
      const dataUrl = `data:image/png;base64,${Buffer.from(previewPng).toString("base64")}`;
      let rawReply = await locate(dataUrl);
      cuts = parseCutsJson(rawReply, W, H);
      if (!cuts && !deps.locate && rawReply.trim() === "") {
        // 首发带 maxOutputTokens=128k:部分 key 档位不允许这么大的输出上限,
        // 端点不报错而是秒回 200 空内容(2026-09-11 手机真机:换新 key 后
        // 聊天看图正常、向导恒空)。空回复时降档 8k 重试一次——切分 JSON
        // 本体只有千余 token,8k 对关闭思考的机械提取绰绰有余。
        rawReply = await locateAt(dataUrl, LOCATE_RETRY_TOKENS);
        cuts = parseCutsJson(rawReply, W, H);
      }
      if (!cuts) {
        // 带出原文开头:端点秒回拒绝/空内容时,这是唯一能区分「key 档位没视觉」
        // 「端点剥离了图片」「模型答非所问」的证据(2026-09-11 手机真机排查)
        const head = rawReply.trim().slice(0, 120);
        visionError = `切分线解析失败(VLM 输出不含 cuts JSON)。回复开头:「${head || "(空)"}」`;
      }
    } catch (e) {
      cuts = null;
      visionError = String((e as Error).message ?? e).slice(0, 200);
    }
  }

  const result = routeCut(rgba, { cuts });
  const mode = fm?.mode ?? "alpha";

  if (result.route === "l1") {
    // L1:单件贴纸(白描边),永不出错。键控掩码在手就先抠背景并裁到内容 bbox
    // ——识图失败不该连带把绿幕背景贴出来,边距稀释也会让纸偶在舞台上缩水
    // (底部锚定的脚线=真脚;2026-09-11 真机反馈)。掩码空等异常回原图兜底。
    let base = rgba;
    let box: Box = { x: 0, y: 0, w: W, h: H };
    if (fm) {
      try {
        const keyed = applyFigureKey(rgba, fm);
        base = keyed.image;
        box = keyed.box;
      } catch {
        /* CUT_EMPTY 等防御性回退:原样整图 */
      }
    }
    const outlined = addWhiteOutline(base, Math.max(3, Math.round(Math.min(base.width, base.height) * 0.008)));
    const png = await rgbaToPng(outlined);
    return {
      route: "l1",
      failure: result.failure,
      visionError,
      parts: [{ name: "sticker", file: "sticker.png", box, png }],
      manifest: {
        formatVersion: 1,
        kind: "companion-cut",
        source: { width: W, height: H, keyMode: mode, route: "l1" },
        parts: { sticker: { file: "sticker.png", box } },
      },
    };
  }

  // vision:部件白描边 + PNG
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
  return { route: result.route, visionError, parts: outParts, manifest };
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
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...input.manifest, name: input.name }, null, 2));
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

/** 删除激活包(兼容入口:删的就是当前激活包)。 */
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

/* ---------------- 多 bot(2026-09-11):列表/切换/按 id 删 ---------------- */

export interface CompanionPackSummary {
  id: string;
  name: string;
  active: boolean;
  route: string;
  /** 主件缩略图 dataURL(形象栏卡片;生成失败缺省 → 渲染层占位)。 */
  thumb?: string;
  /** 载具主题(卡片色点;缺省 = silver)。 */
  vehicle?: string;
}

/** 列出磁盘上全部包(目录扫描,激活指针只标 active;按 激活优先+名字 排序)。 */
export function listCompanionPacks(db: PackDb, dataDir: string): { packs: CompanionPackSummary[] } {
  const activeId = settingOf(db, ACTIVE_ID_KEY);
  const root = path.join(dataDir, "companion-packs");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return { packs: [] };
  }
  const packs: CompanionPackSummary[] = [];
  for (const id of entries) {
    if (!/^custom-[a-z0-9]{8}$/.test(id)) continue;
    const manifestPath = path.join(root, id, "manifest.json");
    let manifest: CutPackManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CutPackManifest;
    } catch {
      continue;
    }
    // 旧包无 name 字段:回填默认名并写回(一次性,幂等)
    if (!manifest.name) {
      manifest.name = "自定义纸偶";
      try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      } catch {
        /* 写不进就仅本次展示用 */
      }
    }
    packs.push({
      id,
      name: manifest.name,
      active: id === activeId,
      route: manifest.source?.route ?? "l1",
      vehicle: manifest.vehicle,
    });
  }
  packs.sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name));
  return { packs };
}

/** 形象栏卡片缩略图:头件(贴纸档用整图)缩到 96px dataURL;失败返回 undefined。
 *  缩放走 resizeBox 面积平均(2026-09-11)——缩略图是双后端唯一视觉差异点,
 *  统一纯 JS 路径后全平台逐像素一致。 */
async function packThumb(dataDir: string, id: string): Promise<string | undefined> {
  try {
    const dir = path.join(dataDir, "companion-packs", id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as CutPackManifest;
    const pick = manifest.parts.head ?? manifest.parts.sticker ?? Object.values(manifest.parts)[0];
    if (!pick) return undefined;
    const img = await rgbaOfPng(fs.readFileSync(path.join(dir, pick.file)));
    const scale = 96 / Math.max(img.width, img.height);
    const small = resizeBox(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    const png = await rgbaToPng(small);
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch (e) {
    console.warn("[companion-pack] 缩略图生成失败:", String(e).slice(0, 160));
    return undefined;
  }
}

/** 列表 + 缩略图(形象栏卡片;缩略图逐包独立,失败不挡列表)。 */
export async function listCompanionPacksWithThumbs(db: PackDb, dataDir: string): Promise<{ packs: CompanionPackSummary[] }> {
  const { packs } = listCompanionPacks(db, dataDir);
  await Promise.all(
    packs.map(async (p) => {
      p.thumb = await packThumb(dataDir, p.id);
    }),
  );
  return { packs };
}

/** 切换激活包(包必须真实存在;名字以 manifest.name 为准)。 */
export function activateCompanionPack(db: PackDb, dataDir: string, id: string): { ok: boolean } {
  const dir = companionPackDir(dataDir, id);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`包不存在: ${id}`);
  let name = id;
  try {
    name = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CutPackManifest).name ?? id;
  } catch {
    /* 名字读不出就记 id */
  }
  setSettingRaw(db, ACTIVE_ID_KEY, id);
  setSettingRaw(db, ACTIVE_NAME_KEY, name);
  return { ok: true };
}

/** 按 id 删除;删的是激活包时清指针 + custom 形态回退 ember。 */
export function deleteCompanionPack(db: PackDb, dataDir: string, id: string): CompanionPackDeleteResult {
  const activeId = settingOf(db, ACTIVE_ID_KEY);
  const dir = companionPackDir(dataDir, id);
  fs.rmSync(dir, { recursive: true, force: true });
  let formReset = false;
  if (id === activeId) {
    setSettingRaw(db, ACTIVE_ID_KEY, "");
    setSettingRaw(db, ACTIVE_NAME_KEY, "");
    if (settingOf(db, FORM_KEY) === "custom") {
      setSettingRaw(db, FORM_KEY, "ember");
      formReset = true;
    }
  }
  return { ok: true, formReset };
}

const VEHICLE_IDS: ReadonlySet<string> = new Set(["silver", "ember", "frost", "moss", "astro", "ink"]);

/** 换载具主题(2026-09-11,形象栏卡片色点入口):只改 manifest.vehicle,其余不动。 */
export function setCompanionPackVehicle(dataDir: string, id: string, vehicle: string): { ok: boolean } {
  if (!VEHICLE_IDS.has(vehicle)) throw new Error(`未知载具主题: ${vehicle}`);
  const manifestPath = path.join(companionPackDir(dataDir, id), "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CutPackManifest;
  manifest.vehicle = vehicle as CutPackManifest["vehicle"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ok: true };
}
