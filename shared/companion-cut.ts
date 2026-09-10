/**
 * companion-cut —— 单图切分管线(免费层供给,纯函数层,SPEC §17)。
 *
 * 输入一张不重叠 A-pose/T-pose 立绘 RGBA,产出 头/身体/双臂(可降级)部件;
 * 切不动则降级 L1(整图贴纸)。范式(2026-09-10 用户拍板,SPEC §17):
 *   1. 键控先行:keyFigure 出掩码(唯一可信的几何证据);
 *   2. VLM 在键控预览图上声明"切分线"——折线从无像素处出发、沿部件真实分界、
 *      到无像素处结束;粘连的臂诚实给 null;
 *   3. 机器校验链(planCutCurves):端点外找背景、线要碰到角色(≥3 墙像素)、
 *      两线不交叉;
 *   4. 划分(partitionByCurves):切分线栅栏化成 8-连通墙,BFS 连通块 → 区域,
 *      最高像素区=头 / 最低=身 / 其余按质心分左右臂;面积 <4% 主体的小碎片
 *      并回 body;
 *   5. 分级降级:headBody 无效 → L1;armX 无效 → 臂留身体(两件套合法成功)。
 *   旧几何链(颈线/缝带/逐行切/box 划分)整体退役——除非未来引入优秀的开源
 *   分割模型,否则无识图时只留键控 → L1。
 *
 * 设计红线:shared 层,零 DOM/IPC 依赖,renderer/主进程/verify 同吃一份真源。
 */

import type { CompanionPackManifest } from "./companion-pack.ts";

/* ---------------- 基础类型 ---------------- */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA,长度 = w*h*4 */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type KeyMode = "alpha" | "green";

export interface FigureMask {
  mode: KeyMode;
  width: number;
  height: number;
  /** 全图坐标 0/1 掩码 */
  mask: Uint8Array;
  /** 主体 bbox(全图坐标) */
  main: Box;
  /** 过滤噪点后的显著连通块数(主体自身不计入多余判定,恒 ≥1) */
  significantComponents: number;
}

export type PartName = "head" | "body" | "armL" | "armR";

export interface CutPart {
  name: PartName;
  /** 部件在全图中的 bbox */
  box: Box;
  /** 裁剪到 bbox 的 RGBA(部件外 alpha=0) */
  rgba: Uint8ClampedArray;
}

/** 老包 manifest 兼容保留三值;新管线只发 vision | l1。 */
export type CutRoute = "vision" | "geometric" | "l1";

export interface CutFailure {
  route: "l1";
  reason: "NO_HEAD_CUT" | "TOO_FEW_PARTS";
}

/** 折线(全图像素坐标;parseCutsJson 产出)。 */
export type Poly = Array<{ x: number; y: number }>;

/** VLM 切分线声明(协议原文见 SPEC §17.1;臂粘连 → armX 为 null)。 */
export interface CutCurves {
  headBody: Poly | null;
  armLeft: Poly | null;
  armRight: Poly | null;
}

/** 校验后的切分计划(headBody 必有效;armX 通过校验才在场)。 */
export interface CutPlan {
  headBody: Poly;
  armLeft: Poly | null;
  armRight: Poly | null;
}

export interface CutResult {
  route: CutRoute;
  parts: CutPart[];
  /** route=l1 时的失败原因 */
  failure?: CutFailure["reason"];
  /** 每条切分线的采纳情况(诊断) */
  debug: {
    accepted: { headBody: boolean; armLeft: boolean; armRight: boolean };
  };
}

/** 切分包 manifest:部件文件 + 全图坐标布局(SPEC §9 布局元数据化)。 */
export interface CutPackManifest {
  formatVersion: 1;
  kind: "companion-cut";
  source: { width: number; height: number; keyMode: KeyMode; route: CutRoute };
  parts: Partial<Record<PartName | "sticker", { file: string; box: Box }>>;
}

/* ---------------- 11.5 纸偶布局(切分件 → 渲染 viewBox 坐标,纯函数) ---------------- */

