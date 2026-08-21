/**
 * forms/shared —— 五款形象共享的「生命系统接口」。
 *
 * 形象=同一 cel-shading 语法的不同物种;骨骼完全共享(同屏框坐标/同臂位/
 * 同 class 契约),确保壳(Mascot.tsx)的姿势 CSS、逐键 WAAPI、眨眼、视线、
 * 麦克风弧对每款形象零改动生效。每款形态自带:轮廓/调色/口型艺术/能量核
 * 钩子/streak 签名——个性在皮肤,生命在骨架。
 */
import type { ReactNode, RefObject } from "react";

import type { CompanionExpression, Viseme } from "../../../lib/companion/companion-core.js";

export interface FormRefs {
  bot: RefObject<SVGGElement | null>;
  head: RefObject<SVGGElement | null>;
  armL: RefObject<SVGGElement | null>;
  armR: RefObject<SVGGElement | null>;
  eyes: RefObject<SVGGElement | null>;
  pupils: RefObject<SVGGElement | null>;
  waves: RefObject<SVGGElement | null>;
}

export interface FormPalette {
  /** 墨描边(家族统一 #2B2530 系) */
  out: string;
  /** 屏上五官墨色(随屏幕明暗反转:astro 暗屏用暖白) */
  ink: string;
  /** 瞳孔高光(屏色系) */
  pupil: string;
  /** 听写声波弧色 */
  wave: string;
  crown: string;
  crownD: string;
}

export interface FormArtProps {
  uid: string;
  refs: FormRefs;
  expression: CompanionExpression;
  viseme: Viseme;
  openScale: number;
  energyRatio: number;
  streakLit: boolean;
}

export function faceFlags(e: CompanionExpression) {
  return {
    sleep: e === "sleeping",
    smile: e === "happy" || e === "cheer" || e === "proud",
    star: e === "stars" || e === "flame",
    thinking: e === "thinking",
    listening: e === "listening",
    encourage: e === "encourage",
    proud: e === "proud",
    surprised: e === "surprised",
    huffy: e === "huffy",
  };
}

/**
 * 口型宽度调制(v3 细化):同一开口度下横向收放——展唇音(E/I/SS)横宽、
 * 圆唇音(O/U)收窄,母音之间的形状差从"只有高度"升级为"高×宽"。
 * v9 辅音:SS 齿擦最宽、L 舌尖自然宽、FV 咬唇微收。
 */
const MOUTH_WIDTH: Record<Viseme, number> = {
  closed: 1,
  A: 1.06,
  E: 1.2,
  I: 1.26,
  O: 0.9,
  U: 0.84,
  SS: 1.18,
  L: 1.0,
  FV: 0.96,
};

/**
 * 屏上脸(共享几何):眨眼 scaleY 作用于眼睛组,瞳孔组吃视线 lerp,
 * 口型组随开口度缩放。表情 key 变化重挂载 → cp-face-pop 弹跳盖住硬切。
 * 口型艺术每款自带(renderMouth)。
 */
export function Face({
  expression,
  flags,
  refs,
  p,
  viseme,
  openScale,
  renderMouth,
}: {
  expression: CompanionExpression;
  flags: ReturnType<typeof faceFlags>;
  refs: FormRefs;
  p: FormPalette;
  viseme: Viseme;
  openScale: number;
  renderMouth: (v: Viseme, p: FormPalette) => ReactNode;
}) {
  const strokeMouth = viseme === "closed";
  return (
    <g key={expression} className="cp-face cp-face-pop" transform={flags.thinking ? "translate(-1.5 -1)" : undefined}>
      <g ref={refs.eyes} className="cp-eyes" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {flags.sleep ? (
          <>
            <path d="M77,68 h14" stroke={p.ink} strokeWidth="4" strokeLinecap="round" />
            <path d="M109,68 h14" stroke={p.ink} strokeWidth="4" strokeLinecap="round" />
          </>
        ) : flags.smile ? (
          <>
            <path d="M77,71 Q84,62 91,71" fill="none" stroke={p.ink} strokeWidth="4.5" strokeLinecap="round" />
            <path d="M109,71 Q116,62 123,71" fill="none" stroke={p.ink} strokeWidth="4.5" strokeLinecap="round" />
          </>
        ) : flags.star ? (
          <g className="cp-star-tw">
            <path d="M84,60 L86.2,66 L92,68.2 L86.2,70.4 L84,76.4 L81.8,70.4 L76,68.2 L81.8,66 Z" fill={p.crown} stroke={p.crownD} strokeWidth="1.5" />
            <path d="M116,60 L118.2,66 L124,68.2 L118.2,70.4 L116,76.4 L113.8,70.4 L108,68.2 L113.8,66 Z" fill={p.crown} stroke={p.crownD} strokeWidth="1.5" />
          </g>
        ) : (
          <>
            <rect x={flags.surprised ? "75" : "76"} y={flags.surprised ? "59" : flags.listening ? "61" : "62"} width={flags.surprised ? "18" : "16"} height={flags.surprised ? "17" : flags.listening ? "15" : "13"} rx="6" fill={p.ink} />
            <rect x={flags.surprised ? "107" : "108"} y={flags.surprised ? "59" : flags.listening ? "61" : "62"} width={flags.surprised ? "18" : "16"} height={flags.surprised ? "17" : flags.listening ? "15" : "13"} rx="6" fill={p.ink} />
            <g ref={refs.pupils} className="cp-pupils">
              <rect x="82" y={flags.surprised ? "64" : "66"} width="4.5" height="5.5" rx="1.5" fill={p.pupil} />
              <rect x="114" y={flags.surprised ? "64" : "66"} width="4.5" height="5.5" rx="1.5" fill={p.pupil} />
            </g>
          </>
        )}
      </g>
      <g
        className="cp-mouth"
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          transform: strokeMouth ? undefined : `scale(${(MOUTH_WIDTH[viseme] * (0.72 + openScale * 0.28)).toFixed(3)}, ${(0.72 + openScale * 0.28).toFixed(3)})`,
        }}
      >
        {renderMouth(viseme, p)}
      </g>
    </g>
  );
}

