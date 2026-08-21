/**
 * companion-flight —— 伴学生物的左栏飞行世界(Matter.js 单刚体 + 手工跨引擎碰撞)。
 *
 * 设计(v3 单生物):
 * - 伴学是**视口空间**的一只轻飞行体:独立小引擎,边界=左栏矩形(可翻越的墙),
 *   不进任何 section 岛引擎(岛有顶墙,会把他关在一个 section 里)。
 * - 悬浮 = PD 控制器(弹簧拉向巡航点 + 阻尼 + 重力补偿 + 确定性游走/呼吸起伏),
 *   像 Iron Man:大部分时候定点悬浮,被撞则真实翻滚,控制器再把他稳回来。
 * - 与球的碰撞是**跨引擎手工解算**:每帧渲染循环把各岛球的位置喂进来
 *   (BallProbe),重叠时按质量比交换冲量——球重伴学轻,球拍他=他飞出去,
 *   他撞球=球荡开(力经 probe 回灌岛引擎)。锁定球=不可撼动的墙。
 * - 纯函数(flightForce/crossImpulse/bankAngle)verify 直测;引擎壳只在渲染层跑。
 */
import Matter from "matter-js";

/** 伴学物理半径(px):故意比视觉小(视觉 ~88px 盒,物理 22px)——
 *  擦边而过不弹飞,只有真的撞上才有戏。 */
export const COMPANION_RADIUS = 22;
/** 伴学/球质量比:球 density 0.001×πr²≈2.5;伴学要轻得多(被拍就飞)。 */
const COMPANION_DENSITY = 0.00035;

/* PD 参数(px/step² 单位的目标加速度;换算成 Matter 力时除以 dt²) */
const SPRING = 0.012; // 每偏移 px 产生 0.012 px/step² 拉回
const DAMP = 0.12; // 速度阻尼(px/step 每 px/step²)
const MAX_ACCEL = 0.3; // 控制器加速度上限(优雅加速,不瞬移)
/** Matter 引擎力换算基准 dt(ms):Δv = F/m × dt²,控制器力按此归一 */
const DT_REF = 16.667;
/** 速度钳制(px/step):防单位错/极端冲量把生物打进穿透态 */
export const MAX_FLIGHT_SPEED = 12;
/** 被拍晕眩阈值(单次冲量 px/step):低于=轻碰,高于=真被拍飞(晕眩+翻滚) */
export const SWAT_IMPULSE = 3.2;

/* 避让转向场:自主巡航绕开球,不主动撞球搅乱地图布局 */
/** 感知余量(px):接触距(球r+伴学r)之外再留这么宽的提前量开始转向 */
export const AVOID_MARGIN = 56;
/** 贴脸最大避让加速度(px/step²):>MAX_ACCEL(0.3) → 近距避让必赢巡航弹簧 */
export const AVOID_MAX = 0.6;

/**
 * 避让加速度(纯):感知域内每球沿法线推离,接触=满额、域缘=0 线性衰减;
 * **速度感知制动**——正在冲向球时(法向速度 vn<0)按接近速度增强推离,
 * 掐掉动量过头的浅穿;多球合成后钳制。球心重合(d≈0)任选向上,无 NaN。
 * 晕眩期控制器断开不调用——用户拖球拍他的玩法不受影响。
 */
export function avoidAccel(
  cx: number,
  cy: number,
  cr: number,
  balls: { x: number; y: number; r: number }[],
  vx = 0,
  vy = 0,
): { x: number; y: number } {
  let ax = 0;
  let ay = 0;
  for (const b of balls) {
    const dx = cx - b.x;
    const dy = cy - b.y;
    const d = Math.hypot(dx, dy);
    const touch = b.r + cr;
    const range = touch + AVOID_MARGIN;
    if (d >= range) continue;
    if (d < 0.0001) {
      ay -= AVOID_MAX; // 球心重合:向上逃(任选方向,确定性优先)
      continue;
    }
    const nx = dx / d;
    const ny = dy / d;
    const near = Math.min(1.6, Math.max(0, 1 - (d - touch) / AVOID_MARGIN));
    const vn = vx * nx + vy * ny;
    const boost = vn < 0 ? 1 + Math.min(1.6, -vn / 4) : 1;
    ax += nx * AVOID_MAX * near * boost;
    ay += ny * AVOID_MAX * near * boost;
  }
  const m = Math.hypot(ax, ay);
  if (m > AVOID_MAX * 2) {
    ax = (ax / m) * AVOID_MAX * 2;
    ay = (ay / m) * AVOID_MAX * 2;
  }
  return { x: ax, y: ay };
}

export interface FlightTarget {
  x: number;
  y: number;
}