/** 单部件在渲染舞台上的落位(viewBox 坐标)。 */
export interface PuppetPartLayout {
  name: PartName | "sticker";
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 部件盒并集 = 已渲染内容的真实外接框(SPEC §17.11):标定纸偶大小时用它,
 * 画布四周的留白不参与——AI 生成的 2:3 图人物常只占 60~70%,按整画布 contain
 * 会让纸偶整体偏小、脚悬在悬浮盘上。无部件 → 0 尺寸框(调用方兜底)。
 */
export function figureBoxOfParts(
  parts: Partial<Record<PartName | "sticker", { file: string; box: Box }>>,
): { x: number; y: number; width: number; height: number } {
  const boxes = Object.values(parts)
    .map((p) => p?.box)
    .filter((b): b is Box => !!b);
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 把切分件的原图坐标等比 contain 到目标舞台(伴学 svg 200×200 内的子区),
 * 居中;部件间相对位置与原图逐像素一致。确定性(同输入同输出,verify 直测)。
 * source 支持带 x/y 的标定框(2026-09-10:传 figureBoxOfParts 的部件并集,
 * 画布留白不参与缩放;不传 x/y 视为整画布,兼容老调用)。
 */
export function layoutParts(
  source: { x?: number; y?: number; width: number; height: number },
  parts: Partial<Record<PartName | "sticker", { file: string; box: Box }>>,
  target: { x: number; y: number; w: number; h: number } = { x: 24, y: 22, w: 152, h: 154 },
): PuppetPartLayout[] {
  if (source.width <= 0 || source.height <= 0) return [];
  const bx = source.x ?? 0;
  const by = source.y ?? 0;
  const s = Math.min(target.w / source.width, target.h / source.height);
  const offX = target.x + (target.w - source.width * s) / 2;
  const offY = target.y + (target.h - source.height * s) / 2;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: PuppetPartLayout[] = [];
  for (const [name, part] of Object.entries(parts) as Array<[PartName | "sticker", { file: string; box: Box }]>) {
    if (!part) continue;
    out.push({
      name,
      x: r2(offX + (part.box.x - bx) * s),
      y: r2(offY + (part.box.y - by) * s),
      w: r2(part.box.w * s),
      h: r2(part.box.h * s),
    });
  }
  return out;
}

/* ---------------- 内部工具 ---------------- */

const MAX_PIXELS = 24e6;

/** classify 驱动的部件提取核:扫描主体框,按分类收像素、算 bbox、裁剪输出。 */
function extractParts(
  img: RgbaImage,
  fm: FigureMask,
  classify: (x: number, y: number) => PartName | null,
): CutPart[] {
  const { main } = fm;
  const out: CutPart[] = [];
  for (const name of ["head", "body", "armL", "armR"] as PartName[]) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
    for (let y = main.y; y < main.y + main.h; y++) {
      for (let x = main.x; x < main.x + main.w; x++) {
        if (classify(x, y) !== name) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (count === 0) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (classify(minX + x, minY + y) !== name) continue;
        const sp = ((minY + y) * img.width + (minX + x)) * 4;
        const q = (y * w + x) * 4;
        rgba[q] = img.data[sp];
        rgba[q + 1] = img.data[sp + 1];
        rgba[q + 2] = img.data[sp + 2];
        rgba[q + 3] = img.data[sp + 3];
      }
    }
    out.push({ name, box: { x: minX, y: minY, w, h }, rgba });
  }
  return out;
}

/* ---------------- 1. 键控 + 主体提取 ---------------- */

/**
 * 键控自动分流:四角均不透明 → 绿幕键控(g 主导,即 g>r+20 且 g>b+20 判背景);
 * 否则 alpha 键控。连通块(4 邻域 BFS)后按面积过滤噪点(<最大块 5%),
 * 返回主体掩码与显著块数。超过 MAX_PIXELS 拒收(抛错,调用方兜 T3)。
 */
export function keyFigure(img: RgbaImage, opts?: { minBlobRatio?: number }): FigureMask {
  const { width: W, height: H, data } = img;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W <= 0 || H <= 0) {
    throw new Error("CUT_BAD_SIZE");
  }
  if (W * H > MAX_PIXELS) throw new Error("CUT_TOO_LARGE");

