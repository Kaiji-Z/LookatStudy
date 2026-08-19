/**
 * Mascot —— 伴学伙伴本体(小焰/Ember),纯 SVG cel 机器人。
 *
 * 视觉语法 = R-06(赤焰英雄机:粗墨描边/额头白 glare/能量核)× R-03(cel 守护机:
 * 同形错位堆叠硬阴影/屏幕玻璃色阶带),悬浮守护机形态:
 *   头盔(珊瑚) + 屏幕脸(青) + 胸口能量核(今日 XP 充能) + 双臂白手套 + 尾焰悬浮。
 * 脸长在屏幕上:眼睛换形(常态/眯笑/星星/横线睡)+ 口型六档母音(closed/A/E/I/O/U)
 * ——朗读时由真实音频驱动(见 useSpeechMouth),这是「AI 软件式口型」的渲染端。
 *
 * 生命系统(组件内,零重渲染):眨眼随机调度 + 瞳孔 rAF lerp 追指针(写 ref,
 * 不 setState);表情/姿势/口型走 props(总线快照,量化后才变)。
 * reduced-motion:生命循环关闭,静态呈现(a11y 双轨铁律)。
 */
import { useId, useEffect, useRef } from "react";

import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion.js";
import {
  type CompanionExpression,
  type CompanionPose,
  type Viseme,
  clampGaze,
  gazeFromPointer,
  lerp,
} from "../../lib/companion/companion-core.js";

/* 配色(R-06×R-03 融合,主题无关——伙伴自带明度,双主题可读) */
const OUT = "#2B2530"; // 墨描边
const CORAL = "#E8563F"; // 机身珊瑚(赤焰)
const CORAL_D = "#C23A2C"; // cel 暗面
const SCREEN = "#35E0E8"; // 屏幕青
const SCREEN_D = "#1899B0"; // 屏幕玻璃暗带
const BEZEL = "#1E2A3E"; // 屏框深海军
const INK = "#173047"; // 屏上五官墨色
const GLOVE = "#FFFFFF";
const GOLD = "#FFC800";
const GOLD_D = "#E8A400";

const SMILE_EYES = new Set(["happy", "cheer", "proud"]);
const STAR_EYES = new Set(["stars", "flame"]);

/** 口型形状(屏幕内,中心 100,84)。closed=微笑线;其余为母音块。 */
function mouthPath(viseme: Viseme): { d: string; stroke?: boolean } {
  switch (viseme) {
    case "A":
      return { d: "M91,78 h18 a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 h-18 a4,4 0 0 1 -4,-4 v-4 a4,4 0 0 1 4,-4 Z M95,81 h10 v3 h-10 Z" };
    case "E":
      return { d: "M90,80 h20 a3,3 0 0 1 0,6 h-20 a3,3 0 0 1 0,-6 Z" };
    case "I":
      return { d: "M90,82 h20 a1.8,1.8 0 0 1 0,3.6 h-20 a1.8,1.8 0 0 1 0,-3.6 Z" };
    case "O":
      return { d: "M100,76 a7,7.5 0 1 1 -0.01,0 Z" };
    case "U":
      return { d: "M100,76.5 a4.5,7.5 0 1 1 -0.01,0 Z" };
    default:
      return { d: "M92,83 Q100,88 108,83", stroke: true };
  }
}

export interface MascotProps {
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
}

