/**
 * make-sheet-template —— 分件设计图「白模」控制图(SVG,SPEC §13.7)。
 *
 * 用户拍板(2026-09-09):白模直接画出 整体/头/身体/双臂 的哑模剪影并排在
 * 正确位置,比例严格二头身(参照 Q版2头身教程:头=1,颈→胯=0.5,胯→脚=0.5,
 * 肩宽 < 头宽,臂垂至胯)。纯矢量白模,零生成图入模。
 *
 * 形状语义:
 * - 左:完整站姿人偶(双手微张);
 * - 右上:头部件 —— 底部沿颈线**平切**(椭圆去底冠);
 * - 右中:身体部件 —— 顶部带**颈桩**(颈到脚一整件,无手臂);
 * - 右下:双臂部件 —— 肩端**平切**、指尖到掌,两条完整手臂。
 * 白色哑模若被模型复制进成品,机检按多余连通块判废卷。
 *
 * 用法: node scripts/companion-pack/make-sheet-template.mjs [输出.svg] [--png 输出.png]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const W = 1024;
const H = 1536; // 纵向 2:3:内容自然纵横比 ≈0.72(右栏 3U 高 > 左图 2U),横版浪费中缝
const BG = "#00B140";
const PART = "#FFFFFF";

/* ---------------- 设计坐标系(U=330,1536×1024 旧版已验证的几何) ---------------- */
const U = 330;
const FX = 310;
const FTOP = 170; // 头顶
const headCy = FTOP + U / 2; // 335
const neck = { x: FX - 30, y: FTOP + U - 6, w: 60, h: 24 }; // y 494-518
const torso = { x: FX - 108, y: FTOP + U + 5, w: 216, h: 165, rx: 55 }; // y515-680,肩宽<头宽
const legL = { x: 252, y: FTOP + 485, w: 48, h: 145, rx: 20 }; // y655-800
const legR = { x: 320, y: FTOP + 485, w: 48, h: 145, rx: 20 };
const footL = { x: 236, y: FTOP + 612, w: 72, h: 48, rx: 22 }; // y782-830
const footR = { x: 312, y: FTOP + 612, w: 72, h: 48, rx: 22 };
// 手臂:肩锚→腕(粗圆线) + 掌(圆),垂至胯略外张
const armL = { sx: 222, sy: FTOP + 378, wx: 190, wy: FTOP + 480, hx: 172, hy: FTOP + 502 };
const armR = { sx: 398, sy: FTOP + 378, wx: 430, wy: FTOP + 480, hx: 448, hy: FTOP + 502 };
const ARM_W = 44;
const HAND_R = 31;

/* ---------------- 右:部件(与整体同尺度) ---------------- */
const CX = 1073;
// 头部件:椭圆 rx172 ry165,底冠平切于 y=345
const P_HEAD = { cx: CX, cy: 215, rx: 172, ry: 165, cutY: 345 };
const headCutDx = Math.sqrt(P_HEAD.rx ** 2 - (P_HEAD.cutY - P_HEAD.cy) ** 2); // ≈112.6
// 身体部件 = 左整体的身体整体平移(dx=763, dy=-115)
const bNeck = { x: neck.x + 763, y: neck.y - 115, w: neck.w, h: neck.h };
const bTorso = { x: torso.x + 763, y: torso.y - 115, w: torso.w, h: torso.h, rx: 55 };
const bLegL = { x: legL.x + 763, y: legL.y - 115, w: 48, h: 145, rx: 20 };
const bLegR = { x: legR.x + 763, y: legR.y - 115, w: 48, h: 145, rx: 20 };
const bFootL = { x: footL.x + 763, y: footL.y - 115, w: 72, h: 48, rx: 22 };
const bFootR = { x: footR.x + 763, y: footR.y - 115, w: 72, h: 48, rx: 22 };
// 双臂部件:与整体人偶同款 粗圆线+掌,略外张(肩到指尖完整一条)
const pArmL = { sx: 1008, sy: 778, wx: 962, wy: 884, hx: 946, hy: 908 };
const pArmR = { sx: 1138, sy: 778, wx: 1184, wy: 884, hx: 1200, hy: 908 };

const rect = (b, fill = PART) =>
  `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.rx ?? 0}" fill="${fill}"/>`;
const circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PART}"/>`;
const ell = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${PART}"/>`;
const limb = (a) =>
  `<line x1="${a.sx}" y1="${a.sy}" x2="${a.wx}" y2="${a.wy}" stroke="${PART}" stroke-width="${ARM_W}" stroke-linecap="round"/>` +
  circle(a.hx, a.hy, HAND_R);

/* ---------------- 纵向重排:设计坐标 ×S 后平移入 1024×1536 ----------------
 * 设计空间内容 bbox:左图 x138-482 / y170-830,右栏 x901-1245 / y50-939。
 * S=400/330 部件放大 21%;两区各留 30px 边距,中缝 ~130px(防粘连)。 */
const S = 400 / 330;
const FIG_BBOX = { x0: 138, x1: 482, y0: 170, y1: 830 };
const COL_BBOX = { x0: 901, x1: 1245, y0: 50, y1: 939 };
const txF = 30 - FIG_BBOX.x0 * S;
const tyF = (H - (FIG_BBOX.y1 - FIG_BBOX.y0) * S) / 2 - FIG_BBOX.y0 * S;
const txC = W - 30 - COL_BBOX.x1 * S;
const tyC = (H - (COL_BBOX.y1 - COL_BBOX.y0) * S) / 2 - COL_BBOX.y0 * S;

const figureSvg = `
  ${limb(armL)}${limb(armR)}
  ${rect(legL)}${rect(legR)}
  ${rect(footL)}${rect(footR)}
  ${rect(neck)}${rect(torso)}
  ${ell(FX, headCy, 172, U / 2)}`;

const partsSvg = `
  <path d="M ${(P_HEAD.cx - headCutDx).toFixed(1)} ${P_HEAD.cutY} A ${P_HEAD.rx} ${P_HEAD.ry} 0 1 1 ${(P_HEAD.cx + headCutDx).toFixed(1)} ${P_HEAD.cutY} Z" fill="${PART}"/>
  ${rect(bNeck)}${rect(bTorso)}${rect(bLegL)}${rect(bLegR)}${rect(bFootL)}${rect(bFootR)}
  ${limb(pArmL)}
  ${limb(pArmR)}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <g transform="translate(${txF.toFixed(1)} ${tyF.toFixed(1)}) scale(${S.toFixed(4)})">${figureSvg}</g>
  <g transform="translate(${txC.toFixed(1)} ${tyC.toFixed(1)}) scale(${S.toFixed(4)})">${partsSvg}</g>
</svg>
`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "dev-docs", "companion-bot-lab");
mkdirSync(outDir, { recursive: true });
const pngIdx = process.argv.indexOf("--png");
const outPath = pngIdx === 2 ? join(outDir, "sheet-template-2x3.svg") : process.argv[2] ?? join(outDir, "sheet-template-2x3.svg");
writeFileSync(outPath, svg);
console.log("svg →", outPath);

// --png:自检栅格化(也用于上传豆包的即用 PNG)
if (pngIdx > 0) {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(svg, "utf8"));
  const canvas = createCanvas(W, H);
  canvas.getContext("2d").drawImage(img, 0, 0, W, H);
  writeFileSync(process.argv[pngIdx + 1], await canvas.encode("png"));
  console.log("png →", process.argv[pngIdx + 1]);
}
