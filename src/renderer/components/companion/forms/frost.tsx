/**
 * 形态·霜绒(Frost)——冰晶守望机,冷静沉稳的学者气质。
 *
 * 家族语法在冰的材质上重铸:多面体头盔(切角王冠)+ 肩部冰棱 + 六瓣
 * 冰晶能量核(XP 逐瓣点亮,如霜花凝结)+ 晶簇天线(streak=鎏金晶簇)。
 * 口型=切角母音块(硬朗冰感)。冷调:冰川蓝×白 glare,屏面近白浮冰色。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, faceFlags, BevelPlate, CrownMark  } from "./shared.js";
import type { Viseme } from "../../../lib/companion/companion-core.js";

export const FROST: FormPalette = {
  out: "#232B3A",
  ink: "#1C4E63",
  pupil: "#A8E4F0",
  wave: "#7FD1E8",
  crown: "#FFD75E",
  crownD: "#D9A400",
};
const ICE = "#C9EEF7";
const ICE_D = "#7CC4DC";
const SCREEN = "#EAF9FD";
const SCREEN_D = "#C4E9F2";
const BEZEL = "#2E4A5E";
const CRYSTAL = "#BFF3FF";
const CRYSTAL_OFF = "#6FA9BD";
const GOLD = "#FFD75E";
const OUT = "#232B3A";

/** 六瓣冰晶核:lit 数 = round(energyRatio*6),逐瓣凝结。 */
function CrystalCore({ energyRatio, uid }: { energyRatio: number; uid: string }) {
  const lit = Math.round(Math.min(1, Math.max(0, energyRatio)) * 6);
  const seg = (i: number) => {
    const a0 = (i * 60 - 90) * (Math.PI / 180);
    const a1 = ((i + 1) * 60 - 90) * (Math.PI / 180);
    const r0 = 4.5;
    const r1 = 11.5;
    return `M${(100 + Math.cos(a0) * r0).toFixed(1)},${(135 + Math.sin(a0) * r0).toFixed(1)}
      L${(100 + Math.cos(a0) * r1).toFixed(1)},${(135 + Math.sin(a0) * r1).toFixed(1)}
      L${(100 + Math.cos((a0 + a1) / 2) * (r1 - 1)).toFixed(1)},${(135 + Math.sin((a0 + a1) / 2) * (r1 - 1)).toFixed(1)}
      L${(100 + Math.cos(a1) * r1).toFixed(1)},${(135 + Math.sin(a1) * r1).toFixed(1)}
      L${(100 + Math.cos(a1) * r0).toFixed(1)},${(135 + Math.sin(a1) * r0).toFixed(1)} Z`;
  };
  return (
    <g>
      <path d="M100,117 L114,135 L100,153 L86,135 Z" fill={BEZEL} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} d={seg(i)} fill={i < lit ? CRYSTAL : CRYSTAL_OFF} stroke={OUT} strokeWidth="1.4" strokeLinejoin="round" opacity={i < lit ? 1 : 0.55} />
      ))}
      <circle cx="100" cy="135" r="3.2" fill={lit >= 6 ? GOLD : CRYSTAL} stroke={OUT} strokeWidth="1.6" />
      <path d="M94,124 L98,119" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      <rect x="0" y="0" width="0" height="0" fill="none" data-uid={uid} />
    </g>
  );
}

/** 口型(v0.18 机器人化+屏内化,y≤86):切角语言保留," fleshy"件换屏光件
 *  ——冰舌→发光音素条(p.pupil),牙→切面刻度,咬唇→快门压光。 */
function frostMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M92,74.5 L108,74.5 L113,78.5 L108,85.5 L92,85.5 L87,78.5 Z M95,77.5 L105,77.5 L105,83.5 L95,83.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,76.5 L110,76.5 L113,80 L110,83.5 L90,83.5 L87,80 Z" fill={p.ink} />;
    case "I":
      return <path d="M90,79 L110,79 L111.5,80.8 L110,82.6 L90,82.6 L88.5,80.8 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,73.5 L106,80.5 L100,86 L94,80.5 Z M100,77.5 L102.8,80.5 L100,83.4 L97.2,80.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,74 L104,80.5 L100,85.5 L96,80.5 Z M100,78 L101.8,80.5 L100,83 L98.2,80.5 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:宽冰槽 + 切面刻度齿列(非人类牙块)
      return (
        <g>
          <path d="M86,76 L114,76 L112.5,82.6 L87.5,82.6 Z" fill={p.ink} />
          <path d="M90,76.4 L95.4,76.4 L94.4,82.2 L91.2,82.2 Z" fill="#FFFFFF" />
          <path d="M98,76.4 L103,76.4 L102.2,82.2 L99,82.2 Z" fill="#FFFFFF" opacity="0.9" />
          <path d="M105.6,76.4 L110.4,76.4 L109.4,82.2 L106.4,82.2 Z" fill="#FFFFFF" opacity="0.75" />
        </g>
      );
    case "L":
      // 舌尖:切角开口 + 发光音素条顶上齿龈(屏光"舌")
      return (
        <g>
          <path d="M92,74.5 L108,74.5 L113,78.5 L108,85.5 L92,85.5 L87,78.5 Z M95,77.5 L105,77.5 L105,83.5 L95,83.5 Z" fill={p.ink} fillRule="evenodd" />
          <rect x="96" y="78" width="8" height="3.2" rx="1.6" fill={p.pupil} />
          <rect x="98" y="78.8" width="4" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.9" />
        </g>
      );
    case "FV":
      // 咬唇:切面齿条下压发光条=快门"咬"住光(非人类唇)
      return (
        <g>
          <path d="M92,74.5 L108,74.5 L112,78 L108,84.5 L92,84.5 L88,78 Z" fill={p.ink} />
          <path d="M93.5,76.2 L106.5,76.2 L105.8,79.4 L94.2,79.4 Z" fill="#FFFFFF" />
          <rect x="95.5" y="80.6" width="9" height="2.6" rx="1.3" fill={p.pupil} />
        </g>
      );
    default:
      return <path d="M92,79.5 L100,83.5 L108,79.5" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />;
  }
}

