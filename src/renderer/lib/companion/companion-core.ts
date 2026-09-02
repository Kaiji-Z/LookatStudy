/**
 * companion-core —— 伴学伙伴纯逻辑核(零 DOM / 零 IPC,headless 可测)。
 *
 * 三层职责:
 *   1. 庆祝→表情映射(expressionForCelebration):9 种 celebration kind → 表情/姿势/保持时长。
 *      产品红线:答错走「鼓励向」(encourage),绝不出现羞辱性反馈。
 *   2. 状态机(companionReducer):优先级 活动反应 > 听写 > 朗读 > 流式 > 睡觉 > 待机;
 *      反应带保持时长(holdMs),到期回落到当前标志位对应的 base 表情。
 *   3. 口型(computeViseme/audioToMouth):朗读音频的响度+频谱 → viseme
 *      (v9 九形:六母音+SS 齿擦/L 舌尖/FV 咬唇,见 shared SpeechViseme)
 *      + 开口度 5 档量化——「母音形状」而非单纯张嘴。
 *
 * DOM/事件接线在 bus.ts(订阅 celebration 总线 + state:changed + 用户活动),
 * 本文件被 verify-companion.mjs 直接 import,改这里必须跑套件。
 */
import type { CelebrationKind } from "../celebration.js";
import type { SpeechViseme } from "@shared/speech-types";

/** v9:viseme 词表与主进程剧本路径共用同一真源(shared/speech-types)。 */
export type Viseme = SpeechViseme;
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
  | "thinking"
  | "lean-right"
  | "typing"
  | "doze"
  | "flying"
  | "writing"
  | "wave"
  | "spin"
  | "point"
  | "pointr"
  | "pointu"
  | "pointd";

/** 伙伴所在的世界维度:左栏原生物理世界 / 中栏宠物世界 / 右栏助教世界。 */
export type CompanionZone = "rail" | "chat" | "notebook" | "roam";
/** 渲染栏(体型/坐标系维度)。v13 新增 titlebar:左栏不在场时的标题栏栖息地。 */
export type CompanionPane = "rail" | "chat" | "notebook" | "titlebar";

/**
 * v10 用户操作信号(最新者优先,双槽):聚焦=chat 槽,朗读/记笔记=notebook 槽,
 * 各记**激活时刻**。同时活跃时跟最新激活的(用户"边朗读边输入"→跟最新动作);
 * 各自取消(失焦/朗读停)或到期(note 短钉)后 → 闲时 roam(跨栏游走)。
 * 双槽而非单对象:talking 覆盖 focus 的单对象会在 talking 结束时把仍在场的
 * focus 一起丢掉(实测踩过)。
 */
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
  /** v10 最近一次键入的可见字符(胸屏显示;非打印键为 null) */
  lastKey: string | null;
  /** v0.18 最近一次按键类别(char/back/enter/other;Enter=胸屏 → 闪发/小跳) */
  lastKeyKind: "char" | "back" | "enter" | "other";
  /** v0.18 退格连击(1.5s 窗内计数;≥3 → 汗滴担忧) */
  backStreak: number;
  lastBackAt: number;
  /** v0.18 键击爆发窗(3s 内 ≥6 键 → 专注表情/眉聚) */
  burstStart: number;
  burstN: number;
  /** v0.18 打字暂停相位(0/1/2,见 pausePhaseOf;存进状态让 tick 的提前返回能感知相位转移) */
  pausePhase: 0 | 1 | 2;
  /** v11 连续答对计数(wrong 清零;≥3 触发 flame 连击情绪) */
  correctStreak: number;
  /** v11 勾销动作保持到(卡点掌握→本子上打金勾) */
  noteTickUntil: number;
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
  /** v10 chat 槽激活时刻(聚焦中);null=未聚焦 */
  zoneChatAt: number | null;
  /** v10 notebook 槽激活时刻(朗读中/记笔记钉住);null=未激活 */
  zoneNbAt: number | null;
  /** v10 notebook 槽到期(note 短钉;0=朗读态不过期) */
  zoneNbUntil: number;
  /** 记笔记动作的保持截止(划线触发,短暂把他钉在右栏) */
  lastNoteUntil: number;
  /** 最近一次滚动时刻(滚动=用户在阅读,不唤醒,反而催他入纱帘) */
  lastScroll: number;
  /** 戳击序号(poke 反应花样轮换:跳跳/挥手/转圈) */
  pokeSeq: number;
  /** 课程导入进行中(监工模式:豁免纱帘,守在导入面板旁) */
  importing: boolean;
  /** 章节考试进行中(v0.19:静栖计时区,庆祝动作/漫游静默,不抢考生注意力) */
  examActive: boolean;
  /** 被用户抓住(挣扎表情,物理由渲染层接管) */
  grabbed: boolean;
  /** 被扔出去后的生气截止(晕眩结束→鼓脸) */
  huffyUntil: number;
}