/** 表情挂件(共享几何,调色随形态):思考眉/听写声波/汗滴/zzz/加冕金冠。 */
export function FaceExtras({
  flags,
  refs,
  p,
}: {
  flags: ReturnType<typeof faceFlags>;
  refs: FormRefs;
  p: FormPalette;
}) {
  return (
    <>
      {flags.thinking && (
        <>
          <rect x="68" y="42" width="22" height="5" rx="2.5" fill={p.out} transform="rotate(10 79 44)" />
          <rect x="110" y="42" width="22" height="5" rx="2.5" fill={p.out} transform="rotate(-10 121 44)" />
        </>
      )}
      {flags.listening && (
        <g ref={refs.waves} className="cp-waves-wrap">
          <g stroke={p.wave} strokeWidth="3" fill="none" strokeLinecap="round" className="cp-waves">
            <path d="M168,64 a10,10 0 0 1 0,16" />
            <path d="M174,60 a16,16 0 0 1 0,24" opacity="0.66" />
            <path d="M180,56 a22,22 0 0 1 0,32" opacity="0.4" />
          </g>
        </g>
      )}
      {flags.encourage && (
        <path d="M156,44 C160,50 160,55 156,57 C152,55 152,50 156,44 Z" fill={p.wave} stroke={p.out} strokeWidth="2" className="cp-sweat" />
      )}
      {flags.huffy && (
        /* 鼓脸生气:两颊吹起(被扔出去后飞回来的余怒) */
        <g className="cp-huffy">
          <circle cx="66" cy="92" r="7.5" fill={p.wave} opacity="0.5" stroke={p.out} strokeWidth="1.5" />
          <circle cx="134" cy="92" r="7.5" fill={p.wave} opacity="0.5" stroke={p.out} strokeWidth="1.5" />
        </g>
      )}
      {flags.sleep && (
        <g className="cp-zzz" stroke={p.ink} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M150,34 h9 l-9,9 h9" />
          <path d="M166,24 h7 l-7,7 h7" opacity="0.7" />
          <path d="M179,16 h5 l-5,5 h5" opacity="0.45" />
        </g>
      )}
      {flags.proud && (
        <g>
          <path d="M108,30 L112,12 L120,24 L128,8 L136,24 L144,12 L148,30 Z" fill={p.crown} stroke={p.crownD} strokeWidth="3" strokeLinejoin="round" />
          <circle cx="128" cy="24" r="3" fill={p.wave} stroke={p.crownD} strokeWidth="1.5" />
        </g>
      )}
    </>
  );
}
/* v0.17.1 地影组件删除:整身投影改 CSS drop-shadow 跟随剪影(见 index.css),
   中/右栏模糊抽象影子+左栏天空无影;椭圆地影不再需要。 */

/** 白手套手臂(共享锚位:姿势 CSS/逐键 WAAPI 对全家族零改动)。 */
/** 块面伪 3D 倒角板(R-06 blk 风):底色板上叠左上受光棱 + 右下背光棱,硬边零渐变。
 *  inverted=true 反转棱向(凹槽感:屏幕/嵌板内退缩)。t=棱厚;clip 需与板同形(调用方在 defs 里备好)。 */
export function BevelPlate({ id, x, y, w, h, t = 5, inverted = false, light: lightOverride, dark: darkOverride }: {
  id: string; x: number; y: number; w: number; h: number; t?: number; inverted?: boolean;
  /** v11 主题倒角:各形态自带受光/背光色(缺省=通用白/墨) */
  light?: string; dark?: string;
}) {
  const light = lightOverride ?? (inverted ? "rgba(8,16,30,0.55)" : "rgba(255,255,255,0.5)");
  const dark = darkOverride ?? (inverted ? "rgba(255,255,255,0.3)" : "rgba(20,16,28,0.42)");
  return (
    <g clipPath={`url(#${id})`}>
      <path d={`M${x},${y} H${x + w} V${y + t} H${x + t} V${y + h} H${x} Z`} fill={light} />
      <path d={`M${x + w - t},${y} H${x + w} V${y + h} H${x} V${y + h - t} H${x + w - t} Z`} fill={dark} />
    </g>
  );
}

export function Arms({
  refs,
  armFill,
  out,
  glove = "#FFFFFF",
}: {
  refs: FormRefs;
  armFill: string;
  out: string;
  glove?: string;
}) {
  return (
    <>
      <g ref={refs.armL} className="cp-arm cp-armL">
        <rect x="47" y="113" width="19" height="30" rx="9.5" fill={armFill} stroke={out} strokeWidth="4" />
        <circle cx="56.5" cy="146" r="8.5" fill={glove} stroke={out} strokeWidth="4" />
      </g>
      <g ref={refs.armR} className="cp-arm cp-armR">
        <rect x="134" y="113" width="19" height="30" rx="9.5" fill={armFill} stroke={out} strokeWidth="4" />
        <circle cx="143.5" cy="146" r="8.5" fill={glove} stroke={out} strokeWidth="4" />
      </g>
    </>
  );
}
