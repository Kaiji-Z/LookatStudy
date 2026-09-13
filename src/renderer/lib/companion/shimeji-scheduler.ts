/**
 * shimeji-scheduler —— Shimeji 第 7 形态的自主动作状态机(纯函数,零 DOM/零 React)。
 *
 * 二期(贴边物理, SPEC-shimeji.md §5):在包语义(动作 kind + slot 归档)上映射
 * 窗口环境——ground(地面 idle/步行/坐下/躺平)· wall(爬墙)· ceiling(爬顶)·
 * air(扔出坠落,重力积分)· settle(落地缓冲)· dragged(被抓挣扎)。
 *
 * 职责边界:壳(CompanionCreature/flight)拥有屏幕坐标与拖拽运输(抓取跟手/
 * 快扔飞行/throwDizzy),本机只负责生物自己的动作语义与舞台局部运动学。
 * companion-grab 事件进来 → 挣扎帧;松手 speed≥THROW_MIN_SPEED(与壳 throwDizzy
 * 同阈)→ air 重力坠落 → 落地 settle → 回地面策略。飞行器跨栏运输手感留用户拍板。
 *
 * slot 来源:导入时主进程从 88 归档表烘焙进 manifest(archiveOf);一期旧包无
 * slot → 按 kind 退化(Stay=idle,Move=walk,名字含 sit/sprawl=rest),行为不回归。
 * verify-shimeji T7-T10 直测本文件(注入 rng 可复现)。
 */
import type { ShimejiPackManifestT } from "@shared/types.ts";

export type ShimejiActionT = ShimejiPackManifestT["actions"][number];

export type ShimejiMode = "ground" | "wall" | "ceiling" | "air" | "dragged" | "settle";

/** 沙盒四界(舞台局部坐标:200×192,脚底线 192)。 */
export interface ShimejiSandbox {
  groundY: number;
  ceilY: number;
  minX: number;
  maxX: number;
}

/** 默认沙盒(SVG 舞台局部;墙=舞台边)。
    x 收紧到 64..136(2026-09-12 实测反馈"偏移到外部"):脚点±36=精灵半宽,
    保证 128 宽帧图任何时刻完整在舞台内(旧 28..172 贴边时半身出血)。
    运行时由 shimeji-form 每 tick 测量可见容器(composer 卡/讲解面板)边缘,
    按 2026-09-12 用户拍板把"墙"对齐到可见容器边缘后经 tickShimeji 覆盖。 */
export const SHIMEJI_SANDBOX: ShimejiSandbox = {
  groundY: 192,
  ceilY: 40,
  minX: 64,
  maxX: 136,
};

/** 快扔阈值,单位 px/ms(与壳 CompanionCreature throwDizzy 的 2.5 同阈同语义) */
export const THROW_MIN_SPEED = 2.5;

/** 重力加速度 px/tick²(50ms/tick;0.45 → 约半秒从顶坠到地) */
const GRAVITY = 0.45;
const CLIMB_SPEED = 0.7;
const CEIL_SPEED = 0.9;
/** Pose.Duration 有效上限:原版可到 150+ tick,50ms/tick 下单帧太久,钳 12(0.6s/帧) */
const MAX_POSE_TICKS = 12;

export interface ShimejiMotion {
  actionName: string | null;
  poseIdx: number;
  ticksLeft: number;
  loopsLeft: number;
  /** 脚底位置(舞台局部坐标;x∈[minX,maxX], y∈[ceilY,groundY]) */
  x: number;
  y: number;
  /** px/tick */
  vx: number;
  vy: number;
  /** 1=右 -1=左(渲染 scale(facing 1) 镜像) */
  facing: 1 | -1;
  mode: ShimejiMode;
  /** wall 模式贴哪面墙:0=左 1=右 */
  wallSide: 0 | 1 | null;
  /** settle 剩余 tick(落地缓冲后回地面策略) */
  settleLeft: number;
}

export function initMotion(): ShimejiMotion {
  return {
    actionName: null,
    poseIdx: 0,
    ticksLeft: 0,
    loopsLeft: 0,
    x: (SHIMEJI_SANDBOX.minX + SHIMEJI_SANDBOX.maxX) / 2,
    y: SHIMEJI_SANDBOX.groundY,
    vx: 0,
    vy: 0,
    facing: 1,
    mode: "ground",
    wallSide: null,
    settleLeft: 0,
  };
}