  const corner = (x: number, y: number) => (y * W + x) * 4 + 3;
  const cornerOpaque =
    data[corner(0, 0)] > 128 &&
    data[corner(W - 1, 0)] > 128 &&
    data[corner(0, H - 1)] > 128 &&
    data[corner(W - 1, H - 1)] > 128;
  const mode: KeyMode = cornerOpaque ? "green" : "alpha";

  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mode === "green") {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      mask[i] = g > r + 20 && g > b + 20 ? 0 : 1;
    } else {
      mask[i] = data[p + 3] > 128 ? 1 : 0;
    }
  }

  // 连通块
  const comp = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const boxes: Array<{ area: number; box: Box }> = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = boxes.length;
    let minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
    while (sp > 0) {
      const cur = stack[--sp];
      const cx = cur % W;
      const cy = (cur - cx) / W;
      area++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (cx > 0 && mask[cur - 1] && comp[cur - 1] < 0) { comp[cur - 1] = boxes.length; stack[sp++] = cur - 1; }
      if (cx < W - 1 && mask[cur + 1] && comp[cur + 1] < 0) { comp[cur + 1] = boxes.length; stack[sp++] = cur + 1; }
      if (cy > 0 && mask[cur - W] && comp[cur - W] < 0) { comp[cur - W] = boxes.length; stack[sp++] = cur - W; }
      if (cy < H - 1 && mask[cur + W] && comp[cur + W] < 0) { comp[cur + W] = boxes.length; stack[sp++] = cur + W; }
    }
    boxes.push({ area, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } });
  }
  if (boxes.length === 0) throw new Error("CUT_EMPTY");

  boxes.sort((a, b) => b.area - a.area);
  const main = boxes[0].box;
  const minBlobRatio = opts?.minBlobRatio ?? 0.05;
  const significant = boxes.filter((b) => b.area >= boxes[0].area * minBlobRatio).length;

  return { mode, width: W, height: H, mask, main, significantComponents: significant };
}

/**
 * 键控预览合成(VLM 输入图,SPEC §17.5):掩码内保留原像素,掩码外涂深灰
 * #2F2F36 —— VLM 看到的"深灰底上的角色"与机器掩码逐像素同源,绿边/杂背景
 * 不再干扰。
 */
export function composeKeyedPreview(img: RgbaImage, fm: FigureMask): RgbaImage {
  const out = new Uint8ClampedArray(fm.width * fm.height * 4);
  for (let i = 0; i < fm.mask.length; i++) {
    const p = i * 4;
    if (fm.mask[i]) {
      out[p] = img.data[p];
      out[p + 1] = img.data[p + 1];
      out[p + 2] = img.data[p + 2];
      out[p + 3] = img.data[p + 3];
    } else {
      out[p] = 47;
      out[p + 1] = 47;
      out[p + 2] = 54;
      out[p + 3] = 255;
    }
  }
  return { width: fm.width, height: fm.height, data: out };
}

/* ---------------- 2. 切分线协议 prompt(单源,service/live-test/demo 共用) ---------------- */

/**
 * vision 定位 prompt v9(SPEC §17.1/§17.9):
 *   - 切分线语义:headBody 沿头底缘;armX = 肩缝→腋窝的解剖切位(不依赖可见缝),
 *     整条袖子归臂,腋窝黏连按解剖位置直切;
 *   - 点数加密:headBody 12~24 点(弦切误差随点数减半),臂线 6~16 点;
 *   - 坐标归一化,端点必须在背景。
 */
