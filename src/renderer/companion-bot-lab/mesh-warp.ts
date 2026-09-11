/**
 * companion-bot-lab/mesh-warp —— PD-Mesh 最小网格变形(Canvas2D 三角仿射,零依赖)。
 *
 * 原理:把部件图按 cols×rows 网格切三角,每个三角用「裁剪 + setTransform + drawImage」
 * 做仿射贴图——Live2D/Spine 网格变形的降配版,本文件只服务实验页(不进产品代码路径,
 * 见 .goal/SPEC.md §5)。16K 级性能不设防:实验页单角色小画布,60fps 足够。
 */

export interface MeshDeform {
  /** (u,v) ∈ [0,1]² 为部件内归一坐标,t 为 ms 时间戳,返回像素级位移。 */
  (u: number, v: number, t: number): { dx: number; dy: number };
}

export interface MeshWarpOptions {
  /** 目标区域(画布像素) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 当前时间 ms(驱动变形) */
  t: number;
  deform: MeshDeform;
  cols?: number;
  rows?: number;
  /** 源矩形(img 像素;缺省整图)。部件画布为 512² 全坐标系时,传部件所在区域。 */
  src?: { x: number; y: number; w: number; h: number };
}

/**
 * 把 img 画到 ctx 的 (x,y,w,h) 区域,网格顶点先经 deform 位移,再逐三角仿射贴图。
 */
export function drawMeshWarp(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  opts: MeshWarpOptions,
): void {
  const { x, y, w, h, t, deform } = opts;
  const cols = opts.cols ?? 6;
  const rows = opts.rows ?? 8;
  const src = opts.src ?? { x: 0, y: 0, w: img.width, h: img.height };

  // 网格顶点(基础位置 + 位移)
  const pts: number[][] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      const d = deform(u, v, t);
      pts.push([x + u * w + d.dx, y + v * h + d.dy]);
    }
  }
  const at = (i: number, j: number): number[] => pts[j * (cols + 1) + i];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p00 = at(i, j);
      const p10 = at(i + 1, j);
      const p01 = at(i, j + 1);
      const p11 = at(i + 1, j + 1);
      const sx0 = src.x + (i / cols) * src.w;
      const sy0 = src.y + (j / rows) * src.h;
      const sx1 = src.x + ((i + 1) / cols) * src.w;
      const sy1 = src.y + ((j + 1) / rows) * src.h;
      // 每格两个三角(src 三点 → dst 三点)
      tri(ctx, img, [sx0, sy0], [sx1, sy0], [sx0, sy1], p00, p10, p01);
      tri(ctx, img, [sx1, sy0], [sx1, sy1], [sx0, sy1], p10, p11, p01);
    }
  }
}

/** 单三角仿射贴图:求 src→dst 的 2×3 仿射,clip 后整体 drawImage。 */
function tri(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: number[],
  s1: number[],
  s2: number[],
  d0: number[],
  d1: number[],
  d2: number[],
): void {
  const denom = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(denom) < 1e-8) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / denom;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / denom;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / denom;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / denom;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
