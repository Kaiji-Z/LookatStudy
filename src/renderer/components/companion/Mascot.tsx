/**
 * Mascot —— 伴学伙伴的壳(生命系统持有者),形象可换。
 *
 * 壳负责全部「生命」:逐键按压(WAAPI)、听写声波弧(麦克风包络 rAF)、
 * 眨眼调度、瞳孔追踪+闲置漫游、表情弹跳挂载点;形态组件(forms/)负责
 * 全部「皮肤」:轮廓/调色/口型艺术/能量核/streak 签名。两者通过
 * shared.tsx 的 FormRefs/class 契约咬合——姿势 CSS、按压、眨眼、视线
 * 对五款形象零改动生效。
 *
 * 形态见 forms/registry.tsx(小焰/霜绒/苔芽/星尘/墨墨);reduced-motion
 * 时全部生命循环关闭,静态呈现(a11y 双轨铁律)。
 */
import { useId, useEffect, useRef } from "react";

import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion.js";
import { getCompanionMicArc } from "../../lib/companion/bus.ts";
import {
  type CompanionExpression,
  type CompanionPose,
  type Viseme,
  clampGaze,
  gazeFromPointer,
  lerp,
  wanderTarget,
} from "../../lib/companion/companion-core.js";
import { formIdFromSetting } from "../../lib/companion/forms-index.js";
import { FORM_ART } from "./forms/registry.js";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { FormRefs } from "./forms/shared.js";

export interface MascotProps {
  /** 形象 id(默认小焰;垃圾值回退) */
  form?: string;
  expression: CompanionExpression;
  pose: CompanionPose;
  viseme?: Viseme;
  /** 开口度 0..1(量化档),talk 弹跳也用它 */
  openScale?: number;
  /** 能量核填充 0..1(今日 XP/目标) */
  energyRatio?: number;
  streakLit?: boolean;
  size?: number;
  /** 可交互(点击戳一戳;false=纯装饰对读屏隐藏) */
  interactive?: boolean;
  ariaLabel?: string;
  testid?: string;
  onPoke?: () => void;
  /** 抓取按下(pointerdown 坐标;触屏/鼠标同款,拖拽扔出由上层接管) */
  onGrab?: (px: number, py: number) => void;
  /** 键击序号(变化时重触按压动画);0=从不 */
  keySeq?: number;
  /** 最近按压臂侧:-1=左 / 1=右 */
  keySide?: -1 | 1;
  /** 等级徽标:头顶小皇冠(XP 等级≥3,壳层渲染全形态共享) */
  crownBadge?: boolean;
  /** 等级徽标:金色光环(XP 等级≥7) */
  haloBadge?: boolean;
}

