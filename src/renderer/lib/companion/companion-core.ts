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
  | "surprised"
  | "huffy"
  | "sleeping";

export type CompanionPose =
  | "float"
  | "hop"
  | "punch"
  | "oops"
  | "lean-left"
  | "lean-right"
  | "typing"
  | "doze"
  | "flying"
  | "writing"
  | "wave"
  | "spin";

/** 伙伴所在的世界维度:左栏原生物理世界 / 中栏宠物世界 / 右栏助教世界。 */
export type CompanionZone = "rail" | "chat" | "notebook";
/** 前台 = 完全在场;纱帘后 = 半透明隐匿待机(可点击唤醒)。 */
export type CompanionMode = "front" | "veil";

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
  /** 所在世界维度(v3 单生物:一只,跨栏连续行动) */
  zone: CompanionZone;
  /** 前台/纱帘后 */
  mode: CompanionMode;
  /** 对话输入框聚焦(中栏宠物世界的触发闩) */
  composerFocused: boolean;
  /** 进入当前 zone 的时刻(zone 返回计时的基准) */
  zoneSince: number;
  /** 记笔记动作的保持截止(划线触发,短暂把他钉在右栏) */
  lastNoteUntil: number;
  /** 最近一次滚动时刻(滚动=用户在阅读,不唤醒,反而催他入纱帘) */
  lastScroll: number;
  /** 戳击序号(poke 反应花样轮换:跳跳/挥手/转圈) */
  pokeSeq: number;
  /** 课程导入进行中(监工模式:豁免纱帘,守在导入面板旁) */
  importing: boolean;
  /** 被用户抓住(挣扎表情,物理由渲染层接管) */
  grabbed: boolean;
  /** 被扔出去后的生气截止(晕眩结束→鼓脸) */
  huffyUntil: number;
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
  | { type: "zoneFocus"; on: boolean; now: number }
  | { type: "zoneNote"; now: number }
  | { type: "scroll"; now: number }
  | { type: "swat"; now: number }
  | { type: "examEnter"; now: number }
  | { type: "importing"; on: boolean; now: number }
  | { type: "importDone"; ok: boolean; now: number }
  | { type: "reviewing"; on: boolean; now: number }
  | { type: "grab"; on: boolean; speed?: number; now: number }
  | { type: "nodePoint"; now: number }
  | { type: "dayWelcome"; now: number }
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

/** 触发消失(失焦输入框/朗读结束)后多久飞回左栏老家 */
export const ZONE_RETURN_MS = 3_500;

/** 无交互活动多久躲进纱帘(待机隐匿) */
export const VEIL_AFTER_MS = 9_000;

/** 滚动进行中(用户在阅读)时,无交互多久就入纱帘(比纯空闲快) */
export const VEIL_SCROLL_GRACE_MS = 1_600;
export const VEIL_SCROLL_AFTER_MS = 2_500;

/** 到线记笔记动作的保持时长 */
export const NOTE_HOLD_MS = 2_200;

/** 被球拍中后的晕眩时长(自由翻滚,控制器断开) */
export const SWAT_DIZZY_MS = 900;

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
    zone: "rail",
    mode: "front",
    composerFocused: false,
    zoneSince: now,
    lastNoteUntil: 0,
    lastScroll: 0,
    pokeSeq: 0,
    importing: false,
    grabbed: false,
    huffyUntil: 0,
  };
}

/**
 * 当前意图指向的世界(优先级:输入框聚焦 > 朗读/记笔记 > 回左栏老家)。
 * 与 state.zone 分离:zone 是"已经飞到",desired 是"应该去"——
 * 回老家要等 ZONE_RETURN_MS(别让他刚落输入框又抖走),进中/右栏则立即。
 */
export function desiredZone(s: CompanionState, now: number): CompanionZone {
  if (s.composerFocused) return "chat";
  if (s.talking || now < s.lastNoteUntil) return "notebook";
  return "rail";
}

