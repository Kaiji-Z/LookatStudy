/**
 * celebrate —— 轻量庆祝事件总线(EventTarget)。
 *
 * 解耦:深处的 quiz 答题组件发事件,App 根订阅(toast) + ParticleFx 订阅(动画)。
 * 不引入外部状态库,EventTarget 零依赖、tree-shake 友好。
 *
 * 设计原则(PRODUCT.md 反暗黑模式):庆祝是有品味的即时反馈(competence 感),
 * 不是操纵性随机奖励——事件由确定性的学习成就触发(答对/毕业/解锁),无随机盲盒。
 */
export type Celebration = "correct" | "wrong" | "mastered" | "unlock";

const bus = new EventTarget();
const EVENT = "celebration";

/** 发一个庆祝事件。深处组件(quiz 答题)调用。 */
export function celebrate(type: Celebration): void {
  bus.dispatchEvent(new CustomEvent(EVENT, { detail: type }));
}

/**
 * 订阅庆祝事件。返回取消订阅函数。
 * ParticleFx 订阅做动画,App 订阅做 toast。
 */
export function onCelebration(cb: (type: Celebration) => void): () => void {
  const handler = (e: Event): void => {
    cb((e as CustomEvent).detail as Celebration);
  };
  bus.addEventListener(EVENT, handler);
  return () => bus.removeEventListener(EVENT, handler);
}