export type ShimejiSignal =
  | { t: "tick" }
  | { t: "grab" }
  | { t: "release"; speed: number };

/** 表情→动作偏好(动作语义替换三件套之一;包里没有该名就落回策略池) */
export const EXPRESSION_PREF: Record<string, string[]> = {
  happy: ["Bouncing", "Jumping"],
  cheer: ["Bouncing", "Jumping"],
  proud: ["Bouncing"],
  stars: ["Jumping", "Bouncing"],
  flame: ["Dash", "Run"],
  thinking: ["Stand"],
  sleeping: ["Sprawl", "Sit"],
  listening: ["Stand"],
};

// ── 动作池(slot 优先,kind 退化) ──

interface ShimejiPools {
  idle: ShimejiActionT[];
  walk: ShimejiActionT[];
  rest: ShimejiActionT[];
  climb: ShimejiActionT[];
  ceiling: ShimejiActionT[];
  air: ShimejiActionT[];
  drag: ShimejiActionT[];
}

const REST_RE = /sit|sprawl|lie|lay|sleep|nap|dangle|lookup/i;
const AIR_RE = /fall|throw|trip/i;
const DRAG_RE = /drag|resist|pinch/i;

function poolsFor(manifest: ShimejiPackManifestT): ShimejiPools {
  const A = manifest.actions;
  if (!A.some((a) => a.slot)) {
    // 一期旧包:无 slot → 按 kind 退化(一期行为)
    const stay = A.filter((a) => a.kind === "Stay");
    const move = A.filter((a) => a.kind === "Move");
    return {
      idle: [...stay, ...move],
      walk: move,
      rest: [...stay, ...move].filter((a) => REST_RE.test(a.name)),
      climb: [],
      ceiling: [],
      air: [],
      drag: [],
    };
  }
  const bySlot = (slot: string) => A.filter((a) => a.slot === slot);
  const ground = bySlot("ground");
  // panel/mouse/tired 都是"原地演"的场景系,进 idle 池(可达≠仅归档)
  return {
    idle: [...ground.filter((a) => a.kind === "Stay"), ...bySlot("panel"), ...bySlot("mouse"), ...bySlot("tired")],
    walk: ground.filter((a) => a.kind === "Move"),
    rest: ground.filter((a) => REST_RE.test(a.name)),
    climb: bySlot("wall"),
    ceiling: bySlot("ceiling"),
    air: bySlot("interact").filter((a) => AIR_RE.test(a.name)),
    drag: bySlot("interact").filter((a) => DRAG_RE.test(a.name)),
  };
}

function poseTicks(action: ShimejiActionT | null | undefined, idx: number): number {
  return Math.min(MAX_POSE_TICKS, action?.poses[idx]?.duration ?? 4) || 1;
}

function findAction(manifest: ShimejiPackManifestT, name: string | null): ShimejiActionT | null {
  return manifest.actions.find((a) => a.name === name) ?? null;
}

function pickFirst(list: ShimejiActionT[]): ShimejiActionT | null {
  return list[0] ?? null;
}

function byName(manifest: ShimejiPackManifestT, re: RegExp): ShimejiActionT | null {
  return manifest.actions.find((a) => re.test(a.name)) ?? null;
}

/** 地面策略:表情偏好 → 50% idle / 30% walk / 20% rest(坐/躺)。
    climb 不在随机策略里(2026-09-12 实测反馈"原地抓空气"):舞台沙盒边缘没有
    可见墙面,随机贴墙=对着空气爬;起爬只由 tick 里"走到边界时"触发
    (至少有走过去的铺垫)。墙对齐可见容器边(输入卡/面板缘)是后续方向。 */
function nextGround(
  manifest: ShimejiPackManifestT,
  pools: ShimejiPools,
  expression: string,
  rng: () => number,
): ShimejiActionT | null {
  const pref = EXPRESSION_PREF[expression] ?? [];
  const prefHit = pref.map((n) => findAction(manifest, n)).find(Boolean);
  if (prefHit) return prefHit;
  const roll = rng();
  if (roll < 0.5 && pools.idle.length) return pickFirst(pools.idle);
  if (roll < 0.8 && pools.walk.length) return pickFirst(pools.walk);
  if (pools.rest.length) return pickFirst(pools.rest);
  if (pools.idle.length) return pickFirst(pools.idle);
  return manifest.actions[0] ?? null;
}

