/**
 * 形态·小焰(Ember)——赤焰守护机,家族的原点。
 *
 * R-06(赤焰英雄机:粗墨描边/额头白 glare/方舟能量核)× R-03(cel 守护机:
 * 同形错位硬阴影/屏幕玻璃色阶带)融合:珊瑚装甲 + 青屏脸 + 圆形能量核
 * (今日 XP 充能) + 金色 streak 火苗。口型=圆角母音块。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags, BevelPlate, CrownMark } from "./shared.js";
import type { Viseme } from "../../../lib/companion/companion-core.js";

export const EMBER: FormPalette = {
  out: "#2B2530",
  ink: "#173047",
  pupil: "#35E0E8",
  wave: "#7FD1E8",
  crown: "#FFC800",
  crownD: "#E8A400",
};
const CORAL = "#E8563F";
const CORAL_D = "#C23A2C";
const SCREEN = "#35E0E8";
const SCREEN_D = "#1899B0";
const BEZEL = "#1E2A3E";
const GOLD = "#FFC800";
const OUT = "#2B2530";

/**
 * 口型(v0.17.2 机器人化 + 屏内化):口腔=屏幕暗腔,一切" fleshy"元素换成屏光件——
 * 舌头=发光音素条(p.pupil 屏色),牙齿=分段显示刻度,咬唇=快门压住光条。
 * 坐标预算 y74-86(屏幕底=88,旧版嘴到 y90 越界)。
 */
function emberMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M91,75 h18 a4,4 0 0 1 4,4 v3 a4,4 0 0 1 -4,4 h-18 a4,4 0 0 1 -4,-4 v-3 a4,4 0 0 1 4,-4 Z M95,78 h10 v2.6 h-10 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,77 h20 a3,3 0 0 1 0,6 h-20 a3,3 0 0 1 0,-6 Z" fill={p.ink} />;
    case "I":
      return <path d="M90,79 h20 a1.8,1.8 0 0 1 0,3.6 h-20 a1.8,1.8 0 0 1 0,-3.6 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,73 a7,6 0 1 1 -0.01,0 Z" fill={p.ink} />;
    case "U":
      return <path d="M100,73.5 a4.5,6 0 1 1 -0.01,0 Z" fill={p.ink} />;
    case "SS":
      // 齿擦(s/x/sh 家族):横向最宽,分段显示"齿列"刻度(非人类牙块)
      return (
        <g>
          <path d="M86,76.5 h28 a2.6,2.6 0 0 1 2.6,2.6 v1.6 a2.6,2.6 0 0 1 -2.6,2.6 h-28 a2.6,2.6 0 0 1 -2.6,-2.6 v-1.6 a2.6,2.6 0 0 1 2.6,-2.6 Z" fill={p.ink} />
          <rect x="90" y="78.2" width="1.8" height="3.4" rx="0.9" fill="#FFFFFF" />
          <rect x="96" y="78.2" width="1.8" height="3.4" rx="0.9" fill="#FFFFFF" opacity="0.92" />
          <rect x="102" y="78.2" width="1.8" height="3.4" rx="0.9" fill="#FFFFFF" opacity="0.84" />
          <rect x="108" y="78.2" width="1.8" height="3.4" rx="0.9" fill="#FFFFFF" opacity="0.72" />
        </g>
      );
    case "L":
      // 舌尖(d/t/n/l 家族):口腔微开,发光音素条顶上齿龈(屏光"舌",非肉色)
      return (
        <g>
          <path d="M92,74.5 h16 a4,4 0 0 1 4,4 v3.5 a4,4 0 0 1 -4,4 h-16 a4,4 0 0 1 -4,-4 v-3.5 a4,4 0 0 1 4,-4 Z" fill={p.ink} />
          <rect x="96" y="77.4" width="8" height="3.4" rx="1.7" fill={p.pupil} />
          <rect x="98" y="78.2" width="4" height="1.8" rx="0.9" fill="#FFFFFF" opacity="0.9" />
        </g>
      );
    case "FV":
      // 咬唇(f/v/h 家族):分段齿条下压发光条=快门"咬"住光(非人类唇)
      return (
        <g>
          <path d="M92,75 h16 a4,4 0 0 1 4,4 v2.6 a4,4 0 0 1 -4,4 h-16 a4,4 0 0 1 -4,-4 v-2.6 a4,4 0 0 1 4,-4 Z" fill={p.ink} />
          <rect x="93.5" y="76.8" width="13" height="2.4" rx="1.2" fill="#FFFFFF" />
          <rect x="95.5" y="79.8" width="9" height="2.6" rx="1.3" fill={p.pupil} />
        </g>
      );
    default:
      return <path d="M92,80 Q100,85 108,80" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" />;
  }
}

