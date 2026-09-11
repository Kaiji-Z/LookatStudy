/**
 * CustomPuppetArt —— 第 6 形态:用户导入的纸偶包(CompanionPack M2,SPEC §16)。
 *
 * 与五款内置形态共用 Mascot 壳的全部生命系统:pose CSS 按 class 命中 .cp-bot/
 * .cp-head/.cp-armL/.cp-armR 后代,逐键 WAAPI 按压/ squash 走 refs;行为不是
 * 移植而是天生共享。本组件只做四件事:
 *   1. 把切分件 <image> 按 layoutParts 落位(contain 进 200×200 舞台,层序 盘<臂<身<头);
 *   2. 关节 origin 内联覆盖:臂=近躯干上角(86%/14% × 10%)、头=底中(50% 92%)——
 *      pose 旋转/拍臂绕肩/颈,不绕图片几何中心;
 *   3. HoverDisc 载具:程序化 SVG 椭圆盘(零二进制资产),纸偶站盘上悬浮;
 *   4. "转头看"(2026-09-10,替代旧的头图平移):壳的 gaze 经 companion-gaze
 *      事件广播,这里把头绕颈点(头盒底中)做 ±3.5° 倾转+≤1.2px 平移——颈点
 *      固定,头身永不分离(旧版整头平移曾出现"印度动脖子"式断层)。
 *      refs.pupils 退化为空 g(壳的整眼平移写入无害 no-op)。
 *
 * 五官表情=暂缓:eyes/waves refs 挂空 g(壳的眨眼/麦克风弧写入无害 no-op)。
 * 无激活包(或包文件丢失)→ 诚实占位剪影,不白屏。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { armRestAngleDeg } from "@shared/companion-cut.ts";

import { VEH_THEMES, type VehTheme } from "../../../lib/companion/veh-themes.ts";
import { getActivePack, subscribeActivePack } from "../../../lib/companion/custom-pack-store.js";
import type { FormArtProps } from "./shared.js";

/* 层序 身<头<臂(2026-09-10 按用户拍板调整,旧 臂<身<头 会让抬起的手被头压住):
   臂在最前=庆祝万岁/挥手/朗读指向/敲胸打字的手都可见;肩根裁切白边叠在身上,
   88px 伴学尺寸下读作玩偶缝线,可接受。sticker 恒最上。 */
const PART_ORDER: string[] = ["body", "head", "armL", "armR", "sticker"];

/** 关节 origin(相对部件图 bbox;armL 近躯干=右缘,armR=左缘)。 */
const PART_ORIGIN: Record<string, string> = {
  head: "50% 92%",
  armL: "86% 10%",
  armR: "14% 10%",
};

/** 内置姿势 CSS 的 rest 前提=竖直 90°;量测失败时回退该值(=现状行为)。 */
const FALLBACK_REST = 90;

/**
 * 载具组(v2.2):几何固定一套,颜色全部由 VehTheme 内联 —— 五款形态换装
 * 共享形状。CSS 只持动画/透明度(cp-veh-flame/glow/lamp/eq),不持颜色。
 * glow/lamp 在 CSS 有 opacity 规则,fill 走内联 style 压过(表现属性会被类规则盖)。
 */
