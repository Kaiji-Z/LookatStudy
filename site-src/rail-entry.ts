/**
 * 落地页左栏世界桥接层——把 app 的真实物理岛(mapPhysics/Matter.js)、确定性布局
 * (mapLayout)与天空场景(skyCanvas)挂到静态页面上。
 * 由 scripts/build-rail-demo.mjs 打包成 site/rail-demo.js(IIFE,挂 window.RailDemo)。
 *
 * v3(物理全量对齐 app 的 MapRail):
 * - 绳子渲染 = 粒子链全路径([端点, ...绳粒, 端点] 喂 ropeChainPathD),
 *   与 MapRail.tsx rAF 同构——拖拽荡回/风摆/垂坠才有绳感(旧版两点直线是刚性杆)。
 * - squash 指数衰减(decaySquash,渲染层职责)——旧版碰撞一次永久压扁。
 * - 碰撞脉冲环:每岛 8 圆 SVG 池(PULSE_MS 520,r/透明度随冲击速度,app 同参数);
 *   drainImpacts 收敛为 frame 单一消费点,分发给 pulse 池 + orb 层(缓存取走)+ onImpacts。
 * - field 斥力光环(b.field → 蓝色 circle,app 同参数)。
 * - orb 装饰层接 o.orbCanvas(z-20 盖球层)——雪顶/雨痕可见(旧版画进天空层被盖死)。
 * - 视口 resize 节流重建岛(app ResizeObserver 同语义);天气/解锁状态跨重建保留。
 * - reduced-motion:不启动 rAF(buildAll 已静态落位;天空层自带单帧双轨,orb 层 noop)。
 */
import { computeBalloonLayout } from "../src/renderer/lib/mapLayout.js";
import {
  createSectionIsland,
  ropeChainPathD,
  decaySquash,
  BALL_RADIUS,
  ROPE_ATTACH,
  type Vec2,
  type ImpactEvent,
} from "../src/renderer/lib/mapPhysics.js";
import { attachSky, attachOrbWeather, pickPreset, PRESETS, type SkyPreset } from "../src/renderer/lib/skyCanvas.js";
import Matter from "matter-js";

export interface RailBallSpec {
  id: string;
  isExam?: boolean;
  locked?: boolean;
}

export interface RailSectionSpec {
  id: string;
  world: HTMLElement;
  ropes: SVGSVGElement;
  balls: RailBallSpec[];
  /** 宿主算好的布局(演示地图自定义排布);缺省用 computeBalloonLayout。 */
  positions?: { x: number; y: number }[];
  /** 球物理半径(演示地图放大球);缺省 28。 */
  ballRadius?: number;
}

export interface RailWorldOpts {
  panel: HTMLElement;
  sky: HTMLCanvasElement;
  orbCanvas: HTMLCanvasElement;
  scroller: HTMLElement;
  seed: string;
  sections: RailSectionSpec[];
  /** 初始天气档(dock 状态贯通);缺省取 seed 的季节预设档。 */
  weather?: string;
  onImpacts?: (hits: { x: number; y: number; speed: number; secId: string }[]) => void;
  /** 岛重建(天气切换/视口 resize)后回调——宿主借此恢复桥外的装饰状态(如叙事绿绳)。 */
  onRebuild?: () => void;
}

export interface RailHandle {
  ballPos(id: string): Vec2 | null;
  ropeEl(secId: string, i: number): SVGPathElement | null;
  unlock(id: string): void;
  setWeather(weather: string): void;
  beginDrag(id: string, x: number, y: number): void;
  moveDrag(x: number, y: number): void;
  endDrag(): void;
  /** 点击轻推:不给拖拽约束,一颗小冲量让球荡一下(app 点击球同款反馈位)。 */
  nudge(id: string): void;
  destroy(): void;
}

/** 碰撞脉冲环参数(app MapRail 同款)。 */
const PULSE_MS = 520;
const PULSE_POOL = 8;

interface PulseSlot {
  el: SVGCircleElement;
  t: number; // 已播毫秒,>=PULSE_MS 视为空闲
  x: number;
  y: number;
  speed: number;
}

interface SecInst {
  spec: RailSectionSpec;
  island: ReturnType<typeof createSectionIsland>;
  r: number;
  ballEls: Map<string, HTMLElement>;
  halos: Map<string, SVGCircleElement>;
  ropesEl: SVGSVGElement;
  ropePaths: SVGPathElement[];
  pulses: PulseSlot[];
  /** 本帧累积的碰撞事件,orb 层回调取走(与 frame 的 pulse 消费共存,cap 64)。 */
  pendingImpacts: ImpactEvent[];
  height: number;
}

