/**
 * vehicle —— 悬浮载具 + 机械臂(共享组件,用户拍板 2026-09-12)。
 *
 * VehGroup:机械飞行平台(v2.2 从 custom-puppet 平移,类名/结构零 diff——
 * 顶/壁/底三层面 + 前沿仪表舱 + 三喷口焰,主题色全内联,veh-themes 调色)。
 *
 * VehArms:平台两缘的机械臂对,接管"原本 bot 的手臂动作"——refs.armL/armR
 * 直接挂在臂组上,壳层全部手臂行为零接线流转:逐键 WAAPI 拍打(composite add)、
 * 姿势 CSS(.cp-pose-point .cp-armL 等,rest 缺省 90° 时恰为内置调校角)。
 * 纸偶 PNG 臂与 shimeji 精灵臂都不再吃姿势(纸偶改挂 cp-puppet-arm* 私有类)。
 */
import type { FormRefs } from "./shared.js";
import type { VehTheme } from "../../../lib/companion/veh-themes.ts";

export function VehGroup({ uid, energyRatio, theme: th }: { uid: string; energyRatio: number; theme: VehTheme }) {
  return (
    <g className="cp-disc cp-veh" aria-hidden="true">
      <defs>
        {/* 顶面纵向渐变 + 侧壁横向圆柱高光 */}
        <linearGradient id={`${uid}-veh-top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={th.top[0]} />
          <stop offset="0.55" stopColor={th.top[1]} />
          <stop offset="1" stopColor={th.top[2]} />
        </linearGradient>
        <linearGradient id={`${uid}-veh-wall`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={th.wall[0]} />
          <stop offset="0.5" stopColor={th.wall[1]} />
          <stop offset="1" stopColor={th.wall[2]} />
        </linearGradient>
      </defs>
      {/* 地面光晕 */}
      <ellipse cx="100" cy="193" rx="72" ry="11" className="cp-veh-glow" style={{ fill: th.glow }} />
      {/* 三喷口 + 焰(先画,大半藏在平台后,焰从底沿探出) */}
      {[68, 100, 132].map((nx, i) => (
        <g key={nx} transform={`translate(${nx} ${i === 1 ? 187.5 : 185})`} className="cp-veh-nozzle">
          <path d="M -7 0 L 7 0 L 5 4.5 L -5 4.5 Z" className="cp-veh-nozzle-body" fill={th.nozzle} stroke={th.nozzleEdge} />
          <path d="M -4.5 4.5 Q 0 11.5 4.5 4.5 Z" className="cp-veh-flame cp-veh-flame-outer" fill={th.flameOuter} />
          <path d="M -2.4 4.5 Q 0 9 2.4 4.5 Z" className="cp-veh-flame cp-veh-flame-core" fill={th.flameCore} />
        </g>
      ))}
      {/* 底面 */}
      <ellipse cx="100" cy="183" rx="58" ry="8.5" className="cp-veh-bottom" fill={th.bottom} />
      {/* 侧壁(前带,上沿接顶面前弧,下沿接底面前弧——厚度 8) */}
      <path
        d="M 38 175 L 40 183 A 58 8.5 0 0 0 160 183 L 162 175 A 62 9 0 0 1 38 175 Z"
        className="cp-veh-wall"
        fill={`url(#${uid}-veh-wall)`}
        stroke={th.edgeWall}
      />
      {/* 通风格栅(左)与能量条(右,随 energyRatio 充能) */}
      <rect x="47" y="185.6" width="9" height="2.4" rx="1.2" className="cp-veh-vent" fill={th.vent} />
      <rect x="59" y="185.6" width="9" height="2.4" rx="1.2" className="cp-veh-vent" fill={th.vent} />
      <rect x="122" y="185.6" width="34" height="3.6" rx="1.8" className="cp-veh-energy-track" fill={th.track} />
      <rect x="122" y="185.6" width={Math.max(3, 34 * energyRatio)} height="3.6" rx="1.8" className="cp-veh-energy-fill" />
      {/* 舷灯(随主题换色,闪烁动画在 CSS) */}
      <circle cx="42" cy="180" r="2.4" className="cp-disc-lamp" style={{ fill: th.lamp }} />
      <circle cx="158" cy="180" r="2.4" className="cp-disc-lamp" style={{ fill: th.lamp }} />
      {/* 顶面(最后画,盖住壁上沿) + 内圈 + 高光条 */}
      <ellipse cx="100" cy="175" rx="62" ry="9" className="cp-veh-top" fill={`url(#${uid}-veh-top)`} stroke={th.edgeTop} />
      <ellipse cx="100" cy="175" rx="52" ry="6.5" className="cp-veh-top-inset" fill={th.inset} />
      <ellipse cx="74" cy="172.5" rx="22" ry="2.6" className="cp-veh-specular" style={{ opacity: th.specular }} />
      {/* 星尘专属:顶面撒星点(确定性坐标,一粒四角亮星) */}
      {th.stars && (
        <g className="cp-veh-stars" fill="#ffffff" aria-hidden="true">
          <circle cx="62" cy="173.4" r="0.9" />
          <circle cx="84" cy="177.2" r="0.7" opacity="0.8" />
          <circle cx="118" cy="172.8" r="0.8" opacity="0.9" />
          <circle cx="138" cy="176.4" r="0.7" opacity="0.7" />
          <path d="M 104 173.4 l 0.55 1.35 1.35 0.55 -1.35 0.55 -0.55 1.35 -0.55 -1.35 -1.35 -0.55 1.35 -0.55 Z" />
        </g>
      )}
      {/* 仪表舱:亮底玻璃圆窗 + 舱圈(浅金属圈体 + 主题描边圈);舱内均衡器自绘
          (listening/typing 点亮),击键字符由壳层 text 经 translate 落入窗内 */}
      <circle cx="100" cy="187" r="12" className="cp-veh-port-bezel" fill={th.inset} stroke={th.bezel} />
      <circle cx="100" cy="187" r="10" className="cp-veh-port-glass" fill={th.glass} />
      <g className="cp-veh-eq" aria-hidden="true">
        <rect x="93" y="181.5" width="3.2" height="11" rx="1.6" className="cp-veh-eq-bar" />
        <rect x="98.4" y="181.5" width="3.2" height="11" rx="1.6" className="cp-veh-eq-bar" />
        <rect x="103.8" y="181.5" width="3.2" height="11" rx="1.6" className="cp-veh-eq-bar" />
      </g>
    </g>
  );
}

/**
 * 机械臂对:肩座钉在平台顶面两缘(44/156, y≈171),rest 垂在平台侧后方;
 * ref 组本体不带 transform(内层 g 负责摆放),姿势 CSS/逐键 WAAPI 的 rotate
 * 以臂 bbox 的 50% 12%(≈肩点)为轴——与内置臂同一套调校角。
 */
export function VehArms({ refs, theme: th }: { refs: Pick<FormRefs, "armL" | "armR">; theme: VehTheme }) {
  return (
    <g className="cp-veh-arms" aria-hidden="true">
      {(["armL", "armR"] as const).map((side) => {
        const x = side === "armL" ? 44 : 156;
        const out = side === "armL" ? -1 : 1; // rest 弯向平台外侧
        return (
          <g key={side} ref={refs[side]} className={`cp-veh-arm cp-${side}`}>
            <g transform={`translate(${x} 171)`}>
              {/* 肩关节 */}
              <circle r="4" fill={th.bezel} stroke={th.edgeTop} strokeWidth="1.2" />
              {/* 大臂(垂微外弯)→ 肘 → 小臂(收向中线)→ 双指爪(加粗:聊天区 2x 缩水下仍可读) */}
              <path d={`M 0 0 Q ${out * 8} 10 ${out * 4.5} 19`} stroke={th.bezel} strokeWidth="5.6" strokeLinecap="round" fill="none" />
              <circle cx={out * 4.5} cy="19" r="2.8" fill={th.lamp} stroke={th.edgeTop} strokeWidth="1" />
              <path d={`M ${out * 4.5} 19 Q ${out * -2} 26 ${out * -1} 32`} stroke={th.bezel} strokeWidth="4.2" strokeLinecap="round" fill="none" />
              <path
                d={`M ${out * -3.6} 32.5 Q ${out * 0.2} 36.5 ${out * 3.6} 33`}
                stroke={th.edgeTop}
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          </g>
        );
      })}
    </g>
  );
}