/** 纱帘判定:无交互且不在任务中 → 隐匿待机;滚动中(阅读)更快入帘。 */
export function veilDecision(s: CompanionState, now: number): boolean {
  if (s.composerFocused || s.talking || s.listening || s.streaming || s.importing || s.grabbed) return false;
  const idle = now - s.lastActivity;
  const scrolling = now - s.lastScroll < VEIL_SCROLL_GRACE_MS;
  return idle > VEIL_AFTER_MS || (scrolling && idle > VEIL_SCROLL_AFTER_MS);
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
    case "poke": {
      // 戳他=从纱帘后唤醒到前台 + 打招呼;反应花样轮换(跳跳/挥手/转圈)
      const POKE_POSES: CompanionPose[] = ["hop", "wave", "spin"];
      const POKE_HOLD: Record<string, number> = { hop: 900, wave: 1100, spin: 800 };
      const seq = s.pokeSeq + 1;
      const pose = POKE_POSES[seq % POKE_POSES.length]!;
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        mode: "front",
        pokeSeq: seq,
        expression: "happy",
        pose,
        until: ev.now + (POKE_HOLD[pose] ?? 900),
      };
    }
    case "talking":
    case "listening":
    case "streaming": {
      const next: CompanionState = { ...s };
      if (ev.type === "talking") next.talking = ev.on;
      if (ev.type === "listening") next.listening = ev.on;
      if (ev.type === "streaming") next.streaming = ev.on;
      // 语音相关标志翻转都算用户在场
      next.lastActivity = ev.now;
      next.mode = "front";
      if (ev.on) next.sleeping = false;
      // 朗读开 = 助教上岗(右栏);输入框仍聚焦时宠物身份优先,不动
      if (ev.type === "talking" && ev.on && !next.composerFocused && next.zone !== "notebook") {
        next.zone = "notebook";
        next.zoneSince = ev.now;
      }
      // 朗读结束 = 返回窗口起点(释放起算,不吃在栏时间)
      if (ev.type === "talking" && !ev.on && next.zone === "notebook" && !next.composerFocused) {
        next.zoneSince = ev.now;
      }
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
        mode: "front",
        expression: "happy",
        pose: "punch",
        until: ev.now + 700,
      };
    case "zoneFocus": {
      // 输入框聚焦/失焦:聚焦=落上输入框(中栏宠物世界),失焦=闩松开(tick 收尾回家)
      const next: CompanionState = {
        ...s,
        composerFocused: ev.on,
        lastActivity: ev.now,
        mode: "front",
      };
      if (ev.on && next.zone !== "chat") {
        next.zone = "chat";
        next.zoneSince = ev.now;
      }
      // 释放时机 = 返回窗口的起点(别从进栏时刻起算,那会吃掉在栏时间)
      if (!ev.on && next.zone === "chat") next.zoneSince = ev.now;
      return next;
    }
    case "zoneNote": {
      // 用户划线加笔记:飞去右栏(助教世界)做记笔记动作,短暂钉住
      const next: CompanionState = {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        mode: "front",
      };
      if (next.zone !== "notebook") {
        next.zone = "notebook";
        next.zoneSince = ev.now;
      }
      next.lastNoteUntil = ev.now + NOTE_HOLD_MS;
      next.expression = "base";
      next.pose = "writing";
      next.until = next.lastNoteUntil;
      return next;
    }
    case "scroll":
      // 滚动不唤醒(阅读是被动行为),只推进纱帘判定
      return s.lastScroll === ev.now ? s : { ...s, lastScroll: ev.now };
    case "swat":
      // 被球拍中:晕眩惊吓(自由翻滚由物理层负责,这里只管表情)
      return {
        ...s,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: "surprised",
        pose: "flying",
        until: ev.now + SWAT_DIZZY_MS,
      };
    case "focus": {
      if (ev.on === s.windowFocused) return s;
      if (!ev.on) return { ...s, windowFocused: false };
      // 回归:唤醒 + 挥手打招呼(你回来了!)
      return {
        ...s,
        windowFocused: true,
        sleeping: false,
        lastActivity: ev.now,
        mode: "front",
        expression: "happy",
        pose: "wave",
        until: ev.now + 1100,
      };
    }
    case "examEnter": {
      // 进考试节点:加油打气(cheer+挥手),之后 tick 自然入纱帘(考试零干扰红线)
      return {
        ...s,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: "cheer",
        pose: "wave",
        until: ev.now + 1500,
      };
    }
    case "importing":
      // 导入监工:进行中豁免纱帘守在面板旁;结束交棒给 importDone 反应
      return { ...s, importing: ev.on, lastActivity: ev.now, mode: ev.on ? "front" : s.mode };
    case "importDone": {
      // 导入结束:成功=星星眼欢呼,失败=鼓励(不嘲讽)
      const ok = ev.ok;
      return {
        ...s,
        importing: false,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: ok ? "stars" : "encourage",
        pose: ok ? "hop" : "oops",
        until: ev.now + (ok ? 1600 : 1200),
      };
    }
    case "reviewing":
      // 复习抽屉开:自豪挥手待命(关=无动作)
      return ev.on
        ? {
            ...s,
            sleeping: false,
            mode: "front",
            lastActivity: ev.now,
            expression: "proud",
            pose: "wave",
            until: ev.now + 1100,
          }
        : { ...s, lastActivity: ev.now };
    case "grab": {
      // 抓住:挣扎(surprised+flying);松手快=扔出(晕眩,之后鼓脸生气),慢=放回
      if (ev.on) {
        return {
          ...s,
          grabbed: true,
          sleeping: false,
          mode: "front",
          lastActivity: ev.now,
          expression: "surprised",
          pose: "flying",
          until: null,
        };
      }
      const thrown = (ev.speed ?? 0) >= 2.5;
      return {
        ...s,
        grabbed: false,
        lastActivity: ev.now,
        expression: thrown ? "surprised" : "happy",
        pose: thrown ? "flying" : "hop",
        until: ev.now + (thrown ? SWAT_DIZZY_MS : 800),
        huffyUntil: thrown ? ev.now + SWAT_DIZZY_MS + 1600 : s.huffyUntil,
      };
    }
    case "dayWelcome":
      // 隔天回来:星星眼转圈的加倍欢迎(streak 的 lastActiveDate < 今天)
      return {
        ...s,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: "stars",
        pose: "spin",
        until: ev.now + 1700,
      };
    case "nodePoint":
      // 记忆联动:飞到昨天卡点旁,托腮"就是这里"的指向反应
      return {
        ...s,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: "thinking",
        pose: "lean-left",
        until: ev.now + 2600,
      };
    case "tick": {
      const typing = s.typing && ev.now - s.lastPress <= TYPE_IDLE_MS;
      const sleepAfter = s.windowFocused ? SLEEP_AFTER_MS : BLUR_SLEEP_MS;
      const sleeping = !s.talking && !s.listening && !s.grabbed && ev.now - s.lastActivity >= sleepAfter;
      const expired = s.until !== null && ev.now > s.until;
      // zone 演进:进中/右栏立即(desired != rail),回老家要等 ZONE_RETURN_MS
      const want = desiredZone(s, ev.now);
      let zone = s.zone;
      let zoneSince = s.zoneSince;
      if (want !== s.zone) {
        if (want !== "rail") {
          zone = want;
          zoneSince = ev.now;
        } else if (ev.now - s.zoneSince >= ZONE_RETURN_MS) {
          zone = "rail";
          zoneSince = ev.now;
        }
      } else {
        zoneSince = ev.now;
      }
      const mode = veilDecision(s, ev.now) ? "veil" : "front";
      if (
        s.sleeping === sleeping && s.typing === typing && !expired
        && zone === s.zone && mode === s.mode
      ) return s;
      const next: CompanionState = { ...s, typing, sleeping, zone, zoneSince, mode };
      if (
        expired
        || (sleeping && s.expression !== "sleeping")
        || (typing !== s.typing && (s.until === null || expired))
        || (zone !== s.zone && (next.until === null || expired))
      ) {
        // 被扔后的余怒:晕眩结束且无别的反应压着 → 鼓脸生气(huffy)
        if (expired && next.expression === "surprised" && ev.now < s.huffyUntil && !next.grabbed) {
          next.expression = "huffy";
          next.pose = "oops";
          next.until = s.huffyUntil;
        } else {
          next.expression = baseExpressionOf(next);
          next.pose = basePoseOf(next);
          next.until = null;
        }
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

/* ---------------- 栏内锚点世界(v5) ---------------- */

/** chat 世界"探出输入框"最多藏掉的底部百分比:腿脚隐进卡片后面,手臂全露在外面拍键。 */
export const PEEK_CLIP_MAX = 34;

/**
 * chat 世界裁剪:生物下半身藏进输入卡后面(视觉=被卡片挡住,实现=clip-path)。
 * centerY/size=生物中心与边长,edgeY=卡片上缘的视口 y。藏多少 = 底边低于上缘的部分;
 * 完全在上缘之上 → 0(飞行途中自然不裁);封顶 PEEK_CLIP_MAX 保头和手臂永远可见。
 */
export function peekClipPct(centerY: number, size: number, edgeY: number): number {
  const hidden = centerY + size / 2 - edgeY;
  if (hidden <= 0) return 0;
  return Math.min(PEEK_CLIP_MAX, (hidden / size) * 100);
}

/**
 * chat/notebook 世界的锚点漂浮(慢利萨茹):他不是钉死的,在小范围内轻轻游动。
 * chat 幅度稍大(输入框上空开阔);notebook 收敛(讲解正文旁别晃眼)。
 */
export function zoneDrift(zone: "chat" | "notebook", tMs: number): { x: number; y: number } {
  if (zone === "chat") {
    return {
      x: Math.sin(tMs / 1900) * 9 + Math.sin(tMs / 530) * 1.5,
      y: Math.sin(tMs / 1300) * 5,
    };
  }
  return { x: Math.sin(tMs / 2300) * 5, y: Math.sin(tMs / 1500) * 4 };
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