export function locatePrompt(W: number, H: number): string {
  return [
    `你是纸偶动画的部件切分师。深灰色背景上是刚抠好的Q版角色立绘(画布 ${W}x${H} 像素)。`,
    `请在角色身上画出把身体分开的切分线。只输出一个 JSON 对象,格式:`,
    `{"cuts": {"headBody": [[x,y],...], "armLeft": [[x,y],...] 或 null, "armRight": [[x,y],...] 或 null}}`,
    `headBody:沿头部最底缘(含头发/耳朵/头饰/兜帽的轮廓,不是衣领口)从角色左侧的灰色背景出发,`,
    `  经过下巴,到达右侧背景结束,取 12~24 个点(点越密线越贴合弧线)。`,
    `armLeft/armRight:把整条手臂连同袖子从躯干上切下来,手臂以肩为轴转动,所以切线要走肩缝:`,
    `  从肩部上方的灰色背景出发,沿肩关节的缝线向下切到腋窝(手臂与躯干交界的最凹处);`,
    `  腋窝以下手臂若已与躯干分离,线就在腋窝处的背景里结束;若手臂与躯干仍有黏连`,
    `  (如长袖贴着身体),沿黏连带继续向下切,直到把手臂完全分开、到达背景为止。`,
    `  整条袖子(短袖/长袖)都归手臂;图上看不见缝时(如同色布料黏连),按解剖位置直切。`,
    `  armLeft=画面左侧的手臂(观察者视角)。手臂根本不存在时该臂给 null。`,
    `注意:每条线的终点必须明确落在灰色背景上才停;若腋窝处没有背景,就沿手臂与躯干的黏连带继续向下走到最近的背景。`,
    `所有坐标用 0~1 小数(相对原图宽高),点按线的走向顺序排列。`,
    `每条线的起点和终点都必须在没有像素的灰色背景上。不要输出其他文字。`,
  ].join("\n");
}

/* ---------------- 3. 切分线解析(VLM 原文 → CutCurves,纯函数) ---------------- */

/**
 * 解析识图模型返回的切分线 JSON(SPEC §17.1)。宽容三件事:
 *   1. ```json 围栏与前后废话(取首 { 到末 });
 *   2. cuts 包裹层可省(顶层也可);
 *   3. 坐标制式:单条线内全值 ≤1 视为归一化坐标,按图像尺寸还原。
 * 点序保留(不排序——线的走向决定端点外找方向);垃圾点跳过;有效点 <2 →
 * 该线为 null。JSON 整体不可解析 → null(调用方透出 visionError)。
 */
export function parseCutsJson(raw: string, width: number, height: number): CutCurves | null {
  const s = raw.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const cutsRaw = (typeof obj.cuts === "object" && obj.cuts !== null ? obj.cuts : obj) as Record<string, unknown>;
  const normKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
  const out: CutCurves = { headBody: null, armLeft: null, armRight: null };
  for (const [k, v] of Object.entries(cutsRaw)) {
    const poly = readPoly(v, width, height);
    if (!poly) continue;
    const n = normKey(k);
    if (n === "headbody" || n === "head" || n === "neck") out.headBody ??= poly;
    else if (n === "armleft" || n === "leftarm" || n === "arml") out.armLeft ??= poly;
    else if (n === "armright" || n === "rightarm" || n === "armr") out.armRight ??= poly;
  }
  return out;
}

/** 点列读取:[x,y] 二元组或 {x,y};垃圾点跳过;有效点 ≥2 才可用。 */
function readPoly(v: unknown, width: number, height: number): Poly | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of v) {
    let px: number;
    let py: number;
    if (Array.isArray(p) && p.length >= 2) {
      px = Number(p[0]);
      py = Number(p[1]);
    } else if (typeof p === "object" && p !== null) {
      const o = p as Record<string, unknown>;
      px = Number(o.x);
      py = Number(o.y);
    } else {
      continue;
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    pts.push({ x: px, y: py });
  }
  if (pts.length < 2) return null;
  const fractional = pts.every((p) => p.x <= 1.0001 && p.y <= 1.0001);
  return pts.map((p) => ({
    x: Math.round(fractional ? p.x * width : p.x),
    y: Math.round(fractional ? p.y * height : p.y),
  }));
}

/* ---------------- 3. 折线几何工具(校验与栅栏化共用) ---------------- */

const inBounds = (fm: FigureMask, x: number, y: number) => x >= 0 && y >= 0 && x < fm.width && y < fm.height;

const maskAt = (fm: FigureMask, x: number, y: number) => (inBounds(fm, x, y) ? fm.mask[y * fm.width + x] : 0);

/**
 * 沿折线逐段走像素并回调。步进取 max(|dx|,|dy|),相邻标记像素恒只差 ≤1 轴
 * (水平/垂直/单对角),墙天然 8-连通——单对角即挡住 4-连通渗漏,无需补桥像素
 * (闭环实证:拆掉补桥,22 断言不变红,冗余防御删除)。界外坐标照常回调,
 * 由消费方自行决定忽略。
 */
