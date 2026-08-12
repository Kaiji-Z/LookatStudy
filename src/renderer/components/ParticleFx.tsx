/**
 * ParticleFx —— 订阅 celebrate 总线,有品味的 CSS 粒子爆发(competence 即时反馈)。
 *
 * 挂在 App 根一次即可。PRODUCT.md 反暗黑模式红线:触发是**确定性**的学习成就(答对/毕业/解锁),
 * 不是随机盲盒;视觉克制(短动画 ~800ms、小粒子、无闪屏)。答错(wrong)不发粒子——诚实反馈,不粉饰。
 *
 * 实现选 CSS keyframes 而非 Canvas:零依赖、无重运行时、tree-shake 友好,足够 deliver 即时反馈。
 * (音效 playSfx 仍保留为占位——音频资产留给专门设计 pass,不阻塞当前能力感反馈。)
 */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { onCelebration, type Celebration } from "../lib/celebrate.js";

// 向后兼容旧导出(playSfx 占位;ParticleTrigger 保留供未来 sfx 类型用)
export type ParticleTrigger = "correct" | "wrong" | "streak" | "unlock" | "levelup";
export function playSfx(_type: ParticleTrigger): void {
  /* no-op: 音频资产 + 静音开关留给专门设计 pass */
}

const PARTICLE_COUNT = 14;
/** 固定角度(确定性,非随机)——视觉散开但不引入奖励随机性。 */
const ANGLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => (360 / PARTICLE_COUNT) * i);

const COLOR: Record<Celebration, string> = {
  correct: "var(--brand)", // 绿:进度/能量
  mastered: "var(--gold)", // 金:mastery/crown
  unlock: "var(--gold)",
  wrong: "var(--review)", // 仅记录,ParticleFx 不渲染 wrong
};

interface Burst {
  type: Celebration;
  key: number;
}

export function ParticleFx() {
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const unsub = onCelebration((type) => {
      if (type === "wrong") return; // 答错不庆祝(诚实)
      setBurst({ type, key: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBurst(null), 900);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  const color = burst ? COLOR[burst.type] ?? COLOR.correct : COLOR.correct;
  return (
    <div
      aria-hidden="true"
      data-testid="particle-fx-root"
      className="pointer-events-none fixed inset-x-0 top-24 z-[100] flex justify-center"
    >
      {burst && (
        <div key={burst.key} className="relative">
          {ANGLES.map((deg, i) => {
            const style = {
              background: color,
              "--tx": `${Math.cos((deg * Math.PI) / 180) * 64}px`,
              "--ty": `${Math.sin((deg * Math.PI) / 180) * 64 - 24}px`,
              animationDelay: `${i * 8}ms`,
            } as CSSProperties;
            return <span key={i} className="particle-fx-dot" style={style} />;
          })}
        </div>
      )}
    </div>
  );
}
