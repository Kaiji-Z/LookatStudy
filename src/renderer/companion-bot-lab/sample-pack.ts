/**
 * companion-bot-lab/sample-pack —— 程序化绘制的样例角色包(M0 spike 专用)。
 *
 * 为什么画而不是放图片文件:零二进制资产入库、零 IP 风险(会话决定 2026-09-09),
 * 且 ui-test 在生产构建里也能跑同一份(不依赖静态资源管线)。
 * 全部画布 512²、透明底、内容落在 PART_BOX 分数区域内,三档共用同一坐标系:
 *   - 贴纸级/Bongo档:合成整图(states 五帧,keyL/keyR 手臂上举画进图里)
 *   - 纸偶/PD-Mesh:head/body/armL/armR 四层分离画布,引擎按 PART_BOX 绝对定位
 * 画完用 analyzePngSpec 自检(样例必须过三行规格——检测器吃真实像素的活演示)。
 */
import {
  analyzePngSpec,
  type BotState,
  type CompanionPackManifest,
  type PngSpecReport,
} from "@shared/companion-pack.ts";

export const PART_BOX = {
  head: { x: 0.2, y: 0.06, w: 0.6, h: 0.58 },
  body: { x: 0.3, y: 0.6, w: 0.4, h: 0.34 },
  armL: { x: 0.14, y: 0.64, w: 0.18, h: 0.3 },
  armR: { x: 0.68, y: 0.64, w: 0.18, h: 0.3 },
} as const;

/** 纸偶肩点(旋转原点,512 画布坐标)。 */
export const SHOULDER = { armL: { x: 0.25, y: 0.66 }, armR: { x: 0.75, y: 0.66 } } as const;

const INK = "#3c3c3c";
const FILL = "#ffc800";
const FILL_DARK = "#e0a800";
const S = 512;

type Ctx = CanvasRenderingContext2D;

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d") as Ctx;
  return { canvas, ctx };
}

function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function arm(ctx: Ctx, cx: number, cy: number, angleDeg: number): void {
  ctx.save();
  ctx.translate(cx, cy - 70);
  ctx.rotate((angleDeg * Math.PI) / 180);
  blob(ctx, 0, 70, 38, 74);
  ctx.restore();
}