function startMotion(prev: ShimejiMotion, action: ShimejiActionT | null, mode: ShimejiMode): ShimejiMotion {
  return {
    ...prev,
    actionName: action?.name ?? prev.actionName,
    poseIdx: 0,
    ticksLeft: poseTicks(action, 0),
    loopsLeft: action?.kind === "Stay" ? 2 : action?.kind === "Move" ? 1 : 2,
    mode,
    vx: 0,
    vy: 0,
  };
}

/** 帧步进(纯):tick 减到 0 进下一帧,帧尾回卷扣 loops */
function advancePose(
  prev: ShimejiMotion,
  action: ShimejiActionT | null,
): { poseIdx: number; ticksLeft: number; loopsLeft: number } {
  let { poseIdx, ticksLeft, loopsLeft } = prev;
  ticksLeft -= 1;
  if (ticksLeft <= 0) {
    poseIdx += 1;
    if (poseIdx >= (action?.poses.length ?? 0)) {
      poseIdx = 0;
      loopsLeft -= 1;
    }
    ticksLeft = poseTicks(action, poseIdx);
  }
  return { poseIdx, ticksLeft, loopsLeft };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 状态机单步。返回全新对象(不 mutate prev);rng 注入保证 verify 可复现。
 * signal(grab/release) 优先于 tick;dragged 模式跟手由壳负责,本地只循环挣扎帧。
 */
export function tickShimeji(
  prev: ShimejiMotion,
  manifest: ShimejiPackManifestT,
  signal: ShimejiSignal,
  expression: string,
  rng: () => number = Math.random,
  /** 运行时沙盒覆盖(2026-09-12 拍板:墙对齐可见容器边缘——form 每 tick 测
      composer 卡/讲解面板缘换算舞台坐标喂入;缺省=舞台局部默认沙盒) */
  sandboxOverride?: Partial<ShimejiSandbox>,
): ShimejiMotion {
  const pools = poolsFor(manifest);
  const S: ShimejiSandbox = sandboxOverride ? { ...SHIMEJI_SANDBOX, ...sandboxOverride } : SHIMEJI_SANDBOX;

  // ── 交互信号(最高优先;仅 dragged 中响应 release,避免误伤其它模式)──
  if (signal.t === "grab") {
    const action = pickFirst(pools.drag) ?? byName(manifest, DRAG_RE);
    return {
      ...prev,
      mode: "dragged",
      actionName: action?.name ?? prev.actionName,
      poseIdx: 0,
      ticksLeft: poseTicks(action, 0),
      loopsLeft: Number.POSITIVE_INFINITY,
    };
  }
  if (signal.t === "release" && prev.mode === "dragged") {
    if (signal.speed >= THROW_MIN_SPEED) {
      const action = pickFirst(pools.air) ?? byName(manifest, AIR_RE);
      return {
        ...prev,
        mode: "air",
        actionName: action?.name ?? prev.actionName,
        poseIdx: 0,
        ticksLeft: poseTicks(action, 0),
        loopsLeft: 1,
        vx: prev.facing * clamp(signal.speed * 0.8, 1.2, 3),
        vy: -clamp(signal.speed * 0.5, 1.5, 4),
      };
    }
    // 轻放:原地缓冲后回地面
    const action = pickFirst(pools.idle);
    return {
      ...startMotion(prev, action, "settle"),
      settleLeft: 10,
      x: prev.x,
      y: clamp(prev.y, S.ceilY, S.groundY),
      facing: prev.facing,
    };
  }

  switch (prev.mode) {
    case "dragged": {
      const action = findAction(manifest, prev.actionName);
      return { ...prev, ...advancePose(prev, action) };
    }

    case "air": {
      const action = findAction(manifest, prev.actionName);
      const p = advancePose(prev, action);
      let { x, y, vx, vy, facing } = prev;
      vy += GRAVITY;
      x = clamp(x + vx, S.minX, S.maxX);
      y += vy;
      if (x === S.minX || x === S.maxX) vx = -vx * 0.5;
      if (vx > 0.1) facing = 1;
      else if (vx < -0.1) facing = -1;
      if (y >= S.groundY) {
        // 落地:缓冲若干 tick(优先 Tripping 翻倒帧)回地面
        const land = byName(manifest, /trip/i) ?? pickFirst(pools.idle);
        return {
          ...startMotion({ ...prev, ...p, x, y: S.groundY, vx, vy: 0, facing }, land, "settle"),
          settleLeft: 12,
        };
      }
      return { ...prev, ...p, x, y, vx, vy, facing };
    }

    case "settle": {
      const action = findAction(manifest, prev.actionName);
      const p = advancePose(prev, action);
      const settleLeft = prev.settleLeft - 1;
      if (settleLeft <= 0) {
        const next = nextGround(manifest, pools, expression, rng);
        return { ...startMotion(prev, next, "ground"), x: prev.x, y: S.groundY, facing: prev.facing };
      }
      return { ...prev, ...p, settleLeft };
    }

    case "wall": {
      const action = findAction(manifest, prev.actionName);
      const p = advancePose(prev, action);
      const x = prev.wallSide === 0 ? S.minX : S.maxX;
      const facing: 1 | -1 = prev.wallSide === 0 ? -1 : 1;
      const y = Math.max(S.ceilY, prev.y - CLIMB_SPEED);
      if (y <= S.ceilY) {
        // 登顶 → 爬顶(朝远离来墙的方向)
        const ceil = pickFirst(pools.ceiling) ?? byName(manifest, /ceil/i);
        const vx = (prev.wallSide === 0 ? 1 : -1) * CEIL_SPEED;
        return {
          ...prev,
          ...p,
          mode: "ceiling",
          actionName: ceil?.name ?? prev.actionName,
          poseIdx: 0,
          ticksLeft: poseTicks(ceil, 0),
          loopsLeft: 2,
          x,
          y: S.ceilY,
          vx,
          vy: 0,
          facing: vx > 0 ? 1 : -1,
          wallSide: null,
        };
      }
      return { ...prev, ...p, x, y, facing };
    }

    case "ceiling": {
      const action = findAction(manifest, prev.actionName);
      const p = advancePose(prev, action);
      const x = clamp(prev.x + prev.vx, S.minX, S.maxX);
      if (x <= S.minX || x >= S.maxX) {
        // 到对角 → 松手坠落
        const fall = pickFirst(pools.air) ?? byName(manifest, AIR_RE);
        return {
          ...prev,
          ...p,
          mode: "air",
          actionName: fall?.name ?? prev.actionName,
          poseIdx: 0,
          ticksLeft: poseTicks(fall, 0),
          loopsLeft: 1,
          vx: prev.vx * 0.3,
          vy: 0.5,
        };
      }
      return { ...prev, ...p, x, facing: prev.vx >= 0 ? 1 : -1 };
    }

    // ground
    default: {
      const action = findAction(manifest, prev.actionName);
      let { x, vx, facing } = prev;
      if (action?.kind === "Move") {
        const pose = action.poses[prev.poseIdx];
        if (pose && pose.velocity[0] !== 0) {
          vx = clamp(pose.velocity[0] * 0.6, -3, 3);
          facing = vx > 0 ? 1 : -1;
          x += vx;
          if (x <= S.minX) {
            x = S.minX;
            facing = 1;
            vx = Math.abs(vx);
          } else if (x >= S.maxX) {
            x = S.maxX;
            facing = -1;
            vx = -Math.abs(vx);
          }
        } else {
          vx = 0;
        }
      }
      const p = advancePose(prev, action);
      if (p.loopsLeft <= 0) {
        // 爬墙/爬顶入口关闭(2026-09-12 用户拍板方案 B):壳层把 bot 悬浮在锚点上空,
        // 没有贴边物理支撑,攀爬帧=飘着爬空气墙(归档与 wall/ceiling 代码路径保留,
        // 待"爬墙锚点旁路"方案 A 立项后重开:沿容器边缘插值壳悬停目标点,PD 照常追)
        const next = nextGround(manifest, pools, expression, rng);
        const base = startMotion(prev, next, "ground");
        return { ...base, x, y: S.groundY, vx, facing };
      }
      return { ...prev, ...p, x, vx, facing, y: S.groundY };
    }
  }
}
