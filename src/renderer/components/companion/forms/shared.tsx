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
  /* 竖线眼:全表情统一竖圆棒(EVE 式冷萌机器脸),情绪靠棒的长短/倾角/浓度传;
   * 圆角矩形瞳孔眼/上弧笑眼/横线睡眼/星形眼退役。棒渲染进 cp-pupils 组 →
   * 壳的视线 lerp 变成整眼平移(眼神跟随),眨眼 scaleY 仍作用外层
   * cp-eyes 组,两套生命机制对竖线眼照常生效。 */
  const bar = (x: number, y: number, len: number, opt?: { tilt?: number; w?: number; op?: number }) => (
    <path
      d={`M${x},${y} v${len}`}
      stroke={p.ink}
      strokeWidth={opt?.w ?? 5}
      strokeLinecap="round"
      opacity={opt?.op ?? 1}
      transform={opt?.tilt ? `rotate(${opt.tilt} ${x} ${y + len / 2})` : undefined}
    />
  );
  return (
    <g key={expression} className="cp-face cp-face-pop" transform={flags.thinking ? "translate(-1.5 -1)" : undefined}>
      <g ref={refs.eyes} className="cp-eyes" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {flags.sleep ? (
          /* 睡:两粒短淡竖点(旧横线睡眼退役) */
          <>
            {bar(84, 63.5, 4, { w: 4.5, op: 0.55 })}
            {bar(116, 63.5, 4, { w: 4.5, op: 0.55 })}
          </>
        ) : flags.smile ? (
          /* 笑(^_^):竖棒弯成上拱弧——竖线的弯曲变形,弧顶即笑意 */
          <>
            <path d="M78,68 Q84,60.5 90,68" fill="none" stroke={p.ink} strokeWidth="5" strokeLinecap="round" />
            <path d="M110,68 Q116,60.5 122,68" fill="none" stroke={p.ink} strokeWidth="5" strokeLinecap="round" />
          </>
        ) : flags.star ? (
          /* 星星眼:竖棒本体 + 棒旁小星芒(star-tw 闪动挂件保留) */
          <>
            <g ref={refs.pupils} className="cp-pupils">
              {bar(84, 58.5, 13)}
              {bar(116, 58.5, 13)}
            </g>
            <g className="cp-star-tw">
              <path d="M72,60 l1.7,3.4 3.4,1.7 -3.4,1.7 -1.7,3.4 -1.7,-3.4 -3.4,-1.7 3.4,-1.7 Z" fill={p.crown} stroke={p.crownD} strokeWidth="1.2" />
              <path d="M128,60 l1.7,3.4 3.4,1.7 -3.4,1.7 -1.7,3.4 -1.7,-3.4 -3.4,-1.7 3.4,-1.7 Z" fill={p.crown} stroke={p.crownD} strokeWidth="1.2" />
            </g>
          </>
        ) : flags.huffy ? (
          /* 无语(-_-):竖棒整体旋横 90°——鼓脸余怒的"懒得看你" */
          <g ref={refs.pupils} className="cp-pupils">
            <path d="M78,65 h12" stroke={p.ink} strokeWidth="5" strokeLinecap="round" />
            <path d="M110,65 h12" stroke={p.ink} strokeWidth="5" strokeLinecap="round" />
          </g>
        ) : (
          <g ref={refs.pupils} className="cp-pupils">
            {flags.surprised
              ? /* 惊:拉长收细 */
                <>
                  {bar(84, 56.5, 18, { w: 4.5 })}
                  {bar(116, 56.5, 18, { w: 4.5 })}
                </>
              : flags.thinking
                ? /* 思考:左短右长不对称(配合思考眉) */
                  <>
                    {bar(84, 61.5, 9)}
                    {bar(116, 58.5, 13)}
                  </>
                : /* 常态/说话/聆听/鼓励/鼓脸:标准双竖棒 */
                  <>
                    {bar(84, 58.5, flags.listening ? 12.5 : 13)}
                    {bar(116, 58.5, flags.listening ? 12.5 : 13)}
                  </>
                }
          </g>
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

/** 表情挂件(v0.18 全部收进头部屏幕内——脸=屏幕渲染,是机器人身份的一部分;
 * 表情互斥,同屏只渲染一支,坐标只避开常驻眼睛区)。皇冠是头顶实体徽章,
 * 不属于屏幕表情,留在屏外。 */
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
        /* 思考眉:屏内眼上,细圆棒(旧版在屏外盔额上,用户点名要进屏) */
        <>
          <rect className="cp-brow" x="70" y="55" width="19" height="3.6" rx="1.8" fill={p.ink} transform="rotate(9 79.5 56.8)" />
          <rect className="cp-brow" x="111" y="55" width="19" height="3.6" rx="1.8" fill={p.ink} transform="rotate(-9 120.5 56.8)" />
        </>
      )}
      {flags.listening && (
        <g ref={refs.waves} className="cp-waves-wrap">
          <g stroke={p.wave} strokeWidth="2.6" fill="none" strokeLinecap="round" className="cp-waves">
            <path d="M130,62 a8,8 0 0 1 0,14" />
            <path d="M134,59.5 a12,12 0 0 1 0,19" opacity="0.66" />
            <path d="M138,57 a16,16 0 0 1 0,24" opacity="0.4" />
          </g>
        </g>
      )}
      {flags.encourage && (
        <path d="M129,56 C131.6,60 131.6,63 129,64.6 C126.4,63 126.4,60 129,56 Z" fill={p.wave} stroke={p.ink} strokeWidth="1.6" className="cp-sweat" />
      )}
      {flags.huffy && (
        /* 鼓脸生气:屏底两角蒸汽团(屏内版;避开中央口型区) */
        <g className="cp-huffy">
          <circle cx="69.5" cy="82" r="4.6" fill={p.wave} opacity="0.45" stroke={p.ink} strokeWidth="1.3" />
          <circle cx="130.5" cy="82" r="4.6" fill={p.wave} opacity="0.45" stroke={p.ink} strokeWidth="1.3" />
        </g>
      )}
      {flags.sleep && (
        <g className="cp-zzz" stroke={p.ink} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M126,58 h6 l-6,6 h6" />
          <path d="M134.5,52 h4 l-4,4 h4" opacity="0.7" />
        </g>
      )}
    </>
  );
}

/** 加冕金冠(毕业得意态):头顶实体徽章,不属于屏幕表情——在屏内剪裁组**外**渲染。 */
export function CrownMark({ p }: { p: FormPalette }) {
  return (
    <g>
      <path d="M108,30 L112,12 L120,24 L128,8 L136,24 L144,12 L148,30 Z" fill={p.crown} stroke={p.crownD} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="128" cy="24" r="3" fill={p.wave} stroke={p.crownD} strokeWidth="1.5" />
    </g>
  );
}
/* v0.18 地影组件删除:整身投影改 CSS drop-shadow 跟随剪影(见 index.css),
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