export function FrostArt({ uid, refs, expression, viseme, openScale, energyRatio, streakLit }: FormArtProps) {
  const flags = faceFlags(expression);
  return (
    <>
      <defs>
        <clipPath id={`${uid}-body`}><path d="M70,110 L130,110 L142,122 L138,156 L62,156 L58,122 Z" /></clipPath>
        <clipPath id={`${uid}-helm`}><path d="M54,40 L76,26 L124,26 L146,40 L150,64 L142,96 L58,96 L50,64 Z" /></clipPath>
        <clipPath id={`${uid}-scr`}><rect x="64" y="54" width="72" height="34" rx="6" /></clipPath>
      </defs>
      <g ref={refs.bot} className="cp-bot">
        {/* 冰晶尾气(冷焰;streak=鎏金) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : CRYSTAL} opacity="0.35" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : CRYSTAL} />
        </g>
        <path d="M90,158 L110,158 L104,171 L96,171 Z" fill="#2E3A4A" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
        {/* 多面体躯干 + cel 错位暗面 + 冰晶核 */}
        <g className="cp-body">
          <g clipPath={`url(#${uid}-body)`}>
            <path d="M70,110 L130,110 L142,122 L138,156 L62,156 L58,122 Z" fill={ICE_D} />
            <path d="M70,110 L130,110 L142,122 L138,156 L62,156 L58,122 Z" fill={ICE} transform="translate(-5 -5)" />
          </g>
          <path d="M70,110 L130,110 L142,122 L138,156 L62,156 L58,122 Z" fill="none" stroke={OUT} strokeWidth="5" strokeLinejoin="round" />
          <BevelPlate id={`${uid}-body`} x={58} y={110} w={84} h={46} t={4} light="rgba(255,255,255,0.6)" dark="rgba(24,58,82,0.4)" />
          <CrystalCore energyRatio={energyRatio} uid={uid} />
          <circle cx="74" cy="150" r="1.5" fill={OUT} opacity="0.45" />
          <circle cx="126" cy="150" r="1.5" fill={OUT} opacity="0.45" />
        </g>

        <g ref={refs.head} className="cp-head">
          {/* 晶簇天线(streak=鎏金晶簇+星芒) */}
          <g className="cp-antenna">
            <path d="M40,58 L36,38 L44,50 Z" fill={streakLit ? GOLD : CRYSTAL} stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M46,56 L46,42 L52,52 Z" fill={streakLit ? GOLD : ICE} stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
            {streakLit && <path d="M28,34 l3,-3 m-1,7 l3,-3 m-9,-1 l3,-3" stroke={GOLD} strokeWidth="2.2" strokeLinecap="round" />}
            {!streakLit && <circle cx="40" cy="38" r="8" fill={CRYSTAL} opacity="0.22" className="cp-ant-glow" />}
          </g>
          {/* 六角耳舱 */}
          <path d="M42,60 L42,84 L48,88 L54,84 L54,60 L48,56 Z" fill={SCREEN_D} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />
          <path d="M146,60 L146,84 L152,88 L158,84 L158,60 L152,56 Z" fill={SCREEN_D} stroke={OUT} strokeWidth="4" strokeLinejoin="round" />

          {/* 切角王冠头盔 + cel 暗面 + 切面高光棱线 */}
          <g clipPath={`url(#${uid}-helm)`}>
            <path d="M54,40 L76,26 L124,26 L146,40 L150,64 L142,96 L58,96 L50,64 Z" fill={ICE_D} />
            <path d="M54,40 L76,26 L124,26 L146,40 L150,64 L142,96 L58,96 L50,64 Z" fill={ICE} transform="translate(-5 -5)" />
            <path d="M60,34 L74,28 M132,28 L146,34" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
          </g>
          <path d="M54,40 L76,26 L124,26 L146,40 L150,64 L142,96 L58,96 L50,64 Z" fill="none" stroke={OUT} strokeWidth="5" strokeLinejoin="round" />
          <BevelPlate id={`${uid}-helm`} x={50} y={26} w={100} h={70} t={4} light="rgba(255,255,255,0.55)" dark="rgba(24,58,82,0.38)" />
          {/* 额头冰棱 glare */}
          <path d="M58,36 L96,36 L90,45 L54,45 Z" fill="#FFFFFF" opacity="0.9" />
          <path d="M104,36 L118,36 L112,45 L102,45 Z" fill="#FFFFFF" opacity="0.5" />

          {/* 屏框 + 冰白屏 + 玻璃色阶带 */}
          <path d="M58,48 h84 a8,8 0 0 1 8,8 v30 a8,8 0 0 1 -8,8 h-84 a8,8 0 0 1 -8,-8 v-30 a8,8 0 0 1 8,-8 Z" fill={BEZEL} stroke={OUT} strokeWidth="4.5" />
          <rect x="64" y="54" width="72" height="34" rx="6" fill={SCREEN} />
          <g clipPath={`url(#${uid}-scr)`}>
            <rect x="64" y="54" width="72" height="34" fill={SCREEN_D} transform="translate(0 15)" />
            <path d="M118,54 L136,54 L108,88 L90,88 Z" fill="#FFFFFF" opacity="0.18" />
          </g>

          {/* v0.18 脸=屏幕渲染:表情整体剪进屏幕,任何元素构造上不可能越出屏框 */}
          <g className="cp-scr-face" clipPath={`url(#${uid}-scr)`}>
            <Face expression={expression} flags={flags} refs={refs} p={FROST} viseme={viseme} openScale={openScale} renderMouth={frostMouth} />
            <FaceExtras flags={flags} refs={refs} p={FROST} />
          </g>
        </g>
          {flags.proud && <CrownMark p={FROST} />}
        {/* v0.18 arms layer above head */}
        <Arms refs={refs} armFill={ICE_D} out={OUT} />
      </g>
    </>
  );
}
