/**
 * 形态·墨墨(Ink)——砚上学者机,书房里的沉静气质。
 *
 * 家族语法的文人转译:身=砚台(胸口墨池=能量核,今日 XP 越高墨越满,
 * 满时浮起金墨涟漪),头=方巾学帽,天线=一支悬笔(streak=笔尖落款
 * 朱砂),屏=宣纸(家族唯一暖纸色屏),胸口小印章做点缀。口型=毛笔
 * 笔触(圆头粗描,起收笔圆润)。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags , BevelPlate, CrownMark  } from "./shared.js";
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

/** 口型(v0.18 机器人化+屏内化,y≤86):笔画语言保留,朱砂舌/宣纸唇换屏光件
 *  ——舌=发光音素条(p.pupil),齿=飞白刻度,咬唇=墨条压光。 */
function inkMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M91,74 Q100,71.5 109,74 Q111,83 100,86.5 Q89,83 91,74 Z M96,76.5 Q100,78.5 104,76.5 Q103,81 100,82.5 Q97,81 96,76.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,76 Q100,73.8 110,76 Q110.8,82.2 100,83.4 Q89.2,82.2 90,76 Z" fill={p.ink} />;
    case "I":
      return <path d="M90.5,78.4 Q100,77 109.5,78.4 Q110,81.8 100,82.4 Q90,81.8 90.5,78.4 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,72.5 C105.5,72.5 108,77 108,80 C108,83.6 104.8,86.6 100,86.6 C95.2,86.6 92,83.6 92,80 C92,77 94.5,72.5 100,72.5 Z M100,77 C102.6,77 104.2,78.5 104.2,80.5 C104.2,82.5 102.5,83.7 100,83.7 C97.5,83.7 95.8,82.5 95.8,80.5 C95.8,78.5 97.4,77 100,77 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,73 C103.2,73 105.2,76.6 105.2,80 C105.2,83.4 103.2,86 100,86 C96.8,86 94.8,83.4 94.8,80 C94.8,76.6 96.8,73 100,73 Z M100,76.8 C101.4,76.8 102.3,78.3 102.3,80.3 C102.3,82.3 101.4,83.5 100,83.5 C98.6,83.5 97.7,82.3 97.7,80.3 C97.7,78.3 98.6,76.8 100,76.8 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:宽笔锋横抹 + 飞白刻度齿列(非人类牙块)
      return (
        <g>
          <path d="M88,77.2 Q100,75.6 112,77.2 Q112.6,82.8 100,83.4 Q87.4,82.8 88,77.2 Z" fill={p.ink} />
          <path d="M91.5,77.8 L96.3,77.6 L95.7,81.6 L92.1,81.5 Z" fill="#F7F2E6" />
          <path d="M99,77.6 L104.3,77.6 L103.8,81.7 L99.3,81.6 Z" fill="#F7F2E6" opacity="0.9" />
          <path d="M107,77.7 L110.3,77.9 L109.7,81.5 L107.3,81.4 Z" fill="#F7F2E6" opacity="0.72" />
        </g>
      );
    case "L":
      // 舌尖:笔画开口 + 发光音素条顶上齿龈(屏光"舌",非朱砂肉)
      return (
        <g>
          <path d="M91,74 Q100,71.5 109,74 Q111,83 100,86.5 Q89,83 91,74 Z M96,76.5 Q100,78.5 104,76.5 Q103,81 100,82.5 Q97,81 96,76.5 Z" fill={p.ink} fillRule="evenodd" />
          <rect x="96.2" y="77.2" width="7.6" height="3" rx="1.5" fill={p.pupil} />
          <rect x="98" y="77.9" width="4" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.9" />
        </g>
      );
    case "FV":
      // 咬唇:墨条齿带下压发光条=快门"咬"住光(非宣纸唇)
      return (
        <g>
          <path d="M93.5,77 Q100,74.6 106.5,77 Q107,82.6 100,83.4 Q93,82.6 93.5,77 Z" fill={p.ink} />
          <path d="M94,76.6 Q100,74.8 106,76.6 L105.4,79.6 Q100,80.6 94.6,79.6 Z" fill="#3A342A" />
          <rect x="95.5" y="80.6" width="9" height="2.5" rx="1.25" fill={p.pupil} />
        </g>
      );
    default:
      return <path d="M91,78.8 Q100,85.6 109,78.4" fill="none" stroke={p.ink} strokeWidth="4.2" strokeLinecap="round" />;
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

          {/* v0.18 脸=屏幕渲染:表情整体剪进屏幕,任何元素构造上不可能越出屏框 */}
          <g className="cp-scr-face" clipPath={`url(#${uid}-scr)`}>
            <Face expression={expression} flags={flags} refs={refs} p={INK} viseme={viseme} openScale={openScale} renderMouth={inkMouth} />
            <FaceExtras flags={flags} refs={refs} p={INK} />
          </g>
        </g>
          {flags.proud && <CrownMark p={INK} />}
        {/* v0.18 arms layer above head */}
        <Arms refs={refs} armFill={PAPER_D} out={OUT} />
      </g>
    </>
  );
}