/** 球探针:岛引擎球的只读快照 + 回灌力通道(渲染循环装配)。 */
export interface BallProbe {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 锁定(static)球:不回灌力,伴学被单方面弹开。 */
  isStatic: boolean;
  /** 向岛引擎的球施加力(动态球专用)。 */
  push: (fx: number, fy: number) => void;
}

/**
 * 巡航点计算(纯):基础目标 + 确定性游走(双正弦利萨茹)+ 呼吸起伏。
 * seed 变化(渲染层每 3-6s 换)→ 换一片空域巡逻。
 */
export function cruiseTarget(
  base: FlightTarget,
  seed: number,
  tMs: number,
  amp = 34,
): FlightTarget {
  const t = tMs * 0.001;
  return {
    x: base.x + Math.sin(t * 0.31 + seed * 2.1) * amp,
    y: base.y + Math.sin(t * 0.47 + seed * 4.7) * (amp * 0.55)
      + Math.sin(t * 1.7 + seed) * 4,
  };
}

/**
 * PD 悬浮力(纯):重力补偿 + 弹簧 + 阻尼 + 加速度上限。
 * 单位陷阱(实测炸过):Matter 的力换算 Δv = F/m × dt²(dt≈16.7ms → dt²≈278),
 * 控制器加速度是 px/step² 语义 → 换算成力必须除以 dt²,否则等效放大 ~278 倍,
 * 弹簧变炸弹(速度 40+px/step、钉墙抖动=渲染层"瞬移")。
 * 重力补偿例外:引擎引力本身以 force = mass × g.y × scale(0.001) 施加,
 * 补偿力必须同量纲 = mass × 0.001(不除 dt²)。
 */
export function flightForce(
  pos: FlightTarget,
  vel: FlightTarget,
  target: FlightTarget,
  mass: number,
  dtMs = DT_REF,
): { fx: number; fy: number } {
  const dt2 = Math.max(64, dtMs * dtMs);
  const ax = clamp((target.x - pos.x) * SPRING - vel.x * DAMP, MAX_ACCEL);
  const ay = clamp((target.y - pos.y) * SPRING - vel.y * DAMP, MAX_ACCEL);
  // 注意 y 正方向向下:重力补偿必须为**负**(向上)——写反=重力加倍,生物沉底
  return { fx: (ax * mass) / dt2, fy: (ay * mass) / dt2 - mass * 0.001 };
}

function clamp(v: number, lim: number): number {
  return v > lim ? lim : v < -lim ? -lim : v;
}

/**
 * 跨引擎碰撞解算(纯):重叠 → 法线/分离/冲量分配。
 * 质量比 mC/(mC+mB) 决定伴学吃多少冲量(伴学轻→吃大头)。
 * 返回 null=未命中。hitSpeed 用于拍击判定。
 */
export function crossImpulse(
  cx: number, cy: number, cvx: number, cvy: number, cr: number,
  bx: number, by: number, bvx: number, bvy: number, br: number,
): {
  nx: number;
  ny: number;
  /** 伴学的速度修正(px/step,直接 setVelocity 叠加) */
  dvx: number;
  dvy: number;
  /** 球受到的等大反向力(每步力单位,喂 probe.push) */
  bfx: number;
  bfy: number;
  hitSpeed: number;
} | null {
  const dx = cx - bx;
  const dy = cy - by;
  const d = Math.hypot(dx, dy);
  const minD = cr + br;
  if (d >= minD || d < 0.0001) return null;
  const nx = dx / d;
  const ny = dy / d;
  const rvx = cvx - bvx;
  const rvy = cvy - bvy;
  const relN = rvx * nx + rvy * ny;
  // 分离:把伴学推出重叠(球不动或稍动;球端只给力,岛求解器自己决定)
  const overlap = minD - d;
  // 冲量:只处理接近(relN<0);分离中(relN≥0)只做位置分离
  const j = relN < 0 ? -relN * 0.9 : 0;
  return {
    nx, ny,
    dvx: nx * (overlap * 0.55 + j * 0.85),
    dvy: ny * (overlap * 0.55 + j * 0.85),
    bfx: -nx * j * 0.02,
    bfy: -ny * j * 0.02,
    hitSpeed: -relN,
  };
}

/** 飞行倾角(纯):水平速度 → 侧倾角(弧度),静止时归零。 */
export function bankAngle(vx: number, vy: number): number {
  if (Math.hypot(vx, vy) < 0.35) return 0;
  return clamp(vx * 0.06, 0.5);
}

/**
 * 挑待机空地(纯):在高度中部带(y∈[0.35h,0.65h])按 5×3 候选网格选
 * **离所有球最远**的点(净空最大化),同分按 seed 轮转的候选顺序先到先得
 * (确定性)。球滚动/新增后调用方周期重选即可。
 */
