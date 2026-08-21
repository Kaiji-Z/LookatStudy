/**
 * 形态·苔芽(Moss)——自然精灵机,温软的陪伴气质。
 *
 * 家族语法长进植物:圆滚滚的叶冠头盔 + 双叶耳朵 + 茎芽天线(streak=
 * 一步开花)+ 胸口种子能量核(XP 越高,双叶张得越开,像种子破壳)。
 * 口型=花瓣/叶片的有机母音。调性:苔绿×奶白屏,呼吸般的圆。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, GroundShadow, faceFlags , BevelPlate } from "./shared.js";
import type { Viseme } from "../../../lib/companion/companion-core.js";

export const MOSS: FormPalette = {
  out: "#2A3326",
  ink: "#2F5D3A",
  pupil: "#9BEFA9",
  wave: "#8FDBA0",
  crown: "#FFC800",
  crownD: "#D9A400",
};
const LEAF = "#9BEFA9";
const LEAF_D = "#57BD74";
const LEAF_DEEP = "#3E8E55";
const SCREEN = "#F4FBE8";
const SCREEN_D = "#D7F0C8";
const BEZEL = "#3A4A34";
const GOLD = "#FFC800";
const OUT = "#2A3326";

/** 种子能量核:双叶张开角随 energyRatio(0=闭合种壳,1=完全舒展)+ 芽茎拔高。 */
function SeedCore({ energyRatio }: { energyRatio: number }) {
  const e = Math.min(1, Math.max(0, energyRatio));
  const open = 10 + e * 30; // 每侧张开角度
  const sprout = 2 + e * 6; // 芽茎露出
  return (
    <g>
      <circle cx="100" cy="135" r="16.5" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
      <circle cx="100" cy="135" r="12.5" fill={SCREEN_D} />
      {/* 芽茎 */}
      <path d={`M100,141 Q${100 - e * 2},${135 - sprout} 100,${129 - sprout}`} fill="none" stroke={LEAF_DEEP} strokeWidth="3" strokeLinecap="round" />
      {/* 双子叶:种子壳(闭合)→ 叶片(张开) */}
      <g transform={`rotate(${-open} 100 133)`}>
        <path d="M100,133 C95,127 87,127 85,131 C88,136 96,137 100,133 Z" fill={LEAF} stroke={OUT} strokeWidth="2.6" strokeLinejoin="round" />
      </g>
      <g transform={`rotate(${open} 100 133)`}>
        <path d="M100,133 C105,127 113,127 115,131 C112,136 104,137 100,133 Z" fill={LEAF} stroke={OUT} strokeWidth="2.6" strokeLinejoin="round" />
      </g>
      <ellipse cx="100" cy="140" rx="5.5" ry="4" fill="#7A5A3A" stroke={OUT} strokeWidth="2.4" />
      <path d="M95,130.5 Q97,128.5 99.5,129" stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

function mossMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M92,77 Q100,74 108,77 Q110,86 100,89 Q90,86 92,77 Z M96,79 Q100,81 104,79 Q103,83 100,84.5 Q97,83 96,79 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M91,79.5 Q100,77 109,79.5 Q109,85 100,86 Q91,85 91,79.5 Z" fill={p.ink} />;
    case "I":
      return <path d="M91,81.5 Q100,80 109,81.5 Q109,84.5 100,85.2 Q91,84.5 91,81.5 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,75.5 C105,75.5 107.5,80 107.5,83 C107.5,86.5 104.5,89.5 100,89.5 C95.5,89.5 92.5,86.5 92.5,83 C92.5,80 95,75.5 100,75.5 Z M100,79.5 C102.5,79.5 104,81 104,83 C104,85 102.3,86.3 100,86.3 C97.7,86.3 96,85 96,83 C96,81 97.5,79.5 100,79.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,76 C103,76 105,79.5 105,83 C105,86.3 103,89 100,89 C97,89 95,86.3 95,83 C95,79.5 97,76 100,76 Z M100,79.5 C101.3,79.5 102.2,81 102.2,83 C102.2,85 101.3,86.3 100,86.3 C98.7,86.3 97.8,85 97.8,83 C97.8,81 98.7,79.5 100,79.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:圆润宽槽 + 白牙卵石
      return (
        <g>
          <path d="M88,80 Q100,78 112,80 Q112.5,85.5 100,86 Q87.5,85.5 88,80 Z" fill={p.ink} />
          <rect x="91" y="80.6" width="6.5" height="2.6" rx="1.3" fill="#FFFFFF" />
          <rect x="99" y="80.4" width="6.5" height="2.8" rx="1.4" fill="#FFFFFF" opacity="0.9" />
          <rect x="106.6" y="80.7" width="4.2" height="2.5" rx="1.25" fill="#FFFFFF" opacity="0.75" />
        </g>
      );
    case "L":
      // 舌尖:圆润开口 + 嫩叶舌顶上齿龈
      return (
        <g>
          <path d="M92,77 Q100,74 108,77 Q110,86 100,89 Q90,86 92,77 Z M96,79 Q100,81 104,79 Q103,83 100,84.5 Q97,83 96,79 Z" fill={p.ink} fillRule="evenodd" />
          <path d="M96,85.5 Q100,78 104,85.5 Q100,88 96,85.5 Z" fill="#A8E89A" stroke={p.ink} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M98.4,84 Q100,81 101.6,84" fill="none" stroke={p.ink} strokeWidth="1" strokeLinecap="round" />
        </g>
      );
    case "FV":
      // 咬唇:白牙咬叶片下唇
      return (
        <g>
          <path d="M93.5,80.5 Q100,78 106.5,80.5 Q107,86 100,86.8 Q93,86 93.5,80.5 Z" fill="#57BD74" stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M94,79.2 Q100,77.4 106,79.2 L105.4,82.4 Q100,83.4 94.6,82.4 Z" fill="#FFFFFF" stroke={p.ink} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      );
    default:
      return <path d="M92,82.5 Q100,88.5 108,82.5" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" />;
  }
}

export function MossArt({ uid, refs, expression, viseme, openScale, energyRatio, streakLit }: FormArtProps) {
  const flags = faceFlags(expression);
  return (
    <>
      <defs>
        <clipPath id={`${uid}-body`}><rect x="64" y="110" width="72" height="50" rx="22" /></clipPath>
        <clipPath id={`${uid}-helm`}><ellipse cx="100" cy="69" rx="56" ry="42" /></clipPath>
        <clipPath id={`${uid}-scr`}><rect x="64" y="54" width="72" height="34" rx="12" /></clipPath>
      </defs>

      <GroundShadow tint="rgba(26,36,24,0.32)" />

      <g ref={refs.bot} className="cp-bot">
        {/* 花粉光尘尾焰(自然悬浮;streak=金粉) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : LEAF} opacity="0.3" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : LEAF} />
        </g>
        <path d="M88,158 Q100,152 112,158 L106,171 Q100,174 94,171 Z" fill="#3A4A34" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />

        <Arms refs={refs} armFill={LEAF_D} out={OUT} />

        {/* 圆滚躯干 + cel 错位暗面 + 种子核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <rect x="64" y="110" width="72" height="50" rx="22" fill={LEAF_D} />
            <rect x="64" y="110" width="72" height="50" rx="22" fill={LEAF} transform="translate(-4 -4)" />
          </g>
          <rect x="64" y="110" width="72" height="50" rx="22" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-body`} x={64} y={110} w={72} h={50} t={4} light="rgba(255,255,255,0.42)" dark="rgba(38,74,46,0.4)" />
          <SeedCore energyRatio={energyRatio} />
          <circle cx="73" cy="150" r="1.6" fill={OUT} opacity="0.45" />
          <circle cx="127" cy="150" r="1.6" fill={OUT} opacity="0.45" />
        </g>

        <g ref={refs.head} className="cp-head">
          {/* 茎芽天线:常态=待放花苞;streak=一步开花(五瓣金心) */}
          <g className="cp-antenna">
            <path d="M43,60 Q40,50 44,42" fill="none" stroke={OUT} strokeWidth="4" strokeLinecap="round" />
            {streakLit ? (
              <g>
                {Array.from({ length: 5 }, (_, i) => (
                  <ellipse key={i} cx="44" cy="33" rx="4" ry="7.5" fill={GOLD} stroke={OUT} strokeWidth="2" transform={`rotate(${i * 72} 44 40)`} />
                ))}
                <circle cx="44" cy="40" r="4.5" fill="#FFF3C4" stroke={OUT} strokeWidth="2" />
              </g>
            ) : (
              <g>
                <ellipse cx="44" cy="39" rx="5.5" ry="7" fill={LEAF} stroke={OUT} strokeWidth="3" />
                <path d="M44,33 Q46.5,39 44,45" fill="none" stroke={LEAF_DEEP} strokeWidth="1.8" />
              </g>
            )}
          </g>
          {/* 双叶耳朵 */}
          <path d="M48,62 C36,56 30,62 32,70 C38,76 48,74 48,62 Z" fill={LEAF} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
          <path d="M152,62 C164,56 170,62 168,70 C162,76 152,74 152,62 Z" fill={LEAF} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
          <path d="M36,62 Q42,66 46,68 M164,62 Q158,66 154,68" stroke={LEAF_DEEP} strokeWidth="1.8" fill="none" strokeLinecap="round" />

          {/* 叶冠头盔(椭圆,有机圆) + cel 暗面 + 露珠 glare */}
          <g clipPath={`url(#${uid}-helm)`}>
            <ellipse cx="100" cy="69" rx="56" ry="42" fill={LEAF_D} />
            <ellipse cx="100" cy="69" rx="56" ry="42" fill={LEAF} transform="translate(-5 -5)" />
          </g>
          <ellipse cx="100" cy="69" rx="56" ry="42" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-helm`} x={44} y={27} w={112} h={84} t={4} light="rgba(255,255,255,0.36)" dark="rgba(38,74,46,0.36)" />
          <path d="M58,37 Q86,31 104,38 L96,47 Q68,46 58,37 Z" fill="#FFFFFF" opacity="0.88" />
          <circle cx="118" cy="41" r="4" fill="#FFFFFF" opacity="0.55" />

          {/* 屏框 + 奶白屏 + 玻璃色阶带 */}
          <rect x="58" y="48" width="84" height="46" rx="16" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <rect x="64" y="54" width="72" height="34" rx="12" fill={SCREEN} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={SCREEN_D} transform="translate(0 15)" />
            <path d="M120,54 L136,54 L106,88 L90,88 Z" fill="#FFFFFF" opacity="0.2" />
          </g>

          <Face expression={expression} flags={flags} refs={refs} p={MOSS} viseme={viseme} openScale={openScale} renderMouth={mossMouth} />
          <FaceExtras flags={flags} refs={refs} p={MOSS} />
        </g>
      </g>
    </>
  );
}
