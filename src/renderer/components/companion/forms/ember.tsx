/**
 * 形态·小焰(Ember)——赤焰守护机,家族的原点。
 *
 * R-06(赤焰英雄机:粗墨描边/额头白 glare/方舟能量核)× R-03(cel 守护机:
 * 同形错位硬阴影/屏幕玻璃色阶带)融合:珊瑚装甲 + 青屏脸 + 圆形能量核
 * (今日 XP 充能) + 金色 streak 火苗。口型=圆角母音块。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, GroundShadow, faceFlags, BevelPlate } from "./shared.js";
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

function emberMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M91,78 h18 a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 h-18 a4,4 0 0 1 -4,-4 v-4 a4,4 0 0 1 4,-4 Z M95,81 h10 v3 h-10 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,80 h20 a3,3 0 0 1 0,6 h-20 a3,3 0 0 1 0,-6 Z" fill={p.ink} />;
    case "I":
      return <path d="M90,82 h20 a1.8,1.8 0 0 1 0,3.6 h-20 a1.8,1.8 0 0 1 0,-3.6 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,76 a7,7.5 0 1 1 -0.01,0 Z" fill={p.ink} />;
    case "U":
      return <path d="M100,76.5 a4.5,7.5 0 1 1 -0.01,0 Z" fill={p.ink} />;
    case "SS":
      // 齿擦(s/x/sh 家族):咧开露齿——上牙带 + 暗腔,横向最宽
      return (
        <g>
          <path d="M87,80 h26 a2.6,2.6 0 0 1 2.6,2.6 v1.6 a2.6,2.6 0 0 1 -2.6,2.6 h-26 a2.6,2.6 0 0 1 -2.6,-2.6 v-1.6 a2.6,2.6 0 0 1 2.6,-2.6 Z" fill={p.ink} />
          <rect x="90" y="80.4" width="7" height="2" rx="1" fill="#FFFFFF" />
          <rect x="99" y="80.4" width="7" height="2" rx="1" fill="#FFFFFF" opacity="0.9" />
          <rect x="108" y="80.4" width="4.4" height="2" rx="1" fill="#FFFFFF" opacity="0.75" />
        </g>
      );
    case "L":
      // 舌尖(d/t/n/l 家族):口腔微开,舌尖顶上齿龈
      return (
        <g>
          <path d="M92,77 h16 a4,4 0 0 1 4,4 v5 a4,4 0 0 1 -4,4 h-16 a4,4 0 0 1 -4,-4 v-5 a4,4 0 0 1 4,-4 Z" fill={p.ink} />
          <path d="M95.5,84.5 Q100,78.5 104.5,84.5 Q100,87.5 95.5,84.5 Z" fill="#FF9DB0" stroke={p.ink} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      );
    case "FV":
      // 咬唇(f/v/h 家族):上牙咬住下唇
      return (
        <g>
          <path d="M93,80.5 Q100,77.5 107,80.5 Q107,86.5 100,87 Q93,86.5 93,80.5 Z" fill="#E8563F" stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
          <rect x="93.5" y="78.6" width="13" height="3.6" rx="1.8" fill="#FFFFFF" stroke={p.ink} strokeWidth="1.4" />
        </g>
      );
    default:
      return <path d="M92,83 Q100,88 108,83" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" />;
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

      <GroundShadow />

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

        <Arms refs={refs} armFill={CORAL_D} out={OUT} />

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

          <Face expression={expression} flags={flags} refs={refs} p={EMBER} viseme={viseme} openScale={openScale} renderMouth={emberMouth} />
          <FaceExtras flags={flags} refs={refs} p={EMBER} />
        </g>
      </g>
    </>
  );
}
