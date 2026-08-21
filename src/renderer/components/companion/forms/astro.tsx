/**
 * 形态·星尘(Astro)——星空观测机,安静的宇宙气质。
 *
 * 家族语法的反转样本:屏面是夜空(全家族唯一的暗屏),五官用暖白星火
 * ——夜空里睁大的眼睛。圆顶天文台头盔缀星点,耳舱=带环小行星,
 * 天线=轨道环上的月珠(streak=彗尾),能量核=月相(今日 XP 越满,
 * 月亮越圆:新月→满月)。口型=暖白星月母音。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags , BevelPlate, CrownMark  } from "./shared.js";
import type { Viseme } from "../../../lib/companion/companion-core.js";

export const ASTRO: FormPalette = {
  out: "#221C38",
  ink: "#FFEFC2",
  pupil: "#8B7BF0",
  wave: "#B7ACFF",
  crown: "#FFD75E",
  crownD: "#D9A400",
};
const VIOLET = "#8B7BF0";
const VIOLET_D = "#5D4FD1";
const NIGHT = "#241E4E";
const NIGHT_D = "#3A2F6E";
const BEZEL = "#1A1440";
const MOON = "#FFEFC2";
const GOLD = "#FFD75E";
const OUT = "#221C38";

/** 月相能量核:阴影圆随 energyRatio 移出(0=新月全阴影,1=满月)。 */
function MoonCore({ energyRatio, uid }: { energyRatio: number; uid: string }) {
  const e = Math.min(1, Math.max(0, energyRatio));
  const shift = (1 - e) * 26; // 阴影圆心偏移(0=盖满 → 26=移出)
  return (
    <g>
      <circle cx="100" cy="135" r="16.5" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
      <circle cx="100" cy="135" r="12.5" fill={NIGHT_D} />
      <g clipPath={`url(#${uid}-moon)`}>
        <circle cx="100" cy="135" r="11.5" fill={MOON} />
        <circle cx={100 - shift} cy="135" r="12.5" fill={BEZEL} />
      </g>
      <circle cx="100" cy="135" r="12.5" fill="none" stroke={OUT} strokeWidth="2" />
      {/* 月面环形山点缀(满月时可见) */}
      <g opacity={0.35 * e}>
        <circle cx="96" cy="131" r="2" fill={BEZEL} />
        <circle cx="104" cy="138" r="1.5" fill={BEZEL} />
        <circle cx="99" cy="140" r="1.1" fill={BEZEL} />
      </g>
    </g>
  );
}

/** 口型(v0.18 机器人化+屏内化,y≤86):舱窗语言保留,紫光舌/紫罗兰唇换屏光件
 *  ——舌=发光音素条(p.pupil),牙=星轨刻度,咬唇=快门压光。 */
function astroMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M91,74.5 h18 a5,5 0 0 1 5,5 v2.6 a5,5 0 0 1 -5,5 h-18 a5,5 0 0 1 -5,-5 v-2.6 a5,5 0 0 1 5,-5 Z M95,77.5 h10 v5.6 h-10 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,77 h20 a3.2,3.2 0 0 1 0,6.4 h-20 a3.2,3.2 0 0 1 0,-6.4 Z" fill={p.ink} />;
    case "I":
      return <path d="M90,79.5 h20 a1.9,1.9 0 0 1 0,3.8 h-20 a1.9,1.9 0 0 1 0,-3.8 Z" fill={p.ink} />;
    case "O":
      return (
        <g fill="none">
          <circle cx="100" cy="79.5" r="6.4" stroke={p.ink} strokeWidth="4" />
          <circle cx="100" cy="79.5" r="1.6" fill={p.ink} stroke="none" />
        </g>
      );
    case "U":
      return (
        <g fill="none">
          <circle cx="100" cy="79.5" r="4.4" stroke={p.ink} strokeWidth="3.6" />
        </g>
      );
    case "SS":
      // 齿擦:宽暗槽 + 星轨刻度齿列(非人类牙块)
      return (
        <g>
          <path d="M87,76.5 h26 a2.4,2.4 0 0 1 2.4,2.4 v1.2 a2.4,2.4 0 0 1 -2.4,2.4 h-26 a2.4,2.4 0 0 1 -2.4,-2.4 v-1.2 a2.4,2.4 0 0 1 2.4,-2.4 Z" fill={p.ink} />
          <rect x="90.5" y="78.1" width="1.8" height="3.2" rx="0.9" fill="#FFFFFF" />
          <rect x="96.5" y="78.1" width="1.8" height="3.2" rx="0.9" fill="#FFFFFF" opacity="0.92" />
          <rect x="102.5" y="78.1" width="1.8" height="3.2" rx="0.9" fill="#FFFFFF" opacity="0.84" />
          <rect x="108" y="78.1" width="1.8" height="3" rx="0.9" fill="#FFFFFF" opacity="0.72" />
        </g>
      );
    case "L":
      // 舌尖:开口 + 发光音素条顶上齿龈(屏光"舌",非紫光肉)
      return (
        <g>
          <path d="M91,74.5 h18 a5,5 0 0 1 5,5 v2.6 a5,5 0 0 1 -5,5 h-18 a5,5 0 0 1 -5,-5 v-2.6 a5,5 0 0 1 5,-5 Z M95,77.5 h10 v5.6 h-10 Z" fill={p.ink} fillRule="evenodd" />
          <rect x="96" y="77.2" width="8" height="3.2" rx="1.6" fill={p.pupil} />
          <rect x="98" y="78" width="4" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.9" />
        </g>
      );
    case "FV":
      // 咬唇:星轨齿条下压发光条=快门"咬"住光(非紫罗兰唇)
      return (
        <g>
          <path d="M92,74.8 h16 a5,5 0 0 1 5,5 v2.4 a5,5 0 0 1 -5,5 h-16 a5,5 0 0 1 -5,-5 v-2.4 a5,5 0 0 1 5,-5 Z" fill={p.ink} />
          <rect x="93.5" y="76.6" width="13" height="2.4" rx="1.2" fill="#FFFFFF" />
          <rect x="95.5" y="79.6" width="9" height="2.6" rx="1.3" fill={p.pupil} />
        </g>
      );
    default:
      return <path d="M92,79.5 Q100,85 108,79.5" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" />;
  }
}

