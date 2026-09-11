/**
 * make-sheet-template —— 白模控制图 v2(单角色 40° A-pose,SPEC §16.5)。
 *
 * 与 v6a 生图 prompt 几何逐项对齐:纵向 2:3、二头身(头高=总高一半)、
 * A-pose 双臂自水平下垂 40°、纯绿 #00B140 底、白色哑模+墨描边、肩宽<头宽、
 * 无脚(载具世界)。旧 3×2 分件排版退役(供给公式已收敛到单图 A-pose,§14)。
 *
 * 白模双重身份:①给生图模型的控制参考;②自身即切分管线的确定性回归
 * fixture——`cut-figure 白模.png` 冒烟:几何链出 头/躯干/双臂 ≥3 件。
 *
 * 用法: node scripts/companion-pack/make-sheet-template.mjs [输出.png]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const W = 800;
const H = 1200; // 纵向 2:3
const BG = "#00B140";
const BODY = "#F5F2EA";
const INK = "#2B2530";
const STROKE = 14;

// 二头身:头径 460,总高(头顶 100 → 腿底 1020)= 920 = 460 × 2,严格 1:2
const head = { cx: 400, cy: 330, r: 230 };
const torso = { x: 285, y: 560, w: 230, h: 320, rx: 70 }; // 肩宽 230 < 头宽 460
const legL = { x: 320, y: 880, w: 64, h: 140, rx: 26 };
const legR = { x: 416, y: 880, w: 64, h: 140, rx: 26 };
// 40° A-pose:肩锚→腕(粗圆线,dy=+len·sin40°),腕外手掌圆
const ARM = { deg: 40, len: 280, w: 64, hand: 40, sy: 620 };
const armL = {
  sx: 300,
  sy: ARM.sy,
  wx: 300 - ARM.len * Math.cos((ARM.deg * Math.PI) / 180),
  wy: ARM.sy + ARM.len * Math.sin((ARM.deg * Math.PI) / 180),
};
const armR = { sx: 500, sy: ARM.sy, wx: 800 - armL.wx, wy: armL.wy };

const canvasMod = await import("@napi-rs/canvas");
const cv = canvasMod.createCanvas(W, H);
const c = cv.getContext("2d");
c.fillStyle = BG;
c.fillRect(0, 0, W, H);
c.fillStyle = BODY;
c.strokeStyle = INK;
c.lineWidth = STROKE;
c.lineJoin = "round";
c.lineCap = "round";

// 臂先画(被躯干压住肩部接缝),再腿、躯干、头
const limb = (a) => {
  c.beginPath();
  c.moveTo(a.sx, a.sy);
  c.lineTo(a.wx, a.wy);
  c.stroke();
  c.beginPath();
  c.arc(a.wx, a.wy, ARM.hand, 0, Math.PI * 2);
  c.fill();
  c.stroke();
};
limb(armL);
limb(armR);
for (const leg of [legL, legR]) {
  c.beginPath();
  c.roundRect(leg.x, leg.y, leg.w, leg.h, leg.rx);
  c.fill();
  c.stroke();
}
c.beginPath();
c.roundRect(torso.x, torso.y, torso.w, torso.h, torso.rx);
c.fill();
c.stroke();
c.beginPath();
c.arc(head.cx, head.cy, head.r, 0, Math.PI * 2);
c.fill();
c.stroke();

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dev-docs", "companion-bot-lab");
mkdirSync(outDir, { recursive: true });
const outPath = process.argv[2] ?? join(outDir, "white-model-apose.png");
writeFileSync(outPath, await cv.encode("png"));
console.log("白模 →", outPath);
console.log(
  `几何: 二头身 头径=${head.r * 2} 总高=${legL.y + legL.h - (head.cy - head.r)} A-pose ${ARM.deg}° 画布 ${W}x${H} (2:3)`,
);
