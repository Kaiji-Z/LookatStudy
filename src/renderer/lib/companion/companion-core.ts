/**
 * companion-core —— 伴学伙伴纯逻辑核(零 DOM / 零 IPC,headless 可测)。
 *
 * 三层职责:
 *   1. 庆祝→表情映射(expressionForCelebration):9 种 celebration kind → 表情/姿势/保持时长。
 *      产品红线:答错走「鼓励向」(encourage),绝不出现羞辱性反馈。
 *   2. 状态机(companionReducer):优先级 活动反应 > 听写 > 朗读 > 流式 > 睡觉 > 待机;
 *      反应带保持时长(holdMs),到期回落到当前标志位对应的 base 表情。
 *   3. 口型(computeViseme/audioToMouth):朗读音频的响度+频谱质心 → 六档 viseme
 *      (闭/A/E/I/O/U)+ 开口度 5 档量化——「母音形状」而非单纯张嘴。
 *
 * DOM/事件接线在 bus.ts(订阅 celebration 总线 + state:changed + 用户活动),
 * 本文件被 verify-companion.mjs 直接 import,改这里必须跑套件。
 */
import type { CelebrationKind } from "../celebration.js";

export type Viseme = "closed" | "A" | "E" | "I" | "O" | "U";

export type CompanionExpression =
  | "base"
  | "happy"
  | "cheer"
  | "encourage"
  | "proud"
  | "stars"
  | "flame"
  | "thinking"
  | "listening"
  | "talking"
  | "sleeping";

export type CompanionPose =
  | "float"
  | "hop"
  | "punch"
  | "oops"
  | "lean-left"
  | "lean-right"
  | "typing"
  | "doze";

export interface CompanionState {
  /** 当前渲染表情(活动反应或 base) */
  expression: CompanionExpression;
  /** 当前姿势 */
  pose: CompanionPose;
  /** 活动反应到期时刻(ms,epoch);null=无活动反应 */
  until: number | null;
  talking: boolean;
  listening: boolean;
  streaming: boolean;
  sleeping: boolean;
  /** 最近一次用户活动时刻(ms)——空闲入睡的基准 */
  lastActivity: number;
  /** Bongo Cat 式打字反应:最近键击在 TYPE_IDLE_MS 内为 true */
  typing: boolean;
  /** 键击序号(每次 press +1,Mascot 用它重触臂部按压动画) */
  keySeq: number;
  /** 最近一次按压的臂侧:-1=左 / 1=右(交替/点击定位) */
  keySide: -1 | 1;
  /** 最近一次按压时刻(ms)——typing 过期基准 */
  lastPress: number;
  /** 窗口聚焦(失焦→短阈值打盹;回归→唤醒+打招呼) */
  windowFocused: boolean;
}

export type CompanionEvent =
  | { type: "celebration"; kind: CelebrationKind; now: number }
  | { type: "poke"; now: number }
  | { type: "talking"; on: boolean; now: number }
  | { type: "listening"; on: boolean; now: number }
  | { type: "streaming"; on: boolean; now: number }
  | { type: "activity"; now: number }
  | { type: "press"; side: -1 | 1; now: number }
  | { type: "send"; now: number }
  | { type: "focus"; on: boolean; now: number }
  | { type: "tick"; now: number };

export interface CelebrationReaction {
  expression: CompanionExpression;
  pose: CompanionPose;
  holdMs: number;
}

/** 空闲多久入睡(3 分钟;朗读/听写中永不睡) */
export const SLEEP_AFTER_MS = 180_000;

/** 打字反应空闲过期(Bongo Cat:停键 1.2s 收手) */
export const TYPE_IDLE_MS = 1_200;

/** 窗口失焦后多久打盹(人回来一眼就醒,不用等 3 分钟) */
export const BLUR_SLEEP_MS = 4_000;

/** 庆祝 kind → 伙伴反应。数值=保持时长,经验值(短反馈 600-1100ms 不打断节奏)。 */
export function expressionForCelebration(kind: CelebrationKind): CelebrationReaction {
  switch (kind) {
    case "correct":
      return { expression: "cheer", pose: "punch", holdMs: 900 };
    case "wrong":
      // 红线:答错=鼓励(轻拍「没关系再来」),不是沮丧/嘲笑
      return { expression: "encourage", pose: "oops", holdMs: 1100 };
    case "unlock":
      return { expression: "happy", pose: "hop", holdMs: 1000 };
    case "mastery":
    case "level-up":
      return { expression: "proud", pose: "hop", holdMs: 1600 };
    case "streak":
      return { expression: "flame", pose: "hop", holdMs: 1000 };
    case "energy-full":
      return { expression: "cheer", pose: "hop", holdMs: 1200 };
    case "exam-pass":
      return { expression: "stars", pose: "hop", holdMs: 1800 };
    case "lesson-complete":
      return { expression: "stars", pose: "hop", holdMs: 1400 };
    default:
      return { expression: "happy", pose: "hop", holdMs: 900 };
  }
}

