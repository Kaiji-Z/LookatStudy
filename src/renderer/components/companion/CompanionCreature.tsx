/**
 * CompanionCreature —— v3/v4 单生物:全应用唯一一只伴学,跨栏连续行动。
 *
 * 三重世界:
 *   rail(左栏原生物理世界)—— Matter 飞行体:悬浮巡航(中部空地) + 球避让 +
 *     跨引擎碰撞(可被球拍翻滚) + 天风吹斜/雨中抖水 + 纱帘时落绳栖息;
 *     可被抓住拖拽、扔出去晕眩翻滚再飞回来。
 *   chat(中栏宠物世界)—— 输入框聚焦时落在 composer 上缘右侧(Bongo Cat
 *     逐键拍臂),位置避开文字。
 *   notebook(右栏助教世界)—— 朗读口型同步 + 划线记笔记动作,栖标签行下右上。
 *
 * v4:情境反应(exam/import/review/dayWelcome 由 bus 事件驱动,这里只管
 * 落位)、记忆联动(课程切换后飞到 friction 卡点球旁)、等级徽标(皇冠/光环,
 * 壳层渲染)、宠物音效钩子。触屏=鼠标同款(全部 pointer events)。
 * reduced-motion:物理与跟随旁路,静态贴锚。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Matter from "matter-js";

import {
  companionGrab,
  companionLandSfx,
  companionNodePoint,
  companionPoke,
  companionSwat,
  getCompanionSnapshot,
  getRailWorld,
  subscribeCompanion,
} from "../../lib/companion/bus.ts";
import { useSpeechMouth } from "../../lib/companion/use-mouth.ts";
import {
  bankAngle,
  createFlightWorld,
  pickPerchBase,
  pickRestSpot,
  type BallProbe,
  type FlightWorld,
} from "../../lib/companion/companion-flight.ts";
import { BALL_RADIUS, WIND_STRENGTH, swirlAt, weatherPhysFor } from "../../lib/mapPhysics.js";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion.js";

import { Mascot } from "./Mascot.tsx";

/** 各世界体型(rail 天空居民最大,chat 宠物最小,notebook 助教居中)。 */
const SIZE: Record<"rail" | "chat" | "notebook", number> = { rail: 88, chat: 56, notebook: 64 };

