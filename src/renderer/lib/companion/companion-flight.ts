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

/* PD 参数(px/step² 单位的目标加速度,再乘质量成力) */
const SPRING = 0.012; // 每偏移 px 产生 0.012 px/step² 拉回
const DAMP = 0.09; // 速度阻尼(px/step 每 px/step²)
const MAX_ACCEL = 0.42; // 控制器加速度上限(翻滚恢复不至于瞬移)
/** 被拍晕眩阈值(单次冲量 px/step):低于=轻碰,高于=真被拍飞(晕眩+翻滚) */
export const SWAT_IMPULSE = 3.2;

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
 * Matter 0.19 引力:每步 force += mass × gravity.y × 0.001 → 补偿项 = mass×0.001。
 */
export function flightForce(
  pos: FlightTarget,
  vel: FlightTarget,
  target: FlightTarget,
  mass: number,
): { fx: number; fy: number } {
  const ax = clamp((target.x - pos.x) * SPRING - vel.x * DAMP, MAX_ACCEL);
  const ay = clamp((target.y - pos.y) * SPRING - vel.y * DAMP, MAX_ACCEL);
  return { fx: ax * mass, fy: (ay + 0.001) * mass };
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

export interface FlightWorld {
  /** 同步伴学刚体(调用方每帧读 position/angle 渲染)。 */
  readonly body: Matter.Body;
  /** 栏尺寸变化(窗口/档位切换)时重放墙。 */
  resize(width: number, height: number): void;
  /**
   * 每帧步进。
   * target=null(晕眩期/无家)时控制器断开,只受重力+墙。
   * 返回本帧是否被拍(hitSpeed ≥ SWAT_IMPULSE)。
   */
  step(dtMs: number, base: FlightTarget | null, balls: BallProbe[], tMs: number): boolean;
  /** 晕眩剩余时间(ms)。 */
  dizzyRemaining(tMs: number): number;
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
    step(dtMs, base, balls, tMs) {
      const dizzy = tMs < dizzyUntil;
      Engine.update(engine, Math.min(33, Math.max(8, dtMs)));
      let swatted = false;

      if (!dizzy && base) {
        const target = cruiseTarget(base, Math.floor(tMs / 4200), tMs);
        const f = flightForce(
          { x: body.position.x, y: body.position.y },
          { x: body.velocity.x, y: body.velocity.y },
          target,
          body.mass,
        );
        Body.applyForce(body, body.position, { x: f.fx, y: f.fy });
        // 姿态回正:角度弹簧(不是硬 setAngle——被撞的旋转要自然衰减)
        Body.setAngularVelocity(body, body.angularVelocity - body.angle * 0.06 - body.angularVelocity * 0.08);
      }

      // 跨引擎球碰撞:轻碰=弹开;重拍=晕眩(短反应交给 core 的 swat 事件)
      let maxHit = 0;
      for (const b of balls) {
        const hit = crossImpulse(
          body.position.x, body.position.y, body.velocity.x, body.velocity.y, r,
          b.x, b.y, b.vx, b.vy, b.r,
        );
        if (!hit) continue;
        Body.setPosition(body, {
          x: body.position.x + hit.nx * Math.min(6, hit.dvx),
          y: body.position.y + hit.ny * Math.min(6, hit.dvy),
        });
        Body.setVelocity(body, {
          x: body.velocity.x + hit.dvx * 0.9,
          y: body.velocity.y + hit.dvy * 0.9,
        });
        if (!b.isStatic) b.push(hit.bfx, hit.bfy);
        if (hit.hitSpeed > maxHit) maxHit = hit.hitSpeed;
      }
      if (maxHit >= SWAT_IMPULSE && !dizzy) {
        dizzyUntil = tMs + 900;
        swatted = true;
      }

      // 硬边界兜底(防求解器极端把人挤穿墙)
      const p = body.position;
      if (p.x < r) { Body.setPosition(body, { x: r, y: p.y }); if (body.velocity.x < 0) Body.setVelocity(body, { x: -body.velocity.x * 0.5, y: body.velocity.y }); }
      if (p.x > width - r) { Body.setPosition(body, { x: width - r, y: p.y }); if (body.velocity.x > 0) Body.setVelocity(body, { x: -body.velocity.x * 0.5, y: body.velocity.y }); }
      return swatted;
    },
    dizzyRemaining(tMs) {
      return Math.max(0, dizzyUntil - tMs);
    },
    dispose() {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
