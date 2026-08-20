/**
 * CompanionCreature —— v3 单生物:全应用唯一一只伴学,跨栏连续行动。
 *
 * 三重世界:
 *   rail(左栏原生物理世界)—— Matter 飞行体:悬浮巡航 + 与地图球跨引擎碰撞
 *     (可被球拍翻滚),遵循左栏物理;翻墙出场 = transit 动画整体旁路物理。
 *   chat(中栏宠物世界)—— 输入框聚焦时落在 composer 上缘右侧(Bongo Cat
 *     逐键拍臂由 Mascot 既有机制负责),位置避开文字。
 *   notebook(右栏助教世界)—— 朗读口型同步 + 划线记笔记动作,栖在标签行下右上角。
 *
 * 待机(无点击/滚动中)→ 纱帘后(mode=veil):半透明+轻模糊隐匿,点击唤醒。
 * 单例:App 只挂一个;所有定位在视口坐标(position:fixed),rAF 直写 transform
 * 零重渲染;React 状态只管 zone/mode/表情换挡。
 * reduced-motion:物理与跟随全部旁路,直接静态贴锚点。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Matter from "matter-js";

import {
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
  type BallProbe,
  type FlightWorld,
} from "../../lib/companion/companion-flight.ts";
import { BALL_RADIUS } from "../../lib/mapPhysics.js";
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

export function CompanionCreature({ worldReady }: { worldReady: boolean }) {
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);
  const reduced = usePrefersReducedMotion();
  const [inTransit, setInTransit] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<FlightWorld | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const zoneRef = useRef(snap.state.zone);
  const swatLatchRef = useRef(false);
  /** 左栏待机空地(中部带,周期重选)与下次重选时刻 */
  const perchRef = useRef<{ x: number; y: number } | null>(null);
  const perchDueRef = useRef(0);

  const zone = snap.state.zone;
  // zone 变化 → 飞行姿势窗口(物理/锚点目标在 rAF 里切,姿势由 React 换挡);
  // 落栖弹跳:transit 结束踩一下"落地"压缩回弹(WAAPI additive,不碰 rAF 的位移)
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

      const railOk = !!navRect && navRect.width > 40 && rw.visible;
      // 目标世界的锚点不在场(T3 换栏等)→ 退回 rail;rail 也不在 → 隐匿
      let eff: "rail" | "chat" | "notebook" = st.zone;
      if ((eff === "chat" && !chatAnchor()) || (eff === "notebook" && !notebookAnchor())) eff = "rail";

      let target: { x: number; y: number } | null = null;

      if (eff === "rail" && railOk) {
        const w = navRect!.width;
        const h = navRect!.height;
        if (reduced) {
          // 静态兜底:中部定点
          target = { x: navRect!.left + w * 0.5, y: navRect!.top + h * 0.5 };
          angle = 0;
        } else {
          if (w !== navW || h !== navH) {
            navW = w;
            navH = h;
            flightRef.current?.resize(w, h);
            perchRef.current = null; // 栏尺寸变了,重选空地
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
          // 纱帘后也照常采集(挑空地要用),只是不喂给物理(不与球纠缠)。
          const probes: BallProbe[] = [];
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
            }
          }
          // 待机空地:高度中部带 + 离所有球最远的候选点;每 3s 或栏宽变化时重选
          // (球滚动/换 section 后空地会变,周期重选跟着挪窝;避让场兜底过渡)。
          if (!perchRef.current || now > perchDueRef.current) {
            perchRef.current = pickPerchBase(w, h, probes, Math.floor(now / 1000));
            perchDueRef.current = now + 3000;
          }
          const base = perchRef.current;
          const swatted = flight.step(dt, base, st.mode === "veil" ? [] : probes, now);
          if (swatted && !swatLatchRef.current) companionSwat();
          swatLatchRef.current = swatted || flight.dizzyRemaining(now) > 0;
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
            // 弹性跟随(面板尺寸/滚动变化时平滑贴上去)
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
      wrap.style.opacity = "";
      wrap.style.transform = `translate3d(${(target.x - w / 2).toFixed(1)}px, ${(target.y - w / 2).toFixed(1)}px, 0) rotate(${(angle * 57.2958).toFixed(1)}deg)`;
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
      className={`cp-creature fixed left-0 top-0 z-40 will-change-transform ${snap.state.mode === "veil" ? "cp-veil" : ""}`}
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
        testid="companion-mascot"
        keySeq={snap.state.keySeq}
        keySide={snap.state.keySide}
      />
    </div>
  );
}