/** chat 锚点:composer 卡上缘右侧(避开左侧附件/starter 药丸,不遮文字)。 */
function chatAnchor(): { x: number; y: number } | null {
  const el =
    document.querySelector<HTMLElement>('[data-testid="composer"]') ??
    document.querySelector<HTMLElement>('[data-testid="composer-nokey"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.right - 84, y: r.top - 10 };
}

/** notebook 锚点:面板右上、标签行之下(正文列居中,右上肩是留白)。 */
function notebookAnchor(): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>('[data-testid="notebook-panel"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.right - 58, y: r.top + 66 };
}

export function CompanionCreature({ worldReady, courseId }: { worldReady: boolean; courseId: string | null }) {
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);
  const reduced = usePrefersReducedMotion();
  const [inTransit, setInTransit] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<FlightWorld | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const zoneRef = useRef(snap.state.zone);
  const swatLatchRef = useRef(false);
  /** 左栏待机空地(中部带,周期重选/记忆卡点覆盖)与下次重选时刻 */
  const perchRef = useRef<{ x: number; y: number } | null>(null);
  const perchDueRef = useRef(0);
  /** 抓取:指针位置/速度采样(最近两帧),rAF 直读 */
  const grabRef = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  /** 雨天抖水节流 */
  const nextShiverRef = useRef(0);

  const zone = snap.state.zone;
  // zone 变化 → 飞行姿势窗口(物理/锚点目标在 rAF 里切,姿势由 React 换挡);
  // 落栖弹跳:transit 结束"落地"压缩回弹(WAAPI additive)+ 闷响音效
  useEffect(() => {
    if (zone === zoneRef.current) return;
    zoneRef.current = zone;
    if (reduced) return;
    setInTransit(true);
    const timers = [
      setTimeout(() => setInTransit(false), 950),
      setTimeout(() => {
        const el = wrapRef.current;
        if (!el || zone === "rail") return;
        companionLandSfx();
        el.animate?.(
          [
            { transform: "scale(1, 1)" },
            { transform: "scale(1.07, 0.88)", offset: 0.42 },
            { transform: "scale(0.98, 1.03)", offset: 0.72 },
            { transform: "scale(1, 1)" },
          ],
          { duration: 280, easing: "ease-out", composite: "add" },
        );
      }, 940),
    ];
    return () => { for (const t of timers) clearTimeout(t); };
  }, [zone, reduced]);

  // 记忆联动:课程切换后查 friction 卡点 → 把待机空地临时钉到卡点球旁 + 指向反应
  useEffect(() => {
    if (!worldReady || !courseId) return;
    let alive = true;
    void window.api
      .getDashboard(courseId)
      .then((d) => {
        if (!alive) return;
        const weak = d?.frictionByNode?.[0];
        if (!weak?.nodeId) return;
        const rw = getRailWorld();
        const navRect = rw.nav?.getBoundingClientRect();
        if (!navRect) return;
        for (const { island, container } of rw.sections.values()) {
          const b = island.ball(weak.nodeId);
          if (!b) continue;
          const cr = container.getBoundingClientRect();
          const lx = cr.left - navRect.left + b.body.position.x;
          const ly = cr.top - navRect.top + b.body.position.y;
          perchRef.current = { x: lx, y: Math.max(40, ly - 92) };
          perchDueRef.current = performance.now() + 8000;
          setTimeout(() => { if (alive) companionNodePoint(); }, 1200);
          return;
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [worldReady, courseId]);

  // 抓取:抓住后全局跟踪指针(不依赖 setPointerCapture,触屏同款);松手算速度
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = grabRef.current;
      if (!g) return;
      const t = performance.now();
      const dtms = Math.max(8, t - g.t);
      grabRef.current = {
        x: e.clientX,
        y: e.clientY,
        vx: ((e.clientX - g.x) / dtms) * 16.7,
        vy: ((e.clientY - g.y) / dtms) * 16.7,
        t,
      };
    };
    const onUp = () => {
      const g = grabRef.current;
      if (!g) return;
      grabRef.current = null;
      const speed = Math.hypot(g.vx, g.vy);
      // 扔出:给物理体真实初速 + 晕眩(控制器断开翻滚);慢放=温柔落回
      const flight = flightRef.current;
      if (flight) {
        if (speed >= 2.5) {
          Matter.Body.setVelocity(flight.body, { x: g.vx * 0.9, y: g.vy * 0.9 });
          flight.throwDizzy(performance.now());
        }
      }
      companionGrab(false, speed);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    if (!worldReady || !snap.enabled) return;
    const wrap = wrapRef.current;
    if (!wrap) return;

    let raf = 0;
    let last = performance.now();
    let navW = 0;
    let navH = 0;
    let angle = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      const rw = getRailWorld();
      const nav = rw.nav;
      const navRect = nav?.getBoundingClientRect() ?? null;
      const st = getCompanionSnapshot().state;
      const grabbed = !!grabRef.current;

      // 导入监工:importing 期间即使地图面板隐去也在左栏值守
      const railOk = !!navRect && navRect.width > 40 && (rw.visible || st.importing);
      // 目标世界的锚点不在场(T3 换栏等)→ 退回 rail;rail 也不在 → 隐匿
      let eff: "rail" | "chat" | "notebook" = st.zone;
      if (!grabbed && ((eff === "chat" && !chatAnchor()) || (eff === "notebook" && !notebookAnchor()))) eff = "rail";

      let target: { x: number; y: number } | null = null;

      if (grabbed) {
        // ── 抓取中:指针就是全世界(任何 zone 都直接拖拽) ──
        const g = grabRef.current!;
        flightRef.current = null; // 物理旁路,松手再按 zone 重建
        target = { x: g.x, y: g.y };
        angle = Math.max(-0.5, Math.min(0.5, g.vx * 0.04));
      } else if (eff === "rail" && railOk) {
        const w = navRect!.width;
        const h = navRect!.height;
        if (reduced) {
          target = { x: navRect!.left + w * 0.5, y: navRect!.top + h * 0.5 };
          angle = 0;
        } else {
          if (w !== navW || h !== navH) {
            navW = w;
            navH = h;
            flightRef.current?.resize(w, h);
            perchRef.current = null;
          }
          if (!flightRef.current) {
            flightRef.current = createFlightWorld({ width: w, height: h });
            const prev = posRef.current;
            if (prev) {
              Matter.Body.setPosition(flightRef.current.body, {
                x: Math.min(w - 30, Math.max(30, prev.x - navRect!.left)),
                y: Math.min(h - 30, Math.max(30, prev.y - navRect!.top)),
              });
            }
          }
          const flight = flightRef.current;
          // 跨引擎球探针:在场岛的球 → rail 局部坐标(拍他/被他撞都真实)。
          // 纱帘后也照常采集(挑空地/挑栖息点要用),只是不喂给物理。
          const probes: BallProbe[] = [];
          const restSpots: { x: number; y: number }[] = [];
          for (const { island, container } of rw.sections.values()) {
            const cr = container.getBoundingClientRect();
            if (cr.bottom < navRect!.top - 120 || cr.top > navRect!.bottom + 120) continue;
            const ox = cr.left - navRect!.left;
            const oy = cr.top - navRect!.top;
            for (const b of island.balls) {
              probes.push({
                x: ox + b.body.position.x,
                y: oy + b.body.position.y,
                vx: b.body.velocity.x,
                vy: b.body.velocity.y,
                r: BALL_RADIUS,
                isStatic: b.body.isStatic,
                push: (fx, fy) => Matter.Body.applyForce(b.body, b.body.position, { x: fx, y: fy }),
              });
              restSpots.push({ x: ox + b.body.position.x, y: oy + b.body.position.y - BALL_RADIUS - 20 });
            }
            // 绳粒 = 天然的落脚树枝(纱帘栖息候选)
            for (const link of island.links) {
              for (const p of link.particles) {
                restSpots.push({ x: ox + p.position.x, y: oy + p.position.y - 8 });
              }
            }
          }
          // 待机位:纱帘 → 最近的绳/球顶栖息点(真落下休息);否则中部空地重选
          let base = perchRef.current;
          let settle = false;
          if (st.mode === "veil") {
            const rest = pickRestSpot({ x: flight.body.position.x, y: flight.body.position.y }, restSpots, 220);
            if (rest) {
              base = rest;
              settle = true;
            }
          }
          if (!base || now > perchDueRef.current) {
            perchRef.current = pickPerchBase(w, h, probes, Math.floor(now / 1000));
            perchDueRef.current = now + 3000;
            base = perchRef.current;
          }
          const swatted = flight.step(dt, base, st.mode === "veil" ? [] : probes, now, { settle });
          if (swatted && !swatLatchRef.current) companionSwat();
          swatLatchRef.current = swatted || flight.dizzyRemaining(now) > 0;
          // 天气:风把他吹斜(控制器自然回正=可见的挣扎);雨/暴雨定期抖水
          if (flight.dizzyRemaining(now) === 0) {
            const env = weatherPhysFor(rw.weather);
            if (env.wind >= 0.3) {
              const m = flight.body.mass;
              Matter.Body.applyForce(flight.body, flight.body.position, {
                x: swirlAt(flight.body.position.x, flight.body.position.y, now) * env.wind * WIND_STRENGTH * m * 2.2,
                y: 0,
              });
            }
            if ((rw.weather === "rain" || rw.weather === "storm") && st.mode !== "veil" && now > nextShiverRef.current) {
              nextShiverRef.current = now + 6000 + Math.random() * 4000;
              wrap.classList.add("cp-shiver");
              setTimeout(() => wrap.classList.remove("cp-shiver"), 460);
            }
          }
          const p = flight.body.position;
          target = { x: navRect!.left + p.x, y: navRect!.top + p.y };
          angle = flight.body.angle + bankAngle(flight.body.velocity.x, flight.body.velocity.y);
        }
      } else if (eff !== "rail") {
        flightRef.current = null;
        const anchor = eff === "chat" ? chatAnchor() : notebookAnchor();
        if (anchor) {
          if (reduced) {
            target = anchor;
            angle = 0;
          } else {
            const cur = posRef.current ?? anchor;
            const k = 1 - Math.exp(-dt / 90);
            target = { x: cur.x + (anchor.x - cur.x) * k, y: cur.y + (anchor.y - cur.y) * k };
            angle = Math.max(-0.35, Math.min(0.35, (anchor.x - cur.x) * 0.012));
          }
        }
      }

      if (!target) {
        wrap.style.opacity = "0";
        posRef.current = null;
        return;
      }
      posRef.current = target;
      const w = wrap.offsetWidth || SIZE[eff === "rail" ? "rail" : eff];
      wrap.style.transform = `translate3d(${(target.x - w / 2).toFixed(1)}px, ${(target.y - w / 2).toFixed(1)}px, 0) rotate(${(angle * 57.2958).toFixed(1)}deg)`;
      // 高度感:离栏底越远阴影越小越淡(CSS 变量直写,零重渲染)
      if (navRect) {
        const alt = Math.min(1, Math.max(0, 1 - (target.y - navRect.top) / navRect.height));
        wrap.style.setProperty("--cp-alt", alt.toFixed(3));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      flightRef.current?.dispose();
      flightRef.current = null;
    };
  }, [worldReady, snap.enabled, reduced]);

  if (!worldReady || !snap.enabledLoaded || !snap.enabled) return null;

  const pose = inTransit ? "flying" : snap.state.pose;
  return (
    <div
      ref={wrapRef}
      className={`cp-creature fixed left-0 top-0 z-40 will-change-transform ${snap.state.mode === "veil" ? "cp-veil" : ""} ${snap.state.grabbed ? "cp-grabbed" : ""}`}
      data-testid="companion-creature"
      data-zone={zone}
      data-mode={snap.state.mode}
    >
      <Mascot
        form={snap.form}
        expression={snap.state.expression}
        pose={pose}
        viseme={mouth.viseme}
        openScale={mouth.open}
        energyRatio={snap.energyRatio}
        streakLit={snap.streakLit}
        size={SIZE[zone]}
        interactive
        ariaLabel="companion"
        onPoke={companionPoke}
        onGrab={(px, py) => {
          if (!grabRef.current) {
            grabRef.current = { x: px, y: py, vx: 0, vy: 0, t: performance.now() };
            companionGrab(true);
          }
        }}
        crownBadge={snap.crowned}
        haloBadge={snap.halo}
        testid="companion-mascot"
        keySeq={snap.state.keySeq}
        keySide={snap.state.keySide}
      />
    </div>
  );
}
