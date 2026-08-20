/**
 * 形态·霜绒(Frost)——冰晶守望机,冷静沉稳的学者气质。
 *
 * 家族语法在冰的材质上重铸:多面体头盔(切角王冠)+ 肩部冰棱 + 六瓣
 * 冰晶能量核(XP 逐瓣点亮,如霜花凝结)+ 晶簇天线(streak=鎏金晶簇)。
 * 口型=切角母音块(硬朗冰感)。冷调:冰川蓝×白 glare,屏面近白浮冰色。
 */
import type { FormPalette, FormArtProps } from "./shared.js";
import { Arms, Face, FaceExtras, GroundShadow, faceFlags, Shoulders, BevelPlate } from "./shared.js";
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

function frostMouth(v: Viseme, p: FormPalette) {
  switch (v) {
    case "A":
      return <path d="M92,77 L108,77 L113,81 L108,89 L92,89 L87,81 Z M95,80 L105,80 L105,86 L95,86 Z" fill={p.ink} fillRule="evenodd" />;
    case "E":
      return <path d="M90,79 L110,79 L113,82 L110,85 L90,85 L87,82 Z" fill={p.ink} />;
    case "I":
      return <path d="M90,81 L110,81 L111.5,82.8 L110,84.6 L90,84.6 L88.5,82.8 Z" fill={p.ink} />;
    case "O":
      return <path d="M100,75 L106,82 L100,90 L94,82 Z M100,79 L102.8,82 L100,85.4 L97.2,82 Z" fill={p.ink} fillRule="evenodd" />;
    case "U":
      return <path d="M100,75.5 L104,82 L100,89 L96,82 Z M100,79.5 L101.8,82 L100,84.6 L98.2,82 Z" fill={p.ink} fillRule="evenodd" />;
    case "SS":
      // 齿擦:宽冰槽 + 白牙 facets(冰晶切面感)
      return (
        <g>
          <path d="M87,80 L113,80 L111.5,84.5 L88.5,84.5 Z" fill={p.ink} />
          <path d="M90,80.4 L96,80.4 L94.6,84.1 L91,84.1 Z" fill="#FFFFFF" />
          <path d="M98.5,80.4 L104,80.4 L103,84.1 L99,84.1 Z" fill="#FFFFFF" opacity="0.9" />
          <path d="M106.5,80.4 L110.6,80.4 L109.6,84.1 L107,84.1 Z" fill="#FFFFFF" opacity="0.75" />
        </g>
      );
    case "L":
      // 舌尖:切角开口 + 冰舌顶上齿龈
      return (
        <g>
          <path d="M92,77 L108,77 L113,81 L108,89 L92,89 L87,81 Z M95,80 L105,80 L105,86 L95,86 Z" fill={p.ink} fillRule="evenodd" />
          <path d="M95.5,85.5 L100,78.5 L104.5,85.5 Q100,87.8 95.5,85.5 Z" fill="#BFF3FF" stroke={p.ink} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      );
    case "FV":
      // 咬唇:白牙带咬冰蓝下唇
      return (
        <g>
          <path d="M93,80.5 Q100,77.8 107,80.5 Q107.5,86.2 100,87 Q92.5,86.2 93,80.5 Z" fill="#7CC4DC" stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M93.5,79 L106.5,79 L105.8,82.6 L94.2,82.6 Z" fill="#FFFFFF" stroke={p.ink} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      );
    default:
      return <path d="M92,83 L100,86.5 L108,83" fill="none" stroke={p.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />;
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

      <GroundShadow tint="rgba(24,34,48,0.32)" />

      <g ref={refs.bot} className="cp-bot">
        {/* 冰晶尾气(冷焰;streak=鎏金) */}
        <g className="cp-thrust">
          <ellipse cx="100" cy="177" rx="11" ry="8" fill={streakLit ? GOLD : CRYSTAL} opacity="0.35" />
          <ellipse cx="100" cy="176" rx="7" ry="5" fill={streakLit ? GOLD : CRYSTAL} />
        </g>
        <path d="M90,158 L110,158 L104,171 L96,171 Z" fill="#2E3A4A" stroke={OUT} strokeWidth="4" strokeLinejoin="round" />

        {/* 肩部冰棱(角朝外,守望者的甲) */}
        <path d="M60,112 L48,100 L52,120 Z" fill={ICE_D} stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M140,112 L152,100 L148,120 Z" fill={ICE_D} stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />

        <Shoulders fill={ICE} fillDark={ICE_D} out={OUT} />
        <Arms refs={refs} armFill={ICE_D} out={OUT} />

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

          <Face expression={expression} flags={flags} refs={refs} p={FROST} viseme={viseme} openScale={openScale} renderMouth={frostMouth} />
          <FaceExtras flags={flags} refs={refs} p={FROST} />
        </g>
      </g>
    </>
  );
}
