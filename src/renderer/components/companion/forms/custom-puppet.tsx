/**
 * CustomPuppetArt —— 第 6 形态:用户导入的纸偶包(CompanionPack M2,SPEC §16)。
 *
 * 与五款内置形态共用 Mascot 壳的全部生命系统:pose CSS 按 class 命中 .cp-bot/
 * .cp-head/.cp-armL/.cp-armR 后代,逐键 WAAPI 按压/ squash 走 refs;行为不是
 * 移植而是天生共享。本组件只做三件事:
 *   1. 把切分件 <image> 按 layoutParts 落位(contain 进 200×200 舞台,层序 盘<臂<身<头);
 *   2. 关节 origin 内联覆盖:臂=近躯干上角(86%/14% × 10%)、头=底中(50% 92%)——
 *      pose 旋转/拍臂绕肩/颈,不绕图片几何中心;
 *   3. HoverDisc 载具:程序化 SVG 椭圆盘(零二进制资产),纸偶站盘上悬浮。
 *
 * 五官表情=暂缓:eyes/waves refs 挂空 g(壳的眨眼/麦克风弧写入无害 no-op);
 * pupils 挂头图组——视线 lerp 变成头部 ±5/3px 微平移,无五官也有活体感。
 * 无激活包(或包文件丢失)→ 诚实占位剪影,不白屏。
 */
import { useMemo, useSyncExternalStore } from "react";

import { getActivePack, subscribeActivePack } from "../../../lib/companion/custom-pack-store.js";
import type { FormArtProps } from "./shared.js";

const PART_ORDER: string[] = ["armL", "armR", "body", "head", "sticker"];

/** 关节 origin(相对部件图 bbox;armL 近躯干=右缘,armR=左缘)。 */
const PART_ORIGIN: Record<string, string> = {
  head: "50% 92%",
  armL: "86% 10%",
  armR: "14% 10%",
};

export function CustomPuppetArt({ refs }: FormArtProps) {
  const pack = useSyncExternalStore(subscribeActivePack, getActivePack);
  const lay = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const l of pack?.layout ?? []) m.set(l.name, l);
    return m;
  }, [pack]);

  return (
    <g ref={refs.bot} className="cp-bot cp-puppet-bot">
      {!pack ? (
        <g className="cp-puppet-placeholder" opacity="0.45" aria-hidden="true">
          <circle cx="100" cy="68" r="36" fill="var(--surface-2, #3a3a44)" stroke="var(--border-faint, #777)" strokeWidth="3" />
          <rect x="70" y="110" width="60" height="58" rx="16" fill="var(--surface-2, #3a3a44)" stroke="var(--border-faint, #777)" strokeWidth="3" />
        </g>
      ) : (
        <>
          {/* HoverDisc 载具(程序化,零资产):光晕+盘体+缘+舱灯,纸偶站盘上 */}
          <g className="cp-disc" aria-hidden="true">
            <ellipse cx="100" cy="188" rx="72" ry="11" className="cp-disc-glow" opacity="0.16" />
            <ellipse cx="100" cy="186" rx="58" ry="8" className="cp-disc-glow" opacity="0.28" />
            <ellipse cx="100" cy="182" rx="62" ry="10" className="cp-disc-base" />
            <ellipse cx="100" cy="179" rx="62" ry="10" className="cp-disc-top" />
            <ellipse cx="100" cy="179" rx="62" ry="10" fill="none" className="cp-disc-rim" strokeWidth="2.5" />
            <circle cx="46" cy="179" r="2.6" className="cp-disc-lamp" />
            <circle cx="154" cy="179" r="2.6" className="cp-disc-lamp" />
          </g>
          {/* 贴纸档(l1)=单件整图;分件档=臂/身/头分层(头压身,臂在身侧之上) */}
          {PART_ORDER.map((name) => {
            const src = pack.srcs[name];
            const box = lay.get(name);
            if (!src || !box) return null;
            if (name === "head") {
              return (
                <g key={name} ref={refs.head} className="cp-head" style={{ transformBox: "fill-box", transformOrigin: PART_ORIGIN.head }}>
                  <g ref={refs.pupils}>
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
                  style={{ transformBox: "fill-box", transformOrigin: PART_ORIGIN[name] }}
                >
                  <image href={src} x={box.x} y={box.y} width={box.w} height={box.h} />
                </g>
              );
            }
            return <image key={name} href={src} x={box.x} y={box.y} width={box.w} height={box.h} />;
          })}
        </>
      )}
      {/* 壳的眨眼/麦克风弧写 transform 的挂点(五官暂缓:空 g,no-op) */}
      <g ref={refs.eyes} />
      <g ref={refs.waves} />
    </g>
  );
}