export type CompanionEvent =
  | { type: "celebration"; kind: CelebrationKind; now: number }
  | { type: "examActive"; on: boolean; now: number }
  | { type: "poke"; now: number }
  | { type: "talking"; on: boolean; now: number }
  | { type: "listening"; on: boolean; now: number }
  | { type: "streaming"; on: boolean; now: number }
  | { type: "activity"; now: number }
  | { type: "press"; side: -1 | 1; now: number; key?: string; kind?: "char" | "back" | "enter" | "other" }
  | { type: "send"; now: number }
  | { type: "focus"; on: boolean; now: number }
  | { type: "zoneFocus"; on: boolean; now: number }
  | { type: "zoneNote"; now: number }
  | { type: "noteTick"; now: number }
  | { type: "scroll"; now: number }
  | { type: "swat"; now: number }
  | { type: "examEnter"; now: number }
  | { type: "importing"; on: boolean; now: number }
  | { type: "importDone"; ok: boolean; now: number }
  | { type: "reviewing"; on: boolean; now: number }
  | { type: "grab"; on: boolean; speed?: number; now: number }
  | { type: "nodePoint"; now: number }
  | { type: "whistle"; now: number }
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

/** v0.18 键击爆发窗:窗内 ≥6 键 → 专注(屏内思考眉) */
export const KEY_BURST_MS = 3_000;
export const KEY_BURST_FOCUS_N = 6;
/** v0.18 打字暂停相位:1.2~6s=抬头等待(listening),6~15s=若有所思(thinking) */
export const PAUSE_WAIT_MS = 6_000;
export const PAUSE_THINK_MS = 15_000;

/**
 * v0.18 QWERTY 物理键位 → 左右臂(真实键位取代机械交替,bot 像"看着键盘")。
 * 左半区=-1,右半区=1;未知键(空 code/IME Process 等)沿用交替 fallback。
 * 纯函数,verify 直测。
 */
const CODE_LEFT = new Set([
  "Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
  "Tab", "CapsLock", "ShiftLeft", "ControlLeft", "MetaLeft", "AltLeft",
  "Escape", "F1", "F2", "F3", "F4", "F5", "F6",
]);
const CODE_RIGHT = new Set([
  "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "Backspace",
  "Backslash", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Enter",
  "Comma", "Period", "Slash", "ShiftRight", "ControlRight", "MetaRight", "AltRight",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F7", "F8", "F9", "F10", "F11", "F12",
]);
const LETTER_LEFT = new Set("qwertyasdfgzxcvb");
export function sideFromCode(code: string, fallback: -1 | 1): -1 | 1 {
  if (code.startsWith("Key")) return LETTER_LEFT.has(code.slice(3).toLowerCase()) ? -1 : 1;
  if (code.startsWith("Digit")) return Number(code.slice(5)) <= 5 ? -1 : 1;
  if (CODE_LEFT.has(code)) return -1;
  if (CODE_RIGHT.has(code)) return 1;
  return fallback;
}

/**
 * v0.18 胸屏信号面板的击键脉冲条(确定性伪随机:同 keySeq 稳定,verify 直测)。
 * h=条高(4~11,两端收敛成包络),d=动画延迟 ms(左→右传播,像信号扫过)。
 */
export function scopeBars(keySeq: number, bars = 7): Array<{ h: number; d: number }> {
  const out: Array<{ h: number; d: number }> = [];
  for (let i = 0; i < bars; i++) {
    const x = Math.sin(keySeq * 12.9898 + i * 78.233) * 43758.5453;
    const r = x - Math.floor(x);
    const edge = i === 0 || i === bars - 1 ? 0.55 : 1;
    out.push({ h: 4 + r * 7 * edge, d: i * 22 });
  }
  return out;
}

/** v0.18 打字暂停相位(0=打字中/无,1=抬头等待,2=若有所思;纯函数) */
export function pausePhaseOf(s: Pick<CompanionState, "typing" | "lastPress">, now: number): 0 | 1 | 2 {
  if (s.lastPress === 0) return 0; // 从未打字=无暂停相位(测试用合成小时间戳,生产 lastPress=0 是"未打字"哨兵)
  if (s.typing && now - s.lastPress <= TYPE_IDLE_MS) return 0;
  const age = now - s.lastPress;
  if (age > TYPE_IDLE_MS && age <= PAUSE_WAIT_MS) return 1;
  if (age > PAUSE_WAIT_MS && age <= PAUSE_THINK_MS) return 2;
  return 0;
}

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
    lastKey: null,
    lastKeyKind: "other",
    backStreak: 0,
    lastBackAt: 0,
    burstStart: 0,
    burstN: 0,
    pausePhase: 0,
    correctStreak: 0,
    noteTickUntil: 0,
    lastPress: 0,
    windowFocused: true,
    zone: "roam",
    mode: "front",
    composerFocused: false,
    zoneSince: now,
    zoneChatAt: null,
    zoneNbAt: null,
    zoneNbUntil: 0,
    lastNoteUntil: 0,
    lastScroll: 0,
    pokeSeq: 0,
    importing: false,
    grabbed: false,
    huffyUntil: 0,
    examActive: false,
  };
}

