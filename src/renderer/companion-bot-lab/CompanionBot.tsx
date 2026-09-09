/**
 * CompanionBot —— M0 spike:外部角色包 bot v0(全新独立系统,见 .goal/SPEC.md)。
 *
 * 与现有伴学的关系:零共享状态、零相互调用。只读消费 celebration 总线
 * (onCelebration)与 window 键击/companion-streaming 事件——bot 永远不驱动
 * 现有 CompanionCreature(verify-companion-pack G2 守卫)。
 *
 * 三个渲染档:
 *   CompanionBot  贴纸级/Bongo档:整图帧替换 + CSS 呼吸 + WAAPI squash/jump
 *   PDLiteBot     纸偶档(head/body/armL/armR 四层绝对定位,肩点旋转)
 *   MeshBot       PD-Mesh(同四层,Canvas2D 网格变形,仅实验页)
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { sideFromCode } from "../lib/companion/companion-core.ts";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion.ts";
import { onCelebration } from "../lib/celebration.js";
import type { BotState, CompanionPackManifest } from "@shared/companion-pack.ts";
import { poseHoldMsOf } from "@shared/companion-pack.ts";
import { PART_BOX, SHOULDER } from "./sample-pack.ts";
import { drawMeshWarp } from "./mesh-warp.ts";

export type BotGesture = "keyL" | "keyR" | "happy" | "wrong" | "thinking" | "idle";

/** 只读手势源:window 键击 + celebration 总线 + companion-streaming。 */
function useBotGestures(handler: (g: BotGesture) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const alt = { side: 1 as 1 | -1 };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const side = sideFromCode(e.code, alt.side);
      alt.side = alt.side === 1 ? -1 : 1;
      ref.current(side === 1 ? "keyR" : "keyL");
    };
    const onStream = (e: Event) => ref.current((e as CustomEvent).detail ? "thinking" : "idle");
    const off = onCelebration((e) => ref.current(e.kind === "wrong" ? "wrong" : "happy"));
    window.addEventListener("keydown", onKey, { passive: true });
    window.addEventListener("companion-streaming", onStream);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("companion-streaming", onStream);
      off();
    };
  }, []);
}

/** 姿态状态机:setTimed(p, ms) — ms>0 驻留后回 idle,ms=0 粘滞(等显式 idle)。 */
function usePose(): { pose: BotState; setTimed: (p: BotState, ms?: number) => void } {
  const [pose, setPose] = useState<BotState>("idle");
  const timer = useRef<number | null>(null);
  const setTimed = useCallback(
    (p: BotState, ms = 0) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setPose(p);
      const wait = ms > 0 ? ms : 0;
      if (wait > 0 && p !== "idle") timer.current = window.setTimeout(() => setPose("idle"), wait);
    },
    [],
  );
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return { pose, setTimed };
}

function squash(el: Element | null, reduced: boolean): void {
  if (reduced || !el || typeof el.animate !== "function") return;
  el.animate(
    [{ transform: "scale(1.09, 0.88)" }, { transform: "scale(0.98, 1.03)", offset: 0.6 }, { transform: "scale(1)" }],
    { duration: 200, easing: "cubic-bezier(0.2, 1.5, 0.4, 1)" },
  );
}

function jump(el: Element | null, reduced: boolean): void {
  if (reduced || !el || typeof el.animate !== "function") return;
  el.animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-12%)" }, { transform: "translateY(2%)" }, { transform: "translateY(0)" }],
    { duration: 380, easing: "cubic-bezier(0.2, 1.4, 0.4, 1)" },
  );
}

function wiggle(el: Element | null, reduced: boolean): void {
  if (reduced || !el || typeof el.animate !== "function") return;
  el.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(-6deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(0deg)" }],
    { duration: 280 },
  );
}

const BOT_CSS = `
.cbot { position: relative; display: inline-block; line-height: 0;
  animation: cbot-breath 3.4s ease-in-out infinite; transform-origin: 50% 88%; }
.cbot img, .cbot canvas { display: block; user-select: none; }
.cbot-lite img { position: absolute; pointer-events: none; }
@keyframes cbot-breath { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.012, 1.03); } }
@media (prefers-reduced-motion: reduce) { .cbot { animation: none; } }
`;

/* ---------------- 贴纸级 / Bongo 档 ---------------- */

export interface LoadedPack {
  manifest: CompanionPackManifest;
  srcs: Partial<Record<BotState, string>>;
}

