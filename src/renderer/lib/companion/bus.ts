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
  micArcScale,
  smoothMic,
} from "./companion-core.ts";
import { formIdFromSetting, type CompanionFormId } from "./forms-index.ts";
import { playPetSfx, setPetSfxEnabled } from "./pet-sfx.ts";
import type { SectionIsland } from "../mapPhysics.js";

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
  /** 当前形象(默认小焰;设置页可换) */
  form: CompanionFormId;
  /** 等级徽标:XP 等级 ≥3 → 头顶小皇冠(壳层渲染,全形态共享) */
  crowned: boolean;
  /** 等级徽标:XP 等级 ≥7 → 金色光环 */
  halo: boolean;
  /** v0.11 桌宠模式:主窗生物隐身(桌宠透明窗接管),避免双影 */
  petMode: boolean;
}

let state: CompanionState = initialCompanionState(Date.now());
let energyRatio = 0;
let streakLit = false;
let streakTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;
let enabledLoaded = false;
let form = formIdFromSetting(null);
let crowned = false;
let halo = false;
let petMode = false;
let installed = false;
let snapshot: CompanionSnapshot | null = null;
const listeners = new Set<() => void>();

/* 听写麦克风包络(ref 级,不进 React 状态——渲染层 rAF 读) */
let micSmoothed = 0;

