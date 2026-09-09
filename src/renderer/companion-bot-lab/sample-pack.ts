/**
 * companion-bot-lab/sample-pack —— 实验页样例角色包。
 *
 * v3(2026-09-09,用户反馈"非人形、没有身体"):改用 Kenney 平台包经典小宇航员
 * (alienBeige,CC0)——人形:头盔大头 + 躯干 + 四肢,且官方自带多姿势帧
 * (stand/jump/hurt/duck/climb),Bongo 档第一次用上**真姿势帧替换**。
 *
 * 纸偶件按「统一变换 + 颈线切分」烘焙:头/身两件用同一仿射从原精灵绘制,
 * 各自清除颈线另一侧——叠放即精确还原原精灵,构造性零接缝。
 * 布局契约仍是私有烘焙布局(PART_BOX);用户自带图的布局元数据化见 SPEC §9。
 *
 * self-spec:对 head 件跑 analyzePngSpec(真像素活演示)。
 */
import {
  analyzePngSpec,
  type BotState,
  type CompanionPackManifest,
  type PngSpecReport,
} from "@shared/companion-pack.ts";
import idleUrl from "./assets/alien-idle.png";
import happyUrl from "./assets/alien-happy.png";
import thinkingUrl from "./assets/alien-thinking.png";
import keyLUrl from "./assets/alien-keyL.png";
import keyRUrl from "./assets/alien-keyR.png";
import headUrl from "./assets/alien-head.png";
import bodyUrl from "./assets/alien-body.png";

/** 部件在 512 画布中的烘焙区域(分数;与烘焙脚本同一变换)。 */
export const PART_BOX = {
  head: { x: 0.3, y: 0.05, w: 0.4, h: 0.2726 },
  body: { x: 0.3, y: 0.3226, w: 0.4, h: 0.2841 },
} as const;

/** 头的摆动轴点(颈心;512 画布分数)。 */
export const NECK_PIVOT = { x: 0.5, y: 0.3226 } as const;

export interface SampleArt {
  /** Bongo档 五状态姿势帧 */
  srcs: Record<BotState, string>;
  /** 纸偶/PD-Mesh 两件:头 + 身体 */
  parts: { head: string; body: string };
  /** head 件跑三行规格检测的活演示 */
  selfSpec: PngSpecReport;
}

export const SAMPLE_MANIFEST: CompanionPackManifest = {
  formatVersion: 1,
  id: "lab-alien",
  name: "Lab 小宇航员(Kenney)",
  author: "Kenney",
  license: "CC0-1.0 (Kenney Platformer Characters)",
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

/** 加载烘焙件并构建包数据(selfSpec 需解码像素,异步)。 */
export async function buildSampleArt(): Promise<SampleArt> {
  const srcs: Record<BotState, string> = {
    idle: idleUrl,
    keyL: keyLUrl,
    keyR: keyRUrl,
    happy: happyUrl,
    thinking: thinkingUrl,
  };

  const img = await loadImageEl(headUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, 512, 512);
  const selfSpec = analyzePngSpec({ width: 512, height: 512, rgba: data.data });

  return {
    srcs,
    parts: { head: headUrl, body: bodyUrl },
    selfSpec,
  };
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`image load failed: ${src}`));
    im.src = src;
  });
}
