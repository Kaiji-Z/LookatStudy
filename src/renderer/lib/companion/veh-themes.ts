/**
 * 载具主题表(2026-09-11)—— 悬浮平台按五形态设计语言换装,选型存
 * manifest.vehicle。silver = 中性银灰(旧包缺省值,取自 v2.1 实机定稿色),
 * 其余五款:
 *   ember 小焰:熔岩橙合金 + 橙焰;
 *   frost 霜绒:冰蓝银白 + 冷凝焰;
 *   moss  苔芽:苔绿原木 + 嫩芽绿焰;
 *   astro 星尘:紫夜合金 + 星辉焰,顶面撒星点;
 *   ink   墨墨:漆黑漆面 + 朱砂(印章红)舱圈,玻璃换宣纸暖白。
 *
 * 渲染侧只在 custom-puppet.tsx 消费(填充全部走内联属性);CSS 只保留
 * 动画/透明度/描边宽,不持颜色 —— 换主题零 CSS 分支。向导芯片用 dot 作色点。
 */
import type { CompanionVehicleId } from "@shared/companion-cut.ts";

export interface VehTheme {
  /** 顶面纵向渐变三停(亮→中→暗)。 */
  top: [string, string, string];
  /** 侧壁横向圆柱高光三停(暗→亮→暗)。 */
  wall: [string, string, string];
  inset: string;
  bottom: string;
  /** 顶面高光条不透明度(深色漆面调低防脏)。 */
  specular: number;
  /** 顶/壁描边(壁的更暗一档,沿用 v2.1 双色)。 */
  edgeTop: string;
  edgeWall: string;
  bezel: string;
  glass: string;
  vent: string;
  track: string;
  nozzle: string;
  nozzleEdge: string;
  flameOuter: string;
  flameCore: string;
  lamp: string;
  glow: string;
  /** 向导选择芯片的色点。 */
  dot: string;
  /** astro 专属:顶面撒星点。 */
  stars?: boolean;
}

export const VEH_THEMES: Record<CompanionVehicleId, VehTheme> = {
  silver: {
    top: ["#eceff4", "#c3cad5", "#9aa2b1"],
    wall: ["#7d8595", "#d3d9e2", "#6d7584"],
    inset: "#aab1bf",
    bottom: "#565d6b",
    specular: 0.55,
    edgeTop: "#7b8393",
    edgeWall: "#5d6472",
    bezel: "#ffc800",
    glass: "#dff5fa",
    vent: "#3f4654",
    track: "#3f4654",
    nozzle: "#4a5160",
    nozzleEdge: "#333a47",
    flameOuter: "#1cb0f6",
    flameCore: "#e8f7ff",
    lamp: "#ffc800",
    glow: "#1cb0f6",
    dot: "#c3cad5",
  },
  ember: {
    top: ["#ffc98a", "#f0954e", "#c25f2e"],
    wall: ["#e08a4a", "#ffd2a8", "#a34e2a"],
    inset: "#f0a468",
    bottom: "#8a3d20",
    specular: 0.4,
    edgeTop: "#a34e2a",
    edgeWall: "#8a3d20",
    bezel: "#ff9f43",
    glass: "#fff3e6",
    vent: "#7a3a1c",
    track: "#7a3a1c",
    nozzle: "#7a3a1c",
    nozzleEdge: "#5c2b14",
    flameOuter: "#ff7a3c",
    flameCore: "#ffe4c8",
    lamp: "#ffd27a",
    glow: "#ff8c42",
    dot: "#f0954e",
  },
  frost: {
    top: ["#f2fafe", "#c9e6f7", "#93c2e2"],
    wall: ["#9cc8e8", "#e8f6fe", "#7fb2d6"],
    inset: "#d7ecf9",
    bottom: "#6f9fc0",
    specular: 0.6,
    edgeTop: "#7fb2d6",
    edgeWall: "#6f9fc0",
    bezel: "#7fc4e8",
    glass: "#f4fbff",
    vent: "#5d8db0",
    track: "#5d8db0",
    nozzle: "#5d8db0",
    nozzleEdge: "#47708e",
    flameOuter: "#6fc8f2",
    flameCore: "#ecfaff",
    lamp: "#c9e9fa",
    glow: "#6fc8f2",
    dot: "#93c2e2",
  },
  moss: {
    top: ["#eff7e2", "#c8e2b4", "#94bd7c"],
    wall: ["#a9cd92", "#e6f4d8", "#7ba468"],
    inset: "#d5eac2",
    bottom: "#6e9459",
    specular: 0.45,
    edgeTop: "#7ba468",
    edgeWall: "#6e9459",
    bezel: "#6fbf4f",
    glass: "#f4fbee",
    vent: "#4f7040",
    track: "#4f7040",
    nozzle: "#4f7040",
    nozzleEdge: "#3d5830",
    flameOuter: "#8ed464",
    flameCore: "#f0fbe2",
    lamp: "#c9ee9e",
    glow: "#8ed464",
    dot: "#94bd7c",
  },
  astro: {
    top: ["#4a4478", "#34305c", "#221e40"],
    wall: ["#565179", "#7d78b0", "#2c2850"],
    inset: "#3c3765",
    bottom: "#191631",
    specular: 0.25,
    edgeTop: "#17142c",
    edgeWall: "#14112a",
    bezel: "#b8b3e0",
    glass: "#edeaff",
    vent: "#161329",
    track: "#161329",
    nozzle: "#161329",
    nozzleEdge: "#0e0c1c",
    flameOuter: "#b18cff",
    flameCore: "#ece5ff",
    lamp: "#b8b3e0",
    glow: "#b18cff",
    dot: "#55508a",
    stars: true,
  },
  ink: {
    top: ["#43434b", "#2b2b31", "#17171a"],
    wall: ["#55555f", "#9a9aa4", "#202026"],
    inset: "#333339",
    bottom: "#101013",
    specular: 0.3,
    edgeTop: "#101013",
    edgeWall: "#0c0c0e",
    bezel: "#e8563f",
    glass: "#f6f3ec",
    vent: "#0d0d10",
    track: "#0d0d10",
    nozzle: "#1a1a1f",
    nozzleEdge: "#000000",
    flameOuter: "#ff6b4a",
    flameCore: "#ffe9d9",
    lamp: "#e8563f",
    glow: "#e8563f",
    dot: "#3a3a40",
  },
};

/** 向导里的可选顺序(五款对应五形态;silver 不进选择器,只作旧包缺省)。 */
export const VEH_PICKABLE: CompanionVehicleId[] = ["ember", "frost", "moss", "astro", "ink"];
