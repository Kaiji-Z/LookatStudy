/**
 * celebration —— 中央庆祝事件总线。
 *
 * 游戏感动效的"高光时刻"统一入口:任何组件 fire `celebrate("correct")`,
 * 渲染由根级 <CelebrationLayer> 统一处理(粒子爆发/闪光/彩屑),解耦"触发"与"渲染"。
 *
 * 设计理由(Phase 0 架构决策 #2):原反馈完全散落(答对题在 QuizArtifact、
 * 解锁在 MapRail、XP 在 App...),没有中央总线。总线让所有高光时刻走一处,
 * 新增反馈点只需一行 celebrate(),渲染逻辑集中可维护 + reduced-motion 降级统一。
 *
 * 触发源:
 *   - 用户操作(答题/解锁/复习) → 直接 celebrate()
 *   - main 进程状态变化(xp/streak/mastery) → 经 state:changed IPC → renderer celebrate()
 */
export type CelebrationKind =
  | "correct" // 答对题
  | "wrong" // 答错题
  | "unlock" // 节点解锁
  | "mastery" // 掌握度达成(加冕)
  | "streak" // 连击递增
  | "energy-full" // 能量条充满(≥100)
  | "exam-pass" // 考试通过
  | "lesson-complete" // 课程完成
  | "level-up"; // 升级(预留)

export interface CelebrationEvent {
  kind: CelebrationKind;
  /** 可选强度 0..1(影响粒子数/幅度);默认按 kind 推断。 */
  intensity?: number;
  /** 可选锚点(视口坐标),粒子从该点爆发;默认视口中心。 */
  origin?: { x: number; y: number };
  ts: number;
}

type Listener = (e: CelebrationEvent) => void;

const listeners = new Set<Listener>();

/** 触发一次庆祝(任何组件都可调)。渲染由 <CelebrationLayer> 统一处理。 */
export function celebrate(
  kind: CelebrationKind,
  opts?: { intensity?: number; origin?: { x: number; y: number } },
): void {
  const e: CelebrationEvent = {
    kind,
    intensity: opts?.intensity,
    origin: opts?.origin,
    ts: performance.now(),
  };
  for (const l of listeners) l(e);
}

/** 订阅庆祝事件(<CelebrationLayer> 用)。返回取消订阅。 */
export function onCelebration(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 按 kind 推断默认粒子数/持续时长(<CelebrationLayer> 用)。 */
export function celebrationDefaults(kind: CelebrationKind): {
  particles: number;
  durationMs: number;
  colors: string[];
} {
  switch (kind) {
    case "correct":
      return { particles: 28, durationMs: 700, colors: ["#58cc02", "#7ed957", "#ffc800"] };
    case "mastery":
    case "level-up":
      return { particles: 48, durationMs: 1100, colors: ["#ffc800", "#ffe680", "#fff7c2"] };
    case "unlock":
      return { particles: 32, durationMs: 800, colors: ["#58cc02", "#1cb0f6", "#ffffff"] };
    case "exam-pass":
      return { particles: 56, durationMs: 1200, colors: ["#a855f7", "#c084fc", "#ffc800"] };
    case "lesson-complete":
      return { particles: 40, durationMs: 1000, colors: ["#58cc02", "#ffc800", "#1cb0f6"] };
    case "energy-full":
      return { particles: 36, durationMs: 900, colors: ["#58cc02", "#7ed957", "#ffffff"] };
    case "streak":
      return { particles: 24, durationMs: 700, colors: ["#ff7a1a", "#ffc800", "#ffffff"] };
    case "wrong":
      return { particles: 12, durationMs: 450, colors: ["#ff4b4b", "#ff7a7a"] };
    default:
      return { particles: 20, durationMs: 600, colors: ["#58cc02", "#ffffff"] };
  }
}
