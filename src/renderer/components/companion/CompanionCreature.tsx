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
import { readingAnchorPos, zoneDrift, wanderInPanel } from "../../lib/companion/companion-core.js";
import { getReadingRange } from "../../lib/highlightText.js";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion.js";

import { Mascot } from "./Mascot.tsx";

/** 各世界体型(v5 放大:chat 76 / notebook 88 看清口型;rail 天空居民不变)。 */
// v7 近大远小:左栏=远距离(小),中栏=中距离,右栏=近距离(最大,看清口型细节)。
// 跨栏时 Mascot 尺寸带过渡动画(CSS width/height transition),飞行途中就是"变大/变小"本身。
const SIZE: Record<"rail" | "chat" | "notebook", number> = { rail: 76, chat: 96, notebook: 120 };

/** 栏内锚点(视口坐标)。 */
type ZoneAnchor = { x: number; y: number };

/** chat 锚点:输入卡上缘右侧上空悬浮(v6 撤掉半身藏卡:拍键手臂全程可见,附近轻漂)。 */
function chatAnchor(): ZoneAnchor | null {
  const card = document.querySelector<HTMLElement>('[data-testid="composer-card"]');
  const el =
    card ??
    document.querySelector<HTMLElement>('[data-testid="composer"]') ??
    document.querySelector<HTMLElement>('[data-testid="composer-nokey"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 悬在卡片上缘之上(完整可见),右侧避开文字;无卡(nokey 横幅)同款悬停
  return { x: r.right - 78, y: r.top - 44 };
}

/** notebook 锚点:面板右上、标签行之下(正文列居中,右上肩是留白)。朗读跟句时会被
 *  .cp-reading-mark 实时位置覆盖(见 rAF),这是无朗读时的默认栖位。 */
function notebookAnchor(): ZoneAnchor | null {
  const el = document.querySelector<HTMLElement>('[data-testid="notebook-panel"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.right - 64, y: r.top + 84 };
}

export function CompanionCreature({ courseId }: { courseId: string | null }) {
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);
  const reduced = usePrefersReducedMotion();
  const [inTransit, setInTransit] = useState(false);
  /** v6 朗读跟句:正在指句时非 null。side=手指方向(left=生物在句右指左);
   *  pane=mark 所在栏(决定体型:chat 76/notebook 88)。rAF 写 ref,变化才 setState。 */
  const [reading, setReading] = useState<{ side: "left" | "right"; pane: "chat" | "notebook" } | null>(null);
  /** v8 实际栖身栏(rAF 写 ref 变化才 setState):手机回退家/景深尺寸按它,不只看 zone 状态机 */
  const [dispZone, setDispZone] = useState<"rail" | "chat" | "notebook">("rail");
  const dispZoneRef = useRef<"rail" | "chat" | "notebook">("rail");
  const readingRef = useRef<{ side: "left" | "right"; pane: "chat" | "notebook" } | null>(null);
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
    // v7 起飞:压缩蓄力→弹射 stretch(WAAPI additive),喷焰增强 class 同步 600ms
    wrapRef.current?.animate?.(
      [
        { transform: "scale(1, 1)" },
        { transform: "scale(1.08, 0.86)", offset: 0.3 },
        { transform: "scale(0.96, 1.1)", offset: 0.65 },
        { transform: "scale(1, 1)" },
      ],
      { duration: 620, easing: "cubic-bezier(0.2, 1.4, 0.4, 1)", composite: "add" },
    );
    wrapRef.current?.classList.add("cp-takeoff");
    setTimeout(() => wrapRef.current?.classList.remove("cp-takeoff"), 650);
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
    if (!courseId) return;
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
  }, [courseId]);

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
    if (!snap.enabledLoaded || !snap.enabled) return;
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
      // v7 手机端修复:家(左栏)不在场时不消失——T3 切栏会卸载地图,退到当前
      // 在场的栏栖身(对话优先),切回地图自然回老家。修复"切页后 bot 消失要刷新"。
      let freeRoam = false;
      if (!grabbed && eff === "rail" && !railOk) {
        if (chatAnchor()) eff = "chat";
        else if (notebookAnchor()) eff = "notebook";
        else freeRoam = true; // v9 常驻兜底:无课程/空态(两栏锚点都不在)→整窗游走,绝不隐匿
      }

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
      } else if (freeRoam) {
        // v9 无课程/空态:整个视口是他的世界(顶部避开标题栏,底部留边),慢慢游走
        flightRef.current = null;
        const wpt = wanderInPanel(
          { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 },
          SIZE.chat,
          now,
        );
        const cur = posRef.current ?? { x: wpt.x, y: wpt.y };
        const k = 1 - Math.exp(-dt / 140);
        target = { x: cur.x + (wpt.x - cur.x) * k, y: cur.y + (wpt.y - cur.y) * k };
        angle = Math.max(-0.25, Math.min(0.25, (wpt.x - cur.x) * 0.008));
      } else if (eff !== "rail") {
        flightRef.current = null;
        // v6 朗读跟句:有 karaoke 高亮句(讲解区/中栏对话消息均可)时,锚点被句子
        // 实时位置接管(贴着那句站,指住它;scroll 时 rect 随 .cp-reading-mark 元素
        // 自动更新)。clamp 面板取 mark 所在的 pane —— 讲解面板或对话流,两边同款。
        const readRange = getReadingRange();
        const readMarkEl = readRange ? (readRange.startContainer.parentElement ?? null) : null;
        const readMark = readMarkEl && readRange ? { el: readMarkEl, rect: readRange.getBoundingClientRect() } : null;
        const anchor = readMark
          ? null
          : eff === "chat"
            ? chatAnchor()
            : notebookAnchor();
        if (readMark) {
          const host = readMark.el.closest<HTMLElement>('[data-testid="notebook-panel"], [data-testid="chat-stream"]');
          const pr = host?.getBoundingClientRect();
          const mr = readMark.rect;
          const zoneSize = host?.closest('[data-testid="chat-stream"]') ? SIZE.chat : SIZE.notebook;
          if (pr && mr.width > 0) {
            const pos = readingAnchorPos(mr, pr, zoneSize);
            const pane: "chat" | "notebook" = zoneSize === SIZE.chat ? "chat" : "notebook";
            const next = { side: pos.side, pane };
            if (readingRef.current?.side !== next.side || readingRef.current?.pane !== next.pane) {
              readingRef.current = next;
              setReading(next);
            }
            if (reduced) {
              target = pos;
              angle = 0;
            } else {
              // 跟句不叠漂移(要稳稳指住);lerp 平滑换句滑动
              const cur = posRef.current ?? { x: pos.x, y: pos.y };
              const k = 1 - Math.exp(-dt / 110);
              target = { x: cur.x + (pos.x - cur.x) * k, y: cur.y + (pos.y - cur.y) * k };
              angle = pos.side === "left" ? -0.07 : 0.07; // 微倾向所指文字
            }
          }
        } else {
          if (readingRef.current !== null) {
            readingRef.current = null;
            setReading(null);
          }
          if (anchor) {
            if (reduced) {
              target = anchor;
              angle = 0;
            } else if (eff === "notebook") {
              // v8 右栏徘徊:在讲解面板的右侧空白带里确定性游弋(像住在文章里,
              // 随时可以和内容互动),避开顶部标签/按钮安全带
              const panel = document.querySelector<HTMLElement>('[data-testid="notebook-panel"]');
              const pr = panel?.getBoundingClientRect();
              const w = pr ? wanderInPanel({ left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom }, SIZE.notebook, now) : null;
              const ax = w ? w.x : anchor.x;
              const ay = w ? w.y : anchor.y;
              const cur = posRef.current ?? { x: ax, y: ay };
              const k = 1 - Math.exp(-dt / 90);
              target = { x: cur.x + (ax - cur.x) * k, y: cur.y + (ay - cur.y) * k };
              angle = Math.max(-0.3, Math.min(0.3, (ax - cur.x) * 0.01));
            } else {
              // 栏内漂浮:锚点叠慢利萨茹漂移(他在输入框附近轻轻游动,不是钉死)
              const d = zoneDrift(eff, now);
              const ax = anchor.x + d.x;
              const ay = anchor.y + d.y;
              const cur = posRef.current ?? { x: ax, y: ay };
              const k = 1 - Math.exp(-dt / 90);
              target = { x: cur.x + (ax - cur.x) * k, y: cur.y + (ay - cur.y) * k };
              angle = Math.max(-0.35, Math.min(0.35, (ax - cur.x) * 0.012));
            }
          }
        }
      }

      const dz = freeRoam ? "chat" : eff;
      if (dispZoneRef.current !== dz) {
        dispZoneRef.current = dz;
        setDispZone(dz);
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
  }, [snap.enabledLoaded, snap.enabled, reduced]);

  if (!snap.enabledLoaded || !snap.enabled) return null;

  const pose = inTransit
    ? "flying"
    : reading?.side === "left"
      ? "point"
      : reading?.side === "right"
        ? "pointr"
        : snap.state.pose;
  // 跟句时体型随 mark 所在栏(中栏对话 76/讲解栏 88),否则随 zone
  const mascotSize = reading ? SIZE[reading.pane] : SIZE[dispZone];
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
        size={mascotSize}
        interactive
        ariaLabel="companion"
        onPoke={companionPoke}
        onGrab={(px, py) => {
          if (!grabRef.current) {
            grabRef.current = { x: px, y: py, vx: 0, vy: 0, t: performance.now() };
            companionGrab(true);
          }
        }}
        haloBadge={snap.halo}
        testid="companion-mascot"
        keySeq={snap.state.keySeq}
        keySide={snap.state.keySide}
      />
    </div>
  );
}
