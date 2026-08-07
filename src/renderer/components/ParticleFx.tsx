/**
 * ParticleFx —— v0.3 趣味性钩子(占位,后续专门设计)。
 *
 * 用户决策:"按最高要求预留,未来可进行专门设计"。
 * 当前:导出组件和触发函数,但实现是 no-op(不阻塞功能)。
 * 后续:填 Canvas/CSS 粒子(答对星星飞溅、连击火焰弹)。
 *
 * 用法:<ParticleFx trigger="correct" /> —— trigger 变化时触发一次
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
