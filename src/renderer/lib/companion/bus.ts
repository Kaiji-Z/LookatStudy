/**
 * companion/bus —— 伴学伙伴的渲染层全局状态店(副作用接线层)。
 *
 * 纯逻辑在 companion-core.ts(reducer,verify 直测);本文件负责:
 *   - 安装一次性全局监听:celebration 总线 / state:changed(xp→能量核,streak→天线火)/
 *     用户活动(pointerdown/keydown→空闲入睡基准)/ companion-config-changed(设置开关)
 *   - useSyncExternalStore 兼容的 subscribe/getSnapshot
 *   - 语音/流式/戳一戳的命令入口(ContentTab/ChatComposer/App 调用)
 *
 * 幂等:首个订阅者触发 install;监听随模块生命周期(单例,不拆)。
 * DOM/IPC 全部 try 守卫——伙伴是纯装饰层,任何接线失败都不许影响宿主功能。
 */
import { onCelebration } from "../celebration.js";
import {
  type CompanionState,
  companionReducer,
  initialCompanionState,
  isCompanionEnabled,
} from "./companion-core.ts";

export interface CompanionSnapshot {
  state: CompanionState;
  /** 能量核填充(今日 XP / 每日目标,0..1) */
  energyRatio: number;
  /** 天线火苗点亮(streak 事件后亮 4s) */
  streakLit: boolean;
  /** 设置开关(默认开;未加载完=false 配合 enabledLoaded 由组件等待) */
  enabled: boolean;
  /** 设置是否已加载(避免误渲染后闪隐) */
  enabledLoaded: boolean;
}

let state: CompanionState = initialCompanionState(Date.now());
let energyRatio = 0;
let streakLit = false;
let streakTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;
let enabledLoaded = false;
let installed = false;
let snapshot: CompanionSnapshot | null = null;
const listeners = new Set<() => void>();
let lastActivitySent = 0;

function rebuild(): void {
  snapshot = {
    state,
    energyRatio,
    streakLit,
    enabled,
    enabledLoaded,
  };
  for (const l of listeners) l();
}

function dispatch(ev: Parameters<typeof companionReducer>[1]): void {
  const next = companionReducer(state, ev);
  if (next !== state) {
    state = next;
    rebuild();
  }
}

async function reloadEnabled(): Promise<void> {
  try {
    const v = await window.api?.getSetting("companion_enabled");
    enabled = isCompanionEnabled(v);
  } catch {
    enabled = true;
  }
  enabledLoaded = true;
  rebuild();
}

function install(): void {
  if (installed) return;
  installed = true;

  // 高光庆祝 → 表情反应(与 CelebrationLayer 同源订阅,零耦合)
  onCelebration((e) => {
    dispatch({ type: "celebration", kind: e.kind, now: Date.now() });
  });

  // main 状态推送:xp → 能量核重算;streak → 天线火苗
  try {
    window.api?.on("state:changed", (kind: "xp" | "streak" | "mastery") => {
      if (kind === "xp") {
        window.api
          .getXpStatus()
          .then((x) => {
            const ratio = x.dailyGoal > 0 ? Math.min(1, x.todayXp / x.dailyGoal) : 0;
            if (ratio !== energyRatio) {
              energyRatio = ratio;
              rebuild();
            }
          })
          .catch(() => {});
      } else if (kind === "streak") {
        if (!streakLit) {
          streakLit = true;
          rebuild();
        }
        if (streakTimer) clearTimeout(streakTimer);
        streakTimer = setTimeout(() => {
          streakLit = false;
          rebuild();
        }, 4000);
      }
    });
  } catch {
    /* web/测试环境无 api:伙伴退化为纯本地反应 */
  }

  // 用户活动 → 入睡计时基准(节流 1s,reducer 活动事件本身廉价但不必每键一发)
  const onAct = () => {
    const now = Date.now();
    if (state.sleeping || now - lastActivitySent > 1000) {
      lastActivitySent = now;
      dispatch({ type: "activity", now });
    }
  };
  window.addEventListener("pointerdown", onAct, { passive: true });
  window.addEventListener("keydown", onAct, { passive: true });

  // 设置开关变更(设置页 dispatch)
  window.addEventListener("companion-config-changed", () => {
    void reloadEnabled();
  });

  // 到期回落/空闲入睡的慢时钟(500ms;reducer 无变化时不发通知)
  setInterval(() => {
    dispatch({ type: "tick", now: Date.now() });
  }, 500);

  // 初始能量 + 开关
  window.api
    ?.getXpStatus()
    .then((x) => {
      energyRatio = x.dailyGoal > 0 ? Math.min(1, x.todayXp / x.dailyGoal) : 0;
    })
    .catch(() => {})
    .finally(() => rebuild());
  void reloadEnabled();
}

/** useSyncExternalStore 订阅。 */
export function subscribeCompanion(l: () => void): () => void {
  listeners.add(l);
  install();
  return () => {
    listeners.delete(l);
  };
}

/** useSyncExternalStore 快照(引用稳定,未变化不换对象)。 */
export function getCompanionSnapshot(): CompanionSnapshot {
  if (!snapshot) {
    snapshot = { state, energyRatio, streakLit, enabled, enabledLoaded };
  }
  return snapshot;
}

/* ---------------- 命令入口(组件调用) ---------------- */

/** 戳一下伙伴(点击互动)。 */
export function companionPoke(): void {
  dispatch({ type: "poke", now: Date.now() });
}

/** 朗读状态(NotebookPanel 的 ContentTab 用,绑 🔊 整课朗读)。 */
export function companionSetTalking(on: boolean): void {
  dispatch({ type: "talking", on, now: Date.now() });
}

/** 听写模式(ChatComposer 的 voiceMode)。 */
export function companionSetListening(on: boolean): void {
  dispatch({ type: "listening", on, now: Date.now() });
}

/** AI 流式回答中(App 的 chat.streaming → 托腮思考)。 */
export function companionSetStreaming(on: boolean): void {
  dispatch({ type: "streaming", on, now: Date.now() });
}