export function Mascot({
  form,
  expression,
  pose,
  viseme = "closed",
  openScale = 0,
  energyRatio = 0,
  streakLit = false,
  size = 96,
  interactive = false,
  ariaLabel,
  testid,
  onPoke,
  onGrab,
  keySeq = 0,
  keySide = 1,
  crownBadge = false,
  haloBadge = false,
}: MascotProps) {
  const raw = useId();
  const uid = "cp" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const reduced = usePrefersReducedMotion();
  const formId = formIdFromSetting(form);

  const refs: FormRefs = {
    bot: useRef<SVGGElement | null>(null),
    head: useRef<SVGGElement | null>(null),
    armL: useRef<SVGGElement | null>(null),
    armR: useRef<SVGGElement | null>(null),
    eyes: useRef<SVGGElement | null>(null),
    pupils: useRef<SVGGElement | null>(null),
    waves: useRef<SVGGElement | null>(null),
  };
  const rootRef = refs.bot;

  /* 逐键按压(Bongo Cat 式,v5 加强):keySeq 变化 → 该侧手臂大幅拍下(±52°,回弹
     过冲)+ 整机随拍压弹一下(scale 弹跳)——反馈从"手抖"放大到"全身在敲键盘"。
     composite:"add" 与姿势 CSS 变换叠加;reduced-motion 静默跳过。 */
  useEffect(() => {
    if (reduced || keySeq <= 0) return;
    const el = keySide === -1 ? refs.armL.current : refs.armR.current;
    const deg = keySide === -1 ? 52 : -52;
    el?.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: `rotate(${deg}deg)`, offset: 0.38 },
        { transform: "rotate(0deg)" },
      ],
      { duration: 185, easing: "cubic-bezier(0.2, 1.5, 0.4, 1)", composite: "add" },
    );
    // 整机弹跳:向下轻压再回弹,和拍臂同拍。SVG g 的 transform-origin 默认在
    // viewBox 原点,必须显式 fill-box + 身体中心,否则从左上角缩放会跑偏。
    const bot = refs.bot.current;
    if (bot) {
      bot.style.transformBox = "fill-box";
      bot.style.transformOrigin = "50% 62%";
      bot.animate(
        [
          { transform: "translateY(0px) scale(1, 1)" },
          { transform: "translateY(2.5px) scale(1.045, 0.93)", offset: 0.42 },
          { transform: "translateY(0px) scale(1, 1)" },
        ],
        { duration: 185, easing: "ease-out", composite: "add" },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs 套件随组件存活,仅按压序号驱动
  }, [keySeq, keySide, reduced]);

  /* 听写声波弧随真实麦克风音量起伏(bus 的包络 ref,rAF 读,零重渲染) */
  const listening = expression === "listening";
  useEffect(() => {
    if (!listening || reduced) return;
    let raf = 0;
    const loop = () => {
      const arc = getCompanionMicArc();
      const g = refs.waves.current;
      if (g) {
        g.style.opacity = arc <= 0 ? "0" : "1";
        g.setAttribute(
          "transform",
          `translate(174 72) scale(${(0.55 + 0.45 * arc).toFixed(3)}) translate(-174 -72)`,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs 套件随组件存活
  }, [listening, reduced]);

  /* 生命系统:随机眨眼 + 瞳孔追踪指针(rAF lerp,写 transform 不重渲染);
     指针静止 4s+ 后视线开始确定性漫游(东张西望,不是死盯屏)。 */
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let blinkT: ReturnType<typeof setTimeout>;
    let gaze = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };
    let lastMove = performance.now();
    let wanderSeq = 1;
    let nextWander = performance.now() + 4200;

    const blink = () => {
      const el = refs.eyes.current;
      if (el) {
        el.style.transform = "scaleY(0.14)";
        setTimeout(() => {
          if (el) el.style.transform = "";
        }, 120);
      }
      blinkT = setTimeout(blink, 2400 + Math.random() * 2600);
    };
    blinkT = setTimeout(blink, 1500 + Math.random() * 1500);

    const onMove = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      target = gazeFromPointer(e.clientX, e.clientY, r.left + r.width / 2, r.top + r.height * 0.35, Math.max(140, r.width));
      lastMove = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      const now = performance.now();
      if (now - lastMove > 4000 && now >= nextWander) {
        target = wanderTarget(wanderSeq++);
        nextWander = now + 2200 + (wanderSeq % 3) * 450;
      }
      gaze = { x: lerp(gaze.x, target.x, 0.1), y: lerp(gaze.y, target.y, 0.1) };
      const g = clampGaze(gaze.x, gaze.y);
      refs.pupils.current?.setAttribute("transform", `translate(${(g.x * 3).toFixed(2)} ${(g.y * 2).toFixed(2)})`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      clearTimeout(blinkT);
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs 套件随组件存活
  }, [reduced]);

  const Art = FORM_ART[formId];

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={`cp-mascot cp-form-${formId} cp-pose-${pose} cp-expr-${expression}`}
      data-testid={testid}
      data-form={formId}
      style={interactive ? { touchAction: "none", cursor: onGrab ? "grab" : "pointer" } : undefined}
      {...(interactive
        ? {
            role: "button",
            "aria-label": ariaLabel,
            onClick: onPoke,
            ...(onGrab
              ? {
                  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => {
                    if (e.button === 0) onGrab(e.clientX, e.clientY);
                  },
                }
              : {}),
          }
        : { "aria-hidden": true })}
    >
      {/* 喷焰:飞行姿势点亮的推进器粒子(壳层渲染,全形态共享) */}
      <g className="cp-thruster" aria-hidden="true">
        <circle cx="78" cy="150" r="3.2" />
        <circle cx="100" cy="158" r="4" />
        <circle cx="122" cy="150" r="3.2" />
      </g>
      {/* 等级徽标:金色光环(高等级)在形态身后,小皇冠在头顶 */}
      {haloBadge && (
        <ellipse cx="100" cy="104" rx="86" ry="60" fill="none" stroke="#FFC800" strokeWidth="2.5"
          opacity="0.4" strokeDasharray="10 7" className="cp-halo" />
      )}
      <Art
        uid={uid}
        refs={refs}
        expression={expression}
        viseme={viseme}
        openScale={openScale}
        energyRatio={energyRatio}
        streakLit={streakLit}
      />
      {crownBadge && (
        <g className="cp-crown-badge" aria-hidden="true">
          <path d="M84,26 L92,36 L100,24 L108,36 L116,26 L114,44 L86,44 Z" fill="#FFC800" stroke="#E8A400" strokeWidth="2" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