export function CompanionBot({
  pack,
  size = 128,
  label,
  poseOverride = null,
}: {
  pack: LoadedPack;
  size?: number;
  label?: string;
  poseOverride?: BotState | null;
}) {
  const reduced = usePrefersReducedMotion();
  const { pose, setTimed } = usePose();
  const imgRef = useRef<HTMLImageElement | null>(null);
  useBotGestures((g) => {
    if (g === "keyL") {
      setTimed("keyL", 180);
      squash(imgRef.current, reduced);
    } else if (g === "keyR") {
      setTimed("keyR", 180);
      squash(imgRef.current, reduced);
    } else if (g === "happy") {
      setTimed("happy", poseHoldMsOf(pack.manifest));
      jump(imgRef.current, reduced);
    } else if (g === "thinking") {
      setTimed("thinking", 0);
    } else if (g === "idle") {
      setTimed("idle", 0);
    } else {
      wiggle(imgRef.current, reduced);
    }
  });
  const shown = poseOverride ?? pose;
  const src = pack.srcs[shown] ?? pack.srcs.idle ?? "";
  return (
    <div
      className="cbot"
      data-companion-bot={pack.manifest.tier}
      data-bot-state={shown}
      style={{ width: size, height: size }}
    >
      <img ref={imgRef} src={src} alt={label ?? pack.manifest.name} width={size} height={size} draggable={false} />
      <style>{BOT_CSS}</style>
    </div>
  );
}

/* ---------------- 纸偶档(PD-Lite) ---------------- */

export interface PartArt {
  head: string;
  body: string;
  armL: string;
  armR: string;
}

/** 部件画布全尺寸叠放(四层同一 512 坐标系,绝对位置天然对齐)。 */
const FULL: CSSProperties = { left: 0, top: 0, width: "100%", height: "100%" };

export function PDLiteBot({
  parts,
  size = 160,
  label,
  poseOverride = null,
}: {
  parts: PartArt;
  size?: number;
  label?: string;
  poseOverride?: BotState | null;
}) {
  const reduced = usePrefersReducedMotion();
  const { pose, setTimed } = usePose();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLImageElement | null>(null);
  const armLRef = useRef<HTMLImageElement | null>(null);
  const armRRef = useRef<HTMLImageElement | null>(null);
  useBotGestures((g) => {
    const swing = (el: HTMLImageElement | null, dir: -1 | 1) => {
      if (reduced || !el || typeof el.animate !== "function") return;
      el.animate(
        [{ transform: "rotate(0deg)" }, { transform: `rotate(${dir * 36}deg)`, offset: 0.5 }, { transform: "rotate(0deg)" }],
        { duration: 220, easing: "cubic-bezier(0.2, 1.5, 0.4, 1)" },
      );
    };
    if (g === "keyL") {
      setTimed("keyL", 200);
      swing(armLRef.current, -1);
    } else if (g === "keyR") {
      setTimed("keyR", 200);
      swing(armRRef.current, 1);
    } else if (g === "happy") {
      setTimed("happy", 1100);
      jump(boxRef.current, reduced);
    } else if (g === "thinking") {
      setTimed("thinking", 0);
      if (!reduced && headRef.current?.animate) {
        headRef.current.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(7deg)" }], { duration: 240, fill: "forwards" });
      }
    } else if (g === "idle") {
      setTimed("idle", 0);
      if (!reduced && headRef.current?.animate) {
        headRef.current.animate([{ transform: "rotate(7deg)" }, { transform: "rotate(0deg)" }], { duration: 180, fill: "forwards" });
      }
    } else {
      wiggle(boxRef.current, reduced);
    }
  });
  const shown = poseOverride ?? pose;
  return (
    <div className="cbot cbot-lite" ref={boxRef} data-companion-bot="pd-lite" data-bot-state={shown} style={{ width: size, height: size }}>
      <img src={parts.armL} alt="" draggable={false} ref={armLRef} style={{ ...FULL, transformOrigin: `${SHOULDER.armL.x * 100}% ${SHOULDER.armL.y * 100}%` }} />
      <img src={parts.armR} alt="" draggable={false} ref={armRRef} style={{ ...FULL, transformOrigin: `${SHOULDER.armR.x * 100}% ${SHOULDER.armR.y * 100}%` }} />
      <img src={parts.body} alt="" draggable={false} style={FULL} />
      <img ref={headRef} src={parts.head} alt={label ?? "pd-lite"} draggable={false} style={FULL} />
      <style>{BOT_CSS}</style>
    </div>
  );
}

/* ---------------- PD-Mesh(网格变形,仅实验页) ---------------- */