function rebuild(): void {
  snapshot = {
    state,
    energyRatio,
    streakLit,
    enabled,
    enabledLoaded,
    form,
    crowned,
    halo,
    petMode,
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
  try {
    const p = await window.api?.getSetting("companion_pet_mode");
    // web 运行时(手机/浏览器)没有桌宠窗:设置即使是 1 也不隐身主窗生物(否则手机上 bot 凭空消失)
    const webRuntime = typeof window !== "undefined" && !!(window as { __lookatstudyWeb?: boolean }).__lookatstudyWeb;
    petMode = p === "1" && !webRuntime;
  } catch {
    petMode = false;
  }
  try {
    const sfx = await window.api?.getSetting("companion_sfx");
    setPetSfxEnabled(!(sfx === "false" || sfx === "0"));
  } catch {
    setPetSfxEnabled(true);
  }
  try {
    const f = await window.api?.getSetting("companion_form");
    const nextForm = formIdFromSetting(typeof f === "string" ? f : null);
    if (nextForm !== form) form = nextForm;
  } catch {
    /* 形象读取失败保持现状 */
  }
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
    // v11:掌握变化转发(window 事件,Creature 拿去判定"卡点毕业")
    window.api?.on("state:changed", (kind: "xp" | "streak" | "mastery") => {
      try {
        window.dispatchEvent(new CustomEvent("companion-state-changed", { detail: kind }));
      } catch {
        /* 装饰层失败无碍 */
      }
      if (kind === "xp") {
        window.api
          .getXpStatus()
          .then((x) => {
            const ratio = x.dailyGoal > 0 ? Math.min(1, x.todayXp / x.dailyGoal) : 0;
            const nextCrowned = x.level >= 3;
            const nextHalo = x.level >= 7;
            if (ratio !== energyRatio || nextCrowned !== crowned || nextHalo !== halo) {
              energyRatio = ratio;
              crowned = nextCrowned;
              halo = nextHalo;
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

  // Bongo Cat 式真实输入反馈:
  //   键击 → 双臂交替按压(逐键,长按 repeat 不刷屏)
  //   点击 → 按点击半区定向按压一侧臂
  //   两者都更新活动/唤醒(见 reducer press)
  let nextSide: -1 | 1 = 1;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      const side = nextSide;
      nextSide = nextSide === 1 ? -1 : 1;
      // v10:打印字符随键击上屏(胸屏显示按键);组合键/功能键不上屏
      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : undefined;
      dispatch({ type: "press", side, now: Date.now(), key: printable });
    },
    { passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      dispatch({ type: "press", side: e.clientX < window.innerWidth / 2 ? -1 : 1, now: Date.now() });
    },
    { passive: true },
  );

  // 窗口失焦 → 短阈值打盹;回归 → 唤醒+打招呼(「你回来了」)
  window.addEventListener("blur", () => dispatch({ type: "focus", on: false, now: Date.now() }));
  window.addEventListener("focus", () => dispatch({ type: "focus", on: true, now: Date.now() }));

  // 滚动 = 用户在阅读:不唤醒,催他入纱帘(冒泡捕获各 pane 的内部滚动容器)
  window.addEventListener(
    "scroll",
    () => dispatch({ type: "scroll", now: Date.now() }),
    { passive: true, capture: true },
  );

  // 设置开关变更(设置页 dispatch)
  window.addEventListener("companion-config-changed", () => {
    void reloadEnabled();
  });

  // ---- 组件→bus 触发统一走 window 事件(与 companion-config-changed 同款) ----
  // 为什么不用直接函数调用:渲染层各组件对 bus 的 import 可能被打包器解析成
  // 不同模块实例(Windows junction 双盘路径曾让 vite 产出双实例——组件调进副本,
  // Creature 订阅正主,触发全丢)。window 事件天然单例,对任何打包路径免疫。
  window.addEventListener("companion-zone-focus", (e) => {
    dispatch({ type: "zoneFocus", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-talking", (e) => {
    dispatch({ type: "talking", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-listening", (e) => {
    dispatch({ type: "listening", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-streaming", (e) => {
    dispatch({ type: "streaming", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-send", () => {
    playPetSfx("happy");
    dispatch({ type: "send", now: Date.now() });
  });
  window.addEventListener("companion-note", () => {
    dispatch({ type: "zoneNote", now: Date.now() });
  });
  window.addEventListener("companion-poke", () => {
    playPetSfx("poke");
    dispatch({ type: "poke", now: Date.now() });
  });
  window.addEventListener("companion-swat", () => {
    playPetSfx("ouch");
    dispatch({ type: "swat", now: Date.now() });
  });
  window.addEventListener("companion-mic-level", (e) => {
    const v = Number(detailOf(e));
    if (Number.isFinite(v)) applyMic(v);
  });
  // 左栏世界注册表(MapRail 写,Creature 读):同样走事件,写进正主实例
  window.addEventListener("companion-rail-register", (e) => {
    const d = detailOf(e) as { sectionId: string; island: SectionIsland; container: HTMLElement } | undefined;
    if (d?.sectionId) railWorld.sections.set(d.sectionId, { island: d.island, container: d.container });
  });
  window.addEventListener("companion-rail-unregister", (e) => {
    const d = detailOf(e) as { sectionId: string } | undefined;
    if (d?.sectionId) railWorld.sections.delete(d.sectionId);
  });
  window.addEventListener("companion-exam-enter", () => {
    dispatch({ type: "examEnter", now: Date.now() });
  });
  window.addEventListener("companion-importing", (e) => {
    dispatch({ type: "importing", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-import-done", (e) => {
    dispatch({ type: "importDone", ok: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-reviewing", (e) => {
    dispatch({ type: "reviewing", on: !!detailOf(e), now: Date.now() });
  });
  window.addEventListener("companion-grab", (e) => {
    const d = detailOf(e) as { on: boolean; speed?: number } | undefined;
    if (d?.on) playPetSfx("grab");
    dispatch({ type: "grab", on: !!d?.on, speed: d?.speed, now: Date.now() });
  });
  window.addEventListener("companion-node-point", () => {
    dispatch({ type: "nodePoint", now: Date.now() });
  });
  window.addEventListener("companion-day-welcome", () => {
    dispatch({ type: "dayWelcome", now: Date.now() });
  });
  window.addEventListener("companion-rail-world", (e) => {
    const d = detailOf(e) as Partial<Pick<RailWorld, "nav" | "visible" | "weather">> | undefined;
    if (!d) return;
    if ("nav" in d) railWorld.nav = d.nav ?? null;
    if ("visible" in d) railWorld.visible = !!d.visible;
    if ("weather" in d) railWorld.weather = d.weather ?? "clear";
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
      crowned = x.level >= 3;
      halo = x.level >= 7;
    })
    .catch(() => {})
    .finally(() => rebuild());
  // 隔天回来:streak 的 lastActiveDate < 今天 → 加倍欢迎(仅一次)
  window.api
    ?.getStreak()
    .then((st) => {
      const last = st?.lastActiveDate;
      if (!last) return;
      const today = new Date().toISOString().slice(0, 10);
      if (last < today) dispatch({ type: "dayWelcome", now: Date.now() });
    })
    .catch(() => {});
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
    snapshot = { state, energyRatio, streakLit, enabled, enabledLoaded, form, crowned, halo, petMode };
  }
  return snapshot;
}

/* ---------------- 命令入口(组件调用→window 事件→正主实例) ---------------- */

/** 事件 detail 取值助手(防畸形事件)。 */
function detailOf(e: Event): unknown {
  return (e as CustomEvent<unknown>).detail;
}
function fire(name: string, detail?: unknown): void {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* 伙伴是纯装饰层,广播失败不许影响宿主 */
  }
}

/** 戳一下伙伴(点击互动)。 */
export function companionPoke(): void {
  fire("companion-poke");
}

/** 朗读状态(NotebookPanel 的 ContentTab 用,绑 🔊 整课朗读)。 */
export function companionSetTalking(on: boolean): void {
  fire("companion-talking", on);
}

/** 听写模式(ChatComposer 的 voiceMode)。 */
export function companionSetListening(on: boolean): void {
  fire("companion-listening", on);
}

/** AI 流式回答中(App 的 chat.streaming → 托腮思考)。 */
export function companionSetStreaming(on: boolean): void {
  fire("companion-streaming", on);
}

/** 用户发出消息(ChatComposer 提交 → 出拳送出)。 */
export function companionSend(): void {
  fire("companion-send");
}

/**
 * 声波弧幅度(4 档量化;0=无声波)。(平滑在正主实例的 applyMic 里做,
 * 广播入口是上方的 companionMicLevel。)
 */
export function getCompanionMicArc(): number {
  return micArcScale(micSmoothed);
}

/* ---------------- v3 单生物:zone 命令 + 左栏世界注册表 ---------------- */

/** 对话输入框聚焦/失焦(ChatComposer onFocus/onBlur → 落框栖息/回老家)。 */
export function companionZoneFocus(on: boolean): void {
  fire("companion-zone-focus", on);
}

/** 用户划线加笔记(NotebookPanel 保存 user_note → 飞右栏记笔记)。 */

/** v11 卡点掌握勾销:掏本打金勾(mastery 从 friction 榜消失时由 Creature 判定触发)。 */
export function companionNoteTick(): void {
  dispatch({ type: "noteTick", now: Date.now() });
}
export function companionNote(): void {
  fire("companion-note");
}

/** 被球拍中(渲染循环物理判定 → 晕眩表情)。 */
export function companionSwat(): void {
  fire("companion-swat");
}

/** 听写实时音量:同样走事件(高频,CustomEvent 同步派发,开销可忽略)。 */
export function companionMicLevel(v: number): void {
  fire("companion-mic-level", Math.min(1, Math.max(0, v)));
}

/** 平滑/量化在正主实例内完成(监听器直调,不再回播事件防环)。 */
function applyMic(v: number): void {
  micSmoothed = smoothMic(micSmoothed, Math.min(1, Math.max(0, v)));
}

/** MapRail → 左栏世界注册(section 岛 + 路径容器)。 */
export function companionRailRegister(sectionId: string, island: SectionIsland, container: HTMLElement): void {
  fire("companion-rail-register", { sectionId, island, container });
}

/** MapRail → section 岛注销(物理效应卸载)。 */
export function companionRailUnregister(sectionId: string): void {
  fire("companion-rail-unregister", { sectionId });
}

/** 进考试节点(App 在选中考试节点时) → 加油打气后离场(考试零干扰)。 */
export function companionExamEnter(): void {
  fire("companion-exam-enter");
}

/** 导入任务开始/结束(MapRail 导入面板) → 监工模式。 */
export function companionImporting(on: boolean): void {
  fire("companion-importing", on);
}

/** 导入完成/失败(MapRail import:done) → 欢呼/鼓励。 */
export function companionImportDone(ok: boolean): void {
  fire("companion-import-done", ok);
}

/** 复习抽屉开/关(App isReviewing) → 待命挥手。 */
export function companionReviewing(on: boolean): void {
  fire("companion-reviewing", on);
}

/** 抓住/松手(Mascot pointer;speed=松手时指针速度,快=扔出晕眩)。 */
export function companionGrab(on: boolean, speed?: number): void {
  fire("companion-grab", { on, speed });
}

/** 记忆联动:飞到卡点节点旁(Creature 定位球后触发指向反应)。 */
export function companionNodePoint(): void {
  fire("companion-node-point");
}

/** 落栖音效(Creature 落地弹跳时)。 */
export function companionLandSfx(): void {
  playPetSfx("land");
}

/** MapRail → 左栏世界补丁(nav 元素/地图可见性/天气)。 */
export function companionRailWorld(patch: Partial<Pick<RailWorld, "nav" | "visible" | "weather">>): void {
  fire("companion-rail-world", patch);
}

/** 左栏世界注册表(ref 级,渲染循环直读,不进 React 状态)。
 *  MapRail 经事件装配:nav 元素 / 地图面板可见性 / 天气 / 各 section 岛 + 容器。
 *  CompanionCreature 的 rAF 从这里取球位置做跨引擎碰撞。
 *  注意:只保证与 bus 正主实例同视图——Creature 与 install() 同实例,安全。 */
export interface RailWorld {
  nav: HTMLElement | null;
  /** 地图面板当前可见(切到导入面板时 false → 生物隐匿)。 */
  visible: boolean;
  weather: string;
  /** sectionId → 岛 + 该岛的路径容器(球岛坐标 → 视口的换算源)。 */
  sections: Map<string, { island: SectionIsland; container: HTMLElement }>;
}

const railWorld: RailWorld = { nav: null, visible: false, weather: "clear", sections: new Map() };

export function getRailWorld(): RailWorld {
  return railWorld;
}