function VehGroup({ uid, energyRatio, theme: th }: { uid: string; energyRatio: number; theme: VehTheme }) {
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

export function CustomPuppetArt({ uid, refs, energyRatio }: FormArtProps) {
  const pack = useSyncExternalStore(subscribeActivePack, getActivePack);
  const leanRef = useRef<SVGGElement | null>(null);
  const lay = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const l of pack?.layout ?? []) m.set(l.name, l);
    return m;
  }, [pack]);
  // rest 角(2026-09-10,SPEC §17.12):A-pose 臂与竖直有任意夹角,固定角姿势必然
  // 指偏——从臂部件像素量"肩原点→手尖"方向,姿势 CSS 按 目标角−var(--cp-rest)
  // 求差值。量测是确定性的(远端 2% 像素带向量均值),包不变则值不变。
  const [restDeg, setRestDeg] = useState<{ armL: number; armR: number }>({ armL: FALLBACK_REST, armR: FALLBACK_REST });
  useEffect(() => {
    if (!pack) return;
    let cancelled = false;
    const measure = (name: "armL" | "armR") =>
      new Promise<number>((resolve) => {
        const im = new Image();
        im.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = im.naturalWidth;
          cv.height = im.naturalHeight;
          const ctx = cv.getContext("2d");
          if (!ctx) return resolve(FALLBACK_REST);
          ctx.drawImage(im, 0, 0);
          let data: Uint8ClampedArray;
          try {
            data = ctx.getImageData(0, 0, cv.width, cv.height).data;
          } catch {
            return resolve(FALLBACK_REST);
          }
          const deg = armRestAngleDeg(
            { w: cv.width, h: cv.height, at: (x, y) => data[(y * cv.width + x) * 4 + 3] / 255 },
            { x: cv.width * (name === "armL" ? 0.86 : 0.14), y: cv.height * 0.1 },
          );
          resolve(deg ?? FALLBACK_REST);
        };
        im.onerror = () => resolve(FALLBACK_REST);
        im.src = pack.srcs[name] ?? "";
      });
    void Promise.all([measure("armL"), measure("armR")]).then(([l, r]) => {
      if (!cancelled) setRestDeg({ armL: l, armR: r });
    });
    return () => {
      cancelled = true;
    };
  }, [pack]);

  // "转头看":gaze(-1..1)→ 绕颈点倾转,朝向鼠标一侧;颈点=头盒底中,固定不分离
  useEffect(() => {
    const onGaze = (e: Event) => {
      const g = (e as CustomEvent<{ x: number; y: number }>).detail;
      const head = leanRef.current;
      if (!head) return;
      const hb = getActivePack()?.layout.find((l) => l.name === "head");
      const cx = hb ? hb.x + hb.w / 2 : 100;
      const cy = hb ? hb.y + hb.h * 0.92 : 170;
      const deg = Math.max(-3.5, Math.min(3.5, g.x * 2.8)) + Math.max(-1, Math.min(1, g.y * 0.8));
      head.setAttribute("transform", `rotate(${deg.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)}) translate(${(g.x * 1.2).toFixed(2)} ${(g.y * 0.7).toFixed(2)})`);
    };
    window.addEventListener("companion-gaze", onGaze);
    return () => window.removeEventListener("companion-gaze", onGaze);
  }, []);

  return (
    <g ref={refs.bot} className="cp-bot cp-puppet-bot">
      {!pack ? (
        <g className="cp-puppet-placeholder" opacity="0.45" aria-hidden="true">
          <circle cx="100" cy="68" r="36" fill="var(--surface-2, #3a3a44)" stroke="var(--border-faint, #777)" strokeWidth="3" />
          <rect x="70" y="110" width="60" height="58" rx="16" fill="var(--surface-2, #3a3a44)" stroke="var(--border-faint, #777)" strokeWidth="3" />
        </g>
      ) : (
        <>
          {/* 悬浮载具 v2.2(2026-09-11):机械飞行平台 + 五款形态主题换装
              (manifest.vehicle → veh-themes.ts 调色,缺省 silver 兼容旧包)。
              顶面贴脚线(布局底部锚定后任何素材脚都在 y≈176);顶面/侧壁/底面
              三层面(厚度 8),前沿仪表舱(舱圈+亮底玻璃+自绘均衡器+壳层击键
              字符);底部三喷口 idle 呼吸微焰、flying/takeoff 加力。程序化
              SVG+渐变,零资产(G5);颜色全内联,CSS 只持动画/透明度。 */}
          <VehGroup uid={uid} energyRatio={energyRatio} theme={VEH_THEMES[pack.manifest.vehicle ?? "silver"]} />
          {/* 呼吸层:float 姿势下整身微缩放(部件一起动,无头身分离;盘在此层外) */}
          <g className="cp-puppet-figure">
          {/* 贴纸档(l1)=单件整图;分件档=臂/身/头分层(头压身,臂在身侧之上) */}
          {PART_ORDER.map((name) => {
            const src = pack.srcs[name];
            const box = lay.get(name);
            if (!src || !box) return null;
            if (name === "head") {
              return (
                <g key={name} ref={refs.head} className="cp-head" style={{ transformBox: "fill-box", transformOrigin: PART_ORIGIN.head }}>
                  <g ref={leanRef}>
                    <image href={src} x={box.x} y={box.y} width={box.w} height={box.h} />
                  </g>
                </g>
              );
            }
            if (name === "armL" || name === "armR") {
              return (
                <g
                  key={name}
                  ref={name === "armL" ? refs.armL : refs.armR}
                  className={`cp-arm cp-${name}`}
                  style={
                    {
                      transformBox: "fill-box",
                      transformOrigin: PART_ORIGIN[name],
                      "--cp-rest": `${restDeg[name]}deg`,
                    } as CSSProperties
                  }
                >
                  <image href={src} x={box.x} y={box.y} width={box.w} height={box.h} />
                </g>
              );
            }
            return <image key={name} href={src} x={box.x} y={box.y} width={box.w} height={box.h} />;
          })}
          </g>
        </>
      )}
      {/* 壳的眨眼/麦克风弧/整眼平移写 transform 的挂点(五官暂缓:空 g,no-op) */}
      <g ref={refs.eyes} />
      <g ref={refs.waves} />
      <g ref={refs.pupils} />
    </g>
  );
}