/**
 * 当前意图指向的世界(v10:最新用户操作信号优先;无信号=roam 回左栏家)。
 * 与 state.zone 分离:zone 是"已经飞到",desired 是"应该去"——
 * 操作目标即时跟进;操作结束回 roam 要等 ZONE_RETURN_MS(别刚落输入框又抖走)。
 * 导入监工例外:importing 期间钉左栏值守。
 * v12:listening(听写语音模式)也算 chat 在场信号——按住说话时飞来陪听写
 * (voice 卡仍是 composer-card,锚点零改动)。
 */
export function desiredZone(s: CompanionState, now: number): CompanionZone {
  if (s.importing) return "rail";
  const nbActive = s.zoneNbAt !== null && (s.zoneNbUntil === 0 || now < s.zoneNbUntil);
  // v13 streaming(AI 流式回答/思考中)也算 chat 在场信号:飞到输入卡上空
  // 托腮思考,流式结束再回去该去的地方(thinking 表情/姿势由 basePoseOf 链出)
  const chatActive = s.zoneChatAt !== null || s.listening || s.streaming;
  if (!chatActive && !nbActive) return "roam";
  if (!chatActive) return "notebook";
  if (!nbActive) return "chat";
  // 双槽都在场:跟最新激活的
  return (s.zoneNbAt ?? 0) > (s.zoneChatAt ?? 0) ? "notebook" : "chat";
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
  if (s.streaming) return "thinking";
  if (s.sleeping) return "doze";
  if (s.typing) return "typing";
  return "float";
}