export function initialCompanionState(now = 0): CompanionState {
  return {
    expression: "base",
    pose: "float",
    until: null,
    talking: false,
    listening: false,
    streaming: false,
    sleeping: false,
    lastActivity: now,
    typing: false,
    keySeq: 0,
    keySide: 1,
    lastPress: 0,
    windowFocused: true,
  };
}

/** 无活动反应时的 base 表情(优先级:听写 > 朗读 > 流式 > 睡觉 > 待机)。 */
export function baseExpressionOf(s: CompanionState): CompanionExpression {
  if (s.listening) return "listening";
  if (s.talking) return "talking";
  if (s.streaming) return "thinking";
  if (s.sleeping) return "sleeping";
  return "base";
}

function basePoseOf(s: CompanionState): CompanionPose {
  if (s.listening) return "lean-right";
  if (s.streaming) return "lean-left";
  if (s.sleeping) return "doze";
  if (s.typing) return "typing";
  return "float";
}

/** 纯 reducer:同一事件序列必得同一状态(React StrictMode 安全)。 */
export function companionReducer(s: CompanionState, ev: CompanionEvent): CompanionState {
  switch (ev.type) {
    case "celebration": {
      // 入睡中被庆祝事件唤醒(庆祝本身即活动)
      const r = expressionForCelebration(ev.kind);
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        expression: r.expression,
        pose: r.pose,
        until: ev.now + r.holdMs,
      };
    }
    case "poke":
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        expression: "happy",
        pose: "hop",
        until: ev.now + 900,
      };
    case "talking":
    case "listening":
    case "streaming": {
      const next: CompanionState = { ...s };
      if (ev.type === "talking") next.talking = ev.on;
      if (ev.type === "listening") next.listening = ev.on;
      if (ev.type === "streaming") next.streaming = ev.on;
      // 语音相关标志翻转都算用户在场
      next.lastActivity = ev.now;
      if (ev.on) next.sleeping = false;
      // 无活动反应(或已过期)时立即重算 base——标志切换即时反映,不依赖 tick 时序
      if (next.until === null || next.until <= ev.now) {
        next.expression = baseExpressionOf(next);
        next.pose = basePoseOf(next);
        next.until = null;
      }
      return next;
    }
    case "activity": {
      const woke = s.sleeping;
      const next: CompanionState = {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
      };
      if (woke) {
        next.expression = baseExpressionOf(next);
        next.pose = basePoseOf(next);
        next.until = null;
      }
      return next;
    }
    case "press": {
      // Bongo Cat 式逐键:每次键击/点击都交替/定向按压一只臂,唤醒入睡
      const next: CompanionState = {
        ...s,
        sleeping: false,
        typing: true,
        keySeq: s.keySeq + 1,
        keySide: ev.side,
        lastPress: ev.now,
        lastActivity: ev.now,
      };
      if (next.until === null || next.until <= ev.now) {
        next.expression = baseExpressionOf(next);
        next.pose = basePoseOf(next);
        next.until = null;
      }
      return next;
    }
    case "send":
      // 用户发出消息:出拳把消息"送出去"(短反应,不抢流式的托腮思考)
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        expression: "happy",
        pose: "punch",
        until: ev.now + 700,
      };
    case "focus": {
      if (ev.on === s.windowFocused) return s;
      if (!ev.on) return { ...s, windowFocused: false };
      // 回归:唤醒 + 打个招呼(你回来了!)
      return {
        ...s,
        windowFocused: true,
        sleeping: false,
        lastActivity: ev.now,
        expression: "happy",
        pose: "hop",
        until: ev.now + 900,
      };
    }
    case "tick": {
      const typing = s.typing && ev.now - s.lastPress <= TYPE_IDLE_MS;
      const sleepAfter = s.windowFocused ? SLEEP_AFTER_MS : BLUR_SLEEP_MS;
      const sleeping = !s.talking && !s.listening && ev.now - s.lastActivity >= sleepAfter;
      const expired = s.until !== null && ev.now > s.until;
      if (s.sleeping === sleeping && s.typing === typing && !expired) return s;
      const next: CompanionState = { ...s, typing, sleeping };
      if (
        expired
        || (sleeping && s.expression !== "sleeping")
        || (typing !== s.typing && (s.until === null || expired))
      ) {
        next.expression = baseExpressionOf(next);
        next.pose = basePoseOf(next);
        next.until = null;
      }
      return next;
    }
  }
}

/* ---------------- 口型:viseme ---------------- */

