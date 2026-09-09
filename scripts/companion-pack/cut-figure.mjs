/**
 * cut-figure —— 单图切分冒烟 CLI(SPEC §15 判据 2)。
 *
 * 用法: npx tsx scripts/companion-pack/cut-figure.mjs <输入.png> [输出目录]
 *
 * 行为:键控 → 降级路由(T1 锚点未提供时走 T2 几何)→ 部件白描边 →
 * 部件 PNG + manifest.json 落盘。route=l1 时打印"降级 L1: 原因"并以 0 退出
 * ——降级是正常路径不是失败(判据要求路由机器可判定、不允许 crash)。
 */
import { loadImage, createCanvas, ImageData } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error("用法: npx tsx scripts/companion-pack/cut-figure.mjs <输入.png> [输出目录]");
  process.exit(2);
}

const { keyFigure, routeCut, addWhiteOutline, buildCutManifest } = await import(
  "../../shared/companion-cut.ts"
);

const img = await loadImage(src);
const W = img.width;
const H = img.height;
const cv = createCanvas(W, H);
const ctx = cv.getContext("2d");
ctx.drawImage(img, 0, 0);
const rgba = { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data };

const result = routeCut(rgba);
const outDir = outArg ?? path.join(path.dirname(src), "companion-cut-out");
mkdirSync(outDir, { recursive: true });

if (result.route === "l1") {
  console.log(`降级 L1: 原因=${result.failure}`);
  console.log(
    `debug: 颈线=${result.debug.neck ? `y=${result.debug.neck.y} 宽=${result.debug.neck.width}` : "未检出"} 缝行率=${result.debug.gaps ? result.debug.gaps.ratio.toFixed(2) : "n/a"}`,
  );
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ route: "l1", reason: result.failure }, null, 2));
  console.log(`[降级 L1] 已写入 ${outDir}/manifest.json`);
  process.exit(0);
}

const fm = keyFigure(rgba);
const files = {};
for (const part of result.parts) {
  const outlined = addWhiteOutline(
    { width: part.box.w, height: part.box.h, data: part.rgba },
    Math.max(3, Math.round(Math.min(part.box.w, part.box.h) * 0.02)),
  );
  const pc = createCanvas(part.box.w, part.box.h);
  pc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(outlined.data), part.box.w, part.box.h), 0, 0);
  const file = `${part.name}.png`;
  writeFileSync(path.join(outDir, file), await pc.encode("png"));
  files[part.name] = file;
  console.log(`  ${part.name}: box=(${part.box.x},${part.box.y}) ${part.box.w}x${part.box.h} → ${file}`);
}

const manifest = buildCutManifest(rgba, result.route, fm.mode, result.parts, files, {
  id: ("cut-" + path.basename(src).replace(/\.[a-z]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 48),
  name: path.basename(src),
  author: "companion-cut",
  license: "UNLICENSED",
});
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`route=${result.route} mode=${fm.mode} 缝行率=${result.debug.gaps ? result.debug.gaps.ratio.toFixed(2) : "n/a"}`);
console.log(`manifest → ${path.join(outDir, "manifest.json")}`);