/** 头+脸(variant 决定表情)。坐标与 PART_BOX.head 契约一致。 */
function drawHead(ctx: Ctx, variant: "idle" | "happy" | "thinking"): void {
  const cx = (PART_BOX.head.x + PART_BOX.head.w / 2) * S;
  const cy = (PART_BOX.head.y + PART_BOX.head.h / 2) * S;
  const r = PART_BOX.head.w * S * 0.47;
  blob(ctx, cx, cy, r, r);
  // 竖线眼(应用既有词汇:bar eye)
  ctx.fillStyle = INK;
  const eye = (ex: number) => {
    ctx.beginPath();
    ctx.roundRect(ex - 7, cy - 26, 14, 42, 7);
    ctx.fill();
  };
  if (variant === "happy") {
    ctx.lineWidth = 10;
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    for (const ex of [cx - r * 0.36, cx + r * 0.36]) {
      ctx.beginPath();
      ctx.arc(ex, cy + 4, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  } else {
    eye(cx - r * 0.36);
    eye(cx + r * 0.36);
  }
  // 腮红
  ctx.fillStyle = "rgba(255,159,159,0.75)";
  blob(ctx, cx - r * 0.58, cy + r * 0.34, 18, 11);
  blob(ctx, cx + r * 0.58, cy + r * 0.34, 18, 11);
  // 嘴
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  if (variant === "happy") {
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.22, 22, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else if (variant === "thinking") {
    ctx.beginPath();
    ctx.arc(cx + r * 0.1, cy + r * 0.34, 10, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + r * 0.32);
    ctx.lineTo(cx + 10, cy + r * 0.32);
    ctx.stroke();
  }
}

function drawBody(ctx: Ctx): void {
  const cx = (PART_BOX.body.x + PART_BOX.body.w / 2) * S;
  const cy = (PART_BOX.body.y + PART_BOX.body.h / 2) * S;
  ctx.fillStyle = FILL;
  blob(ctx, cx, cy, PART_BOX.body.w * S * 0.47, PART_BOX.body.h * S * 0.44);
  ctx.fillStyle = FILL_DARK;
  blob(ctx, cx, cy + 18, PART_BOX.body.w * S * 0.3, PART_BOX.body.h * S * 0.2);
  ctx.fillStyle = FILL;
}

function drawArm(ctx: Ctx, side: "armL" | "armR"): void {
  const box = PART_BOX[side];
  const cx = (box.x + box.w / 2) * S;
  const cy = (box.y + box.h / 2) * S;
  ctx.fillStyle = FILL;
  blob(ctx, cx, cy, box.w * S * 0.42, box.h * S * 0.46);
  ctx.fillStyle = FILL;
}

function blankPart(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = FILL;
  return { canvas, ctx };
}

export interface SampleArt {
  /** 贴纸级/Bongo档五帧(data URL) */
  srcs: Record<BotState, string>;
  /** 纸偶/PD-Mesh 四层(data URL,idle 表态) */
  parts: { head: string; body: string; armL: string; armR: string };
  /** 合成整图跑三行规格检测的活演示 */
  selfSpec: PngSpecReport;
}

export const SAMPLE_MANIFEST: CompanionPackManifest = {
  formatVersion: 1,
  id: "lab-chibi",
  name: "实验页圆团(Lab Chibi)",
  author: "lookatstudy-dev",
  license: "CC0-1.0(程序化生成)",
  tier: "bongo",
  states: {
    idle: "idle.png",
    keyL: "keyl.png",
    keyR: "keyr.png",
    happy: "happy.png",
    thinking: "thinking.png",
  },
  poseHoldMs: 1100,
};

/** 同步构建全部画布并导出 data URL(实验页 useMemo 一次)。 */
export function buildSampleArt(): SampleArt {
  const toURL = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

  // ---- 分层(纸偶/PD-Mesh 用,idle 表态) ----
  const head = blankPart();
  drawHead(head.ctx, "idle");
  const body = blankPart();
  drawBody(body.ctx);
  const armL = blankPart();
  drawArm(armL.ctx, "armL");
  const armR = blankPart();
  drawArm(armR.ctx, "armR");

  // ---- 合成整图(贴纸级/Bongo档,keyL/keyR 把举臂画进图) ----
  const compose = (variant: "idle" | "happy" | "thinking", raiseL = 0, raiseR = 0): string => {
    const { canvas, ctx } = makeCanvas();
    ctx.fillStyle = FILL;
    const armLx = (PART_BOX.armL.x + PART_BOX.armL.w / 2) * S;
    const armRx = (PART_BOX.armR.x + PART_BOX.armR.w / 2) * S;
    const armCy = (PART_BOX.armL.y + PART_BOX.armL.h / 2) * S;
    drawBody(ctx);
    if (raiseL) arm(ctx, armLx + 10, armCy, -38 * raiseL);
    else drawArm(ctx, "armL");
    if (raiseR) arm(ctx, armRx - 10, armCy, 38 * raiseR);
    else drawArm(ctx, "armR");
    // 头画在最后(盖住身体与肩接缝)
    drawHead(ctx, variant);
    return toURL(canvas);
  };

  const srcs: Record<BotState, string> = {
    idle: compose("idle"),
    keyL: compose("idle", 1, 0),
    keyR: compose("idle", 0, 1),
    happy: compose("happy"),
    thinking: compose("thinking"),
  };

  // ---- 自检:合成 idle 跑三行规格(活演示,页面上展示徽标) ----
  const probe = makeCanvas();
  probe.ctx.drawImage(head.canvas, 0, 0);
  probe.ctx.drawImage(body.canvas, 0, 0);
  probe.ctx.drawImage(armL.canvas, 0, 0);
  probe.ctx.drawImage(armR.canvas, 0, 0);
  const data = probe.ctx.getImageData(0, 0, S, S);
  const selfSpec = analyzePngSpec({ width: S, height: S, rgba: data.data });

  return {
    srcs,
    parts: { head: toURL(head.canvas), body: toURL(body.canvas), armL: toURL(armL.canvas), armR: toURL(armR.canvas) },
    selfSpec,
  };
}