function walkPolyline(poly: Poly, visit: (x: number, y: number) => void): void {
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let s = 1; s <= steps; s++) {
      visit(Math.round(a.x + ((b.x - a.x) * s) / steps), Math.round(a.y + ((b.y - a.y) * s) / steps));
    }
  }
}

/** 线落在掩码上的墙像素数(线是否真的切到角色;<3 = 没碰到,不可信)。 */
function wallOnMaskCount(poly: Poly, fm: FigureMask): number {
  let n = 0;
  walkPolyline(poly, (x, y) => {
    if (maskAt(fm, x, y) === 1) n++;
  });
  return n;
}

/** 两线段是否真交叉(严格内交,共享端点/共线不算——线在背景处合法交汇)。 */
function segsCross(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function polysCross(a: Poly, b: Poly): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

/**
 * 端点落地(SPEC §17.2 校验 3):端点已在背景 → 原样;落在掩码内 → **环形最近
 * 背景搜索**(2026-09-10 四图验收改):先沿末段方向的前向半平面找(v9 臂线
 * 语义下延续走向),再全向——VLM 的腋窝终点常差几个像素落在布料上,最近的
 * 背景往往在任意方向几像素外,沿末段直找经常扑空。半径 ≤4% 对角线;
 * 出界 = 背景。找不到 → null(该线作废)。
 */
function extendEndpoint(p: { x: number; y: number }, toward: { x: number; y: number }, fm: FigureMask): Poly {
  if (maskAt(fm, p.x, p.y) === 0) return [p];
  let dx = p.x - toward.x;
  let dy = p.y - toward.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  // 4% 对角线:四图实测 VLM 腋窝终点平均深入布料 ~90px(2.5% 不够),4%(1696 图 →123px)覆盖
  const radius = Math.max(4, Math.round(Math.hypot(fm.width, fm.height) * 0.04));
  // 两遍扫描:先只在"顺线走向的前向半平面"里找(全环距离扫完),全无才退而求
  // 其次接受任意方向——单圈混扫会把反方向的近点提前返回,墙的延长段错过真缝
  for (const forwardOnly of [true, false]) {
    for (let r = 1; r <= radius; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a * Math.PI) / 8;
        const qx = Math.round(p.x + Math.cos(ang) * r);
        const qy = Math.round(p.y + Math.sin(ang) * r);
        if (inBounds(fm, qx, qy) && fm.mask[qy * fm.width + qx] !== 0) continue;
        // 出界或背景都可作端点;forwardOnly 时要求与线走向同侧
        if (!forwardOnly || dx * (qx - p.x) + dy * (qy - p.y) >= 0) return [{ x: qx, y: qy }];
      }
    }
  }
  return [];
}

/** 校验单条线:两端落地 + 线真的切到角色(≥3 墙像素)。返回修正后的折线或 null。 */
export function validateCurve(poly: Poly, fm: FigureMask): Poly | null {
  const start = extendEndpoint(poly[0], poly[1], fm);
  const end = extendEndpoint(poly[poly.length - 1], poly[poly.length - 2], fm);
  if (start.length === 0 || end.length === 0) return null;
  const fixed = [...start, ...poly.slice(1, -1), ...end];
  return wallOnMaskCount(fixed, fm) >= 3 ? fixed : null;
}

/* ---------------- 4. 校验链(VLM 声明 → 机器可信的切分计划) ---------------- */

/**
 * 切分线校验链(SPEC §17.2):headBody 必须通过,否则 null(→ L1);
 * 臂线独立判定端点/碰面,失败 → null(臂留身体)。
 * 交叉守卫(2026-09-10 四图验收收窄):臂线×headBody 不再拒线——无颈形态的
 * 臂根就长在头底弧高度,臂线与头身线几何上必然交叉;孤儿区域清理已能消化
 * 交叉产生的碎片。仅双臂互交仍拒(后者作废,防区域结构碎成无法标注)。
 */
export function planCutCurves(fm: FigureMask, cuts: CutCurves): CutPlan | null {
  if (!cuts.headBody) return null;
  const headBody = validateCurve(cuts.headBody, fm);
  if (!headBody) return null;
  const fixArm = (poly: Poly | null): Poly | null => {
    if (!poly) return null;
    const fixed = validateCurve(poly, fm);
    return fixed ?? null;
  };
  const armLeft = fixArm(cuts.armLeft);
  const armRight = fixArm(cuts.armRight);
  if (armLeft && armRight && polysCross(armLeft, armRight)) {
    return { headBody, armLeft, armRight: null };
  }
  return { headBody, armLeft, armRight };
}

