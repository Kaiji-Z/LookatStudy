/**
 * mapPhysics —— 左栏地图物理引擎适配层(Matter.js 0.19)。
 *
 * 设计(2026-08-16,物理地图 v1):
 * - **无弹簧回位**:球自由摆布,顺序由绳链表达——绳从章节路牌锚点(绳结)出发,
 *   穿过全部球,终点是紫球(考试/boss)。读序 = 从绳结顺绳走到紫球。
 * - 每 section 一个物理岛(独立 Engine):墙 = 栏宽(左右) + section 边界(上下),
 *   岛内球互相碰撞 + 弹力带约束(相邻球距离约束,中低刚度 = 可拉伸);
 *   视口外的岛不步进(IntersectionObserver 门控,球冻结原位)。
 * - 近中性浮力(与重力等量反向,每球确定性 ± 微差)+ 位置相关正弦风
 *   → 场景永远微微漂浮,不结死块。
 * - 本模块不碰 DOM/React:位置由渲染层每帧读走写 transform;碰撞 squash
 *   形变是渲染层的事(物理体始终是圆,`inertia: Infinity` 不打转)。
 * - a11y:reduced-motion 时调用方完全不启用本模块(静态布局兜底)。
 *
 * 参考:balloons.html(Matter.js 绳系气球沙盒)的浮力/软抓取/风场手法。
 */
import Matter from "matter-js";

/** 弹力带视觉:绷紧时直线,松弛时下垂(二次贝塞尔)。垂量随松弛度线性增长,封顶。 */
export const ROPE_MAX_SAG = 26;
/** 指针位移 < 此值(px)判为点击(拖拽阈值);超出判为拖拽。与按压时长无关。 */
export const DRAG_THRESHOLD_PX = 6;
/** 球物理半径(px)。必须与视觉 w-14 h-14(56px)匹配。 */
export const BALL_RADIUS = 28;

export interface Vec2 {
  x: number;
  y: number;
}

/* ============================================================
 * 纯函数(渲染层每帧用,全部无副作用,verify-map-physics 覆盖)
 * ============================================================ */

export interface PointerTrack {
  startX: number;
  startY: number;
}
/** 指针按下→抬起分类:位移 < DRAG_THRESHOLD_PX = 点击,否则拖拽。 */
export function classifyPointer(track: PointerTrack, endX: number, endY: number): "click" | "drag" {
  const dist = Math.hypot(endX - track.startX, endY - track.startY);
  return dist < DRAG_THRESHOLD_PX ? "click" : "drag";
}

/**
 * 弹力带 SVG path(二次贝塞尔):松弛下垂,绷紧变直。
 * sag = clamp((restLen - dist) * 0.6, 0, ROPE_MAX_SAG)。
 */
