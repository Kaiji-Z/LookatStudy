/**
 * paneTiers —— 三栏布局的窗口宽度分档(纯函数,verify-pane-tiers 覆盖)。
 *
 * 三档(用户拍板 2026-08-16):
 * - T1 ≥1240:三栏共存(左地图 300 + 中对话 + 右笔记)。
 * - T2 920~1239:双栏 = 中栏 + 一侧栏(默认右侧笔记,左栏自动隐藏);
 *   点左栏按钮 → 显示左栏隐藏右栏,点右栏按钮 → 反之(互斥,中栏常驻)。
 * - T3 <920:单栏(默认对话),窗口顶部浮动按钮组切换 地图/对话/笔记。
 * 拉宽自动弹回:进入 T1 时三栏全恢复(弹回档位默认形态,不记手动收起)。
 *
 * 阈值依据:三栏最小和 = 300+480+440 = 1220(+边距≈1240);
 * 双栏(中+右)最小和 = 480+440 = 920。窗口下限 560(单栏对话舒适下限)。
 */

/** T1 下限:三栏共存的最小窗口宽。 */
export const T1_MIN = 1240;
/** T2 下限:双栏(中+右)共存的最小窗口宽。 */
export const T2_MIN = 920;
/** 窗口允许的最小宽(单栏档,主进程 minWidth 与此同步)。 */
export const WINDOW_MIN = 560;

export type PaneTier = 1 | 2 | 3;

/** 窗口宽 → 档位。 */
export function tierFor(width: number): PaneTier {
  if (width >= T1_MIN) return 1;
  if (width >= T2_MIN) return 2;
  return 3;
}

/** T2 的侧栏选择(互斥:显示左则隐右,显示右则隐左)。 */
export type T2Side = "rail" | "notebook";
/** T3 的当前单栏。 */
export type T3Pane = "rail" | "chat" | "notebook";

/**
 * T3 → T2 升档时的侧栏承接:单栏正在看地图 → 双栏保留地图侧;
 * 看笔记 → 保留笔记侧;看对话 → 双栏默认(笔记侧)。
 */
export function t2SideFromT3(pane: T3Pane): T2Side {
  return pane === "rail" ? "rail" : "notebook";
}
