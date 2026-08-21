/**
 * 形态·墨墨(Ink)——砚上学者机,书房里的沉静气质。
 *
 * 家族语法的文人转译:身=砚台(胸口墨池=能量核,今日 XP 越高墨越满,
 * 满时浮起金墨涟漪),头=方巾学帽,天线=一支悬笔(streak=笔尖落款
 * 朱砂),屏=宣纸(家族唯一暖纸色屏),胸口小印章做点缀。口型=毛笔
 * 笔触(圆头粗描,起收笔圆润)。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags , BevelPlate } from "./shared.js";
import type { Viseme } from "../../../lib/companion/companion-core.js";

export const INK: FormPalette = {
  out: "#2F2A22",
  ink: "#2B2B2B",
  pupil: "#F7F2E6",
  wave: "#8FB8C9",
  crown: "#FFC800",
  crownD: "#D9A400",
};
const PAPER = "#F7F2E6";
const PAPER_D = "#DCD2B8";
const SCREEN = "#FBF7EC";
const SCREEN_D = "#EFE7D2";
const BEZEL = "#4A4234";
const CINNABAR = "#E8543F";
const CINNABAR_D = "#B8392A";
const INKWELL = "#3A342A";
const GOLD = "#FFC800";
const OUT = "#2F2A22";

/** 砚台墨池能量核:墨位随 energyRatio 上升,满时金墨涟漪。 */
function InkCore({ energyRatio, streakLit }: { energyRatio: number; streakLit: boolean }) {
  const e = Math.min(1, Math.max(0, energyRatio));
  const h = e * 22;
  const y = 146 - h; // 墨面 y(池底 146)
  return (
    <g>
      {/* 砚池外沿(砚堂) */}
      <path d="M82,120 h36 a6,6 0 0 1 6,6 v16 a8,8 0 0 1 -8,8 h-32 a8,8 0 0 1 -8,-8 v-16 a6,6 0 0 1 6,-6 Z" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
      {/* 池 */}
      <path d="M86,124 h28 a4,4 0 0 1 4,4 v14 a5,5 0 0 1 -5,5 h-26 a5,5 0 0 1 -5,-5 v-14 a4,4 0 0 1 4,-4 Z" fill={PAPER_D} />
      {/* 墨(水位) */}
      <g>
        <rect x="82" y={y} width="36" height={150 - y} rx="3" fill={streakLit ? "#4A4034" : INKWELL} />
        <ellipse cx="100" cy={y} rx="18" ry="2.6" fill={e >= 0.999 ? GOLD : "#57503F"} />
        {e >= 0.999 && <path d="M90,144 q5,-4 10,0 q5,4 10,0" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" opacity="0.8" />}
      </g>
      {/* 池沿高光 */}
      <path d="M88,126.5 q12,-2.5 24,0" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* 小印章(朱砂点缀) */}
      <rect x="122" y="121" width="11" height="11" rx="2.5" fill={CINNABAR} stroke={CINNABAR_D} strokeWidth="1.8" />
      <path d="M125.5,124.5 h4 M125.5,127.5 h4 M127.5,124 v6" stroke={PAPER} strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

function inkMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M91,77 Q100,74.5 109,77 Q111,86 100,89.5 Q89,86 91,77 Z M96,79.5 Q100,81.5 104,79.5 Q103,84 100,85.5 Q97,84 96,79.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,79 Q100,76.8 110,79 Q110.8,85.2 100,86.4 Q89.2,85.2 90,79 Z" fill={p.ink} />;
    case "I":
      return <path d="M90.5,81.4 Q100,80 109.5,81.4 Q110,84.8 100,85.4 Q90,84.8 90.5,81.4 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,75.5 C105.5,75.5 108,80 108,83 C108,86.6 104.8,89.6 100,89.6 C95.2,89.6 92,86.6 92,83 C92,80 94.5,75.5 100,75.5 Z M100,79.6 C102.6,79.6 104.2,81.1 104.2,83 C104.2,85 102.5,86.2 100,86.2 C97.5,86.2 95.8,85 95.8,83 C95.8,81.1 97.4,79.6 100,79.6 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,76 C103.2,76 105.2,79.6 105.2,83 C105.2,86.4 103.2,89 100,89 C96.8,89 94.8,86.4 94.8,83 C94.8,79.6 96.8,76 100,76 Z M100,79.6 C101.4,79.6 102.3,81.1 102.3,83 C102.3,85 101.4,86.2 100,86.2 C98.6,86.2 97.7,85 97.7,83 C97.7,81.1 98.6,79.6 100,79.6 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:宽笔锋横抹 + 纸白齿缝(飞白)
      return (
        <g>
          <path d="M88,80.2 Q100,78.6 112,80.2 Q112.6,85.8 100,86.4 Q87.4,85.8 88,80.2 Z" fill={p.ink} />
          <path d="M91.5,80.8 L96.5,80.5 L95.8,84.6 L92,84.4 Z" fill="#F7F2E6" />
          <path d="M99,80.4 L104.5,80.4 L104,84.7 L99.4,84.6 Z" fill="#F7F2E6" opacity="0.9" />
          <path d="M107,80.6 L110.4,80.8 L109.8,84.4 L107.4,84.3 Z" fill="#F7F2E6" opacity="0.72" />
        </g>
      );
    case "L":
      // 舌尖:笔画开口 + 朱砂舌顶上齿龈
      return (
        <g>
          <path d="M91,77 Q100,74.5 109,77 Q111,86 100,89.5 Q89,86 91,77 Z M96,79.5 Q100,81.5 104,79.5 Q103,84 100,85.5 Q97,84 96,79.5 Z" fill={p.ink} fillRule="evenodd" />
          <path d="M96.2,85.6 Q100,78.6 103.8,85.6 Q100,87.9 96.2,85.6 Z" fill="#E8543F" stroke={p.ink} strokeWidth="1.3" strokeLinejoin="round" />
        </g>
      );
    case "FV":
      // 咬唇:墨条上牙咬宣纸下唇
      return (
        <g>
          <path d="M93.5,80.6 Q100,78.2 106.5,80.6 Q107,86.2 100,87 Q93,86.2 93.5,80.6 Z" fill="#DCD2B8" stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M94,79.2 Q100,77.2 106,79.2 L105.4,82.5 Q100,83.6 94.6,82.5 Z" fill="#3A342A" stroke={p.ink} strokeWidth="1.3" strokeLinejoin="round" />
        </g>
      );
    default:
      return <path d="M91,81.8 Q100,88.6 109,81.4" fill="none" stroke={p.ink} strokeWidth="4.2" strokeLinecap="round" />;
  }
}

