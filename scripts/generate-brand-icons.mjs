// 从一张方形品牌源图生成全端应用图标(ac4f921 资产管的脚本化复现,2026-10 换用大构图高清源):
//   build/icon.png                 1024  electron-builder → win exe / mac icns / linux AppImage+deb(满幅)
//   src/renderer/public/icon-192/512  PWA manifest purpose=any + favicon(满幅)
//   src/renderer/public/icon-512-maskable  PWA maskable(字形收进 40% 半径安全区)
//   android mipmap 五密度 fg/bg    自适应图标(108dp 制:mdpi108/hdpi162/xhdpi216/xxhdpi324/xxxhdpi432)
// Android/PWA-maskable 的字形安全区:新源图 L 外沿半径达画布 ~46%,直接满幅会被
// 圆形蒙版(Android 72dp 可视圆 = 33.3% 半径)裁角,故前景层把源图缩画进安全区,
// 底色取源图边缘均色,与图内奶油渐变无缝。
// 用法: node scripts/generate-brand-icons.mjs <源图.png>
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(root, "build", "icon.png"));

const ANDROID_DENSITIES = [
  ["mipmap-mdpi", 108],
  ["mipmap-hdpi", 162],
  ["mipmap-xhdpi", 216],
  ["mipmap-xxhdpi", 324],
  ["mipmap-xxxhdpi", 432],
];
// 源字形最远点半径 ~46.4% 画布 → 缩 0.70 后 ~32.5%,收进 72dp 可视圆(33.3%)内
const ANDROID_FG_SCALE = 0.7;
// PWA maskable 安全区 = 40% 半径 → 0.82 × 46.4% ≈ 38%
const MASKABLE_SCALE = 0.82;

const img = await loadImage(source);
if (img.width !== img.height) throw new Error(`source must be square, got ${img.width}x${img.height}`);

// 源图边缘均色(缩略图上采四边)
function edgeColor() {
  const S = 256;
  const c = createCanvas(S, S);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let r = 0, g = 0, b = 0, n = 0;
  const add = (x, y) => { const k = (y * S + x) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; };
  for (let i = 0; i < S; i++) { add(i, 0); add(i, S - 1); add(0, i); add(S - 1, i); }
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

// 满幅版(桌面/PWA any/Android 背景):源图整幅缩放
function fullBleed(size) {
  const c = createCanvas(size, size);
  c.getContext("2d").drawImage(img, 0, 0, size, size);
  return c;
}

// 安全区版(fg / maskable):底色填充 + 源图居中缩画,边缘羽化——
// 源图背景带渐晕(左缘近白、右缘奶油),与均色填充的硬边界会有 ~40 色阶的接缝,
// 羽化成渐变后不可见
function fitted(size, scale, fill, featherFrac = 0.06) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  const s = size * scale;
  const inner = createCanvas(s, s);
  const ictx = inner.getContext("2d");
  ictx.drawImage(img, 0, 0, s, s);
  const band = s * featherFrac;
  ictx.globalCompositeOperation = "destination-out";
  const fade = (gx0, gy0, gx1, gy1) => {
    const g = ictx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ictx.fillStyle = g;
    ictx.fillRect(0, 0, s, s);
  };
  fade(0, 0, 0, band);
  fade(0, s, 0, s - band);
  fade(0, 0, band, 0);
  fade(s, 0, s - band, 0);
  ctx.drawImage(inner, (size - s) / 2, (size - s) / 2);
  return c;
}

function save(canvas, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canvas.toBuffer("image/png"));
  console.log("wrote", path, `${canvas.width}x${canvas.height}`);
}

const fill = edgeColor();
save(fullBleed(1024), join(root, "build", "icon.png"));
save(fullBleed(192), join(root, "src", "renderer", "public", "icon-192.png"));
save(fullBleed(512), join(root, "src", "renderer", "public", "icon-512.png"));
save(fitted(512, MASKABLE_SCALE, fill), join(root, "src", "renderer", "public", "icon-512-maskable.png"));
for (const [dir, size] of ANDROID_DENSITIES) {
  const base = join(root, "android", "app", "src", "main", "res", dir);
  save(fullBleed(size), join(base, "ic_launcher_background.png"));
  save(fitted(size, ANDROID_FG_SCALE, fill), join(base, "ic_launcher_foreground.png"));
}
console.log("done, source:", source, "fill:", fill);