export function ropePathD(from: Vec2, to: Vec2, restLen: number): string {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const sag = Math.min(ROPE_MAX_SAG, Math.max(0, (restLen - dist) * 0.6));
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 + sag;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** squash 指数衰减(时间常数 ~90ms)。dt 毫秒。 */
export function decaySquash(squash: number, dtMs: number): number {
  return squash * Math.exp(-dtMs / 90);
}

/** 球间弹力带静止长度 = 布局距离(下限防两球完全叠死)。JSX 初值与物理岛共用。 */
export function linkRestLength(a: Vec2, b: Vec2, ballRadius = BALL_RADIUS): number {
  return Math.max(ballRadius * 2 + 8, Math.hypot(b.x - a.x, b.y - a.y));
}

/** 路牌绳结的 y(岛坐标:容器上缘上方,视觉落在路牌区)。 */
export const ANCHOR_KNOT_Y = -46;
/** 锚绳静止长度(下限 36)。JSX 初值与物理岛共用。 */
export function anchorRestLength(anchor: Vec2, ball: Vec2): number {
  return Math.max(36, Math.hypot(ball.x - anchor.x, ball.y - anchor.y));
}

/** squash → CSS transform 片段:沿碰撞法线方向压扁。squash < 0.01 视为无形变。 */
export function squashTransform(dx: number, dy: number, squash: number, angleRad: number): string {
  const t = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  if (squash < 0.01) return t;
  const deg = (angleRad * 180) / Math.PI;
  const s = Math.min(0.35, squash);
  return `${t} rotate(${deg.toFixed(1)}deg) scale(${(1 + s).toFixed(3)}, ${(1 - s).toFixed(3)}) rotate(${(-deg).toFixed(1)}deg)`;
}

/**
 * 确定性风场(balloons.html 手法):两个不同频率的行波正弦叠加,
 * 随位置/时间缓慢变化 → 每个球受力略不同,整体缓慢搅动。
 * 返回已按质量缩放前的单位向量系数(|fx| ≤ WIND_STRENGTH)。
 */
export const WIND_STRENGTH = 0.00005;
export function windFx(x: number, y: number, tMs: number): number {
  const swirl =
    Math.sin(tMs * 0.00037 + y * 0.0013) * 0.6 +
    Math.sin(tMs * 0.00019 + x * 0.0007 + 1.7) * 0.4;
  return swirl * WIND_STRENGTH;
}

/** 视口门控:返回与 [viewportTop, viewportBottom](± pad) 相交的 section id 集合。 */
export function activeIslandIds(
  sections: { id: string; top: number; bottom: number }[],
  viewportTop: number,
  viewportBottom: number,
  pad = 200,
): Set<string> {
  const out = new Set<string>();
  for (const s of sections) {
    if (s.bottom >= viewportTop - pad && s.top <= viewportBottom + pad) out.add(s.id);
  }
  return out;
}

/* ============================================================
 * 物理岛(每 section 一个)
 * ============================================================ */

export interface IslandBall {
  nodeId: string;
  body: Matter.Body;
  /** mapLayout 的确定性初始位(渲染层 transform 的参照原点)。 */
  layoutX: number;
  layoutY: number;
  squash: number;
  squashAngle: number;
}

/** 弹力带(from/to 为 nodeId;"__anchor" = 路牌绳结,锚点见 island.anchor)。 */
export interface RopeLink {
  from: string;
  to: string;
  restLen: number;
}

/** 碰撞事件(岛坐标系):渲染层画脉冲环 / 转换后喂天气层溅水花。 */
export interface ImpactEvent {
  x: number;
  y: number;
  speed: number;
}

export interface SectionIsland {
  readonly balls: IslandBall[];
  readonly links: RopeLink[];
  /** 路牌绳结锚点(岛坐标,通常在容器上缘附近)。 */
  readonly anchor: Vec2;
  ball(nodeId: string): IslandBall | undefined;
  step(dtMs: number): void;
  beginDrag(nodeId: string, px: number, py: number): void;
  moveDrag(px: number, py: number): void;
  endDrag(): void;
  isDragging(): boolean;
  /** 取走并清空累积的碰撞事件。 */
  drainImpacts(): ImpactEvent[];
  dispose(): void;
}

/** 确定性 FNV 哈希(mapLayout.hashStr 的本地副本,避免渲染/物理循环依赖)。 */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

const WALL_THICKNESS = 120;
/** 球间弹力带刚度:低 = 明显可拉伸的弹力带,高 = 硬杆。 */
const LINK_STIFFNESS = 0.35;
/** 软抓取刚度(balloons.html MouseConstraint 手法):拖拽是"牵",不是"钉"。 */
const DRAG_STIFFNESS = 0.09;
/** 产生 squash/脉冲的最低相对速度(px/step)。 */
const IMPACT_MIN_SPEED = 2.2;

export function createSectionIsland(opts: {
  nodes: { id: string; x: number; y: number }[];
  width: number;
  height: number;
  ballRadius?: number;
}): SectionIsland {
  const r = opts.ballRadius ?? BALL_RADIUS;
  const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter;

  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 6;
  engine.velocityIterations = 4;

  const balls: IslandBall[] = opts.nodes.map((n) => {
    const body = Bodies.circle(n.x, n.y, r, {
      restitution: 0.42,
      friction: 0.01,
      frictionAir: 0.022,
      density: 0.001,
      inertia: Infinity, // 不打转:进度环/皇冠朝向不随物理旋转
      collisionFilter: { group: 0, category: 0x0002, mask: 0x0002 | 0x0004 },
    });
    return { nodeId: n.id, body, layoutX: n.x, layoutY: n.y, squash: 0, squashAngle: 0 };
  });
  for (const b of balls) Composite.add(engine.world, b.body);

  // 墙(不可见):左右 = 栏宽,上下 = section 边界。内表面分别位于 0 / width / 0 / height。
  const half = WALL_THICKNESS / 2;
  const wallOpts = { isStatic: true, restitution: 0.4, friction: 0.05, collisionFilter: { category: 0x0004, mask: 0x0002 } };
  Composite.add(engine.world, [
    Bodies.rectangle(opts.width / 2, -half, opts.width * 3, WALL_THICKNESS, wallOpts),
    Bodies.rectangle(opts.width / 2, opts.height + half, opts.width * 3, WALL_THICKNESS, wallOpts),
    Bodies.rectangle(-half, opts.height / 2, WALL_THICKNESS, opts.height * 3, wallOpts),
    Bodies.rectangle(opts.width + half, opts.height / 2, WALL_THICKNESS, opts.height * 3, wallOpts),
  ]);

  // 路牌绳结:锚在容器上缘上方(视觉落在路牌区),绳系住第一个球。
  const first = balls[0];
  const anchor: Vec2 = first ? { x: first.layoutX, y: ANCHOR_KNOT_Y } : { x: opts.width / 2, y: ANCHOR_KNOT_Y };
  const links: RopeLink[] = [];
  if (first) {
    const anchorBody = Bodies.circle(anchor.x, anchor.y, 2, { isStatic: true, collisionFilter: { mask: 0 } });
    Composite.add(engine.world, anchorBody);
    const restLen = anchorRestLength(anchor, { x: first.layoutX, y: first.layoutY });
    Composite.add(
      engine.world,
      Constraint.create({ bodyA: anchorBody, bodyB: first.body, length: restLen, stiffness: 0.5, damping: 0.05 }),
    );
    links.push({ from: "__anchor", to: first.nodeId, restLen });
  }
  // 球间弹力带:restLen = 布局距离(生成即平衡,风慢慢搅动)。
  for (let i = 0; i < balls.length - 1; i++) {
    const a = balls[i]!;
    const b = balls[i + 1]!;
    const restLen = linkRestLength({ x: a.layoutX, y: a.layoutY }, { x: b.layoutX, y: b.layoutY }, r);
    Composite.add(
      engine.world,
      Constraint.create({ bodyA: a.body, bodyB: b.body, length: restLen, stiffness: LINK_STIFFNESS, damping: 0.06 }),
    );
    links.push({ from: a.nodeId, to: b.nodeId, restLen });
  }

  // 近中性浮力 + 风:与重力等量反向(lift 确定性 0.98-1.03 微差 → 有的微升有的微降)。
  const lifts = new Map(balls.map((b) => [b.nodeId, 0.98 + hash01(b.nodeId) * 0.05]));
  Events.on(engine, "beforeUpdate", () => {
    const t = engine.timing.timestamp;
    for (const b of balls) {
      const m = b.body.mass;
      Body.applyForce(b.body, b.body.position, {
        x: windFx(b.body.position.x, b.body.position.y, t) * m,
        y: -m * engine.gravity.y * engine.gravity.scale * (lifts.get(b.nodeId) ?? 1),
      });
    }
  });

  // 碰撞:squash 形变 + 脉冲事件(球-球 与 球-墙 都算)。
  const impacts: ImpactEvent[] = [];
  const ballSet = new Set(balls.map((b) => b.body));
  Events.on(engine, "collisionStart", (e) => {
    for (const pair of e.pairs) {
      const { bodyA, bodyB } = pair;
      const a = balls.find((b) => b.body === bodyA);
      const b2 = balls.find((b) => b.body === bodyB);
      if (!a && !b2) continue;
      const rv = { x: bodyA.velocity.x - bodyB.velocity.x, y: bodyA.velocity.y - bodyB.velocity.y };
      const speed = Math.hypot(rv.x, rv.y);
      if (speed < IMPACT_MIN_SPEED) continue;
      const n = pair.collision.normal;
      const hit: ImpactEvent = {
        x: (bodyA.position.x + bodyB.position.x) / 2,
        y: (bodyA.position.y + bodyB.position.y) / 2,
        speed,
      };
      if (ballSet.has(bodyA) && ballSet.has(bodyB)) {
        // 球-球:命中点用支撑点更准,退化用中点
        const s0 = pair.collision.supports?.[0];
        if (s0) { hit.x = s0.x; hit.y = s0.y; }
      }
      impacts.push(hit);
      if (impacts.length > 64) impacts.shift();
      const amount = Math.min(0.32, speed * 0.028);
      if (a && amount > a.squash) { a.squash = amount; a.squashAngle = Math.atan2(n.y, n.x); }
      if (b2 && amount > b2.squash) { b2.squash = amount; b2.squashAngle = Math.atan2(-n.y, -n.x); }
    }
  });

  // 软抓取:拖拽 = 指针点与球心之间的一条临时弹簧约束。
  let drag: { constraint: Matter.Constraint; nodeId: string } | null = null;

  return {
    balls,
    links,
    anchor,
    ball(nodeId) {
      return balls.find((b) => b.nodeId === nodeId);
    },
    step(dtMs) {
      // dt 钳制:掉帧时最多按 33ms 步进,防止约束爆炸
      Engine.update(engine, Math.min(33, Math.max(8, dtMs)));
    },
    beginDrag(nodeId, px, py) {
      this.endDrag();
      const b = this.ball(nodeId);
      if (!b) return;
      const constraint = Constraint.create({
        pointA: { x: px, y: py },
        bodyB: b.body,
        length: 0,
        stiffness: DRAG_STIFFNESS,
        damping: 0.12,
      });
      Composite.add(engine.world, constraint);
      drag = { constraint, nodeId };
    },
    moveDrag(px, py) {
      if (!drag) return;
      drag.constraint.pointA = { x: px, y: py };
    },
    endDrag() {
      if (!drag) return;
      Composite.remove(engine.world, drag.constraint);
      drag = null;
    },
    isDragging() {
      return drag !== null;
    },
    drainImpacts() {
      const out = impacts.slice();
      impacts.length = 0;
      return out;
    },
    dispose() {
      this.endDrag();
      Events.off(engine, "beforeUpdate");
      Events.off(engine, "collisionStart");
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}