export function AstroArt({ uid, refs, expression, viseme, openScale, energyRatio, streakLit }: FormArtProps) {
  const flags = faceFlags(expression);
  return (
    <>
      <defs>
        <clipPath id={`${uid}-body`}><rect x="66" y="110" width="68" height="50" rx="20" /></clipPath>
        <clipPath id={`${uid}-helm`}><path d="M48,96 L48,62 Q48,26 100,26 Q152,26 152,62 L152,96 Z" /></clipPath>
        <clipPath id={`${uid}-scr`}><rect x="64" y="54" width="72" height="34" rx="9" /></clipPath>
        <clipPath id={`${uid}-moon`}><circle cx="100" cy="135" r="12.5" /></clipPath>
      </defs>
      <g ref={refs.bot} className="cp-bot">
        {/* 星尘尾焰(紫;streak=金) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : VIOLET} opacity="0.38" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : VIOLET} />
        </g>
        <path d="M88,158 L112,158 L106,171 L94,171 Z" fill="#2A2248" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
        {/* 修长舱体 + cel 错位暗面 + 月相核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <rect x="66" y="110" width="68" height="50" rx="20" fill={VIOLET_D} />
            <rect x="66" y="110" width="68" height="50" rx="20" fill={VIOLET} transform="translate(-4 -4)" />
          </g>
          <rect x="66" y="110" width="68" height="50" rx="20" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-body`} x={66} y={110} w={68} h={50} t={4} light="rgba(196,181,255,0.34)" dark="rgba(10,6,32,0.5)" />
          <MoonCore energyRatio={energyRatio} uid={uid} />
          <circle cx="76" cy="150" r="1.5" fill={OUT} opacity="0.5" />
          <circle cx="124" cy="150" r="1.5" fill={OUT} opacity="0.5" />
        </g>

        <g ref={refs.head} className="cp-head">
          {/* 轨道环天线:环上月珠(streak=彗尾拖金) */}
          <g className="cp-antenna">
            <ellipse cx="42" cy="44" rx="13" ry="5.5" fill="none" stroke={OUT} strokeWidth="3.5" transform="rotate(-24 42 44)" />
            <circle cx="49" cy="39" r="5" fill={streakLit ? GOLD : MOON} stroke={OUT} strokeWidth="3" />
            {streakLit && <path d="M56,34 L68,26 M57,41 L71,38 M52,30 L58,20" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" />}
          </g>
          {/* 带环小行星耳舱 */}
          <circle cx="44" cy="72" r="8" fill={VIOLET} stroke={OUT} strokeWidth="4" />
          <ellipse cx="44" cy="72" rx="13" ry="4.5" fill="none" stroke={GOLD} strokeWidth="2.4" transform="rotate(-18 44 72)" />
          <circle cx="156" cy="72" r="8" fill={VIOLET} stroke={OUT} strokeWidth="4" />
          <ellipse cx="156" cy="72" rx="13" ry="4.5" fill="none" stroke={GOLD} strokeWidth="2.4" transform="rotate(18 156 72)" />

          {/* 圆顶天文台头盔 + cel 暗面 + 缀星 */}
          <g clipPath={`url(#${uid}-helm)`}>
            <path d="M48,96 L48,62 Q48,26 100,26 Q152,26 152,62 L152,96 Z" fill={VIOLET_D} />
            <path d="M48,96 L48,62 Q48,26 100,26 Q152,26 152,62 L152,96 Z" fill={VIOLET} transform="translate(-5 -5)" />
            <circle cx="66" cy="42" r="1.6" fill="#FFFFFF" opacity="0.9" />
            <circle cx="82" cy="33" r="1.2" fill="#FFFFFF" opacity="0.75" />
            <circle cx="130" cy="36" r="1.7" fill="#FFFFFF" opacity="0.9" />
            <circle cx="118" cy="30" r="1" fill="#FFFFFF" opacity="0.6" />
            <path d="M94,28 l1.6,3.2 3.4,0.5 -2.5,2.4 0.6,3.4 -3.1,-1.7 -3.1,1.7 0.6,-3.4 -2.5,-2.4 3.4,-0.5 Z" fill="#FFFFFF" opacity="0.85" />
          </g>
          <path d="M48,96 L48,62 Q48,26 100,26 Q152,26 152,62 L152,96 Z" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-helm`} x={48} y={26} w={104} h={70} t={4} light="rgba(196,181,255,0.3)" dark="rgba(10,6,32,0.45)" />
          {/* 银河 glare(斜带) */}
          <path d="M56,40 Q88,28 110,34 L102,44 Q72,40 56,46 Z" fill="#FFFFFF" opacity="0.8" />

          {/* 屏框 + 夜空屏(家族唯一暗屏,暖白五官)+ 玻璃星云带 */}
          <rect x="58" y="48" width="84" height="46" rx="12" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <rect x="64" y="54" width="72" height="34" rx="9" fill={NIGHT} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={NIGHT_D} transform="translate(0 15)" />
            <circle cx="74" cy="60" r="1" fill={MOON} opacity="0.8" />
            <circle cx="128" cy="82" r="1.2" fill={MOON} opacity="0.6" />
            <circle cx="86" cy="84" r="0.8" fill={MOON} opacity="0.5" />
            <path d="M118,54 L136,54 L106,88 L92,88 Z" fill="#FFFFFF" opacity="0.08" />
          </g>

          {/* v0.18 脸=屏幕渲染:表情整体剪进屏幕,任何元素构造上不可能越出屏框 */}
          <g className="cp-scr-face" clipPath={`url(#${uid}-scr)`}>
            <Face expression={expression} flags={flags} refs={refs} p={ASTRO} viseme={viseme} openScale={openScale} renderMouth={astroMouth} />
            <FaceExtras flags={flags} refs={refs} p={ASTRO} />
          </g>
        </g>
          {flags.proud && <CrownMark p={ASTRO} />}
        {/* v0.18 arms layer above head */}
        <Arms refs={refs} armFill={VIOLET_D} out={OUT} />
      </g>
    </>
  );
}
