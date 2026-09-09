/**
 * companion-pack —— 外部角色包(CompanionBot)的最小契约,纯函数层。
 *
 * M0 spike(见 .goal/SPEC.md / 会话决定 2026-09-09):用户自带一张合规 PNG 即可
 * 变成陪伴 bot。本文件三件事,全部可被 verify 直测(无 DOM/IPC 依赖):
 *   1. manifest v1 schema + pack-lint(结构/路径安全/文件存在性回调注入)
 *   2. PNG 三行规格检测器(透明底/单主体/别贴边,像素级纯函数)
 *   3. BotState 词汇表(贴纸级/Bongo档 共用的语义状态槽)
 *
 * 设计红线:本模块是 shared 层,不 import 任何项目内模块;renderer 的
 * CompanionBot 与主进程/verify 同吃这一份真源。
 */

/* ---------------- 状态词汇表 ---------------- */

/** M0 语义状态槽:idle 必填,其余可省(缺省回落 idle)。 */
export type BotState = "idle" | "keyL" | "keyR" | "happy" | "thinking";

export const BOT_STATES: readonly BotState[] = ["idle", "keyL", "keyR", "happy", "thinking"];

export function isBotState(v: unknown): v is BotState {
  return typeof v === "string" && (BOT_STATES as readonly string[]).includes(v);
}

/** 包档位:sticker=整图单帧+变换;bongo=每状态一张整图,帧替换驱动。 */
export type CompanionPackTier = "sticker" | "bongo";

/* ---------------- manifest v1 ---------------- */

export interface CompanionPackManifest {
  formatVersion: 1;
  /** 包 slug(小写字母/数字/连字符) */
  id: string;
  name: string;
  author: string;
  /** SPDX 标识或自定义授权说明(开源合规:用户自带包也强制填) */
  license: string;
  tier: CompanionPackTier;
  /** 状态 → 包根相对图片文件名;idle 必填,其余缺省回落 idle */
  states: { idle: string } & Partial<Record<BotState, string>>;
  /** 表情类状态驻留时长 ms(到期回落 idle),缺省 1200 */
  poseHoldMs?: number;
}

/* ---------------- lint ---------------- */

export interface PackIssue {
  code: string;
  message: string;
}

export interface PackLintResult {
  ok: boolean;
  issues: PackIssue[];
}

const ID_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
/** 包内文件名白名单:禁目录分隔/穿越/隐藏文件,单段 PNG。 */
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

function issue(code: string, message: string): PackIssue {
  return { code, message };
}

/**
 * manifest 结构校验。io.fileExists 注入文件存在性(verify 传桩,运行时读包目录),
 * 结构合法但文件缺失 → FILE_MISSING。
 */
export function lintCompanionPack(
  raw: unknown,
  io: { fileExists: (filename: string) => boolean },
): PackLintResult {
  const issues: PackIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [issue("NOT_OBJECT", "manifest 必须是 JSON 对象")] };
  }
  const m = raw as Record<string, unknown>;

  if (m.formatVersion !== 1) {
    issues.push(issue("BAD_FORMAT_VERSION", `formatVersion 必须为 1,收到 ${JSON.stringify(m.formatVersion)}`));
  }
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    issues.push(issue("BAD_ID", "id 必须为小写字母/数字/连字符的 slug(1~64 位)"));
  }
  for (const key of ["name", "author", "license"] as const) {
    if (typeof m[key] !== "string" || (m[key] as string).trim() === "") {
      issues.push(issue("MISSING_FIELD", `${key} 必填(非空字符串)`));
    }
  }
  if (m.tier !== "sticker" && m.tier !== "bongo") {
    issues.push(issue("BAD_TIER", `tier 必须为 "sticker" 或 "bongo",收到 ${JSON.stringify(m.tier)}`));
  }
  if (m.poseHoldMs !== undefined) {
    const v = m.poseHoldMs;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 200 || v > 10000) {
      issues.push(issue("BAD_POSE_HOLD", "poseHoldMs 须为 200~10000 的有限数字(ms)"));
    }
  }

  if (typeof m.states !== "object" || m.states === null || Array.isArray(m.states)) {
    issues.push(issue("BAD_STATES", "states 必须是对象"));
  } else {
    const states = m.states as Record<string, unknown>;
    if (typeof states.idle !== "string") {
      issues.push(issue("MISSING_IDLE", "states.idle 必填(其余状态缺省回落 idle)"));
    }
    for (const [key, value] of Object.entries(states)) {
      if (!isBotState(key)) {
        issues.push(issue("UNKNOWN_STATE", `未知状态槽 "${key}",合法槽:${BOT_STATES.join("/")}`));
        continue;
      }
      if (typeof value !== "string") {
        issues.push(issue("BAD_STATE_FILE", `states.${key} 必须是文件名字符串`));
        continue;
      }
      if (!FILENAME_RE.test(value)) {
        issues.push(issue("UNSAFE_PATH", `states.${key}="${value}" 不是合法的包根相对 PNG 文件名`));
        continue;
      }
      if (!io.fileExists(value)) {
        issues.push(issue("FILE_MISSING", `states.${key} 指向的文件 "${value}" 不在包内`));
      }
    }
    if (
      m.tier === "bongo" &&
      Object.keys(states).filter((k) => k !== "idle" && isBotState(k)).length === 0
    ) {
      issues.push(issue("BONGO_WITHOUT_POSES", "bongo 档至少要有一个表情/动作帧(keyL/keyR/happy/thinking)"));
    }
  }

  const known = new Set(["formatVersion", "id", "name", "author", "license", "tier", "states", "poseHoldMs"]);
  for (const key of Object.keys(m)) {
    if (!known.has(key)) {
      issues.push(issue("UNKNOWN_FIELD", `未知字段 "${key}"(拼错还是新字段?防手误) `));
    }
  }

  return { ok: issues.length === 0, issues };
}

