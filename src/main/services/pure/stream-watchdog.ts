/**
 * 流式 LLM 调用的活性看门狗 —— 替代墙钟超时。
 *
 * 为什么不用墙钟超时:大课程导入的结构设计批(40 文件/批)在慢模型(glm-5.2 等)上
 * 单次生成可能超过 5 分钟但仍健康地持续吐 token,墙钟超时会杀掉活着的生成,
 * 整个导入 job 报废(前面的分类/清点全部白跑)。
 *
 * 看门狗只杀两种情况:
 *   1. inactive: 连续无输出超过 inactiveMs —— 连接死了/端点挂起,等下去没意义
 *   2. hard-cap: 总时长超过 hardCapMs —— 绝对安全网,防无限生成
 * 流在动就永远续命(touch)。abort 会通过传给 streamText 的 signal 真正取消
 * 底层请求(而不是像 Promise.race 那样输了比赛请求还在后台烧)。
 *
 * 纯函数、无依赖,verify-import-watchdog.mjs 直测。
 */

export interface StreamWatchdog {
  /** 传给 streamText 的 abortSignal;触发即真正取消请求 */
  readonly signal: AbortSignal;
  /** 每收到一个 chunk 调用一次,重置 inactive 计时 */
  touch(): void;
  /** 结束后清理计时器(无论成败都应调用) */
  dispose(): void;
  /** 已触发 abort 的原因;未触发为 null */
  reason(): "inactive" | "hard-cap" | null;
}

export function createStreamWatchdog(inactiveMs: number, hardCapMs: number): StreamWatchdog {
  const controller = new AbortController();
  let why: "inactive" | "hard-cap" | null = null;
  let inactiveTimer: ReturnType<typeof setTimeout> | null = null;

  const hardCapTimer = setTimeout(() => {
    if (!controller.signal.aborted) {
      why = "hard-cap";
      controller.abort();
    }
  }, hardCapMs);

  const armInactive = () => {
    if (inactiveTimer) clearTimeout(inactiveTimer);
    inactiveTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        why = "inactive";
        controller.abort();
      }
    }, inactiveMs);
  };
  armInactive();

  return {
    signal: controller.signal,
    touch: armInactive,
    dispose() {
      if (inactiveTimer) clearTimeout(inactiveTimer);
      clearTimeout(hardCapTimer);
    },
    reason: () => why,
  };
}