/* ---------------- 5. 梯度门控吸附(线 → 最近的可见分界,画风无关) ---------------- */

/**
 * 折线内部点向附近最近的"颜色跳变"吸附(2026-09-10,四图验收驱动)。
 * 画风无关:描边(强)/色块异色边界(中)/阴影折痕(弱)都是颜色跳变;附近
 * 没有强分界就不动——safe-by-construction,同色黏连处保持 VLM 原点,最坏情况
 * = 不吸附。"最近的强边界"优先(从原点向两侧扩张取第一个过阈值的),信任
 * VLM 的大致落点,不跨到更远的另一条边界(如下巴线不跨到衣领线)。
 * 首末点(背景端)不动——端点位置已被校验链背书,吸进图形会破坏墙的贯通性。
 */
export function snapCurvesToEdges(img: RgbaImage, fm: FigureMask, plan: CutPlan): CutPlan {
  const R = Math.max(12, Math.round(Math.min(fm.width, fm.height) * 0.02));
  const WIN = 2; // 边界两侧采样窗(px)
  const THRESH = 120; // 窗口颜色差阈值(Σ通道,0..765)
  // 采样色:掩码内=原图,掩码外=键控灰 —— 图底边界(手描边外缘等)也算强边界
  const sample = (x: number, y: number): [number, number, number] => {
    if (x < 0 || y < 0 || x >= fm.width || y >= fm.height || !fm.mask[y * fm.width + x]) return [47, 47, 54];
    const p = (y * img.width + x) * 4;
    return [img.data[p], img.data[p + 1], img.data[p + 2]];
  };
  const windowDiff = (x: number, y: number, nx: number, ny: number): number => {
    let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0;
    for (let k = -1; k <= 1; k++) {
      const tx = -ny * k;
      const ty = nx * k;
      const a = sample(Math.round(x + nx * WIN + tx), Math.round(y + ny * WIN + ty));
      const b = sample(Math.round(x - nx * WIN + tx), Math.round(y - ny * WIN + ty));
      ar += a[0]; ag += a[1]; ab += a[2];
      br += b[0]; bg += b[1]; bb += b[2];
    }
    return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
  };
  const snapPoint = (prev: { x: number; y: number }, pt: { x: number; y: number }, next: { x: number; y: number }): { x: number; y: number } => {
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) return pt;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    for (let t = 0; t <= R; t++) {
      const sides = t === 0 ? [0] : [t, -t];
      for (const s of sides) {
        const qx = pt.x + nx * s;
        const qy = pt.y + ny * s;
        if (windowDiff(qx, qy, nx, ny) >= THRESH) {
          return { x: Math.round(qx), y: Math.round(qy) };
        }
      }
    }
    return pt;
  };
  const snapPoly = (poly: Poly): Poly => {
    if (poly.length < 3) return poly;
    const out: Poly = [poly[0]];
    for (let i = 1; i < poly.length - 1; i++) out.push(snapPoint(poly[i - 1], poly[i], poly[i + 1]));
    out.push(poly[poly.length - 1]);
    return out;
  };
  return {
    headBody: snapPoly(plan.headBody),
    armLeft: plan.armLeft ? snapPoly(plan.armLeft) : null,
    armRight: plan.armRight ? snapPoly(plan.armRight) : null,
  };
}

/* ---------------- 6. 划分(切分线栅栏 BFS,SPEC §17.3) ---------------- */

