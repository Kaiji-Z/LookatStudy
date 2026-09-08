/**
 * pane-resize —— 三栏拖拽调宽(issue #14)的纯函数层。
 *
 * 模型:右栏恒 flex-1 吃剩余(不持久化),只持久化 左栏宽/中栏宽 两个数
 * (settings 键 pane_width_left / pane_width_mid,null=未定制=沿用响应式默认:
 * 左 300px 类 / 中 clamp(480px,36vw,800px) CSS)。
 *
 * 钳制必须视口感知:三栏都是 shrink-0/flex-1 min-w,宽度和超过视口时右栏
 * 被顶出屏幕(无滚动兜底)。所以拖拽实时钳制与渲染时求解共用同一套预算:
 *   reserved = 其他栏占用的最小宽度之和(T1: 右栏 440 + 对侧栏;T2 按在场栏)。
 * 阈值口径与 paneTiers 对齐:T1_MIN = 300+480+440+20(默认组合不溢出是
 * 档位阈值的设计前提);用户定制宽度只能在小档内自由,超出预算自动压缩。
 */
import { useCallback, useSyncExternalStore } from "react";

/** 左栏(课程地图)可调区间与默认宽。 */
export const RAIL_MIN = 240;
export const RAIL_MAX = 480;
export const RAIL_DEFAULT = 300;
/** 中栏(对话)可调区间;硬底=视口极端挤压时的兜底(低于 MIN 也要保布局不溢出)。 */
export const MID_MIN = 480;
export const MID_MAX = 1100;
export const MID_HARD_FLOOR = 320;
/** 右栏 flex-1 的 min-w(与 App 里 min-w-[440px] 同源,paneTiers 阈值也按它算)。 */
export const RIGHT_MIN = 440;
/** 中栏未定制时的响应式默认(CSS clamp 原文,App 直挂 style)。 */
export const DEFAULT_MID_CSS = "clamp(480px, 36vw, 800px)";

const clampNum = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** 中栏默认宽的数值形式(= DEFAULT_MID_CSS 在 vw 下的取值;求解预算用)。 */
export function defaultMidWidth(vw: number): number {
  return clampNum(vw * 0.36, MID_MIN, 800);
}

/**
 * 左栏拖拽候选钳制:reserved = 同屏其他栏的最小宽之和
 * (T1: RIGHT_MIN+中栏当前宽;T2-rail: 中栏最小 480)。
 * 上限双重:RAIL_MAX 与「视口减预算」,预算不够时保 RAIL_MIN 下限。
 */
export function clampRailCandidate(next: number, vw: number, reserved: number): number {
  return clampNum(next, RAIL_MIN, Math.min(RAIL_MAX, Math.max(RAIL_MIN, vw - reserved)));
}

/**
 * 中栏拖拽候选钳制:reserved = 右栏 RIGHT_MIN + 左栏当前宽(T2-notebook 左栏不在场传 0)。
 * 视口极端挤压时允许压到 MID_HARD_FLOOR(保布局完整优先于保阅读黄金宽)。
 */
export function clampMidCandidate(next: number, vw: number, reserved: number): number {
  return clampNum(next, MID_MIN, Math.min(MID_MAX, Math.max(MID_HARD_FLOOR, vw - reserved)));
}

/** settings 存储值解析:null/空串/非数/超区间 → null(回默认;历史脏值不硬吃)。 */
export function parseStoredWidth(
  v: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}

/** 手柄在场判定(纯):T1 两条边界各一,T2 只在场的边界,T3 无。chat 栏 T1/T2 常驻。 */
export function resizeHandlesFor(
  tier: 1 | 2 | 3,
  showLeft: boolean,
  showRight: boolean,
): { rail: boolean; mid: boolean } {
  if (tier === 3) return { rail: false, mid: false };
  return { rail: showLeft, mid: showRight };
}

/** 求解模式:由档位 + T2 侧栏选择决定。 */
export type PaneSolveMode = "t1" | "t2-notebook" | "t2-rail" | "t3";

/**
 * 渲染时有效宽度求解(持久化值 × 当前视口):拖拽钳制已保证提交时刻不溢出,
 * 但窗口后来变小(档内缩放)会破坏旧组合 —— 这里把存储值按当前视口重新压回
 * 预算内。返回 null = 未定制,挂默认(300 类 / clamp CSS);中栏先求(默认随
 * vw 变),左栏预算按中栏的有效基准算,无循环依赖。
 */
export function solvePaneWidths(
  railStored: number | null,
  midStored: number | null,
  vw: number,
  mode: PaneSolveMode,
): { rail: number | null; mid: number | null } {
  if (mode === "t3") return { rail: null, mid: null };
  if (mode === "t2-rail") {
    // 中栏 flex 撑满(无宽度),左栏只与中栏最小宽分食视口
    return {
      rail: railStored == null ? null : clampRailCandidate(railStored, vw, MID_MIN),
      mid: null,
    };
  }
  const railBasis = railStored ?? RAIL_DEFAULT;
  const mid =
    midStored == null
      ? null
      : clampMidCandidate(midStored, vw, mode === "t1" ? RIGHT_MIN + railBasis : RIGHT_MIN);
  // t1 左栏预算按中栏有效宽(定制值或默认);t2-notebook 左栏不在场,结果弃用
  const midBasis = mid ?? defaultMidWidth(vw);
  const rail =
    mode === "t1" && railStored != null
      ? clampRailCandidate(railStored, vw, RIGHT_MIN + midBasis)
      : null;
  return { rail, mid };
}

/* ---------- 视口宽跟踪(仅定制宽度存在时启用,避免档内 resize 全 app 重渲染) ---------- */

/**
 * useViewportWidth —— innerWidth 订阅,enabled=false 时快照恒 0
 * (Object.is 相等 → 不触发重渲染;与 useWindowTier「档内不重渲染」的设计一致)。
 * 返回 0 表示未启用,调用侧回退直读 window.innerWidth。
 */
export function useViewportWidth(enabled: boolean): number {
  const getSnapshot = useCallback(
    () => (enabled ? window.innerWidth : 0),
    [enabled],
  );
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    getSnapshot,
    () => 0,
  );
}