export function pickPerchBase(
  w: number,
  h: number,
  balls: { x: number; y: number; r: number }[],
  seed = 0,
): FlightTarget {
  const cols = [0.14, 0.32, 0.5, 0.68, 0.86];
  const rows = [0.38, 0.5, 0.62];
  const start = ((seed % 15) + 15) % 15;
  let best: FlightTarget = { x: w * 0.5, y: h * 0.5 };
  let bestClear = -Infinity;
  for (let k = 0; k < 15; k++) {
    const i = (start + k) % 15;
    const cx = w * cols[i % 5]!;
    const cy = h * rows[Math.floor(i / 5)]!;
    let clear = Infinity;
    for (const b of balls) {
      const d = Math.hypot(cx - b.x, cy - b.y) - b.r;
      if (d < clear) clear = d;
    }
    if (clear > bestClear + 1e-9) {
      bestClear = clear;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/**
 * 落脚点挑选(纯):最近的绳粒/球顶栖息候选(距离 ≤ maxDist),
 * 没有合适候选返回 null(继续悬停)。栖息点已带向上偏移,直接可用。
 */
export function pickRestSpot(
  from: FlightTarget,
  spots: FlightTarget[],
  maxDist = 220,
): FlightTarget | null {
  let best: FlightTarget | null = null;
  let bestD = maxDist;
  for (const sp of spots) {
    const d = Math.hypot(sp.x - from.x, sp.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = { x: sp.x, y: sp.y };
    }
  }
  return best;
}

export interface FlightWorld {
  /** 同步伴学刚体(调用方每帧读 position/angle 渲染)。 */
  readonly body: Matter.Body;
  /** 栏尺寸变化(窗口/档位切换)时重放墙。 */
  resize(width: number, height: number): void;
  /**
   * 每帧步进。
   * target=null(晕眩期/无家)时控制器断开,只受重力+墙。
   * opts.settle=true(栖息中):巡航游走幅值收到近零,定住休息。
   * opts.ceilY:硬天花板(栏局部坐标,伴学圆心不许低于此线——标题栏禁入带;
   * 撞线反弹同边界墙,物理/视觉同源,不在渲染层拉扯)。
   * 返回本帧是否被拍(hitSpeed ≥ SWAT_IMPULSE)。
   */
  step(dtMs: number, base: FlightTarget | null, balls: BallProbe[], tMs: number, opts?: { settle?: boolean; ceilY?: number }): boolean;
  /** 晕眩剩余时间(ms)。 */
  dizzyRemaining(tMs: number): number;
  /** 被扔出:外部设定晕眩窗口(控制器断开自由翻滚)。 */
  throwDizzy(tMs: number): void;
  dispose(): void;
}

export function createFlightWorld(opts: {
  width: number;
  height: number;
  radius?: number;
}): FlightWorld {
  const r = opts.radius ?? COMPANION_RADIUS;
  const { Bodies, Body, Composite, Engine } = Matter;
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 4;
  engine.velocityIterations = 3;

  const body = Bodies.circle(opts.width * 0.7, 120, r, {
    restitution: 0.55,
    friction: 0.02,
    frictionAir: 0.028,
    density: COMPANION_DENSITY,
  });
  Composite.add(engine.world, body);

  // 墙:左右=栏缘(可翻越的墙——transit 时物理整体旁路,他从墙顶飞出去),
  // 底=栏底(贴地滑行),顶抬高(-320)给他爬升空间但不许飞出栏外。
  const WALL = 240;
  let walls: Matter.Body[] = [];
  const buildWalls = (w: number, h: number) => {
    for (const b of walls) Composite.remove(engine.world, b);
    const mk = (x: number, y: number, ww: number, hh: number) =>
      Bodies.rectangle(x, y, ww, hh, { isStatic: true, restitution: 0.5 });
    walls = [
      mk(-WALL / 2, h / 2 - 160, WALL, h + 640),
      mk(w + WALL / 2, h / 2 - 160, WALL, h + 640),
      mk(w / 2, h + WALL / 2, w + WALL * 2, WALL),
      mk(w / 2, -320 - WALL / 2, w + WALL * 2, WALL),
    ];
    for (const b of walls) Composite.add(engine.world, b);
  };
  buildWalls(opts.width, opts.height);

  let dizzyUntil = 0;
  let width = opts.width;

  return {
    body,
    resize(w, h) {
      width = w;
      buildWalls(w, h);
    },
    step(dtMs, base, balls, tMs, opts) {
      const dizzy = tMs < dizzyUntil;
      Engine.update(engine, Math.min(33, Math.max(8, dtMs)));
      let swatted = false;

      if (!dizzy && base) {
        const target = opts?.settle
          ? { x: base.x, y: base.y + Math.sin(tMs * 0.0012) * 2 }
          : cruiseTarget(base, Math.floor(tMs / 4200), tMs);
        const dt2 = Math.max(64, dtMs * dtMs);
        const f = flightForce(
          { x: body.position.x, y: body.position.y },
          { x: body.velocity.x, y: body.velocity.y },
          target,
          body.mass,
          dtMs,
        );
        // 避让转向场:球在感知域内推离(近距>巡航弹簧,宁可绕路不穿球)。
        // 晕眩路径不进这里——被球拍是物理,巡航避让是姿态,两码事。
        const av = avoidAccel(body.position.x, body.position.y, r, balls, body.velocity.x, body.velocity.y);
        Body.applyForce(body, body.position, {
          x: f.fx + (av.x * body.mass) / dt2,
          y: f.fy + (av.y * body.mass) / dt2,
        });
        // 姿态回正:角度弹簧(不是硬 setAngle——被撞的旋转要自然衰减)
        Body.setAngularVelocity(body, body.angularVelocity - body.angle * 0.06 - body.angularVelocity * 0.08);
      }

      // 速度钳制:任何路径(单位错/极端碰撞/墙弹)都不许把生物加速到穿透态
      {
        const v = body.velocity;
        const sp = Math.hypot(v.x, v.y);
        if (sp > MAX_FLIGHT_SPEED) {
          Body.setVelocity(body, { x: (v.x / sp) * MAX_FLIGHT_SPEED, y: (v.y / sp) * MAX_FLIGHT_SPEED });
        }
      }

      // 跨引擎球碰撞:轻碰=弹开;重拍=晕眩(短反应交给 core 的 swat 事件)。
      // 多球同时重叠时(穿越球链)先把位移/冲量**合成后统一钳制**——
      // 逐球各推 6px 会叠加成瞬移。
      let maxHit = 0;
      let pushX = 0;
      let pushY = 0;
      let kickX = 0;
      let kickY = 0;
      for (const b of balls) {
        const hit = crossImpulse(
          body.position.x, body.position.y, body.velocity.x, body.velocity.y, r,
          b.x, b.y, b.vx, b.vy, b.r,
        );
        if (!hit) continue;
        pushX += hit.nx * Math.min(4, hit.dvx);
        pushY += hit.ny * Math.min(4, hit.dvy);
        kickX += hit.dvx * 0.9;
        kickY += hit.dvy * 0.9;
        if (!b.isStatic) b.push(hit.bfx, hit.bfy);
        if (hit.hitSpeed > maxHit) maxHit = hit.hitSpeed;
      }
      const pushMag = Math.hypot(pushX, pushY);
      if (pushMag > 4) {
        pushX = (pushX / pushMag) * 4;
        pushY = (pushY / pushMag) * 4;
      }
      const kickMag = Math.hypot(kickX, kickY);
      if (kickMag > 7) {
        kickX = (kickX / kickMag) * 7;
        kickY = (kickY / kickMag) * 7;
      }
      if (pushMag > 0 || kickMag > 0) {
        Body.setPosition(body, { x: body.position.x + pushX, y: body.position.y + pushY });
        Body.setVelocity(body, { x: body.velocity.x + kickX, y: body.velocity.y + kickY });
      }
      if (maxHit >= SWAT_IMPULSE && !dizzy) {
        dizzyUntil = tMs + 900;
        swatted = true;
      }

      // 硬边界兜底(防求解器极端把人挤穿墙)
      const p = body.position;
      if (p.x < r) { Body.setPosition(body, { x: r, y: p.y }); if (body.velocity.x < 0) Body.setVelocity(body, { x: -body.velocity.x * 0.5, y: body.velocity.y }); }
      if (p.x > width - r) { Body.setPosition(body, { x: width - r, y: p.y }); if (body.velocity.x > 0) Body.setVelocity(body, { x: -body.velocity.x * 0.5, y: body.velocity.y }); }
      // 硬天花板(标题栏禁入带):撞线=定位到线上+竖速反弹减半
      const ceil = opts?.ceilY;
      if (ceil !== undefined && p.y < ceil + r) {
        Body.setPosition(body, { x: p.x, y: ceil + r });
        if (body.velocity.y < 0) Body.setVelocity(body, { x: body.velocity.x, y: -body.velocity.y * 0.5 });
      }
      return swatted;
    },
    dizzyRemaining(tMs) {
      return Math.max(0, dizzyUntil - tMs);
    },
    throwDizzy(tMs) {
      dizzyUntil = tMs + 900;
    },
    dispose() {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
