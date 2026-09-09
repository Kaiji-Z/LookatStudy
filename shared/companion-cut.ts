/**
 * companion-cut —— 单图切分管线(免费层供给,纯函数层,SPEC §14/§15)。
 *
 * 输入一张不重叠 A-pose/T-pose 立绘 RGBA,产出 头/身体/双臂 三件套;切不动
 * 则降级 L1(整图贴纸)。设计决定见 .goal/SPEC.md §14(供给阶梯/骨架教训/
 * 腕切否决/识图定位):
 *   - 键控自动分流:四角不透明 → 绿幕键控(g 主导),否则 alpha;
 *   - 颈线/头身分界 = 行宽剖面局部最小 + 肩线跳变(无解剖脖子时作机会式
 *     尝试,检不出不阻塞臂切);
 *   - 臂切 = 缝带引导逐行切:T-pose 竖直切线是缝带法的退化特例,统一实现;
 *   - 部件间"不重叠"是唯一硬前提;"有腋缝"改善几何成功率但非必要(T1 识图
 *     锚点可沿部件轮廓线切);
 *   - 降级链:vision(外部注入锚点)→ geometric(缝带)→ l1,每级机器可判定。
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

export interface NeckDetection {
  /** 头身分界行(全图 y) */
  y: number;
  /** 该行不透明宽 */
  width: number;
  /** 肩线行(分界后首个 ≥1.5× 宽的行) */
  shoulderY: number;
  shoulderWidth: number;
}

export interface GapBand {
  y0: number;
  y1: number;
}

export interface GapScan {
  /** 被扫描行中 ≥3 段(左右臂与躯干间有缝)的行数 */
  gapRows: number;
  total: number;
  ratio: number;
  bands: GapBand[];
}

export type PartName = "head" | "body" | "armL" | "armR";

export interface CutPart {
  name: PartName;
  /** 部件在全图中的 bbox */
  box: Box;
  /** 裁剪到 bbox 的 RGBA(部件外 alpha=0) */
  rgba: Uint8ClampedArray;
}

export type CutRoute = "vision" | "geometric" | "l1";

export interface CutFailure {
  route: "l1";
  reason: "NO_HEAD_BOUNDARY" | "NO_ARM_GAPS" | "TOO_FEW_PARTS";
}

export interface Anchors {
  /** 头身分界行(全图 y,VLM 语义锚点,会被行宽剖面 ±10% 精修) */
  headY?: number;
  /**
   * T1 识图定位的部件 bbox(全图坐标,VLM 最稳定的输出形态)。
   * 提供时走 vision 划分(掩码 ∩ bbox,臂盒优先于头/身),不依赖腋缝存在。
   */
  boxes?: Partial<Record<PartName, Box>>;
  /**
   * 头身交界折线(全图像素坐标,parse 后;parseAnchorsJson 收归一化或像素制)。
   * 无脖子角色的弧线切头:沿头身交界左→右 8~16 点,头部 x 范围逐列插值边界 y,
   * 线上归头、线下归身—— Bears/团子等"头圆直接坐在身上"的形态靠它出独立头件。
   * x 范围即头宽;范围外的列不算头。≥4 个有效点才可用。
   */
  headBoundary?: Array<{ x: number; y: number }>;
}