export function Mascot({
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
}: MascotProps) {
  const raw = useId();
  const uid = "cp" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const reduced = usePrefersReducedMotion();

  const eyesRef = useRef<SVGGElement | null>(null);
  const pupilsRef = useRef<SVGGElement | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);

  /* 生命系统:随机眨眼 + 瞳孔追踪指针(rAF lerp,写 transform 不重渲染) */
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let blinkT: ReturnType<typeof setTimeout>;
    let gaze = { x: 0, y: 0 };
    let target = { x: 0, y: 0 };

    const blink = () => {
      const el = eyesRef.current;
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
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      gaze = { x: lerp(gaze.x, target.x, 0.1), y: lerp(gaze.y, target.y, 0.1) };
      const g = clampGaze(gaze.x, gaze.y);
      pupilsRef.current?.setAttribute("transform", `translate(${(g.x * 3).toFixed(2)} ${(g.y * 2).toFixed(2)})`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      clearTimeout(blinkT);
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduced]);

  const m = mouthPath(viseme);
  const sleepLines = expression === "sleeping";
  const smileEyes = SMILE_EYES.has(expression);
  const starEyes = STAR_EYES.has(expression);
  const thinking = expression === "thinking";
  const listening = expression === "listening";
  const encourage = expression === "encourage";
  const proud = expression === "proud";

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={`cp-mascot cp-pose-${pose}`}
      data-testid={testid}
      {...(interactive
        ? {
            role: "button",
            "aria-label": ariaLabel,
            onClick: onPoke,
          }
        : { "aria-hidden": true })}
    >
      <defs>
        <clipPath id={`${uid}-body`}>
          <rect x="64" y="110" width="72" height="50" rx="16" />
        </clipPath>
        <clipPath id={`${uid}-helm`}>
          <rect x="46" y="30" width="108" height="78" rx="20" />
        </clipPath>
        <clipPath id={`${uid}-scr`}>
          <rect x="64" y="54" width="72" height="34" rx="8" />
        </clipPath>
        <clipPath id={`${uid}-core`}>
          {/* 能量核填充裁剪:从核底向上,rect 顶 = 135+16-energyRatio*32 */}
          <rect x="84" y={151 - Math.round(energyRatio * 32)} width="32" height={Math.max(0, Math.round(energyRatio * 32) + 1)} />
        </clipPath>
      </defs>

      {/* 地影(悬浮高度感) */}
      <ellipse cx="100" cy="189" rx="33" ry="6.5" fill="rgba(20,16,28,0.35)" className="cp-shadow" />

      <g ref={rootRef} className="cp-bot">
        {/* 尾焰(悬浮推进;streak 点燃=金色) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : SCREEN} opacity="0.35" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : SCREEN} />
        </g>
        <path d="M88,158 L112,158 L106,171 L94,171 Z" fill="#3A3440" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />

        {/* 双臂(肩为轴;punch/oops 姿势由 CSS 旋转) */}
        <g className="cp-arm cp-armL">
          <rect x="47" y="113" width="19" height="30" rx="9.5" fill={CORAL_D} stroke={OUT} strokeWidth="4" />
          <circle cx="56.5" cy="146" r="8.5" fill={GLOVE} stroke={OUT} strokeWidth="4" />
        </g>
        <g className="cp-arm cp-armR">
          <rect x="134" y="113" width="19" height="30" rx="9.5" fill={CORAL_D} stroke={OUT} strokeWidth="4" />
          <circle cx="143.5" cy="146" r="8.5" fill={GLOVE} stroke={OUT} strokeWidth="4" />
        </g>

        {/* 身体 + cel 错位暗面 + 能量核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <rect x="64" y="110" width="72" height="50" rx="16" fill={CORAL_D} />
            <rect x="64" y="110" width="72" height="50" rx="16" fill={CORAL} transform="translate(-4 -4)" />
          </g>
          <rect x="64" y="110" width="72" height="50" rx="16" fill="none" stroke={OUT} strokeWidth="5" />
          <circle cx="100" cy="135" r="16.5" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <circle cx="100" cy="135" r="12" fill={SCREEN_D} />
          <g clipPath={`url(#${uid}-core)`}>
            <circle cx="100" cy="135" r="12" fill={streakLit ? GOLD : SCREEN} />
          </g>
          {/* 核高光 */}
          <path d="M92,127 a11,11 0 0 1 8,-3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
          <circle cx="72" cy="152" r="1.6" fill={OUT} opacity="0.5" />
          <circle cx="128" cy="152" r="1.6" fill={OUT} opacity="0.5" />
        </g>

        {/* 头(姿势倾斜/落枕由 CSS) */}
        <g className="cp-head">
          {/* 耳舱 + 天线(听写时 perk;streak 火苗金色) */}
          <g className="cp-antenna">
            <path d={streakLit ? "M42,60 C38,52 30,48 28,40 C34,42 38,46 42,44 Z" : "M42,60 L35,44"} fill={streakLit ? GOLD : "none"} stroke={OUT} strokeWidth="4" strokeLinecap="round" />
            <circle cx={streakLit ? 32 : 35} cy={streakLit ? 40 : 40} r={streakLit ? 7 : 5.5} fill={streakLit ? GOLD : SCREEN} stroke={OUT} strokeWidth="3.5" />
            {!streakLit && <circle cx="35" cy="40" r="9" fill={SCREEN} opacity="0.25" className="cp-ant-glow" />}
          </g>
          <rect x="36" y="60" width="12" height="24" rx="6" fill={SCREEN_D} stroke={OUT} strokeWidth="4" />
          <rect x="152" y="60" width="12" height="24" rx="6" fill={SCREEN_D} stroke={OUT} strokeWidth="4" />

          {/* 头盔 + cel 暗面 + 额头 glare(R-06 签名) */}
          <g clipPath={`url(#${uid}-helm)`}>
            <rect x="46" y="30" width="108" height="78" rx="20" fill={CORAL_D} />
            <rect x="46" y="30" width="108" height="78" rx="20" fill={CORAL} transform="translate(-5 -5)" />
          </g>
          <rect x="46" y="30" width="108" height="78" rx="20" fill="none" stroke={OUT} strokeWidth="5" />
          <rect x="58" y="37" width="46" height="9" rx="4.5" fill="#FFFFFF" opacity="0.92" />
          <rect x="110" y="37" width="18" height="9" rx="4.5" fill="#FFFFFF" opacity="0.55" />

          {/* 屏框 + 屏幕 + 玻璃暗带(R-03) + 光泽 */}
          <rect x="58" y="48" width="84" height="46" rx="12" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <rect x="64" y="54" width="72" height="34" rx="8" fill={SCREEN} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={SCREEN_D} transform="translate(0 15)" />
            <path d="M120,54 L136,54 L108,88 L92,88 Z" fill="#FFFFFF" opacity="0.14" />
          </g>

          {/* 五官(屏幕内) */}
          <g className="cp-face" transform={thinking ? "translate(-1.5 -1)" : undefined}>
            <g ref={eyesRef} className="cp-eyes" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              {sleepLines ? (
                <>
                  <path d="M77,68 h14" stroke={INK} strokeWidth="4" strokeLinecap="round" />
                  <path d="M109,68 h14" stroke={INK} strokeWidth="4" strokeLinecap="round" />
                </>
              ) : smileEyes ? (
                <>
                  <path d="M77,71 Q84,62 91,71" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
                  <path d="M109,71 Q116,62 123,71" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
                </>
              ) : starEyes ? (
                <>
                  <path d="M84,60 L86.2,66 L92,68.2 L86.2,70.4 L84,76.4 L81.8,70.4 L76,68.2 L81.8,66 Z" fill={GOLD} stroke={GOLD_D} strokeWidth="1.5" />
                  <path d="M116,60 L118.2,66 L124,68.2 L118.2,70.4 L116,76.4 L113.8,70.4 L108,68.2 L113.8,66 Z" fill={GOLD} stroke={GOLD_D} strokeWidth="1.5" />
                </>
              ) : (
                <>
                  <rect x="76" y={listening ? "61" : "62"} width="16" height={listening ? "15" : "13"} rx="6" fill={INK} />
                  <rect x="108" y={listening ? "61" : "62"} width="16" height={listening ? "15" : "13"} rx="6" fill={INK} />
                  <g ref={pupilsRef} className="cp-pupils">
                    <rect x="82" y="66" width="4.5" height="5.5" rx="1.5" fill={SCREEN} />
                    <rect x="114" y="66" width="4.5" height="5.5" rx="1.5" fill={SCREEN} />
                  </g>
                </>
              )}
            </g>

            {/* 口型:母音块/微笑线;开口度整体缩放(说话的弹性) */}
            <g
              className="cp-mouth"
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                transform: m.stroke ? undefined : `scale(${(0.72 + openScale * 0.28).toFixed(3)})`,
              }}
            >
              {m.stroke ? (
                <path d={m.d} fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
              ) : (
                <path d={m.d} fill={INK} fillRule="evenodd" />
              )}
            </g>
          </g>

          {/* 思考眉 */}
          {thinking && (
            <>
              <rect x="68" y="42" width="22" height="5" rx="2.5" fill={OUT} transform="rotate(10 79 44)" />
              <rect x="110" y="42" width="22" height="5" rx="2.5" fill={OUT} transform="rotate(-10 121 44)" />
            </>
          )}
          {/* 听写声波(右耳外) */}
          {listening && (
            <g stroke={SCREEN_D} strokeWidth="3" fill="none" strokeLinecap="round" className="cp-waves">
              <path d="M168,64 a10,10 0 0 1 0,16" />
              <path d="M174,60 a16,16 0 0 1 0,24" opacity="0.66" />
              <path d="M180,56 a22,22 0 0 1 0,32" opacity="0.4" />
            </g>
          )}
          {/* 鼓励汗滴 */}
          {encourage && (
            <path d="M156,44 C160,50 160,55 156,57 C152,55 152,50 156,44 Z" fill="#7FD1E8" stroke={OUT} strokeWidth="2" className="cp-sweat" />
          )}
          {/* 睡眠 zzz */}
          {sleepLines && (
            <g className="cp-zzz" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M150,34 h9 l-9,9 h9" />
              <path d="M166,24 h7 l-7,7 h7" opacity="0.7" />
              <path d="M179,16 h5 l-5,5 h5" opacity="0.45" />
            </g>
          )}
          {/* 加冕(R-06 英雄签名的金冠,戴在头盔右顶) */}
          {proud && (
            <g>
              <path d="M108,30 L112,12 L120,24 L128,8 L136,24 L144,12 L148,30 Z" fill={GOLD} stroke={GOLD_D} strokeWidth="3" strokeLinejoin="round" />
              <circle cx="128" cy="24" r="3" fill="#E8563F" stroke={GOLD_D} strokeWidth="1.5" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