export function MeshBot({
  parts,
  size = 180,
  label,
  poseOverride = null,
}: {
  parts: PartArt;
  size?: number;
  label?: string;
  poseOverride?: BotState | null;
}) {
  const reduced = usePrefersReducedMotion();
  const { pose, setTimed } = usePose();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const excite = useRef(0);
  const tilt = useRef(0);
  const shown = poseOverride ?? pose;
  const shownRef = useRef<BotState>("idle");
  shownRef.current = shown;

  useBotGestures((g) => {
    if (g === "keyL" || g === "keyR") {
      excite.current = 1;
      setTimed(g, 200);
    } else if (g === "happy") {
      excite.current = 1.6;
      setTimed("happy", 1100);
      jump(canvasRef.current, reduced);
    } else if (g === "thinking") {
      tilt.current = 1;
      setTimed("thinking", 0);
    } else if (g === "idle") {
      tilt.current = 0;
      setTimed("idle", 0);
    } else {
      wiggle(canvasRef.current, reduced);
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const imgs: Array<HTMLImageElement> = [parts.armL, parts.armR, parts.body, parts.head].map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });
    let cancelled = false;
    Promise.all(
      imgs.map(
        (im) =>
          new Promise<void>((res) => {
            if (im.complete) return res();
            im.onload = () => res();
            im.onerror = () => res();
          }),
      ),
    ).then(() => {
      if (cancelled) return;
      const boxes = [PART_BOX.armL, PART_BOX.armR, PART_BOX.body, PART_BOX.head];
      const start = performance.now();
      const frame = (now: number) => {
        if (cancelled) return;
        excite.current *= 0.92;
        const t = now - start;
        const ex = excite.current;
        const tl = tilt.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);
        // 头:顶部行延迟摆动(发丝 lag)+ 呼吸鼓起 + thinking 歪头(skew 随 v 增长)
        drawMeshWarp(ctx, imgs[3], {
          x: PART_BOX.head.x * size,
          y: PART_BOX.head.y * size,
          w: PART_BOX.head.w * size,
          h: PART_BOX.head.h * size,
          src: { x: PART_BOX.head.x * 512, y: PART_BOX.head.y * 512, w: PART_BOX.head.w * 512, h: PART_BOX.head.h * 512 },
          cols: 7,
          rows: 8,
          t,
          deform: (_u, v, tt) => ({
            dx: Math.sin(tt / 820) * 1.6 * (1 - v) * (1 + ex) + tl * 7 * v + Math.sin(tt / 500) * 2.4 * v * v * (1 + ex * 2),
            dy: Math.sin(tt / 640) * 2 * (1 - v) + Math.sin(tt / 460) * 1.2 * ex * (1 - v),
          }),
        });
        // 身体:侧缘呼吸鼓起(体积感的关键)
        drawMeshWarp(ctx, imgs[2], {
          x: PART_BOX.body.x * size,
          y: PART_BOX.body.y * size,
          w: PART_BOX.body.w * size,
          h: PART_BOX.body.h * size,
          src: { x: PART_BOX.body.x * 512, y: PART_BOX.body.y * 512, w: PART_BOX.body.w * 512, h: PART_BOX.body.h * 512 },
          cols: 6,
          rows: 6,
          t,
          deform: (u, _v, tt) => ({
            dx: Math.sin(tt / 640) * 1.1 + Math.sin(tt / 700) * 2.2 * Math.abs(u - 0.5) * 2 * (1 + ex * 0.5),
            dy: 0,
          }),
        });
        // 双臂:肩点滞后摆动(excite 放大)
        for (const [idx, dir] of [
          [0, -1],
          [1, 1],
        ] as Array<[number, number]>) {
          const box = boxes[idx];
          drawMeshWarp(ctx, imgs[idx], {
            x: box.x * size,
            y: box.y * size,
            w: box.w * size,
            h: box.h * size,
            src: { x: box.x * 512, y: box.y * 512, w: box.w * 512, h: box.h * 512 },
            cols: 4,
            rows: 6,
            t,
            deform: (_u, v, tt) => ({
              dx: Math.sin(tt / 820 + 0.6) * 2.2 * v * dir * (1 + ex * 4) + (v > 0.5 ? ex * 3 * dir * (v - 0.5) * 2 : 0),
              dy: Math.sin(tt / 700) * 0.8 * v,
            }),
          });
        }
        ctx.restore();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return () => {
      cancelled = true;
    };
  }, [parts, size, reduced]);

  return (
    <div className="cbot" data-companion-bot="pd-mesh" data-bot-state={shown} style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-label={label ?? "pd-mesh"} />
      <style>{BOT_CSS}</style>
    </div>
  );
}