export interface CutResult {
  route: CutRoute;
  parts: CutPart[];
  /** route=l1 时的失败原因 */
  failure?: CutFailure["reason"];
  /** 诊断信息(缝行率/颈线等) */
  debug: {
    neck: NeckDetection | null;
    gaps: GapScan | null;
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
 * 把切分件的原图坐标等比 contain 到目标舞台(伴学 svg 200×200 内的子区),
 * 居中;部件间相对位置与原图逐像素一致。确定性(同输入同输出,verify 直测)。
 */
export function layoutParts(
  source: { width: number; height: number },
  parts: Partial<Record<PartName | "sticker", { file: string; box: Box }>>,
  target: { x: number; y: number; w: number; h: number } = { x: 24, y: 22, w: 152, h: 154 },
): PuppetPartLayout[] {
  if (source.width <= 0 || source.height <= 0) return [];
  const s = Math.min(target.w / source.width, target.h / source.height);
  const offX = target.x + (target.w - source.width * s) / 2;
  const offY = target.y + (target.h - source.height * s) / 2;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: PuppetPartLayout[] = [];
  for (const [name, part] of Object.entries(parts) as Array<[PartName | "sticker", { file: string; box: Box }]>) {
    if (!part) continue;
    out.push({
      name,
      x: r2(offX + part.box.x * s),
      y: r2(offY + part.box.y * s),
      w: r2(part.box.w * s),
      h: r2(part.box.h * s),
    });
  }
  return out;
}

/* ---------------- 内部工具 ---------------- */

const MAX_PIXELS = 24e6;

interface Run {
  start: number;
  end: number; // 含端点
}

/** 单行不透明段。 */
function rowRuns(mask: Uint8Array, W: number, y: number, x0: number, x1: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    const v = mask[y * W + x] === 1;
    if (v && start < 0) start = x;
    if (!v && start >= 0) {
      runs.push({ start, end: x - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: x1 });
  return runs;
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

/* ---------------- 2. 行宽剖面 ---------------- */

/** 主体 bbox 内每行的 [首段起点, 末段终点] 跨度宽(即该行在主体内的跨度)。 */
export function rowSpanProfile(fm: FigureMask): { widths: number[]; lefts: number[]; rights: number[] } {
  const { main } = fm;
  const widths: number[] = [];
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let y = main.y; y < main.y + main.h; y++) {
    const runs = rowRuns(fm.mask, fm.width, y, main.x, main.x + main.w - 1);
    if (runs.length === 0) {
      widths.push(0);
      lefts.push(-1);
      rights.push(-1);
    } else {
      const l = runs[0].start;
      const r = runs[runs.length - 1].end;
      lefts.push(l);
      rights.push(r);
      widths.push(r - l + 1);
    }
  }
  return { widths, lefts, rights };
}

/**
 * 头身分界检测:在 [30%,58%] 行高内找跨度局部最小(颈/头底收窄),
 * 其后 25% 行高内出现 ≥1.5× 的肩线跳变才采信。无脖子形态(熊/团子)
 * 最小值落在带尾且无跳变 → 返回 null(机会式,不阻塞臂切)。
 */
export function detectHeadBoundary(fm: FigureMask): NeckDetection | null {
  const { widths } = rowSpanProfile(fm);
  const h = widths.length;
  const lo = Math.floor(h * 0.3);
  const hi = Math.min(Math.floor(h * 0.58), h - 1);
  if (hi - lo < 4) return null;
  let neckY = -1;
  let neckW = Infinity;
  for (let y = lo; y <= hi; y++) {
    if (widths[y] > 0 && widths[y] < neckW) {
      neckW = widths[y];
      neckY = y;
    }
  }
  if (neckY < 0 || neckW <= 0) return null;
  const limit = Math.min(h - 1, neckY + Math.floor(h * 0.25));
  for (let y = neckY + 1; y <= limit; y++) {
    if (widths[y] >= neckW * 1.5) {
      return { y: neckY + fm.main.y, width: neckW, shoulderY: y + fm.main.y, shoulderWidth: widths[y] };
    }
  }
  return null;
}

/* ---------------- 3. 腋缝带扫描 ---------------- */

/**
 * 从 fromY(全图 y,通常=肩线)扫到主体 72% 高,统计 3 段行(左臂|缝|躯干|缝|右臂)
 * 占比,并把连续 3 段行聚成缝带。缝带是 A-pose/T-pose 臂切的统一切分依据。
 */
export function scanArmGapBands(fm: FigureMask, fromY: number, toFrac = 0.72): GapScan {
  const { main } = fm;
  const end = Math.min(main.y + Math.floor(main.h * toFrac) - 1, main.y + main.h - 1);
  const start = Math.max(main.y, Math.min(fromY, end));
  let gapRows = 0;
  let total = 0;
  const bands: GapBand[] = [];
  let cur: GapBand | null = null;
  for (let y = start; y <= end; y++) {
    const runs = rowRuns(fm.mask, fm.width, y, main.x, main.x + main.w - 1);
    total++;
    if (runs.length >= 3) {
      gapRows++;
      if (!cur) cur = { y0: y, y1: y };
      else cur.y1 = y;
    } else if (cur) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  return { gapRows, total, ratio: total > 0 ? gapRows / total : 0, bands };
}

/* ---------------- 4. 逐行切分(缝带引导) ---------------- */

export interface RowCutPlan {
  /** 臂带顶/底(全图 y) */
  armTop: number;
  armBottom: number;
  /** 每行左切线 x(该行 y 上,左臂与躯干的分界;臂带外为 null) */
  leftCut: Array<number | null>;
  rightCut: Array<number | null>;
}

/**
 * 缝带引导逐行切分计划:臂带 = [首个 3 段行 - 缓冲, 末个 3 段行 + 缓冲],
 * 缝带内的行取中间缝隙为切线;缝带外的行(肩部融合区)由最近有效行线性插值。
 * 切线缺失率过高(>60% 臂带行无有效缝)→ null(降 L1)。
 */
export function planRowCuts(fm: FigureMask, neck: NeckDetection | null, gaps: GapScan): RowCutPlan | null {
  if (gaps.bands.length === 0) return null;
  const { main } = fm;
  // 臂带 = 全部 3-run 行的包络(配饰会劈断缝带——学童书包把右腋劈成两段,
  // 选"最长带"会丢上臂;包络 + 端部外推才是正确做法)
  const first = gaps.bands[0].y0;
  const last = gaps.bands[gaps.bands.length - 1].y1;
  const margin = Math.max(10, Math.floor(main.h * 0.03));
  // 臂带顶不高于肩线半颈深(臂不会长到头上去)
  const neckFloor = neck ? neck.shoulderY - Math.floor((neck.shoulderY - neck.y) * 0.5) : main.y;
  const armTop = Math.max(main.y, first - margin, neckFloor);
  const armBottom = Math.min(main.y + main.h - 1, last + margin);

  const len = armBottom - armTop + 1;
  const leftCut: Array<number | null> = new Array(len).fill(null);
  const rightCut: Array<number | null> = new Array(len).fill(null);
  for (let y = armTop; y <= armBottom; y++) {
    const runs = rowRuns(fm.mask, fm.width, y, main.x, main.x + main.w - 1);
    if (runs.length < 3) continue;
    leftCut[y - armTop] = Math.round((runs[0].end + runs[1].start) / 2);
    rightCut[y - armTop] = Math.round((runs[runs.length - 2].start + runs[runs.length - 1].end) / 2);
  }
  // 补洞:内部空洞线性插值;端部空洞外推(肩部融合区沿用最近切位)
  const heal = (arr: Array<number | null>) => {
    let i = 0;
    while (i < arr.length) {
      if (arr[i] !== null) {
        i++;
        continue;
      }
      let j = i;
      while (j < arr.length && arr[j] === null) j++;
      const prev = i > 0 ? arr[i - 1] : null;
      const next = j < arr.length ? arr[j] : null;
      if (prev !== null && next !== null) {
        for (let k = i; k < j; k++) {
          const t = (k - (i - 1)) / (j - (i - 1));
          arr[k] = Math.round((prev as number) * (1 - t) + (next as number) * t);
        }
      } else if (prev !== null) {
        for (let k = i; k < j; k++) arr[k] = prev;
      } else if (next !== null) {
        for (let k = i; k < j; k++) arr[k] = next;
      }
      i = j;
    }
  };
  heal(leftCut);
  heal(rightCut);
  // 有序性守卫:任一行 leftCut ≥ rightCut = 切线交叉,几何不可信
  for (let i = 0; i < len; i++) {
    const l = leftCut[i];
    const r = rightCut[i];
    if (l !== null && r !== null && l >= r) return null;
  }
  return { armTop, armBottom, leftCut, rightCut };
}

/* ---------------- 5. 应用切分 ---------------- */

/** 按逐行切分计划把主体切成部件;头 = 分界行以上,身体 = 臂带以下/切线之间。 */
export function applyRowCuts(
  img: RgbaImage,
  fm: FigureMask,
  neck: NeckDetection | null,
  plan: RowCutPlan,
): CutPart[] {
  const parts: Array<{ name: PartName; minX: number; minY: number; maxX: number; maxY: number }> = [];
  const { main } = fm;
  const headBottom = neck ? neck.y : plan.armTop;

  const touches = (name: PartName, x: number, y: number): boolean => {
    if (!fm.mask[y * fm.width + x]) return false;
    if (y < headBottom) return name === "head";
    const li = y - plan.armTop;
    const lc = li >= 0 && li < plan.leftCut.length ? plan.leftCut[li] : null;
    const rc = li >= 0 && li < plan.rightCut.length ? plan.rightCut[li] : null;
    if (name === "armL") return lc !== null && x < lc;
    if (name === "armR") return rc !== null && x > rc;
    // body:切线之间(切线未定义的行 = 全行归 body,臂带外本来就没有臂)
    if (name === "body") {
      if (lc !== null && x >= lc) return false;
      if (rc !== null && x <= rc) return false;
      return true;
    }
    return false;
  };

  for (const name of ["head", "body", "armL", "armR"] as PartName[]) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = main.y; y < main.y + main.h; y++) {
      for (let x = main.x; x < main.x + main.w; x++) {
        if (!touches(name, x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) continue;
    parts.push({ name, minX, minY, maxX, maxY });
  }

  // 输出裁剪 RGBA
  const out: CutPart[] = [];
  for (const p of parts) {
    const w = p.maxX - p.minX + 1;
    const h = p.maxY - p.minY + 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = p.minX + x;
        const sy = p.minY + y;
        if (!touches(p.name, sx, sy)) continue;
        const sp = (sy * img.width + sx) * 4;
        const q = (y * w + x) * 4;
        rgba[q] = img.data[sp];
        rgba[q + 1] = img.data[sp + 1];
        rgba[q + 2] = img.data[sp + 2];
        rgba[q + 3] = img.data[sp + 3];
      }
    }
    out.push({ name: p.name, box: { x: p.minX, y: p.minY, w, h }, rgba });
  }
  // 臂太碎(宽或高 < 主体的 8%)视为切失败 → 走 L1
  const minSide = Math.max(main.w, main.h) * 0.08;
  const arms = out.filter((p) => p.name === "armL" || p.name === "armR");
  if (arms.length < 2 || arms.some((p) => p.box.w < minSide || p.box.h < minSide)) {
    return [];
  }
  return out;
}

/* ---------------- 6. vision 划分(T1:掩码 ∩ 部件 bbox / 头身折线) ---------------- */

/**
 * 折线边界取值:x 处的头身分界 y(逐列线性插值);x 在折线范围外 → null
 * (范围外不算头)。points 就地容忍乱序/同 x(排序+去重保后值)。
 */
export function headBoundaryYAt(
  points: Array<{ x: number; y: number }>,
  x: number,
): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const dedup: Array<{ x: number; y: number }> = [];
  for (const p of sorted) {
    if (dedup.length && p.x - dedup[dedup.length - 1].x < 0.5) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  if (x < dedup[0].x || x > dedup[dedup.length - 1].x) return null;
  for (let i = 1; i < dedup.length; i++) {
    const a = dedup[i - 1];
    const b = dedup[i];
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return dedup[dedup.length - 1].y;
}

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

/**
 * 识图锚点划分:臂盒优先于头盒,头带(分界行以上)优先于身体,剩余 = 身体。
 * 不依赖腋缝——"部位不重叠"即可切,v7 供给承诺的 T1 实现。
 */
export function partitionByBoxes(
  img: RgbaImage,
  fm: FigureMask,
  headY: number | null,
  boxes: Partial<Record<PartName, Box>>,
): CutPart[] {
  const inBox = (b: Box, x: number, y: number) =>
    x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const classify = (x: number, y: number): PartName | null => {
    if (!fm.mask[y * fm.width + x]) return null;
    for (const name of ["armL", "armR"] as PartName[]) {
      const b = boxes[name];
      if (b && inBox(b, x, y)) return name;
    }
    if (headY !== null && y < headY) return "head";
    const hb = boxes.head;
    if (hb && inBox(hb, x, y)) return "head";
    return "body";
  };
  return extractParts(img, fm, classify);
}

/**
 * 弧线划分(无脖子角色):头=折线以上的掩码像素(臂盒仍优先),其余=身体。
 * headBoundaryYAt 范围外不算头——折线 x 范围即头宽,收窄只会把边缘 Chin 漏给身体,
 * 不会把身体错切给头(保守方向)。
 */
export function partitionByBoundary(
  img: RgbaImage,
  fm: FigureMask,
  boundary: Array<{ x: number; y: number }>,
  boxes: Partial<Record<PartName, Box>>,
): CutPart[] {
  const inBox = (b: Box, x: number, y: number) =>
    x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const classify = (x: number, y: number): PartName | null => {
    if (!fm.mask[y * fm.width + x]) return null;
    for (const name of ["armL", "armR"] as PartName[]) {
      const b = boxes[name];
      if (b && inBox(b, x, y)) return name;
    }
    const by = headBoundaryYAt(boundary, x);
    if (by !== null && y < by) return "head";
    return "body";
  };
  return extractParts(img, fm, classify);
}

/* ---------------- 7. 白描边 ---------------- */

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

/* ---------------- 8. 降级路由 ---------------- */

export interface RouteOptions {
  /** T1 识图锚点(有 key 时由 VLM 产出;headY 会精修行宽最小) */
  anchors?: Anchors | null;
  /** 缝行率阈值,低于此降 L1(默认 0.10——缝带只需部分覆盖臂带,其余插值愈合;
   *  学童实测 0.14 被书包拖累仍可切,0.15 阈值曾误杀) */
  minGapRatio?: number;
}

/**
 * 降级路由(每级机器可判定):
 *   vision  — anchors 提供时,headY 精修(±10% 窗口行宽最小)后走逐行切;
 *   geometric — 无锚点:头身分界 + 缝带比率 ≥ minGapRatio 才切;
 *   l1      — 头身分界缺失 / 缝不足 / 臂太碎。
 */
export function routeCut(img: RgbaImage, opts: RouteOptions = {}): CutResult {
  let fm: FigureMask;
  try {
    fm = keyFigure(img);
  } catch {
    return { route: "l1", parts: [], failure: "TOO_FEW_PARTS", debug: { neck: null, gaps: null } };
  }

  let neck = detectHeadBoundary(fm);
  // T1 锚点精修:headY ±10% 窗口内重找行宽最小
  if (opts.anchors?.headY !== undefined) {
    const { widths } = rowSpanProfile(fm);
    const rel = opts.anchors.headY - fm.main.y;
    const win = Math.max(4, Math.floor(fm.main.h * 0.1));
    let best = -1;
    let bestW = Infinity;
    for (let y = Math.max(0, rel - win); y <= Math.min(widths.length - 1, rel + win); y++) {
      if (widths[y] > 0 && widths[y] < bestW) { bestW = widths[y]; best = y; }
    }
    if (best >= 0) {
      const shoulderLimit = Math.min(widths.length - 1, best + Math.floor(fm.main.h * 0.25));
      let shoulderY = best;
      let shoulderWidth = bestW;
      for (let y = best + 1; y <= shoulderLimit; y++) {
        if (widths[y] >= bestW * 1.5) { shoulderY = y; shoulderWidth = widths[y]; break; }
      }
      neck = { y: best + fm.main.y, width: bestW, shoulderY: shoulderY + fm.main.y, shoulderWidth };
    }
  }

  const fromY = neck ? neck.shoulderY : fm.main.y + Math.floor(fm.main.h * 0.4);

  // T1 识图划分:部件 bbox 提供时不依赖腋缝(部位不重叠 = 必可切)。
  // 折线优先于头盒/头行:无脖子角色的弧线切头(头圆直接坐在身上,行宽无最小)。
  if (opts.anchors?.boxes) {
    const boundary = opts.anchors.headBoundary;
    const parts =
      boundary && boundary.length >= 4
        ? partitionByBoundary(img, fm, boundary, opts.anchors.boxes)
        : partitionByBoxes(img, fm, neck ? neck.y : (opts.anchors.headY ?? null), opts.anchors.boxes);
    if (parts.length >= 3) {
      return { route: "vision", parts, debug: { neck, gaps: null } };
    }
    // bbox 覆盖不足 → 落到几何/L1,不在此直接失败
  }

  const gaps = scanArmGapBands(fm, fromY);
  const minRatio = opts.minGapRatio ?? 0.1;

  if (gaps.ratio < minRatio || gaps.bands.length === 0) {
    return { route: "l1", parts: [], failure: neck ? "TOO_FEW_PARTS" : "NO_HEAD_BOUNDARY", debug: { neck, gaps } };
  }
  const plan = planRowCuts(fm, neck, gaps);
  if (!plan) {
    return { route: "l1", parts: [], failure: "NO_ARM_GAPS", debug: { neck, gaps } };
  }
  const parts = applyRowCuts(img, fm, neck, plan);
  if (parts.length < 3) {
    return { route: "l1", parts: [], failure: "TOO_FEW_PARTS", debug: { neck, gaps } };
  }
  return {
    route: opts.anchors ? "vision" : "geometric",
    parts,
    debug: { neck, gaps },
  };
}

/* ---------------- 10. T1 识图锚点解析(VLM 原文 → Anchors,纯函数) ---------------- */

/**
 * 解析识图模型返回的锚点 JSON。宽容三件事:
 *   1. ```json 围栏与前后废话(取首 { 到末 });
 *   2. 坐标制式:全值 ≤1 视为归一化坐标,按图像尺寸还原;
 *   3. 键名变体(lowercase 后 arml/armr/head 仍可命中)。
 * armL/armR 是切分的最低要求,缺失 → null(调用方降级)。
 */
export function parseAnchorsJson(raw: string, width: number, height: number): Anchors | null {
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
  const normKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
  const nameOf = (k: string): PartName | null => {
    const n = normKey(k);
    if (n === "head") return "head";
    if (n === "arml" || n === "leftarm" || n === "armlower" || n === "larm") return "armL";
    if (n === "armr" || n === "rightarm" || n === "rarm") return "armR";
    return null;
  };
  const readBox = (v: unknown): Box | null => {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const n = v.map(Number);
    if (n.some((x) => !Number.isFinite(x) || x < 0)) return null;
    const fractional = n.every((x) => x <= 1.0001);
    const [x, y, w, h] = fractional
      ? [n[0] * width, n[1] * height, n[2] * width, n[3] * height]
      : n;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  };
  const rawBoxes = (typeof obj.boxes === "object" && obj.boxes !== null ? obj.boxes : obj) as Record<string, unknown>;
  const boxes: Partial<Record<PartName, Box>> = {};
  for (const [k, v] of Object.entries(rawBoxes)) {
    const name = nameOf(k);
    if (!name) continue;
    const b = readBox(v);
    if (b) boxes[name] = b;
  }
  if (!boxes.armL || !boxes.armR) return null;
  const headY = typeof obj.headY === "number" && Number.isFinite(obj.headY) ? Math.round(obj.headY) : undefined;
  const headBoundary = readBoundary(obj.headBoundary ?? obj.head_boundary ?? obj.boundary, width, height);
  return { headY, boxes, ...(headBoundary ? { headBoundary } : {}) };
}

/**
 * 折线解析:点=二元组 [x,y] 或 {x,y};全值 ≤1 视为归一化(与 boxes 同制式判定);
 * 垃圾点跳过,有效点 ≥4 才可用;x 排序+同 x 去重(保后值);跨度 <5% 图宽不可信
 * (VLM 偶发的窄条输出)。键名变体 headBoundary/head_boundary/boundary。
 */
function readBoundary(
  v: unknown,
  width: number,
  height: number,
): Array<{ x: number; y: number }> | undefined {
  if (!Array.isArray(v) || v.length < 4) return undefined;
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
    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0) continue;
    pts.push({ x: px, y: py });
  }
  if (pts.length < 4) return undefined;
  const fractional = pts.every((p) => p.x <= 1.0001 && p.y <= 1.0001);
  const scaled = fractional
    ? pts.map((p) => ({ x: p.x * width, y: p.y * height }))
    : pts;
  scaled.sort((a, b) => a.x - b.x);
  const dedup: Array<{ x: number; y: number }> = [];
  for (const p of scaled) {
    if (dedup.length && p.x - dedup[dedup.length - 1].x < 0.5) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  if (dedup.length < 4) return undefined;
  if (dedup[dedup.length - 1].x - dedup[0].x < width * 0.05) return undefined;
  return dedup.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

/* ---------------- 11. 切分包 manifest ---------------- */

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
