/**
 * @deprecated v0.9 起被 <CelebrationLayer> + celebrate() 总线取代。
 *
 * ParticleFx —— v0.3 趣味性钩子(原占位)。
 *
 * 历史:v0.3 预留的粒子占位(no-op)。v0.9 游戏感动效重构落地中央庆祝总线
 * (lib/celebration.ts 的 celebrate() + components/CelebrationLayer.tsx 根级 canvas
 * 粒子层),本文件的功能已被取代。保留作历史 + 防旧引用报错,新代码用 celebrate()。
 *
 * 用法(新):celebrate("correct") —— 触发 CelebrationLayer 统一渲染粒子爆发。
 */
import { useEffect, useRef } from "react";

export type ParticleTrigger = "correct" | "wrong" | "streak" | "unlock" | "levelup";

interface ParticleFxProps {
  trigger: ParticleTrigger | null;
  onDone?: () => void;
}

/**
 * 占位实现:trigger 变化时只调 onDone,不渲染粒子。
 * 后续填:Canvas 粒子动画 / CSS keyframes / Lottie。
 */
export function ParticleFx({ trigger, onDone }: ParticleFxProps) {
  const prevTrigger = useRef<ParticleTrigger | null>(null);
  useEffect(() => {
    if (trigger && trigger !== prevTrigger.current) {
      // TODO: v0.4+ 填粒子动画(Canvas/CSS/Lottie)
      // 当前:no-op,只通知完成
      const t = setTimeout(() => onDone?.(), 100);
      prevTrigger.current = trigger;
      return () => clearTimeout(t);
    }
  }, [trigger, onDone]);
  return null;
}

/**
 * 音效占位(后续填本地音频文件 + 静音开关)。
 * 当前:no-op,不阻塞。
 */
export function playSfx(_type: ParticleTrigger): void {
  // TODO: v0.4+ 填音频播放
  // const audio = new Audio(`/sfx/${_type}.mp3`);
  // audio.volume = muted ? 0 : 0.3;
  // audio.play().catch(() => {});  // 忽略自动播放限制
}