/**
 * 栅栏 BFS 划分:切分线栅栏化成 1~2px 墙(墙上的掩码像素成为接缝,不归任何
 * 部件,白描边愈合),主体框内掩码 − 墙做 4-连通 BFS → 区域;标注:
 *   head   = 含主体最高掩码像素的区域
 *   body   = 含主体最低掩码像素的区域
 *   其余   = 臂候选:质心 x 在 body 左/右定 armL/armR;合格臂候选 >2 → 区域
 *            结构不可信,L1。
 * 孤儿清理(2026-09-10,熊女孩 body 黑斜条实证):部件=仅自身的规范区域——
 * 小于 4% 主体的碎片区域**不归任何部件**(直接弃,白描边愈合)。旧版把碎片
 * 并回 body,墙从描边条中间穿过时切出的"外半条描边"孤儿(10,258px,与躯干隔
 * 背景不连通)会一直挂在 body 上。
 * 守卫:head/body 必须不同区域且面积 ≥4% 主体,否则 [](调用方降 L1)。
 */
export function partitionByCurves(img: RgbaImage, fm: FigureMask, plan: CutPlan): CutPart[] {
  const { width: W, mask, main } = fm;
  const barrier = new Uint8Array(W * fm.height);
  const paint = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < fm.height) barrier[y * W + x] = 1;
  };
  walkPolyline(plan.headBody, paint);
  if (plan.armLeft) walkPolyline(plan.armLeft, paint);
  if (plan.armRight) walkPolyline(plan.armRight, paint);

  // 主体框内连通块(掩码 − 墙,4 连通)
  const region = new Int32Array(W * fm.height).fill(-1);
  const areas: number[] = [];
  const sumX: number[] = [];
  const sumY: number[] = [];
  const stack = new Int32Array(main.w * main.h);
  let figArea = 0;
  for (let y = main.y; y < main.y + main.h; y++) {
    for (let x = main.x; x < main.x + main.w; x++) {
      const s = y * W + x;
      if (mask[s]) figArea++;
      if (!mask[s] || barrier[s] || region[s] >= 0) continue;
      const id = areas.length;
      region[s] = id;
      let sp = 0;
      stack[sp++] = s;
      let area = 0;
      let sx = 0;
      let sy = 0;
      while (sp > 0) {
        const cur = stack[--sp];
        const cx = cur % W;
        const cy = (cur - cx) / W;
        area++;
        sx += cx;
        sy += cy;
        const tryPush = (n: number) => {
          if (mask[n] && !barrier[n] && region[n] < 0) {
            region[n] = id;
            stack[sp++] = n;
          }
        };
        if (cx > main.x) tryPush(cur - 1);
        if (cx < main.x + main.w - 1) tryPush(cur + 1);
        if (cy > main.y) tryPush(cur - W);
        if (cy < main.y + main.h - 1) tryPush(cur + W);
      }
      areas.push(area);
      sumX.push(sx);
      sumY.push(sy);
    }
  }
  if (areas.length === 0 || figArea === 0) return [];

  // head/body 标注:主体框内最高/最低的非墙掩码像素所在区域
  const regionAtExtreme = (fromTop: boolean): number => {
    for (let y = fromTop ? main.y : main.y + main.h - 1; fromTop ? y < main.y + main.h : y >= main.y; fromTop ? y++ : y--) {
      for (let x = main.x; x < main.x + main.w; x++) {
        const s = y * W + x;
        if (mask[s] && !barrier[s] && region[s] >= 0) return region[s];
      }
    }
    return -1;
  };
  const headR = regionAtExtreme(true);
  const bodyR = regionAtExtreme(false);
  if (headR < 0 || bodyR < 0 || headR === bodyR) return [];

  const minArea = figArea * 0.04;
  if (areas[headR] < minArea || areas[bodyR] < minArea) return [];

  // 其余区域:合格臂按质心 x 定左右(<4% 主体与多余区域一律弃,不归任何部件);
  // >2 个合格臂 = 结构不可信
  const labelOf = new Map<number, PartName | null>();
  labelOf.set(headR, "head");
  labelOf.set(bodyR, "body");
  const extras: Array<{ id: number; cx: number }> = [];
  for (let id = 0; id < areas.length; id++) {
    if (id === headR || id === bodyR) continue;
    if (areas[id] < minArea) continue;
    extras.push({ id, cx: sumX[id] / areas[id] });
  }
  if (extras.length > 2) return [];
  const bodyCx = sumX[bodyR] / areas[bodyR];
  extras.sort((a, b) => a.cx - b.cx);
  if (extras.length === 1) {
    labelOf.set(extras[0].id, extras[0].cx < bodyCx ? "armL" : "armR");
  } else if (extras.length === 2) {
    labelOf.set(extras[0].id, "armL");
    labelOf.set(extras[1].id, "armR");
  }

  // 孤儿清理:非规范区域的像素返回 null —— 不归任何部件
  return extractParts(img, fm, (x, y) => labelOf.get(region[y * W + x]) ?? null);
}