/** 纯 reducer:同一事件序列必得同一状态(React StrictMode 安全)。 */
export function companionReducer(s: CompanionState, ev: CompanionEvent): CompanionState {
  switch (ev.type) {
    case "celebration": {
      // 入睡中被庆祝事件唤醒(庆祝本身即活动)
      // v0.19 考试静栖:答题中不做庆祝动作(出拳/跳跃/粒子式 pose 全静默),
      // 只保留 800ms 的轻表情——在场陪考但不抢注意力
      if (s.examActive) {
        const lite = expressionForCelebration(ev.kind);
        return {
          ...s,
          sleeping: false,
          lastActivity: ev.now,
          expression: lite.expression,
          pose: "float",
          until: ev.now + 800,
        };
      }
      // v11 情绪层:连对计数(correct+1 / wrong 清零);每满 3 连对叠 flame
      // 得意反应(盖过单次 correct 的普通开心——连击值得更亮的正反馈)
      const streak = ev.kind === "correct" ? s.correctStreak + 1 : ev.kind === "wrong" ? 0 : s.correctStreak;
      const r = expressionForCelebration(ev.kind);
      const onFire = ev.kind === "correct" && streak >= 3 && streak % 3 === 0;
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        correctStreak: streak,
        expression: onFire ? "flame" : r.expression,
        pose: onFire ? "spin" : r.pose,
        until: ev.now + (onFire ? 1600 : r.holdMs),
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
      // v10 最新信号:朗读开 = notebook 信号(覆盖更早的聚焦信号);
      // 朗读停 = 清掉自己的信号(回 roam 的 grace 从此刻起算)
      if (ev.type === "talking") {
        if (ev.on) {
          next.zoneNbAt = ev.now;
          next.zoneNbUntil = 0; // 朗读态不过期,停了才清
        } else if (next.zoneNbAt !== null) {
          next.zoneNbAt = null;
          next.zoneSince = ev.now;
        }
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
      // Bongo Cat 式逐键:每次键击/点击都定向按压一只臂,唤醒入睡。
      // v0.18 键盘反馈分型:char=常规(爆发窗≥6键→专注眉)/back=退格连击
      // (≥3/1.5s→汗滴担忧)/enter=交接仪式(小跳+胸屏→闪发)。
      const kind = ev.kind ?? (ev.key != null ? "char" : "other");
      const next: CompanionState = {
        ...s,
        sleeping: false,
        typing: true,
        keySeq: s.keySeq + 1,
        keySide: ev.side,
        lastPress: ev.now,
        lastActivity: ev.now,
        lastKey: ev.key ?? null,
        lastKeyKind: kind,
      };
      if (kind === "back") {
        next.backStreak = ev.now - s.lastBackAt <= 1_500 ? s.backStreak + 1 : 1;
        next.lastBackAt = ev.now;
      } else {
        next.backStreak = 0;
      }
      // 爆发窗:3s 内连续 ≥6 键 → 打字进入专注态(屏内思考眉)
      if (ev.now - s.burstStart > KEY_BURST_MS) {
        next.burstStart = ev.now;
        next.burstN = 1;
      } else {
        next.burstN = s.burstN + 1;
      }
      if (kind === "back" && next.backStreak >= 3) {
        // 连续返工(打错在改的信号):屏角冒汗,不打扰不评判
        next.expression = "encourage";
        next.pose = "float";
        next.until = ev.now + 1_400;
      } else if (kind === "enter") {
        // 回车=「我打完了,该你了」的交接:小跳 + 胸屏 → 闪发
        next.expression = "happy";
        next.pose = "hop";
        next.until = ev.now + 800;
      } else {
        if (next.until === null || next.until <= ev.now) {
          next.expression = baseExpressionOf(next);
          next.pose = basePoseOf(next);
          next.until = null;
        }
        if (kind === "char" && next.burstN >= KEY_BURST_FOCUS_N && (next.until ?? 0) <= ev.now) {
          next.expression = "thinking";
          next.until = ev.now + 800; // 每键续期:持续快打=持续专注,停手 0.8s 自然回落
        }
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
      // v10:聚焦 = chat 槽激活;失焦清槽(回 roam 的 grace 从此刻起算)
      if (ev.on) next.zoneChatAt = ev.now;
      else if (next.zoneChatAt !== null) {
        next.zoneChatAt = null;
        next.zoneSince = ev.now;
      }
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
      next.zoneNbAt = ev.now;
      next.zoneNbUntil = ev.now + NOTE_HOLD_MS;
      next.lastNoteUntil = ev.now + NOTE_HOLD_MS;
      next.expression = "base";
      next.pose = "writing";
      next.until = next.lastNoteUntil;
      return next;
    }
    case "noteTick":
      // v11 卡点掌握:掏本打金勾的自豪小动作(勾销"这条我记过,现在会了")
      return {
        ...s,
        sleeping: false,
        lastActivity: ev.now,
        noteTickUntil: ev.now + 1900,
        expression: "proud",
        pose: "writing",
        until: ev.now + 1900,
      };
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
    case "examActive":
      // v0.19 考试静栖:开考钉住计时区(渲染层 exam 分支),交卷恢复
      return { ...s, examActive: ev.on, lastActivity: ev.now, mode: ev.on ? "front" : s.mode };
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
        pose: "thinking",
        until: ev.now + 2600,
      };
    case "whistle":
      // 吹哨召唤应答:被叫到 → 开心+挥手"来啦"(飞行途中就挥,落定继续挥)
      return {
        ...s,
        sleeping: false,
        mode: "front",
        lastActivity: ev.now,
        expression: "happy",
        pose: "wave",
        until: ev.now + 2400,
      };
    case "tick": {
      const typing = s.typing && ev.now - s.lastPress <= TYPE_IDLE_MS;
      const phase = pausePhaseOf(s, ev.now);
      const sleepAfter = s.windowFocused ? SLEEP_AFTER_MS : BLUR_SLEEP_MS;
      const sleeping = !s.talking && !s.listening && !s.grabbed && ev.now - s.lastActivity >= sleepAfter;
      const expired = s.until !== null && ev.now > s.until;
      // zone 演进(v10):操作目标(chat/notebook/rail)即时跟进;
      // 无信号回 roam 要等 ZONE_RETURN_MS(驻足片刻再开始游走)
      const want = desiredZone(s, ev.now);
      let zone = s.zone;
      let zoneSince = s.zoneSince;
      if (want !== s.zone) {
        if (want !== "roam") {
          zone = want;
          zoneSince = ev.now;
        } else if (
          ev.now - s.zoneSince >= ZONE_RETURN_MS
          // v13 笔记动作结束=直接回家:nb 槽是定时信号(zoneNbUntil≠0)且已到期
          // 时跳过 ZONE_RETURN_MS 防抖——写作姿势 2.2s 本身就是驻留,再在讲解
          // 面板右上肩多呆 3.5s 是用户实测点名的"多余停留"(talking 是非定时
          // 信号 zoneNbUntil=0,朗读结束仍走防抖不受影响)
          || (s.zoneNbUntil !== 0 && ev.now >= s.zoneNbUntil)
        ) {
          zone = "roam";
          zoneSince = ev.now;
        }
      } else {
        zoneSince = ev.now;
      }
      const mode = veilDecision(s, ev.now) ? "veil" : "front";
      if (
        s.sleeping === sleeping && s.typing === typing && !expired
        && zone === s.zone && mode === s.mode && phase === s.pausePhase
      ) return s;
      const next: CompanionState = { ...s, typing, sleeping, zone, zoneSince, mode, pausePhase: phase };
      if (
        expired
        || (sleeping && s.expression !== "sleeping")
        || (typing !== s.typing && (s.until === null || expired))
        || (zone !== s.zone && (next.until === null || expired))
        || (phase !== s.pausePhase && (s.until === null || expired))
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
          // v0.18 打字暂停的呼吸感:刚停(1.2~6s)抬头等待,停久(6~15s)若有所思
          if (phase === 1 && !sleeping && !next.talking && !next.listening) {
            next.expression = "listening";
          } else if (phase === 2 && !sleeping && !next.talking && !next.listening) {
            next.expression = "thinking";
          }
        }
      }
      return next;
    }
  }
}