/** lint 通过后的只读视图(类型收窄助手,不做二次校验)。 */
export function asCompanionPackManifest(raw: unknown): CompanionPackManifest | null {
  return lintCompanionPack(raw, { fileExists: () => true }).ok ? (raw as CompanionPackManifest) : null;
}

/* ---------------- PNG 三行规格检测 ---------------- */

/** 三行规则的机器判定(见 .goal/SPEC.md §3 的 code → 导入 UX 动作表)。 */
export interface PngSpecImage {
  width: number;
  height: number;
  /** RGBA,4 字节/像素;长度必须恰为 width*height*4 */
  rgba: Uint8Array | Uint8ClampedArray;
}

export interface PngSpecOptions {
  /** 短边下限(默认 256) */
  minSide?: number;
  /** 长边上限(默认 4096) */
  maxSide?: number;
  /** 主体 bbox 距边小于该比例视为贴边(默认 0.02) */
  marginRatio?: number;
  /** alpha ≥ 此值算不透明(默认 128) */
  alphaThreshold?: number;
  /** 连通块面积 < 最大块×此比例的碎屑不计主体数(默认 0.05,防天线/饰品误报) */
  minBlobAreaRatio?: number;
  /** 下采样后的像素样本上限(默认 1_000_000;16K 巨图毫秒级检测的关键) */
  maxSamples?: number;
}

export interface PngSpecReport {
  ok: boolean;
  issues: PackIssue[];
  /** 不透明像素(采样)占比 0..1,诊断用 */
  opaqueRatio: number;
  /** 检出的主体块数(≥1;单角色=1) */
  blobCount: number;
}

/**
 * 尺寸守卫先行(坏缓冲/巨图不可能先炸内存再报错),像素扫描带下采样。
 * 连通块:alpha ≥ 阈值的采样网格 4 邻域 BFS,只保留 ≥ 最大块×minBlobAreaRatio 的主体。
 */