/* ---------------- 6. 白描边 ---------------- */

/** 半径 r 的 Chebyshev 膨胀 + 白色垫底:输出与输入同尺寸,新边缘为不透明白。 */
export function addWhiteOutline(img: RgbaImage, radius = Math.max(3, Math.round(Math.min(img.width, img.height) * 0.008))): RgbaImage {
  const { width: W, height: H, data } = img;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  // 可分离膨胀(行方向 + 列方向)
  const dil1 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < W && a[y * W + xx]) v = 1;
      }
      dil1[y * W + x] = v;
    }
  }
  const dil = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = 0;
      for (let k = -radius; k <= radius && !v; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < H && dil1[yy * W + x]) v = 1;
      }
      dil[y * W + x] = v;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    if (a[i]) {
      out[p] = data[p];
      out[p + 1] = data[p + 1];
      out[p + 2] = data[p + 2];
      out[p + 3] = data[p + 3];
    } else if (dil[i]) {
      out[p] = 255;
      out[p + 1] = 255;
      out[p + 2] = 255;
      out[p + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/* ---------------- 7. 降级路由 ---------------- */

export interface RouteOptions {
  /** VLM 切分线声明(有 key 时由识图产出;无/无效 → L1,几何启发式已退役) */
  cuts?: CutCurves | null;
}

/**
 * 降级路由(每级机器可判定,SPEC §17.4):
 *   vision — cuts 校验通过 → 栅栏 BFS 划分(head+body 必在,臂可缺席);
 *   l1     — 无 cuts / headBody 无效(NO_HEAD_CUT)或划分守卫不过(TOO_FEW_PARTS)。
 */
export function routeCut(img: RgbaImage, opts: RouteOptions = {}): CutResult {
  let fm: FigureMask;
  try {
    fm = keyFigure(img);
  } catch {
    return { route: "l1", parts: [], failure: "TOO_FEW_PARTS", debug: { accepted: { headBody: false, armLeft: false, armRight: false } } };
  }
  const none = { headBody: false, armLeft: false, armRight: false };
  if (!opts.cuts?.headBody) {
    return { route: "l1", parts: [], failure: "NO_HEAD_CUT", debug: { accepted: none } };
  }
  const plan = planCutCurves(fm, opts.cuts);
  if (!plan) {
    return { route: "l1", parts: [], failure: "NO_HEAD_CUT", debug: { accepted: none } };
  }
  const snapped = snapCurvesToEdges(img, fm, plan);
  const parts = partitionByCurves(img, fm, snapped);
  const has = (n: PartName) => parts.some((p) => p.name === n);
  if (parts.length < 2 || !has("head") || !has("body")) {
    return { route: "l1", parts: [], failure: "TOO_FEW_PARTS", debug: { accepted: { headBody: true, armLeft: !!plan.armLeft, armRight: !!plan.armRight } } };
  }
  return {
    route: "vision",
    parts,
    debug: { accepted: { headBody: true, armLeft: !!plan.armLeft, armRight: !!plan.armRight } },
  };
}

/* ---------------- 8. 切分包 manifest ---------------- */

export function buildCutManifest(
  img: RgbaImage,
  route: CutRoute,
  keyMode: KeyMode,
  parts: CutPart[],
  files: Partial<Record<PartName, string>>,
  meta: { id: string; name: string; author: string; license: string },
): CutPackManifest & Pick<CompanionPackManifest, "id" | "name" | "author" | "license"> {
  const source = { width: img.width, height: img.height, keyMode, route };
  const partEntries: CutPackManifest["parts"] = {};
  for (const p of parts) {
    const file = files[p.name];
    if (file) partEntries[p.name] = { file, box: p.box };
  }
  return {
    formatVersion: 1,
    kind: "companion-cut",
    id: meta.id,
    name: meta.name,
    author: meta.author,
    license: meta.license,
    source,
    parts: partEntries,
  };
}