export function EmberArt({ uid, refs, expression, viseme, openScale, energyRatio, streakLit }: FormArtProps) {
  const flags = faceFlags(expression);
  return (
    <>
      <defs>
        <clipPath id={`${uid}-body`}><rect x="64" y="110" width="72" height="50" rx="16" /></clipPath>
        <clipPath id={`${uid}-helm`}><rect x="46" y="30" width="108" height="78" rx="20" /></clipPath>
        <clipPath id={`${uid}-scr`}><rect x="64" y="54" width="72" height="34" rx="8" /></clipPath>
        <clipPath id={`${uid}-podL`}><rect x="36" y="60" width="12" height="24" rx="6" /></clipPath>
        <clipPath id={`${uid}-podR`}><rect x="152" y="60" width="12" height="24" rx="6" /></clipPath>
        <clipPath id={`${uid}-bezel`}><rect x="58" y="48" width="84" height="46" rx="12" /></clipPath>
        <clipPath id={`${uid}-core`}>
          <rect x="84" y={151 - Math.round(energyRatio * 32)} width="32" height={Math.max(0, Math.round(energyRatio * 32) + 1)} />
        </clipPath>
      </defs>
      <g ref={refs.bot} className="cp-bot">
        {/* 尾焰(悬浮推进;streak 点燃=金色) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : SCREEN} opacity="0.35" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : SCREEN} />
        </g>
        <path d="M88,158 L112,158 L106,171 L94,171 Z" fill="#3A3440" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
        <path d="M100,160 v8" stroke={OUT} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="92" cy="164" r="1.5" fill={OUT} opacity="0.6" />
        <circle cx="108" cy="164" r="1.5" fill={OUT} opacity="0.6" />
        {/* 身体 + cel 错位暗面 + 能量核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <rect x="64" y="110" width="72" height="50" rx="16" fill={CORAL_D} />
            <rect x="64" y="110" width="72" height="50" rx="16" fill={CORAL} transform="translate(-4 -4)" />
          </g>
          <rect x="64" y="110" width="72" height="50" rx="16" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-body`} x={64} y={110} w={72} h={50} t={5} />
          {/* 侧通气缝 + 裙甲 seam(机械细节) */}
          <path d="M68,146 h9 M68,151 h9 M123,146 h9 M123,151 h9" stroke={OUT} strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
          <circle cx="100" cy="135" r="16.5" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <circle cx="100" cy="135" r="12" fill={SCREEN_D} />
          <g clipPath={`url(#${uid}-core)`}>
            <circle cx="100" cy="135" r="12" fill={streakLit ? GOLD : SCREEN} />
          </g>
          <path d="M92,127 a11,11 0 0 1 8,-3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
          <circle cx="72" cy="152" r="1.6" fill={OUT} opacity="0.5" />
          <circle cx="128" cy="152" r="1.6" fill={OUT} opacity="0.5" />
        </g>

        <g ref={refs.head} className="cp-head">
          {/* 耳舱 + 天线(听写时 perk;streak 火苗金色) */}
          <g className="cp-antenna">
            <path d={streakLit ? "M42,60 C38,52 30,48 28,40 C34,42 38,46 42,44 Z" : "M42,60 L35,44"} fill={streakLit ? GOLD : "none"} stroke={OUT} strokeWidth="4" strokeLinecap="round" />
            <circle cx={streakLit ? 32 : 35} cy="40" r={streakLit ? 7 : 5.5} fill={streakLit ? GOLD : SCREEN} stroke={OUT} strokeWidth="3.5" />
            {!streakLit && <circle cx="35" cy="40" r="9" fill={SCREEN} opacity="0.25" className="cp-ant-glow" />}
          </g>
          <rect x="36" y="60" width="12" height="24" rx="6" fill={SCREEN_D} stroke={OUT} strokeWidth="4" />
          <rect x="152" y="60" width="12" height="24" rx="6" fill={SCREEN_D} stroke={OUT} strokeWidth="4" />
          <BevelPlate id={`${uid}-podL`} x={36} y={60} w={12} h={24} t={3} />
          <BevelPlate id={`${uid}-podR`} x={152} y={60} w={12} h={24} t={3} />

          {/* 头盔 + cel 暗面 + 额头 glare(R-06 签名) */}
          <g clipPath={`url(#${uid}-helm)`}>
            <rect x="46" y="30" width="108" height="78" rx="20" fill={CORAL_D} />
            <rect x="46" y="30" width="108" height="78" rx="20" fill={CORAL} transform="translate(-5 -5)" />
          </g>
          <rect x="46" y="30" width="108" height="78" rx="20" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-helm`} x={46} y={30} w={108} h={78} t={5} />
          <circle cx="52" cy="100" r="2" fill={OUT} opacity="0.5" />
          <circle cx="148" cy="100" r="2" fill={OUT} opacity="0.5" />
          <path d="M132,49 h8 M132,53 h8" stroke={OUT} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          <rect x="58" y="37" width="46" height="9" rx="4.5" fill="#FFFFFF" opacity="0.92" />
          <rect x="110" y="37" width="18" height="9" rx="4.5" fill="#FFFFFF" opacity="0.55" />

          {/* 屏框 + 屏幕 + 玻璃暗带(R-03) + 光泽 */}
          <rect x="58" y="48" width="84" height="46" rx="12" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <BevelPlate id={`${uid}-bezel`} x={58} y={48} w={84} h={46} t={4} inverted />
          <rect x="64" y="54" width="72" height="34" rx="8" fill={SCREEN} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={SCREEN_D} transform="translate(0 15)" />
            <path d="M120,54 L136,54 L108,88 L92,88 Z" fill="#FFFFFF" opacity="0.14" />
          </g>

          {/* v0.17.2 脸=屏幕渲染:表情整体剪进屏幕,任何元素(眉/嘴/挂件)构造上不可能越出屏框 */}
          <g className="cp-scr-face" clipPath={`url(#${uid}-scr)`}>
            <Face expression={expression} flags={flags} refs={refs} p={EMBER} viseme={viseme} openScale={openScale} renderMouth={emberMouth} />
            <FaceExtras flags={flags} refs={refs} p={EMBER} />
          </g>
        </g>
          {flags.proud && <CrownMark p={EMBER} />}
        {/* v0.17.1 arms layer above head */}
        <Arms refs={refs} armFill={CORAL_D} out={OUT} />
      </g>
    </>
  );
}