export function analyzePngSpec(img: PngSpecImage, opts: PngSpecOptions = {}): PngSpecReport {
  const minSide = opts.minSide ?? 256;
  const maxSide = opts.maxSide ?? 4096;
  const marginRatio = opts.marginRatio ?? 0.02;
  const alphaT = opts.alphaThreshold ?? 128;
  const minBlobAreaRatio = opts.minBlobAreaRatio ?? 0.05;
  const maxSamples = opts.maxSamples ?? 1_000_000;
  const issues: PackIssue[] = [];

  const fail = (codes: Array<[string, string]>, opaqueRatio = 0, blobCount = 0): PngSpecReport => ({
    ok: false,
    issues: codes.map(([code, message]) => issue(code, message)),
    opaqueRatio,
    blobCount,
  });

  const { width, height, rgba } = img;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    return fail([["BAD_DIMENSIONS", `非法尺寸 ${width}x${height}`]]);
  }
  if (Math.min(width, height) < minSide) {
    issues.push(issue("TOO_SMALL", `短边 ${Math.min(width, height)}px < ${minSide}px`));
  }
  if (Math.max(width, height) > maxSide) {
    issues.push(issue("TOO_LARGE", `长边 ${Math.max(width, height)}px > ${maxSide}px(导入时自动缩放)`));
  }
  if (!rgba || rgba.length !== width * height * 4) {
    issues.push(issue("BAD_PIXEL_BUFFER", `rgba 长度 ${rgba?.length ?? 0} ≠ ${width}*${height}*4`));
    return { ok: false, issues, opaqueRatio: 0, blobCount: 0 };
  }

  // 下采样:让扫描样本量 ≤ maxSamples(16K 图 stride≈16,样本数掉到 ~1M)
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxSamples)));
  const gw = Math.floor((width - 1) / stride) + 1;
  const gh = Math.floor((height - 1) / stride) + 1;

  const opaque = new Uint8Array(gw * gh);
  let opaqueCount = 0;
  let sampled = 0;
  let minAlphaSeen = 255;
  let minX = gw;
  let maxX = -1;
  let minY = gh;
  let maxY = -1;

  for (let gy = 0; gy < gh; gy++) {
    const py = gy * stride;
    for (let gx = 0; gx < gw; gx++) {
      const px = gx * stride;
      const a = rgba[(py * width + px) * 4 + 3];
      sampled++;
      if (a < minAlphaSeen) minAlphaSeen = a;
      if (a >= alphaT) {
        opaque[gy * gw + gx] = 1;
        opaqueCount++;
        if (gx < minX) minX = gx;
        if (gx > maxX) maxX = gx;
        if (gy < minY) minY = gy;
        if (gy > maxY) maxY = gy;
      }
    }
  }

  const opaqueRatio = sampled > 0 ? opaqueCount / sampled : 0;

  if (opaqueCount === 0) {
    issues.push(issue("ALL_TRANSPARENT", "整图无不透明像素(空图/坏抠图)"));
    return { ok: issues.length === 0, issues, opaqueRatio, blobCount: 0 };
  }
  if (minAlphaSeen === 255) {
    issues.push(issue("NO_ALPHA", "未检出任何透明像素——需要透明底 PNG(可一键抠图/豆包抠图)"));
  }

  // 贴边:主体 bbox 压到边缘 2% 容差内
  if (minX === 0 || minY === 0 || maxX === gw - 1 || maxY === gh - 1) {
    const marginX = width * marginRatio;
    const marginY = height * marginRatio;
    if (
      minX * stride < marginX ||
      minY * stride < marginY ||
      (maxX * stride + stride - 1) > width - 1 - marginX ||
      (maxY * stride + stride - 1) > height - 1 - marginY
    ) {
      issues.push(issue("EDGE_TOUCH", "主体贴边——四周留 5~10% 空白,给跳跃/挤压变换留余地"));
    }
  }

  // 连通块(4 邻域 BFS):只数 ≥ 最大块×minBlobAreaRatio 的主体;
  // 再做**嵌套合并**——bbox 被更大块完全包含的块(玻璃头盔的外环包着内头、
  // 帽檐包着脑袋)视为同一角色的同心结构,不判 MULTI_BLOB(宇航员素材实测教训)。
  const visited = new Uint8Array(gw * gh);
  const blobs: Array<{ area: number; minX: number; maxX: number; minY: number; maxY: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < opaque.length; start++) {
    if (!opaque[start] || visited[start]) continue;
    let area = 0;
    let bMinX = gw, bMaxX = -1, bMinY = gh, bMaxY = -1;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      area++;
      const cx = cur % gw;
      const cy = (cur - cx) / gw;
      if (cx < bMinX) bMinX = cx;
      if (cx > bMaxX) bMaxX = cx;
      if (cy < bMinY) bMinY = cy;
      if (cy > bMaxY) bMaxY = cy;
      const push = (n: number) => {
        if (opaque[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      };
      if (cx > 0) push(cur - 1);
      if (cx < gw - 1) push(cur + 1);
      if (cy > 0) push(cur - gw);
      if (cy < gh - 1) push(cur + gw);
    }
    blobs.push({ area, minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY });
  }
  const maxArea = blobs.length > 0 ? Math.max(...blobs.map((b) => b.area)) : 0;
  const major = blobs.filter((b) => b.area >= maxArea * minBlobAreaRatio);
  // 同角色判定:小块被大块 bbox **包含**,或与大块 bbox **显著重叠**
  // (交叠 ≥ 小块 bbox 面积 40%——宇航员头盔:头从穹顶环里伸出来,相交但不包含)
  type BlobBox = { minX: number; maxX: number; minY: number; maxY: number };
  const contained = (a: BlobBox, b: BlobBox): boolean =>
    a.minX >= b.minX && a.maxX <= b.maxX && a.minY >= b.minY && a.maxY <= b.maxY;
  const overlapRatio = (a: BlobBox, b2: BlobBox): number => {
    const ix = Math.min(a.maxX, b2.maxX) - Math.max(a.minX, b2.minX);
    const iy = Math.min(a.maxY, b2.maxY) - Math.max(a.minY, b2.minY);
    if (ix <= 0 || iy <= 0) return 0;
    const inter = ix * iy;
    const aA = (a.maxX - a.minX + 1) * (a.maxY - a.minY + 1);
    const bA = (b2.maxX - b2.minX + 1) * (b2.maxY - b2.minY + 1);
    return inter / Math.min(aA, bA);
  };
  const majors = major.filter(
    (b) => !major.some((o) => o !== b && o.area >= b.area && (contained(b, o) || overlapRatio(b, o) >= 0.4)),
  );
  const blobCount = majors.length;
  if (blobCount >= 2) {
    issues.push(issue("MULTI_BLOB", `检出 ${blobCount} 个独立主体——请裁剪到单角色`));
  }

  return { ok: issues.length === 0, issues, opaqueRatio, blobCount };
}

/* ---------------- 运行时缺省表(引擎回落逻辑,纯数据) ---------------- */

/** 状态缺省回落链:任何缺失状态最终落 idle。 */
export function resolveStateSrc(
  manifest: CompanionPackManifest,
  state: BotState,
): string | null {
  const s = manifest.states as Partial<Record<BotState, string>>;
  return s[state] ?? s.idle ?? null;
}

/** 表情类状态的默认驻留(引擎回落逻辑)。 */
export function poseHoldMsOf(manifest: CompanionPackManifest): number {
  return typeof manifest.poseHoldMs === "number" ? manifest.poseHoldMs : 1200;
}