export function InkArt({ uid, refs, expression, viseme, openScale, energyRatio, streakLit }: FormArtProps) {
  const flags = faceFlags(expression);
  return (
    <>
      <defs>
        <clipPath id={`${uid}-body`}><rect x="62" y="110" width="76" height="50" rx="10" /></clipPath>
        <clipPath id={`${uid}-helm`}><path d="M54,44 L100,30 L146,44 L150,72 L142,96 L58,96 L50,72 Z" /></clipPath>
        <clipPath id={`${uid}-scr`}><rect x="64" y="54" width="72" height="34" rx="5" /></clipPath>
      </defs>
      <g ref={refs.bot} className="cp-bot">
        {/* 墨雾尾焰(书卷悬浮;streak=金墨) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : SCREEN_D} opacity="0.4" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : SCREEN_D} />
        </g>
        <path d="M88,158 L112,158 L106,171 L94,171 Z" fill={INKWELL} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
        {/* 砚台躯干 + cel 错位暗面 + 墨池核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <rect x="62" y="110" width="76" height="50" rx="10" fill={PAPER_D} />
            <rect x="62" y="110" width="76" height="50" rx="10" fill={PAPER} transform="translate(-4 -4)" />
          </g>
          <rect x="62" y="110" width="76" height="50" rx="10" fill="none" stroke={OUT} strokeWidth="5" />
          <BevelPlate id={`${uid}-body`} x={62} y={110} w={76} h={50} t={4} light="rgba(255,255,255,0.5)" dark="rgba(58,52,42,0.32)" />
          <InkCore energyRatio={energyRatio} streakLit={streakLit} />
        </g>

        <g ref={refs.head} className="cp-head">
          {/* 悬笔天线:一支笔;streak=笔尖蘸朱砂(落款) */}
          <g className="cp-antenna">
            <rect x="38" y="42" width="5" height="20" rx="2.5" fill={PAPER} stroke={OUT} strokeWidth="3" transform="rotate(14 40 52)" />
            <path d="M41,56 Q43,62 40,66 Q37,62 39,56 Z" fill={streakLit ? CINNABAR : INKWELL} stroke={OUT} strokeWidth="2.6" strokeLinejoin="round" transform="rotate(14 40 60)" />
            {streakLit && <circle cx="38" cy="68" r="3.4" fill={CINNABAR} stroke={CINNABAR_D} strokeWidth="2" />}
          </g>
          {/* 书轴耳舱 */}
          <rect x="38" y="58" width="13" height="26" rx="3" fill={BEZEL} stroke={OUT} strokeWidth="4" />
          <path d="M44.5,60 v22" stroke={SCREEN_D} strokeWidth="2" strokeLinecap="round" />
          <rect x="149" y="58" width="13" height="26" rx="3" fill={BEZEL} stroke={OUT} strokeWidth="4" />
          <path d="M155.5,60 v22" stroke={SCREEN_D} strokeWidth="2" strokeLinecap="round" />

          {/* 方巾学帽头盔 + cel 暗面 + 帽脊 + 朱砂 glare */}
          <g clipPath={`url(#${uid}-helm)`}>
            <path d="M54,44 L100,30 L146,44 L150,72 L142,96 L58,96 L50,72 Z" fill={PAPER_D} />
            <path d="M54,44 L100,30 L146,44 L150,72 L142,96 L58,96 L50,72 Z" fill={PAPER} transform="translate(-4 -4)" />
            <path d="M100,30 L100,44" stroke={OUT} strokeWidth="2.6" />
          </g>
          <path d="M54,44 L100,30 L146,44 L150,72 L142,96 L58,96 L50,72 Z" fill="none" stroke={OUT} strokeWidth="5" strokeLinejoin="round" />
          <BevelPlate id={`${uid}-helm`} x={50} y={30} w={100} h={66} t={4} light="rgba(255,255,255,0.46)" dark="rgba(58,52,42,0.3)" />
          <path d="M62,38 Q90,32 104,36 L98,44 Q74,42 62,46 Z" fill={CINNABAR} opacity="0.85" />
          <path d="M112,36 L124,38 L118,45 L108,44 Z" fill={CINNABAR} opacity="0.45" />

          {/* 屏框 + 宣纸屏 + 玻璃色阶带(暖纸) */}
          <rect x="58" y="48" width="84" height="46" rx="8" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <rect x="64" y="54" width="72" height="34" rx="5" fill={SCREEN} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={SCREEN_D} transform="translate(0 15)" />
            {/* 宣纸帘纹 */}
            <path d="M70,56 v30 M78,56 v30 M122,56 v30 M130,56 v30" stroke={SCREEN_D} strokeWidth="1.2" opacity="0.7" />
            <path d="M118,54 L136,54 L108,88 L92,88 Z" fill="#FFFFFF" opacity="0.22" />
          </g>

          <Face expression={expression} flags={flags} refs={refs} p={INK} viseme={viseme} openScale={openScale} renderMouth={inkMouth} />
          <FaceExtras flags={flags} refs={refs} p={INK} />
        </g>
        {/* v0.17.1 arms layer above head */}
        <Arms refs={refs} armFill={PAPER_D} out={OUT} />
      </g>
    </>
  );
}
