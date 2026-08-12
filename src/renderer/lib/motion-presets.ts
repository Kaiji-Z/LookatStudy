/**
 * motion-presets —— 复用的 motion(React) 变体/弹簧预设。
 *
 * 全应用动效用同一套弹簧曲线,避免每个组件手搓参数导致手感不一致。
 * 配色与 index.css 的 --ease-* 变量同源语义(指数 ease-out / 弹簧回弹)。
 *
 * 用法:
 *   import { motion } from "motion/react";
 *   import { enterUp, staggerContainer } from "../lib/motion-presets.js";
 *   <motion.ul variants={staggerContainer} initial="hidden" animate="visible">
 *     {items.map(it => <motion.li variants={enterUp} key={it.id} />)}
 */
import type { Transition, Variants } from "motion/react";

/** 品牌主操作弹簧:答对/解锁,干脆有力(对应 CSS --ease-spring)。 */
export const springBrand: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.8,
};

/** 柔和弹簧:卡片入场/悬浮,克制(--ease-out-back 语义)。 */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 26,
};

/** 利落弹簧:微交互(hover/press),快回弹。 */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 600,
  damping: 20,
};

/** 淡入+上移入场(msg-enter 的 motion 升级版,可错峰)。 */
export const enterUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
};

/** 淡入+缩放入场(卡片/artifact)。 */
export const enterFade: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: springSoft },
};

/** 错峰容器:子项依次入场。配合 enterUp/enterFade 用。 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

/** 弹出(粒子/checkmark/皇冠):从 0.5 缩放 + 品牌弹簧。 */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: { opacity: 1, scale: 1, transition: springBrand },
  exit: { opacity: 0, scale: 0.8, transition: { duration: 0.15 } },
};

/** 皇冠/掌握度加冕:放大回弹 + 持续微脉冲(单 hero 元素,合规)。 */
export const crownLand: Variants = {
  hidden: { opacity: 0, scale: 0.3, rotate: -20 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { ...springBrand, damping: 12 },
  },
};
