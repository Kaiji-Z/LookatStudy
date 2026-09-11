/**
 * cut-figure —— 单图切分冒烟 CLI(SPEC §15 判据 2 / §17)。
 *
 * 用法: npx tsx scripts/companion-pack/cut-figure.mjs <输入.png> [输出目录] [--cuts <cuts.json>]
 *
 * 行为:键控 → 切分线划分(几何启发式已退役,SPEC §17.6):
 *   --cuts 提供 VLM 协议格式的 JSON({"cuts": {"headBody": [[x,y],...], ...},
 *   坐标归一化或像素)→ 走完整 vision 划分;
 *   未提供 --cuts → 无切分线,诚实降级 L1(整图贴纸)——真实识图链路在
 *   scripts/live-test/live-test-companion-cut.mjs(需 API key)。
 * route=l1 时打印"降级 L1: 原因"并以 0 退出——降级是正常路径不是失败。
 */
import { loadImage, createCanvas, ImageData } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const argv = process.argv.slice(2);
const positional = [];
let cutsFile;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--cuts") {
    cutsFile = argv[++i];
  } else if (!argv[i].startsWith("--")) {
    positional.push(argv[i]);
  }
}
const [src, outArg] = positional;
if (!src) {
  console.error("用法: npx tsx scripts/companion-pack/cut-figure.mjs <输入.png> [输出目录] [--cuts <cuts.json>]");
  process.exit(2);
}

const { keyFigure, routeCut, addWhiteOutline, buildCutManifest, composeKeyedPreview, parseCutsJson } = await import(
  "../../shared/companion-cut.ts"
);

const img = await loadImage(src);
const W = img.width;
const H = img.height;
const cv = createCanvas(W, H);
const ctx = cv.getContext("2d");
ctx.drawImage(img, 0, 0);
const rgba = { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data };

const fm = keyFigure(rgba);

// 调试产物:键控预览(VLM 实际看到的图)落盘,肉眼核对掩码质量
const pv = createCanvas(W, H);
pv.getContext("2d").putImageData(
  new ImageData(new Uint8ClampedArray(composeKeyedPreview(rgba, fm).data), W, H),
  0,
  0,
);

let cuts = null;
if (cutsFile) {
  cuts = parseCutsJson(readFileSync(cutsFile, "utf8"), W, H);
  if (!cuts) {
    console.error(`cuts 文件解析失败: ${cutsFile}`);
    process.exit(2);
  }
}

const result = routeCut(rgba, { cuts });
const outDir = outArg ?? path.join(path.dirname(src), "companion-cut-out");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "keyed-preview.png"), await pv.encode("png"));

if (result.route === "l1") {
  console.log(`降级 L1: 原因=${result.failure}${cuts ? "(cuts 已提供但校验失败)" : "(未提供 --cuts)"}`);
  console.log(`debug: ${JSON.stringify(result.debug)}`);
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ route: "l1", reason: result.failure }, null, 2));
  console.log(`[降级 L1] 已写入 ${outDir}/manifest.json(键控预览 → ${outDir}/keyed-preview.png)`);
  process.exit(0);
}

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
console.log(`route=${result.route} mode=${fm.mode} accepted=${JSON.stringify(result.debug.accepted)}`);
console.log(`manifest → ${path.join(outDir, "manifest.json")}(键控预览 → ${outDir}/keyed-preview.png)`);