export function mountRail(o: RailWorldOpts): RailHandle {
  const NS = "http://www.w3.org/2000/svg";
  const baseKey = pickPreset(o.seed);
  let season = (baseKey.split("|")[0] ?? "autumn") as string;
  let weather = o.weather ?? (baseKey.split("|")[1] ?? "clear");
  let preset: SkyPreset = PRESETS[`${season}|${weather}`] ?? PRESETS[baseKey] ?? PRESETS["autumn|clear"];

  const unlocked = new Set<string>();
  for (const s of o.sections) for (const b of s.balls) if (!b.locked) unlocked.add(b.id);

  let stopSky = () => {};
  let stopOrb = () => {};
  const insts: SecInst[] = [];
  const idToSec = new Map<string, SecInst>();

  function buildIsland(sec: RailSectionSpec): SecInst {
    const width = sec.world.clientWidth || 320;
    const r = sec.ballRadius ?? BALL_RADIUS;
    const layout = computeBalloonLayout(sec.balls.length, width, sec.id);
    const positions = sec.positions ?? layout.nodes.map((n) => ({ x: n!.x, y: n!.y }));
    const height = Math.max(
      ...positions.map((pt) => pt.y + r * 3),
      Math.ceil(layout.height),
    );
    sec.world.style.height = height + "px";

    const island = createSectionIsland({
      nodes: sec.balls.map((b, i) => ({
        id: b.id,
        x: positions[i]!.x,
        y: positions[i]!.y,
        isExam: b.isExam,
        locked: b.locked && !unlocked.has(b.id),
      })),
      width,
      height,
      ballRadius: r,
      weather,
      anchorKnotX: Math.round(width * 0.34),
    });

    const ballEls = new Map<string, HTMLElement>();
    const halos = new Map<string, SVGCircleElement>();
    sec.balls.forEach((b, i) => {
      const el = sec.world.querySelector<HTMLElement>(`[data-rail-ball="${b.id}"]`);
      if (!el) return;
      el.style.left = `${positions[i]!.x}px`;
      el.style.top = `${positions[i]!.y}px`;
      el.style.transform = "";
      ballEls.set(b.id, el);
      // field 斥力光环(app:stroke #1cb0f6,r/opacity 随 field 每帧更新)
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", "#1cb0f6");
      halo.setAttribute("stroke-width", "2");
      halo.setAttribute("opacity", "0");
      sec.ropes.appendChild(halo);
      halos.set(b.id, halo);
    });

    const ropePaths: SVGPathElement[] = [];
    const makeRope = () => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("class", "rope");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke-linecap", "round");
      sec.ropes.appendChild(p);
      ropePaths.push(p);
      return p;
    };
    makeRope();
    for (let i = 0; i < sec.balls.length - 1; i++) makeRope();

    // 碰撞脉冲环池(白描边圆,frame 驱动)
    const pulses: PulseSlot[] = [];
    for (let i = 0; i < PULSE_POOL; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "rgba(255,255,255,0.9)");
      c.setAttribute("opacity", "0");
      sec.ropes.appendChild(c);
      pulses.push({ el: c, t: PULSE_MS + 1, x: 0, y: 0, speed: 0 });
    }

    const inst: SecInst = { spec: sec, island, r, ballEls, halos, ropesEl: sec.ropes, ropePaths, pulses, pendingImpacts: [], height };
    idToSec.set(sec.id, inst);
    for (const b of sec.balls) idToSec.set(b.id, inst);
    return inst;
  }

  /** 绳端悬挂点:锚绳结 / 球底(球心 + r×ROPE_ATTACH)。app attachOf 同构。 */
  function attachOf(inst: SecInst, id: string): Vec2 {
    if (id === "__anchor") return inst.island.anchor;
    const ball = inst.island.ball(id);
    if (ball) return { x: ball.body.position.x, y: ball.body.position.y + inst.r * ROPE_ATTACH };
    return inst.island.anchor;
  }

  /** 第 i 条绳的全链路径(端点 + 全部绳粒),app MapRail rAF 同构。 */
  function paintRope(inst: SecInst, i: number) {
    const link = inst.island.links[i];
    if (!link) return;
    const pts: Vec2[] = [attachOf(inst, link.from)];
    for (const p of link.particles) pts.push({ x: p.position.x, y: p.position.y });
    pts.push(attachOf(inst, link.to));
    inst.ropePaths[i]!.setAttribute("d", ropeChainPathD(pts));
  }

  function paintRopes(inst: SecInst) {
    const anchor = inst.island.anchor;
    const knot = document.createElementNS(NS, "circle");
    knot.setAttribute("cx", String(anchor.x));
    knot.setAttribute("cy", String(anchor.y));
    knot.setAttribute("r", "3.5");
    knot.setAttribute("fill", "#ffc800");
    knot.setAttribute("opacity", "0.9");
    inst.ropesEl.appendChild(knot);
    for (let i = 0; i < inst.ropePaths.length; i++) paintRope(inst, i);
  }

  function attachSkyLayers() {
    stopSky();
    stopOrb();
    stopSky = attachSky(o.sky, o.scroller, o.panel, preset);
    stopOrb = attachOrbWeather(
      // orb 装饰层必须画在盖球层(#railOrbs,z-20)——画进天空层会被世界内容盖死
      o.orbCanvas,
      o.panel,
      preset,
      () => {
        const orbs: { x: number; y: number; r: number; snow: number }[] = [];
        for (const inst of insts) {
          const r = inst.spec.world.getBoundingClientRect();
          if (r.bottom < -100 || r.top > window.innerHeight + 100) continue;
          const dx = r.left - o.panel.getBoundingClientRect().left;
          const dy = r.top - o.panel.getBoundingClientRect().top;
          for (const b of inst.island.balls) {
            orbs.push({ x: b.body.position.x + dx, y: b.body.position.y + dy, r: inst.r, snow: b.snow });
          }
        }
        return orbs;
      },
      () => {
        // impacts 的单一生产点在 frame(drain 后存 pending);这里只取走
        const out: { x: number; y: number; speed: number }[] = [];
        for (const inst of insts) {
          for (const h of inst.pendingImpacts) {
            const r = inst.spec.world.getBoundingClientRect();
            out.push({ x: h.x + r.left, y: h.y + r.top, speed: h.speed });
          }
          inst.pendingImpacts.length = 0;
        }
        return out;
      },
      () => {
        const out: { x: number; y: number; vx: number; vy: number; amount: number }[] = [];
        for (const inst of insts) {
          const r = inst.spec.world.getBoundingClientRect();
          for (const f of inst.island.drainFlakes()) {
            out.push({ x: f.x + r.left, y: f.y + r.top, vx: f.vx, vy: f.vy, amount: f.amount });
          }
        }
        return out;
      },
    );
  }

  function rebuildIslands() {
    for (const inst of insts) inst.island.dispose();
    insts.length = 0;
    idToSec.clear();
    for (const sec of o.sections) {
      sec.ropes.textContent = "";
      sec.world.style.height = "";
      insts.push(buildIsland(sec));
    }
    for (const inst of insts) paintRopes(inst);
    attachSkyLayers();
    o.onRebuild?.();
  }

  /* 视口 resize:岛按挂载时宽度布局,窄化/拉宽后必须重排(app MapRail 同语义:
     ResizeObserver 节流重建)。球位置溢出视口、bot 栖点飞出屏幕都由此修复。 */
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuildIslands, 120);
  };
  window.addEventListener("resize", onResize);

  /* ── 主循环:视口内岛才 step/渲染(冻结省 CPU) ── */
  let raf = 0;
  let last = performance.now();

  function pulseSpawn(inst: SecInst, x: number, y: number, speed: number) {
    const slot = inst.pulses.find((p) => p.t >= PULSE_MS);
    if (!slot) return; // 池满丢弃(app 同语义)
    slot.t = 0;
    slot.x = x;
    slot.y = y;
    slot.speed = speed;
  }

  function pulseFrame(inst: SecInst, dtMs: number) {
    for (const p of inst.pulses) {
      if (p.t >= PULSE_MS) {
        if (p.el.getAttribute("opacity") !== "0") p.el.setAttribute("opacity", "0");
        continue;
      }
      p.t += dtMs;
      const k = Math.min(1, p.t / PULSE_MS);
      const s = Math.min(1, p.speed / 14);
      p.el.setAttribute("cx", p.x.toFixed(1));
      p.el.setAttribute("cy", p.y.toFixed(1));
      p.el.setAttribute("r", (6 + k * (14 + s * 14)).toFixed(1));
      p.el.setAttribute("opacity", (0.55 * (1 - k)).toFixed(3));
      p.el.setAttribute("stroke-width", (2 + s * 1.5).toFixed(2));
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(48, now - last);
    last = now;
    const vh = window.innerHeight;
    for (const inst of insts) {
      const r = inst.spec.world.getBoundingClientRect();
      if (r.bottom < -220 || r.top > vh + 220) continue; // 视口外冻结
      inst.island.step(dt);
      // impacts 单一消费点:pulse 池 + orb 层缓存 + onImpacts
      const hits = inst.island.drainImpacts();
      for (const h of hits) pulseSpawn(inst, h.x, h.y, h.speed);
      if (hits.length) {
        for (const h of hits) inst.pendingImpacts.push(h);
        if (inst.pendingImpacts.length > 64) inst.pendingImpacts.splice(0, inst.pendingImpacts.length - 64);
        if (o.onImpacts) {
          const pr = o.panel.getBoundingClientRect();
          o.onImpacts(hits.map((h) => ({ x: h.x + r.left - pr.left, y: h.y + r.top - pr.top, speed: h.speed, secId: inst.spec.id })));
        }
      }
      pulseFrame(inst, dt);
      for (const b of inst.island.balls) {
        const el = inst.ballEls.get(b.nodeId);
        if (!el) continue;
        // squash 指数衰减是渲染层职责(app decaySquash;旧版漏掉 = 碰撞一次永久压扁)
        b.squash = decaySquash(b.squash, dt);
        const dx = b.body.position.x - b.layoutX;
        const dy = b.body.position.y - b.layoutY;
        const sq = b.squash > 0.01
          ? ` rotate(${((b.squashAngle * 180) / Math.PI).toFixed(1)}deg) scale(${(1 + Math.min(0.35, b.squash)).toFixed(3)}, ${(1 - Math.min(0.35, b.squash)).toFixed(3)}) rotate(${(-b.squashAngle * 180 / Math.PI).toFixed(1)}deg)`
          : "";
        el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)${sq}`;
        const halo = inst.halos.get(b.nodeId);
        if (halo) {
          if (b.field > 0.02) {
            halo.setAttribute("cx", b.body.position.x.toFixed(1));
            halo.setAttribute("cy", b.body.position.y.toFixed(1));
            halo.setAttribute("r", (BALL_RADIUS + 4 + b.field * 5).toFixed(1));
            halo.setAttribute("opacity", (0.3 * b.field).toFixed(3));
          } else if (halo.getAttribute("opacity") !== "0") {
            halo.setAttribute("opacity", "0");
          }
        }
      }
      for (let i = 0; i < inst.ropePaths.length; i++) paintRope(inst, i);
    }
  }

  for (const sec of o.sections) insts.push(buildIsland(sec));
  for (const inst of insts) paintRopes(inst);
  attachSkyLayers();
  // reduced-motion:buildAll 已把球/绳按物理布局静态落位(绳粒出生即预下垂),
  // 天空层自带 reduced 单帧+scroll 重绘双轨、orb 装饰层 reduced 直接 noop——只跳过主循环。
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    raf = requestAnimationFrame(frame);
  }

  return {
    ballPos(id) {
      const inst = idToSec.get(id);
      const b = inst?.island.ball(id);
      return b ? { x: b.body.position.x, y: b.body.position.y } : null;
    },
    ropeEl(secId, i) {
      const inst = idToSec.get(secId);
      return inst ? inst.ropePaths[i] ?? null : null;
    },
    unlock(id) {
      const inst = idToSec.get(id);
      const b = inst?.island.ball(id);
      if (!inst || !b) return;
      unlocked.add(id);
      b.body.isStatic = false;
      // 创建时即 isStatic 的球没有 _original 快照 → 手工重建动力学属性
      Matter.Body.setDensity(b.body, b.isExam ? 0.0016 : 0.001);
      Matter.Body.setInertia(b.body, Infinity);
      Matter.Body.applyForce(b.body, b.body.position, { x: 0, y: -0.0012 });
      // "苏醒"squash:解锁瞬间球被向上拽一下的压弹感(squashAngle 0 = 纵向压扁)
      b.squash = Math.max(b.squash, 0.18);
      b.squashAngle = 0;
    },
    setWeather(w) {
      weather = w;
      // 季节×天气组合缺失时(app 的 12 预设:雪只在冬天、雷暴只在夏/秋),
      // 切到拥有该天气的季节——dock 才不会假切换(雪=入冬,雷暴=入夏,符合直觉)
      let key = `${season}|${w}`;
      if (!PRESETS[key]) {
        const alt = Object.keys(PRESETS).find((k) => k.endsWith(`|${w}`));
        if (alt) {
          season = alt.split("|")[0]!;
          key = alt;
        }
      }
      preset = PRESETS[key] ?? preset;
      // 重建岛(环境参数定格,与 app 同语义);解锁状态保留
      rebuildIslands();
      raf = raf || requestAnimationFrame(frame);
    },
    beginDrag(id, x, y) { idToSec.get(id)?.island.beginDrag(id, x, y); },
    moveDrag(x, y) { for (const inst of insts) if (inst.island.isDragging()) { inst.island.moveDrag(x, y); return; } },
    endDrag() { for (const inst of insts) if (inst.island.isDragging()) { inst.island.endDrag(); return; } },
    nudge(id) {
      const inst = idToSec.get(id);
      const b = inst?.island.ball(id);
      if (!inst || !b || b.body.isStatic) return;
      Matter.Body.applyForce(b.body, b.body.position, { x: (Math.random() - 0.5) * 0.006, y: -0.002 });
      b.squash = Math.max(b.squash, 0.14);
      b.squashAngle = 0;
    },
    destroy() {
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      raf = 0;
      stopSky();
      stopOrb();
      for (const inst of insts) inst.island.dispose();
      insts.length = 0;
    },
  };
}
