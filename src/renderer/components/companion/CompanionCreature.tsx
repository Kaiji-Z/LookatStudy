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
  companionNoteTick,
  companionPoke,
  companionSwat,
  getCompanionSnapshot,
  getLastBallTap,
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
import {
  type CompanionPane,
  type RoamIntentKind,
  CRUISE_OP,
  CRUISE_READ,
  CRUISE_ROAM,
  INTENT_HOLD_MS,
  ROAM_BUCKET_MS,
  glideTo,
  nextRoamPane,
  pickRoamIntent,
  readingAnchorFlex,
  zoneDrift,
  wanderInPanel,
} from "../../lib/companion/companion-core.js";
import { getReadingRange, getLastNoteMark } from "../../lib/highlightText.js";
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
  const [reading, setReading] = useState<{ dir: "left" | "right" | "up" | "down"; pane: "chat" | "notebook" } | null>(null);
  /** v8 实际栖身栏(rAF 写 ref 变化才 setState):手机回退家/景深尺寸按它,不只看 zone 状态机 */
  const [dispZone, setDispZone] = useState<"rail" | "chat" | "notebook">("rail");
  const dispZoneRef = useRef<"rail" | "chat" | "notebook">("rail");
  const readingRef = useRef<{ dir: "left" | "right" | "up" | "down"; pane: "chat" | "notebook" } | null>(null);
  // v11.5 整句零遮挡:所有锚点候选都压句(极端窄屏)时半透明让出可读性
  const [occluding, setOccluding] = useState(false);
  const occludeRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<FlightWorld | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  /** v0.17.1 上一帧位置(喷焰速度/方向计算) */
  const prevPosRef = useRef<{ x: number; y: number } | null>(null);
  const zoneRef = useRef(snap.state.zone);
  const swatLatchRef = useRef(false);
  /** v0.17.2 点球互动:消费过的 ballTap seq(去重)+ 当前生效的应答(飞去/朝左注目) */
  const ballTapSeqRef = useRef(0);
  const ballAckRef = useRef<{ nodeId: string; x: number; y: number; until: number; fired: boolean; fly: boolean } | null>(null);
  const [ballAck, setBallAck] = useState<{ until: number } | null>(null);
  /** 左栏待机空地(中部带,周期重选/记忆卡点覆盖)与下次重选时刻 */
  const perchRef = useRef<{ x: number; y: number } | null>(null);
  const perchDueRef = useRef(0);
  /** 抓取:指针位置/速度采样(最近两帧),rAF 直读 */
  const grabRef = useRef<{ x: number; y: number; vx: number; vy: number; t: number } | null>(null);
  /** 雨天抖水节流 */
  const nextShiverRef = useRef(0);
  /** v10 roam 跨栏游走调度:当前栖身栏 + 决策时间桶(桶切换时决定 留/跨栏) */
  const roamRef = useRef<{ pane: CompanionPane; bucket: number }>({ pane: "rail", bucket: -1 });
  /** v11 roam 目的性意图:复习指点/打量下一课/回访卡点(限时,materials 位置视口坐标) */
  const intentRef = useRef<{ kind: RoamIntentKind; until: number; pos: { x: number; y: number }; fired: boolean } | null>(null);
  /** v11 卡点毕业判定:记忆联动聚焦的卡点节点 id(掌握后从 friction 榜消失→打金勾) */
  const frictionNodeIdRef = useRef<string | null>(null);

  // v10 起飞动效挂**实际栖身栏**(dispZone):操作切栏/roam 跨栏都触发翻越感
  useEffect(() => {
    if (dispZone === zoneRef.current) return;
    zoneRef.current = dispZone;
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
        if (!el || dispZone === "rail") return;
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
  }, [dispZone, reduced]);

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
        frictionNodeIdRef.current = weak.nodeId;
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

  // v11 卡点毕业:掌握事件(mastery 变化)后查 friction 榜,聚焦节点已消失 → 掏本打金勾
  useEffect(() => {
    const onChanged = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail;
      const nodeId = frictionNodeIdRef.current;
      if (kind !== "mastery" || !nodeId || !courseId) return;
      void window.api
        .getDashboard(courseId)
        .then((d) => {
          const still = d?.frictionByNode?.some((f) => f.nodeId === nodeId);
          if (!still) {
            frictionNodeIdRef.current = null;
            perchDueRef.current = 0; // 解除卡点驻留
            companionNoteTick();
          }
        })
        .catch(() => {});
    };
    window.addEventListener("companion-state-changed", onChanged);
    return () => window.removeEventListener("companion-state-changed", onChanged);
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
    if (!snap.enabledLoaded || !snap.enabled || snap.petMode) return;
    const wrap = wrapRef.current;
    if (!wrap) return;

    let raf = 0;
    let last = performance.now();
    let navW = 0;
    let navH = 0;
    let angle = 0;
    // 栏矩形缓存:DOM 锚点 60fps 查询太贵(强制布局),150ms 刷新足够跟手
    let rectCacheAt = -1e9;
    let chatRectCache: DOMRect | null = null;
    let nbRectCache: DOMRect | null = null;

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

      // ── 栏矩形(v10 roam 跨栏游走的地图;150ms 节流缓存) ──
      if (now - rectCacheAt > 150) {
        rectCacheAt = now;
        chatRectCache = document.querySelector<HTMLElement>('[data-testid="chat-panel"]')?.getBoundingClientRect() ?? null;
        nbRectCache = document.querySelector<HTMLElement>('[data-testid="notebook-panel"]')?.getBoundingClientRect() ?? null;
      }
      const chatRect = chatRectCache;
      const nbRect = nbRectCache;

      // ── roam 调度:时间桶切换时确定性决定 留/跨栏(在场栏才可选) ──
      const bucket = Math.floor(now / ROAM_BUCKET_MS);
      if (roamRef.current.bucket !== bucket) {
        const avail: CompanionPane[] = [];
        if (railOk) avail.push("rail");
        if (chatRect) avail.push("chat");
        if (nbRect) avail.push("notebook");
        roamRef.current = { pane: nextRoamPane(roamRef.current.pane, bucket, avail), bucket };
        // v11 目的性:低概率产生"有想法"的意图(素材在场才挑;全在左栏地图上)
        if (railOk && st.zone === "roam") {
          const badge = document.querySelector<HTMLElement>('[data-testid="map-review-badge"]');
          const hasReview = !!badge && badge.className.includes("bg-review/20");
          let nextBall: { x: number; y: number } | null = null;
          for (const { island, container } of rw.sections.values()) {
            const b = island.balls.find((bb) => !bb.body.isStatic); // 锁定球=static
            if (b) {
              const cr = container.getBoundingClientRect();
              nextBall = { x: cr.left + b.body.position.x, y: cr.top + b.body.position.y };
              break;
            }
          }
          const friction = perchDueRef.current > now ? perchRef.current : null;
          const kind = pickRoamIntent(bucket, { hasReview, hasNext: !!nextBall, hasFriction: !!friction });
          if (kind === "review" && badge) {
            const r = badge.getBoundingClientRect();
            intentRef.current = { kind, until: now + INTENT_HOLD_MS, pos: { x: r.right + 44, y: r.bottom + 64 }, fired: false };
            roamRef.current.pane = "rail";
          } else if (kind === "inspect" && nextBall) {
            intentRef.current = { kind, until: now + INTENT_HOLD_MS, pos: { x: nextBall.x + 34, y: nextBall.y - 66 }, fired: false };
            roamRef.current.pane = "rail";
          } else if (kind === "friction" && friction) {
            intentRef.current = { kind, until: now + INTENT_HOLD_MS, pos: { x: friction.x, y: friction.y }, fired: false };
            roamRef.current.pane = "rail";
          }
        }
      }
      const intent = intentRef.current && now < intentRef.current.until ? intentRef.current : null;
      if (intentRef.current && !intent) intentRef.current = null;

      // ── v0.17.2 点球互动:点课程球 → rail 在场则飞到球旁指向+轻顶;T3 无 rail
      //    → 原地朝左"注目礼"(表情爆发由 bus 的 nodePoint dispatch 负责) ──
      const bt = getLastBallTap();
      if (bt && bt.seq !== ballTapSeqRef.current) {
        ballTapSeqRef.current = bt.seq;
        let tx: number | null = bt.x;
        let ty: number | null = bt.y;
        if ((tx == null || ty == null) && railOk) {
          // 坐标缺(搜索跳转):从物理岛按 nodeId 定位球
          for (const { island, container } of rw.sections.values()) {
            const b = island.ball(bt.nodeId);
            if (b) {
              const cr = container.getBoundingClientRect();
              tx = cr.left + b.body.position.x;
              ty = cr.top + b.body.position.y;
              break;
            }
          }
        }
        if (railOk && tx != null && ty != null) {
          ballAckRef.current = { nodeId: bt.nodeId, x: tx, y: ty, until: now + 2400, fired: false, fly: true };
          setBallAck({ until: now + 2400 });
        } else {
          ballAckRef.current = { nodeId: bt.nodeId, x: 0, y: 0, until: now + 1600, fired: true, fly: false };
          setBallAck({ until: now + 1600 });
        }
      }
      const ballOk = !!ballAckRef.current && now < ballAckRef.current.until;
      if (ballAckRef.current && !ballOk) {
        ballAckRef.current = null;
        setBallAck(null);
      }
      if (ballOk && ballAckRef.current && !ballAckRef.current.fired) {
        const a = ballAckRef.current;
        a.fired = true;
        // 轻顶一下被点的球(只顶非锁定球;力很小,纯庆祝性拨弄)
        if (a.fly && navRect) {
          for (const { island } of rw.sections.values()) {
            const b = island.ball(a.nodeId);
            if (b && !b.body.isStatic) {
              Matter.Body.applyForce(b.body, b.body.position, { x: 0.0035, y: -0.005 });
              break;
            }
          }
        }
      }

      // ── karaoke 跟句(朗读时的语义位置,最高优先) ──
      const readRange = getReadingRange();
      const readMarkEl = readRange ? (readRange.startContainer.parentElement ?? null) : null;

      let target: { x: number; y: number } | null = null;
      let pane: CompanionPane = roamRef.current.pane;

      if (grabbed) {
        // ── 抓取中:指针就是全世界(任何 zone 都直接拖拽) ──
        const g = grabRef.current!;
        flightRef.current = null; // 物理旁路,松手再按 zone 重建
        target = { x: g.x, y: g.y };
        angle = Math.max(-0.5, Math.min(0.5, g.vx * 0.04));
        pane = dispZoneRef.current;
      } else if (readMarkEl && readRange) {
        // v10 句尾右下角跟随:mark = 高亮句最后一行片段(Range.getClientRects 末位
        // 非零矩形)——生物栖在最后一个字的右下方,指住它;窄屏也全程钳在面板内
        const host = readMarkEl.closest<HTMLElement>('[data-testid="notebook-panel"], [data-testid="chat-stream"]');
        const pr = host?.getBoundingClientRect();
        const rects = readRange.getClientRects();
        // v11.5 障碍物=高亮句**全部行盒**(多行句每行都算,只取首末会被上半身压住中间行)
        const sentLines: Array<{ left: number; right: number; top: number; bottom: number }> = [];
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i]!;
          if (r.width > 1 && r.height > 1) {
            sentLines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          }
        }
        const tail = sentLines.length ? sentLines[sentLines.length - 1]! : null;
        const head = sentLines.length ? sentLines[0]! : null;
        const fb = readRange.getBoundingClientRect();
        const inChat = !!host?.closest('[data-testid="chat-stream"]');
        const zoneSize = inChat ? SIZE.chat : SIZE.notebook;
        pane = inChat ? "chat" : "notebook";
        if (pr && (tail || fb.width > 0)) {
          // v11.5 整句零遮挡:候选(右侧/左侧/正下/正上)逐一 vs **全部行盒**校验,
          // 指向 dir 随方位(下方→指上);全撞时最小遮挡+半透明(occluding)
          const pos = readingAnchorFlex(
            { left: fb.left, right: fb.right, top: fb.top, bottom: fb.bottom },
            pr,
            zoneSize,
            { first: head ?? undefined, last: tail ?? undefined },
            sentLines,
          );
          const next = { dir: pos.dir, pane };
          if (readingRef.current?.dir !== next.dir || readingRef.current?.pane !== next.pane) {
            readingRef.current = next;
            setReading(next);
          }
          if (occludeRef.current !== pos.occluding) {
            occludeRef.current = pos.occluding;
            setOccluding(pos.occluding);
          }
          if (reduced) {
            target = pos;
            angle = 0;
          } else {
            // 限速滑翔跟句:换句/滚动都是看得见的飞行,不闪现
            const cur = posRef.current ?? { x: pos.x, y: pos.y };
            target = glideTo(cur, pos, dt, CRUISE_READ, 110);
            angle = pos.dir === "left" ? -0.07 : pos.dir === "right" ? 0.07 : 0; // 侧向微倾,竖向不倾
          }
        } else {
          // v0.17.2 跟句悬空兜底(永不隐身):mark 节点被卸载/换掉(切课/切线程/
          // T3 换栏/ReactMarkdown 重渲染)后,全局 readingRange 可能残留 detached
          // Range——面板卸载清理曾因"cleanup 前 ref 已被置空"而自废(v0.17.2 已在
          // 两面板修),mark 节点被换且无人重标的路径仍可能短暂悬空。本分支若不
          // 兜底,target 滞留 null → opacity 0 隐身(v9"常驻绝不隐匿"在此被旁路;
          // 记笔记分支 v11.1 已有同款守卫)。处置:清跟句视觉态,在宿主面板(或
          // 整窗)游弋,等 karaoke 层自愈。
          if (readingRef.current !== null) {
            readingRef.current = null;
            setReading(null);
          }
          if (occludeRef.current) {
            occludeRef.current = false;
            setOccluding(false);
          }
          const box = pr
            ? { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom }
            : { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
          const wp = wanderInPanel(box, zoneSize, now);
          const cur = posRef.current ?? { x: wp.x, y: wp.y };
          target = glideTo(cur, wp, dt, CRUISE_ROAM, 140);
          angle = Math.max(-0.25, Math.min(0.25, (target.x - cur.x) * 0.01));
        }
      } else {
        if (readingRef.current !== null) {
          readingRef.current = null;
          setReading(null);
        }
        if (occludeRef.current) {
          occludeRef.current = false;
          setOccluding(false);
        }
        // v10 记笔记:pose=writing 期间,锚点=用户刚画的那条线(飞到线旁拿出本笔记录)
        const noteMark = st.pose === "writing" ? getLastNoteMark() : null;
        const zone = st.zone;
        // 锚点有效性先判定:mark 重渲染悬空(无宿主/零宽)时不再消费分支链,
        // 让下方 zone 分支接住栏内游弋——修复"加笔记时伴学隐身"(target 空=opacity 0)
        const noteHost = noteMark
          ? noteMark.closest<HTMLElement>('[data-testid="notebook-panel"], [data-testid="chat-stream"]')
          : null;
        const noteRect = noteMark?.getBoundingClientRect();
        const noteAnchored = !!(noteHost && noteRect && noteRect.width > 0);
        if (noteMark && noteAnchored) {
          const host = noteHost;
          const pr = host.getBoundingClientRect();
          const mr = noteRect;
          const inChat = !!host.closest('[data-testid="chat-stream"]');
          pane = inChat ? "chat" : "notebook";
          {
            const pos = readingAnchorFlex(mr, pr, inChat ? SIZE.chat : SIZE.notebook);
            flightRef.current = null;
            if (reduced) {
              target = pos;
              angle = 0;
            } else {
              const cur = posRef.current ?? { x: pos.x, y: pos.y };
              target = glideTo(cur, pos, dt, CRUISE_OP);
              angle = 0.08; // 伏案微倾
            }
          }
        } else if (zone === "chat" && chatAnchor()) {
          // ── 操作:输入框聚焦 → 从当前位置限速飞到输入卡上空(叠轻漂移) ──
          flightRef.current = null;
          pane = "chat";
          const a = chatAnchor()!;
          if (reduced) {
            target = a;
            angle = 0;
          } else {
            const d = zoneDrift("chat", now);
            const cur = posRef.current ?? { x: a.x, y: a.y };
            target = glideTo(cur, { x: a.x + d.x, y: a.y + d.y }, dt, CRUISE_OP);
            angle = Math.max(-0.35, Math.min(0.35, (target.x - cur.x) * 0.014));
          }
        } else if (zone === "notebook" && nbRect) {
          // ── 操作:朗读/记笔记 → 讲解面板右侧空白带游弋(住在文章里) ──
          flightRef.current = null;
          pane = "notebook";
          if (reduced) {
            target = notebookAnchor() ?? { x: nbRect.left + nbRect.width / 2, y: nbRect.top + 120 };
            angle = 0;
          } else {
            const w = wanderInPanel(nbRect, SIZE.notebook, now);
            const cur = posRef.current ?? { x: w.x, y: w.y };
            target = glideTo(cur, w, dt, CRUISE_OP);
            angle = Math.max(-0.3, Math.min(0.3, (target.x - cur.x) * 0.012));
          }
        } else if (railOk && (ballOk || zone === "rail" || (zone === "roam" && (roamRef.current.pane === "rail" || !!intent)))) {
          // ── 左栏原生物理世界(导入监工钉守 / roam 游走到左栏) ──
          const w = navRect!.width;
          const h = navRect!.height;
          pane = "rail";
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
              for (const link of island.links) {
                for (const p of link.particles) {
                  restSpots.push({ x: ox + p.position.x, y: oy + p.position.y - 8 });
                }
              }
            }
            const roaming = zone === "roam";
            // 待机位:意图(打量/指点)> roam 游走利萨茹航点 > 监工中部空地周期重选;
            // 纱帘 = 最近绳/球顶栖息(仅非 roam:roam 时帘后照常游)
            let base = perchRef.current;
            let settle = false;
            if (ballOk && ballAckRef.current && ballAckRef.current.fly) {
              // v0.17.2 点球应答:栖在被点球的右肩位,指住它(优先级高于意图/待机)
              base = { x: ballAckRef.current.x - navRect!.left + 34, y: ballAckRef.current.y - navRect!.top - 46 };
              settle = false;
            } else if (intent) {
              base = { x: intent.pos.x - navRect!.left, y: intent.pos.y - navRect!.top };
              if (!intent.fired) {
                intent.fired = true;
                companionNodePoint(); // "就是这里"的托脾指向反应
              }
            } else if (roaming) {
              const wp = wanderInPanel(navRect, SIZE.rail, now);
              base = { x: wp.x - navRect!.left, y: wp.y - navRect!.top };
            } else {
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
            }
            const swatted = flight.step(dt, base, st.mode === "veil" && !roaming ? [] : probes, now, { settle });
            if (swatted && !swatLatchRef.current) companionSwat();
            swatLatchRef.current = swatted || flight.dizzyRemaining(now) > 0;
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
            // v11 修瞬移到左栏:不再直跳物理体位置——先按巡航限速滑翔趋近,
            // 跨栏进入(如 chat/notebook→rail)是连续飞行;栏内 cur≈body 时 glide 无感
            const bodyPos = { x: navRect!.left + p.x, y: navRect!.top + p.y };
            const curPos = posRef.current ?? bodyPos;
            target = glideTo(curPos, bodyPos, dt, CRUISE_OP);
            angle = flight.body.angle + bankAngle(flight.body.velocity.x, flight.body.velocity.y);
          }
        } else {
          // ── roam 跨栏游走(闲时默认):在当前 roam 栏的空白带慢速游弋;
          //    目标栏不在场(T3 换栏)/无课程 → 在场栏或整窗游走,绝不隐匿 ──
          flightRef.current = null;
          const rp = roamRef.current.pane;
          if (rp === "chat" && chatRect) {
            pane = "chat";
            const w = wanderInPanel(chatRect, SIZE.chat, now);
            const cur = posRef.current ?? { x: w.x, y: w.y };
            target = glideTo(cur, w, dt, CRUISE_ROAM, 140);
            angle = Math.max(-0.25, Math.min(0.25, (target.x - cur.x) * 0.01));
          } else if (rp === "notebook" && nbRect) {
            pane = "notebook";
            const w = wanderInPanel(nbRect, SIZE.notebook, now);
            const cur = posRef.current ?? { x: w.x, y: w.y };
            target = glideTo(cur, w, dt, CRUISE_ROAM, 140);
            angle = Math.max(-0.25, Math.min(0.25, (target.x - cur.x) * 0.01));
          } else if (railOk) {
            // roam 栏指向 rail 但上一分支没接住(zone 是 chat/notebook 的 T3 回退)
            // — rail 在场就在 rail 物理世界栖身,下一桶再继续游走
            pane = "rail";
            const wp = wanderInPanel(navRect!, SIZE.rail, now);
            const cur = posRef.current ?? { x: wp.x, y: wp.y };
            target = glideTo(cur, wp, dt, CRUISE_ROAM, 140);
            angle = Math.max(-0.25, Math.min(0.25, (target.x - cur.x) * 0.01));
          } else {
            // 兜底:整窗游走(无课程空态/两栏皆缺)
            pane = "chat";
            const wpt = wanderInPanel(
              { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 },
              SIZE.chat,
              now,
            );
            const cur = posRef.current ?? { x: wpt.x, y: wpt.y };
            target = glideTo(cur, wpt, dt, CRUISE_ROAM, 140);
            angle = Math.max(-0.25, Math.min(0.25, (target.x - cur.x) * 0.008));
          }
        }
      }

      if (dispZoneRef.current !== pane) {
        dispZoneRef.current = pane;
        setDispZone(pane);
      }

      if (!target) {
        wrap.style.opacity = "0";
        posRef.current = null;
        prevPosRef.current = null;
        return;
      }
      posRef.current = target;
      const w = wrap.offsetWidth || SIZE[pane];
      wrap.style.transform = `translate3d(${(target.x - w / 2).toFixed(1)}px, ${(target.y - w / 2).toFixed(1)}px, 0) rotate(${(angle * 57.2958).toFixed(1)}deg)`;
      // v0.17.1 速度驱动喷焰(推进质感):速度→焰不透明度,方向→焰朝向(尾部指向
      // 运动反方向,CSS rotate 消费)。CSS 变量直写,零重渲染;静止时速度归零焰熄。
      const pv = prevPosRef.current;
      if (pv) {
        const pdx = target.x - pv.x;
        const pdy = target.y - pv.y;
        const dist = Math.hypot(pdx, pdy);
        const spd = dist / Math.max(1, dt);
        wrap.style.setProperty("--cp-speed", Math.min(1, spd / 0.45).toFixed(3));
        if (spd > 0.02) {
          const deg = (Math.atan2(pdy, pdx) * 57.2958 + 90 + 360) % 360;
          wrap.style.setProperty("--cp-thrust-deg", deg.toFixed(1) + "deg");
        }
      }
      prevPosRef.current = { x: target.x, y: target.y };
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      flightRef.current?.dispose();
      flightRef.current = null;
    };
  }, [snap.enabledLoaded, snap.enabled, snap.petMode, reduced]);

  // v0.17.2 击键 squash:每次按键整机微压缩(shiver 同款 add/remove;强制
  // reflow 让连续击键也逐键重触发,而不是动画只在第一次播)
  const keySeqPrevRef = useRef(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || snap.state.keySeq === keySeqPrevRef.current) return;
    keySeqPrevRef.current = snap.state.keySeq;
    wrap.classList.remove("cp-keypress");
    void wrap.offsetWidth;
    wrap.classList.add("cp-keypress");
    const t = setTimeout(() => wrap.classList.remove("cp-keypress"), 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap.state.keySeq 即依赖
  }, [snap.state.keySeq]);

  if (!snap.enabledLoaded || !snap.enabled || snap.petMode) return null;

  const pose = inTransit
    ? "flying"
    : snap.state.typing
      ? "typing" // 用户正在打字=进行中活动,优先于点球应答/跟读的指向姿势
      : ballAck
        ? "point" // v0.17.2 点球应答:指住球(桌面=球旁指左;T3=朝离屏的左栏注目)
        : reading?.dir === "left"
          ? "point"
          : reading?.dir === "right"
            ? "pointr"
            : reading?.dir === "up"
              ? "pointu"
              : reading?.dir === "down"
                ? "pointd"
                : snap.state.pose;
  // 跟句时体型随 mark 所在栏(中栏对话 76/讲解栏 88),否则随 zone
  const mascotSize = reading ? SIZE[reading.pane] : SIZE[dispZone];
  return (
    <div
      ref={wrapRef}
      className={`cp-creature fixed left-0 top-0 z-40 will-change-transform ${snap.state.mode === "veil" ? "cp-veil" : ""} ${occluding ? "cp-occluding" : ""} ${snap.state.grabbed ? "cp-grabbed" : ""}`}
      data-testid="companion-creature"
      data-zone={snap.state.zone === "roam" ? dispZone : snap.state.zone}
      data-mode={snap.state.mode}
    >
      <Mascot
        form={snap.form}
        expression={snap.state.expression}
        screenKey={snap.state.typing ? snap.state.lastKey : null}
        coreLit={snap.state.correctStreak >= 3}
        noteTick={Date.now() < snap.state.noteTickUntil}
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