/* ---------------- 口型:viseme(共振峰法,v7) ---------------- */

/** viseme 判定门限(经验值,中文 TTS 频谱实测校准区间)。 */
export const VISEME_LEVEL_GATE = 0.06;
export const VISEME_CENTROID_LOW = 900;
export const VISEME_CENTROID_HIGH = 2200;

/** F1/F2 共振峰频段(Hz):第一共振峰≈开口度,第二共振峰≈舌位前后(圆/展唇)。 */
export const FORMANT_F1_BAND = { lo: 180, hi: 900 };
export const FORMANT_F2_BAND = { lo: 900, hi: 3200 };

/**
 * 共振峰 → 母音(声学元音三角,viseme 最佳实践):按 F1/F2 与五个元音锚点的
 * 最近邻判位。坐标归一:F2 700..2500Hz → x(低=圆唇侧),F1 220..900Hz → y(高=开口)。
 * 锚点取普通话声学元音图的近似:A(开·中前) E(半开·前) I(闭·前展) O(半闭·后圆) U(闭·后圆)。
 */
export function visemeFromFormants(f1: number, f2: number, level: number): Viseme {
  if (level <= VISEME_LEVEL_GATE) return "closed";
  const x = Math.min(1, Math.max(0, (f2 - 700) / 1800));
  const y = Math.min(1, Math.max(0, (f1 - 220) / 680));
  const anchors: Array<[Viseme, number, number]> = [
    ["A", 0.42, 0.95],
    ["E", 0.78, 0.55],
    ["I", 0.95, 0.18],
    ["O", 0.12, 0.45],
    ["U", 0.03, 0.12],
  ];
  let best: Viseme = "A";
  let bestD = Infinity;
  for (const [v, ax, ay] of anchors) {
    const d = (x - ax) * (x - ax) + (y - ay) * (y - ay);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** 响度+频谱质心 → 母音形状(海报化六档;v7 起主路径是共振峰法,此函数保留作回退)。 */
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
 * AnalyserNode 原始数据 → { level, centroidHz, f1, f2, viseme }。
 *
 * level: 时域字节(128=零点)平均偏差归一 —— 响度。
 * F1/F2: 共振峰频段的幅度加权质心(v7,元音判位主路径);全零频段回退典型值。
 * centroid: 频域幅度加权平均频率(整体质心,保留作诊断/回退)。
 * 全零输入安全:level=0 → closed,无 NaN。
 */
export function audioToMouth(
  timeData: Uint8Array,
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { level: number; centroidHz: number; f1: number; f2: number; viseme: Viseme } {
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    sum += Math.abs(timeData[i]! - 128);
  }
  const level = timeData.length > 0 ? sum / timeData.length / 128 : 0;

  let magSum = 0;
  let weighted = 0;
  let m1 = 0;
  let w1 = 0;
  let m2 = 0;
  let w2 = 0;
  const binHz = sampleRate / fftSize;
  for (let i = 0; i < freqData.length; i++) {
    const freq = i * binHz;
    const m = freqData[i]! / 255;
    if (m <= 0) continue;
    magSum += m;
    weighted += m * freq;
    if (freq >= FORMANT_F1_BAND.lo && freq < FORMANT_F1_BAND.hi) {
      m1 += m;
      w1 += m * freq;
    } else if (freq >= FORMANT_F2_BAND.lo && freq < FORMANT_F2_BAND.hi) {
      m2 += m;
      w2 += m * freq;
    }
  }
  const centroidHz = magSum > 0 ? weighted / magSum : 0;
  const f1 = m1 > 0 ? w1 / m1 : 400;
  const f2 = m2 > 0 ? w2 / m2 : 800;
  return { level, centroidHz, f1, f2, viseme: visemeFromFormants(f1, f2, level) };
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

/* ---------------- 栏内锚点世界(v5/v6) ---------------- */

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

/**
 * v8 右栏徘徊:讲解面板右侧空白带的确定性游弋(慢利萨茹,双频不同步=永不重样)。
 * x 走右侧宽带(留出正文列),y 避开顶部标签/朗读按钮安全带与底缘。
 */
export function wanderInPanel(
  panel: { left: number; right: number; top: number; bottom: number },
  size: number,
  tMs: number,
): { x: number; y: number } {
  const half = size / 2;
  const xR = panel.right - half - 14;
  const xL = Math.max(panel.left + half + 14, panel.right - half * 2.6);
  const xMid = (xR + xL) / 2;
  const xAmp = Math.max(0, (xR - xL) / 2);
  const yTop = panel.top + 96 + half;
  const yBot = panel.bottom - half - 16;
  const yMid = (yTop + yBot) / 2;
  const yAmp = Math.max(0, (yBot - yTop) / 2);
  return {
    x: xMid + Math.sin(tMs / 5200) * xAmp + Math.sin(tMs / 1700) * (xAmp * 0.22),
    y: yMid + Math.sin(tMs / 3900) * yAmp,
  };
}

/** 朗读跟句:生物边距(离句末的水平空隙)。 */
export const READING_MARGIN = 14;

/**
 * 朗读跟句锚点(v10:句尾右下角跟随)。mark = 高亮句**最后一行片段**的矩形
 * (Range.getClientRects() 末位):生物栖在句尾右下方——
 *   ①不遮朗读文字(永远在最后一个字的下/右侧留白);
 *   ②窄屏也不出讲解区(x/y 全程钳制在面板内——旧"右侧优先换左侧"方案在窄屏
 *     会把锚点推到面板外,这是"窄屏朗读时 bot 离开讲解区"的根因)。
 * 空间不够时的退让次序:右下 → 句尾正下 → 面板右下安全位。
 * side=手指方向(生物在字的右侧/下方 → 指左 "left")。
 */
export interface LineBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * v11.5 朗读/画线跟随锚点(整句零遮挡版)。
 *
 * 用户拍板规则:**生物不压正在高亮的句子**(压未高亮文字可接受);高亮句有
 * 多行时**每行都是障碍物**。候选序(逐个以核心盒 vs 全部行盒做零重叠校验):
 *  ① 整句右侧(精灵整盒横向净空,像页边批注,横向指向) —— 有侧边余量时的默认位;
 *  ② 整句左侧(镜像);
 *  ③ 整句正下方(核心盒贴句底下缘,压到的是下一句未高亮文字) —— 多行满宽句的主位;
 *  ④ 整句正上方(句贴面板底、③放不下时);
 * 全部撞句(极端窄屏):最小遮挡位 + occluding=true(渲染层半透明保读性)。
 * dir=手臂指向(生物在文字右侧→指左;在下方→指上…)。
 * sent=高亮句全部行盒(Range.getClientRects 非零矩形);缺省按首/末/整体框算。
 */
export type ReadingDir = "left" | "right" | "up" | "down";
export interface ReadingAnchor {
  x: number;
  y: number;
  /** 手臂指向(相对生物):文字在左=left … 文字在上方=up */
  dir: ReadingDir;
  /** true=所有候选都压句(极端窄屏),渲染层应半透明让出可读性 */
  occluding: boolean;
}

/** 生物核心占位盒(中心±0.4×size):精灵四肢/天线稀疏,核心档已保守 */
function coreBox(x: number, y: number, size: number): LineBox {
  const r = size * 0.4;
  return { left: x - r, right: x + r, top: y - r, bottom: y + r };
}
/** 核心盒(外扩 pad)是否与任一障碍行盒零重叠 */
function boxClear(b: LineBox, obs: readonly LineBox[], pad: number): boolean {
  for (const o of obs) {
    if (b.right + pad > o.left && b.left - pad < o.right && b.bottom + pad > o.top && b.top - pad < o.bottom) {
      return false;
    }
  }
  return true;
}
/** 核心盒与障碍行盒的总重叠面积(最小遮挡兜底用) */
function overlapSum(b: LineBox, obs: readonly LineBox[]): number {
  let s = 0;
  for (const o of obs) {
    const w = Math.min(b.right, o.right) - Math.max(b.left, o.left);
    const h = Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top);
    if (w > 0 && h > 0) s += w * h;
  }
  return s;
}

export function readingAnchorFlex(
  full: LineBox,
  panel: LineBox,
  size: number,
  lines?: { first?: LineBox; last?: LineBox },
  sent?: readonly LineBox[],
): ReadingAnchor {
  const half = size / 2;
  const core = size * 0.4; // 生物核心半径(四肢/天线稀疏,核心档已保守)
  const pad = 10;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const xMin = panel.left + half + pad;
  const xMax = panel.right - half - pad;
  const yMin = panel.top + half + pad;
  const yMax = panel.bottom - half - pad;
  const last = lines?.last ?? full;
  const first = lines?.first ?? full;
  // 障碍物 = 高亮句**全部行盒**(多行句每行都算——只让开末行会被上半身压住前面几行)
  const obs: readonly LineBox[] = sent && sent.length ? sent : [first, last, full];

  const sentMaxR = Math.max(...obs.map((o) => o.right));
  const sentMinL = Math.min(...obs.map((o) => o.left));
  const cySent = (full.top + full.bottom) / 2;

  const raw: Array<{ x: number; y: number; dir: ReadingDir }> = [
    // ① 整句右侧(精灵整盒横向净空,贴着读+横向指向)
    { x: sentMaxR + half + 8, y: cySent, dir: "left" },
    // ② 整句左侧(镜像)
    { x: sentMinL - half - 8, y: cySent, dir: "right" },
    // ③ 整句正下方(核心盒贴句底下缘;压到的是**下一句**未高亮文字,可接受)
    { x: clamp(last.right + half * 0.4, xMin, xMax), y: full.bottom + core + 8, dir: "up" },
    // ④ 整句正上方(句贴面板底、下方放不下时)
    { x: clamp(first.left - half * 0.4, xMin, xMax), y: full.top - core - 8, dir: "down" },
  ];

  let fallback: { c: { x: number; y: number }; dir: ReadingDir; area: number } | null = null;
  for (const c of raw) {
    const cc = { x: clamp(c.x, xMin, xMax), y: clamp(c.y, yMin, yMax) };
    const box = coreBox(cc.x, cc.y, size);
    if (boxClear(box, obs, 6)) return { ...cc, dir: c.dir, occluding: false };
    const area = overlapSum(box, obs);
    if (!fallback || area < fallback.area) fallback = { c: cc, dir: c.dir, area };
  }
  // 全部撞句(极端窄屏):最小遮挡位 + occluding 回执(渲染层半透明保读性)
  const f = fallback ?? { c: { x: xMax, y: clamp(yMax - half * 0.1, yMin, yMax) }, dir: "left" as ReadingDir, area: 0 };
  return { ...f.c, dir: f.dir, occluding: true };
}

/* ---------------- v10 连续移动(限速滑翔,不闪现) ---------------- */

/** 巡航速度(px/ms):操作响应快、闲时游走慢、朗读跟句居中、回家从容。 */
export const CRUISE_OP = 0.85;
export const CRUISE_ROAM = 0.3;
export const CRUISE_READ = 0.6;
/** v12 召回制回家巡航:比赶场慢、比闲逛快——"办完事往回飞"读得出有来有往。 */
export const CRUISE_HOME = 0.5;

/**
 * 限速滑翔(v10 治"闪现"):指数趋近在远距时速度无界(跨栏一瞬到达=闪现感),
 * 封顶巡航速度后跨栏是一段看得见的飞行;近距仍用指数收敛(平滑落位)。
 */
export function glideTo(
  cur: { x: number; y: number },
  target: { x: number; y: number },
  dtMs: number,
  cruise: number,
  tau = 90,
): { x: number; y: number } {
  const k = 1 - Math.exp(-dtMs / tau);
  let x = cur.x + (target.x - cur.x) * k;
  let y = cur.y + (target.y - cur.y) * k;
  const dx = x - cur.x;
  const dy = y - cur.y;
  const d = Math.hypot(dx, dy);
  const cap = cruise * dtMs;
  if (d > cap && d > 0) {
    x = cur.x + (dx / d) * cap;
    y = cur.y + (dy / d) * cap;
  }
  return { x, y };
}

/** roam 栏驻留周期(ms):每个时间桶重估一次待机地。 */
export const ROAM_BUCKET_MS = 6_500;

/**
 * roam 下一栏(确定性)——**v12 召回制:游走只锁左栏**。
 * 中栏/右栏只在"有事"(输入框聚焦/朗读/记笔记等 duty 信号)时到场,办完回
 * 左栏家(desiredZone 的无信号态);左栏不在场(手机 T3/左栏收起/空态)由渲染层
 * 落左缘停靠(edgeHomeAnchor)。旧版环形跨栏游走(rail→chat→notebook,~30% 换栏)
 * 按用户反馈退役——闲时栖在正文栏会遮挡阅读。纯函数,verify 直测。
 */
export function nextRoamPane(_cur: CompanionPane, _bucket: number, _available: CompanionPane[]): CompanionPane {
  return "rail";
}

/**
 * 左缘停靠锚(纯,v12):左栏不在场时的家——半身探出屏幕左缘(趴在门框上等事),
 * 竖直方向落在视口中带并让开顶部禁入带;召唤事件从这里飞入,办完飞回这里。
 */
export function edgeHomeAnchor(
  vh: number,
  size: number,
  ceilBottom: number,
): { x: number; y: number } {
  const x = size * 0.34;
  const y = Math.min(Math.max(vh, size) * 0.46, Math.max(ceilBottom + size * 0.8, size * 0.8));
  return { x, y };
}

/**
 * 庆祝召唤栖位(纯,v12):答对/解锁时飞到事件源(题卡/复习卡/解锁球)的
 * 右上上空,视口右缘与顶部禁入带钳制。
 * v0.28 外推修正:origin 是题卡右上角内侧的点(QuizArtifact r.right-48),旧版
 * 只偏 +36px,身体半宽(~size/2 ≥36)会把身体骑在 origin 左侧的题干文字上
 * (实测踩过:压住选项行)。现在 x 至少外推 origin + 36 + 0.4×size,身体左缘
 * (中心-0.5×size)恒在 origin 右侧 ≥ 36-0.1×size——源点所在行不被身体覆盖,
 * 他悬在源的右上方,手臂向左下指向庆祝点。
 */
export function celebrationPerch(
  origin: { x: number; y: number },
  size: number,
  vw: number,
  ceilBottom: number,
): { x: number; y: number } {
  const x = Math.min(origin.x + 36 + size * 0.4, vw - size * 0.7);
  const y = Math.max(origin.y - 44, ceilBottom + size * 0.8);
  return { x, y };
}

/**
 * 标题栏栖息游走(纯,v13):左栏不在场(T3 未选左栏/未选课程/T2 无左栏)时的
 * 新家——缩小到标题栏高度,沿标题栏横向利萨茹缓游(全程 ~40s 一个来回),
 * y 钉在栏竖直中心。x 两端留 size*0.62 的安全边(不出头不贴边)。
 * 按钮避让不在这里做(渲染层按重叠切透明态,这里只管轨迹)。
 */
export function titlebarRoam(
  hdr: { left: number; right: number; top: number; bottom: number },
  size: number,
  now: number,
): { x: number; y: number } {
  const pad = size * 0.62;
  const span = Math.max(0, hdr.right - hdr.left - pad * 2);
  const x = hdr.left + pad + (0.5 + 0.42 * Math.sin(now / 6400 + 0.7)) * span;
  return { x, y: (hdr.top + hdr.bottom) / 2 };
}

/**
 * 用户手放落点的小范围徘徊(纯,v13):把伴学拖出标题栏松手后,他留在放置处
 * 附近 ±22/±16px 利萨茹小游——不回家也不满屏游走,用户觉得遮挡自然会再挪。
 */
export function manualHomeWander(home: { x: number; y: number }, now: number): { x: number; y: number } {
  return {
    x: home.x + Math.sin(now / 2900) * 22,
    y: home.y + Math.sin(now / 2100 + 1.3) * 16,
  };
}

/** v11 roam 目的性:闲逛时间桶上低概率产生"有想法"的意图。 */
export type RoamIntentKind = "inspect" | "review" | "friction";

/**
 * 意图挑选(纯函数):复习到期 > 打量下一课 > 回访卡点,按 seed 确定性低频触发。
 * opts 各布尔 = 该意图的素材是否在场(复习徽章/下一课球/卡点球位置)。
 * 返回 null = 本桶照常闲逛。
 */
export function pickRoamIntent(
  bucket: number,
  opts: { hasReview: boolean; hasNext: boolean; hasFriction: boolean },
): RoamIntentKind | null {
  const r = Math.abs(Math.sin(bucket * 7.3171 + 2.41) * 43758.5453) % 1;
  if (r >= 0.34) return null; // 大多数桶照常游走——意图是调味,不是常态
  if (r < 0.12 && opts.hasReview) return "review";
  if (r < 0.23 && opts.hasNext) return "inspect";
  if (opts.hasFriction) return "friction";
  return null;
}

/** 意图保持时长(ms)与触发概率的导出(verify 断言用)。 */
export const INTENT_HOLD_MS = 3_000;

/* ---------------- 设置门控 ---------------- */

/**
 * companion_enabled 设置值 → 是否渲染伙伴。
 * 默认开(用户拍板「常驻低调可关」);仅显式 "false"/"0" 关闭,
 * 垃圾值不误伤。关闭 = 不渲染任何伙伴 DOM = 回滚到改动前行为。
 */
export function isCompanionEnabled(stored: string | null | undefined): boolean {
  return stored !== "false" && stored !== "0";
}
