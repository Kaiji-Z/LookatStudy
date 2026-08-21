/**
 * 形态·苔芽(Moss)——自然精灵机,温软的陪伴气质。
 *
 * 家族语法长进植物:圆滚滚的叶冠头盔 + 双叶耳朵 + 茎芽天线(streak=
 * 一步开花)+ 胸口种子能量核(XP 越高,双叶张得越开,像种子破壳)。
 * 口型=花瓣/叶片的有机母音。调性:苔绿×奶白屏,呼吸般的圆。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags , BevelPlate, CrownMark  } from "./shared.js";
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

/** 口型(v0.17.2 机器人化+屏内化,y≤86):圆润语言保留,叶舌/叶唇换屏光件
 *  ——舌=发光音素条(p.pupil),牙=卵石刻度,咬唇=快门压光。 */
function mossMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M92,74 Q100,71 108,74 Q110,83 100,86 Q90,83 92,74 Z M96,76 Q100,78 104,76 Q103,80 100,81.5 Q97,80 96,76 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M91,76.5 Q100,74 109,76.5 Q109,82 100,83 Q91,82 91,76.5 Z" fill={p.ink} />;
    case "I":
      return <path d="M91,78.5 Q100,77 109,78.5 Q109,81.5 100,82.2 Q91,81.5 91,78.5 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,72.5 C105,72.5 107.5,77 107.5,80 C107.5,83.5 104.5,86.5 100,86.5 C95.5,86.5 92.5,83.5 92.5,80 C92.5,77 95,72.5 100,72.5 Z M100,77 C102.5,77 104,78.5 104,80.5 C104,82.5 102.3,83.8 100,83.8 C97.7,83.8 96,82.5 96,80.5 C96,78.5 97.5,77 100,77 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,73 C103,73 105,76.5 105,80 C105,83.3 103,86 100,86 C97,86 95,83.3 95,80 C95,76.5 97,73 100,73 Z M100,76.8 C101.3,76.8 102.2,78.3 102.2,80.3 C102.2,82.3 101.3,83.6 100,83.6 C98.7,83.6 97.8,82.3 97.8,80.3 C97.8,78.3 98.7,76.8 100,76.8 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:圆润宽槽 + 卵石刻度齿列(非人类牙块)
      return (
        <g>
          <path d="M87,77 Q100,75 113,77 Q113.5,82.5 100,83 Q86.5,82.5 87,77 Z" fill={p.ink} />
          <rect x="90.5" y="77.8" width="1.8" height="3.2" rx="0.9" fill="#FFFFFF" />
          <rect x="96.5" y="77.7" width="1.8" height="3.4" rx="0.9" fill="#FFFFFF" opacity="0.92" />
          <rect x="102.5" y="77.8" width="1.8" height="3.2" rx="0.9" fill="#FFFFFF" opacity="0.84" />
          <rect x="108" y="77.9" width="1.8" height="3" rx="0.9" fill="#FFFFFF" opacity="0.72" />
        </g>
      );
    case "L":
      // 舌尖:圆润开口 + 发光音素条顶上齿龈(屏光"舌",非叶肉)
      return (
        <g>
          <path d="M92,74 Q100,71 108,74 Q110,83 100,86 Q90,83 92,74 Z M96,76 Q100,78 104,76 Q103,80 100,81.5 Q97,80 96,76 Z" fill={p.ink} fillRule="evenodd" />
          <rect x="96" y="76.6" width="8" height="3.2" rx="1.6" fill={p.pupil} />
          <rect x="98" y="77.4" width="4" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.9" />
        </g>
      );
    case "FV":
      // 咬唇:卵石齿条下压发光条=快门"咬"住光(非叶唇)
      return (
        <g>
          <path d="M93.5,77 Q100,74.5 106.5,77 Q107,82.5 100,83.8 Q93,82.5 93.5,77 Z" fill={p.ink} />
          <rect x="94.5" y="77.2" width="11" height="2.4" rx="1.2" fill="#FFFFFF" />
          <rect x="95.5" y="80.4" width="9" height="2.6" rx="1.3" fill={p.pupil} />
        </g>
      );
    default:
      return <path d="M92,79.5 Q100,85.5 108,79.5" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" />;
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
      <g ref={refs.bot} className="cp-bot">
        {/* 花粉光尘尾焰(自然悬浮;streak=金粉) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : LEAF} opacity="0.3" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : LEAF} />
        </g>
        <path d="M88,158 Q100,152 112,158 L106,171 Q100,174 94,171 Z" fill="#3A4A34" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
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

          {/* v0.17.2 脸=屏幕渲染:表情整体剪进屏幕,任何元素构造上不可能越出屏框 */}
          <g className="cp-scr-face" clipPath={`url(#${uid}-scr)`}>
            <Face expression={expression} flags={flags} refs={refs} p={MOSS} viseme={viseme} openScale={openScale} renderMouth={mossMouth} />
            <FaceExtras flags={flags} refs={refs} p={MOSS} />
          </g>
        </g>
          {flags.proud && <CrownMark p={MOSS} />}
        {/* v0.17.1 arms layer above head */}
        <Arms refs={refs} armFill={LEAF_D} out={OUT} />
      </g>
    </>
  );
}