/** viseme 判定门限(经验值,中文 TTS 频谱实测校准区间)。 */
export const VISEME_LEVEL_GATE = 0.06;
export const VISEME_CENTROID_LOW = 900;
export const VISEME_CENTROID_HIGH = 2200;

/** 响度+频谱质心 → 母音形状(海报化六档)。 */
export function computeViseme(level: number, centroidHz: number): Viseme {
  if (level <= VISEME_LEVEL_GATE) return "closed";
  if (centroidHz < VISEME_CENTROID_LOW) return level < 0.35 ? "U" : "O";
  if (centroidHz <= VISEME_CENTROID_HIGH) return "A";
  return level < 0.3 ? "I" : "E";
}

/** 开口度量化:5 档(0/.25/.5/.75/1),渲染层不接连续值防抖动。 */
export function mouthOpenScale(viseme: Viseme, level: number): number {
  if (viseme === "closed") return 0;
  const q = Math.min(1, Math.max(0, level));
  return Math.round(q * 4) / 4;
}

/**
 * AnalyserNode 原始数据 → { level, centroidHz, viseme }。
 *
 * level: 时域字节(128=零点)平均偏差归一 —— 响度。
 * centroid: 频域幅度加权平均频率 —— 元音共振峰分布的廉价代理
 *   (低质心=圆唇 A/O/U 家族,高质心=展唇 I/E 家族),与响度一起构成母音分档。
 * 全零输入安全:level=0、质心=0 → closed,无 NaN。
 */
export function audioToMouth(
  timeData: Uint8Array,
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { level: number; centroidHz: number; viseme: Viseme } {
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    sum += Math.abs(timeData[i]! - 128);
  }
  const level = timeData.length > 0 ? sum / timeData.length / 128 : 0;

  let magSum = 0;
  let weighted = 0;
  const binHz = sampleRate / fftSize;
  for (let i = 0; i < freqData.length; i++) {
    const m = freqData[i]! / 255;
    if (m <= 0) continue;
    magSum += m;
    weighted += m * i * binHz;
  }
  const centroidHz = magSum > 0 ? weighted / magSum : 0;
  return { level, centroidHz, viseme: computeViseme(level, centroidHz) };
}

/* ---------------- 视线几何 ---------------- */

export interface Gaze {
  x: number;
  y: number;
}

/** 钳制到 [-1,1](SVG 瞳孔位移的归一输入)。 */
export function clampGaze(x: number, y: number): Gaze {
  return {
    x: Math.min(1, Math.max(-1, x)),
    y: Math.min(1, Math.max(-1, y)),
  };
}

/** 指针坐标 → 相对注视中心的归一化视线(px,py 越远越趋向 ±1)。 */
export function gazeFromPointer(px: number, py: number, cx: number, cy: number, radius: number): Gaze {
  if (radius <= 0) return { x: 0, y: 0 };
  return clampGaze((px - cx) / radius, (py - cy) / radius);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ---------------- 闲置视线漫游 ---------------- */

/**
 * 指针静止 4s+ 时,视线定时漂到确定性的"随机"点(活体感,不是死盯屏)。
 * mulberry32 风格 LCG:同种子同值(测试要求),输出钳制在 ±0.75(不翻白眼)。
 */
export function wanderTarget(seed: number): Gaze {
  let t = (seed + 0x6d2b79f5) | 0;
  const step = () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
  };
  const x = step() * 2 - 1;
  const y = step() * 2 - 1;
  return clampGaze(x * 0.75, y * 0.75);
}

/* ---------------- 麦克风包络(听写声波弧) ---------------- */

/**
 * VU 表惯例包络:起音快(0.55)/释放慢(0.12)——声音瞬间顶起来,
 * 停话后缓缓落下。渲染层再过 micArcScale 量化,双保险防抖。
 */
export function smoothMic(prev: number, raw: number): number {
  const k = raw > prev ? 0.55 : 0.12;
  return prev + (raw - prev) * k;
}

/** 声波弧幅度 4 档量化(0/0.35/0.7/1):连续值直连 DOM 必抖。 */
export function micArcScale(level: number): number {
  if (level <= 0.02) return 0;
  if (level < 0.2) return 0.35;
  if (level < 0.55) return 0.7;
  return 1;
}

/* ---------------- 设置门控 ---------------- */

/**
 * companion_enabled 设置值 → 是否渲染伙伴。
 * 默认开(用户拍板「常驻低调可关」);仅显式 "false"/"0" 关闭,
 * 垃圾值不误伤。关闭 = 不渲染任何伙伴 DOM = 回滚到改动前行为。
 */
export function isCompanionEnabled(stored: string | null | undefined): boolean {
  return stored !== "false" && stored !== "0";
}
