/**
 * state-emitter —— main→renderer 状态变化通知的注入点。
 *
 * service(xp/streak/mastery)是纯 db 逻辑,不持有 mainWindow。本模块提供一个
 * 可设置的 emitter 回调:main/index.ts 创建 mainWindow 后注入真实实现
 * (webContents.send "state:changed");service 内 fire-and-forget 调 emitStateChange。
 *
 * 测试/service 单测时 emitter 默认 noop(不影响纯逻辑可测性),同 markDirty 模式。
 *
 * Phase 0(游戏感动效重构):renderer 订阅 state:changed → 重拉 XP/streak/mastery
 * + 触发 celebrate() 庆祝。修原 bug:XP 能量条只在启动 getXpStatus() 一次,
 * 答题后 main 写 DB 但 renderer 不知道 → 能量条从不动。
 */
export type StateKind = "xp" | "streak" | "mastery";

type Emitter = (kind: StateKind) => void;

let emitter: Emitter = () => {};

/** main 进程启动时注入真实 emitter(发 IPC "state:changed" 给 renderer)。 */
export function setStateEmitter(fn: Emitter): void {
  emitter = fn;
}

/** service 内调用:通知 renderer 某类状态变化(重拉 + 触发庆祝)。 */
export function emitStateChange(kind: StateKind): void {
  emitter(kind);
}
