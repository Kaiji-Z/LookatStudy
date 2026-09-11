/**
 * verify-companion-png —— PNG 像素进出双后端的回归断言(2026-09-11,Termux)。
 *
 * 背景:@napi-rs/canvas 无 Android 预编译,手机端(Termux)切分管线落 pngjs
 * 纯 JS 后端(png-codec.ts)。本套件锁住"手机端做出来 = 电脑端做出来":
 *   - T1 纯后端编解码往返无损(含半透明像素)
 *   - T2 napi ↔ pngjs 解码逐字节一致(桌面跑;Android 无 napi 自动 SKIP)
 *   - T3 resizeBox 面积平均:均匀块精确均值;透明像素 RGB 不 bleed(预乘域平均)
 *   - T4 全链对拍:同一 fixture + 同一 mock 切分线,napi 后端 vs pure 后端跑
 *     cutCompanionFigure → route/manifest 全等,部件 PNG 解码后逐字节相等
 *   - T5 坏 PNG 诚实抛错(两后端都不静默)
 *   - T6 verify:core 链含本套件
 *
 * 运行:npx tsx scripts/verify-companion-png.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

const { PNG } = await import("pngjs");
const { createCanvas } = await import("@napi-rs/canvas").then(
  (m) => m,
  () => null,
);
const hasNapi = createCanvas != null;

const shared = await import("../shared/companion-cut.ts");
const { decodePngPure, encodePngPure, resizeBox } = await import("../src/main/services/pure/png-codec.ts");
const { cutCompanionFigure } = await import("../src/main/services/companion-pack-service.ts");

let pass = 0;
const t = async (name, fn) => {
  await fn();
  pass++;
  console.log(`  ok ${pass} - ${name}`);
};
const tSkip = (name) => console.log(`  ok ${pass++} - ${name} (SKIP: napi 不可用)`);

/* ---------------- 工具 ---------------- */

/** 程序化 RGBA:左上渐变 + 半透明圆 + 透明区(覆盖 alpha 混合/边缘场景)。 */
function syntheticRgba(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 255) / w;
      data[i + 1] = (y * 255) / h;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  // 半透明圆(中心)
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = (y * w + x) * 4;
        data[i] = 255;
        data[i + 1] = 80;
        data[i + 2] = 40;
        data[i + 3] = 140;
      }
    }
  }
  return { width: w, height: h, data };
}

function rgbaOf(pngBytes) {
  const buf = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes);
  const img = PNG.sync.read(buf);
  return { width: img.width, height: img.height, data: img.data };
}

function samePixels(a, b) {
  return a.width === b.width && a.height === b.height && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;
}

/* ---------------- T1 往返无损 ---------------- */

await t("T1 pngjs 编码→解码往返无损(渐变+半透明圆)", () => {
  const img = syntheticRgba(97, 61); // 非整尺寸防巧合
  const bytes = encodePngPure(img);
  const back = decodePngPure(bytes);
  assert.ok(samePixels(img, back));
});

/* ---------------- T2 napi ↔ pngjs 解码一致 ---------------- */

if (hasNapi) {
  await t("T2 napi 与 pngjs 解码逐字节一致(RGBA8 fixture)", async () => {
    const bytes = encodePngPure(syntheticRgba(64, 48));
    const pure = decodePngPure(bytes);
    const { loadImage, createCanvas: cc } = await import("@napi-rs/canvas");
    const im = await loadImage(bytes);
    const cv = cc(im.width, im.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(im, 0, 0);
    const napiImg = { width: im.width, height: im.height, data: ctx.getImageData(0, 0, im.width, im.height).data };
    assert.ok(samePixels(napiImg, pure));
  });
} else {
  tSkip("T2 napi 与 pngjs 解码逐字节一致");
}

/* ---------------- T3 resizeBox ---------------- */

await t("T3a resizeBox 均匀块缩到 1×1 = 精确均值", () => {
  const w = 8;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 90;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  const [px] = [resizeBox({ width: w, height: h, data }, 1, 1).data];
  assert.deepStrictEqual([px[0], px[1], px[2], px[3]], [40, 90, 200, 255]);
});

await t("T3b resizeBox 预乘平均:透明像素 RGB 不 bleed", () => {
  // 左列不透明纯红,右列全透明但 RGB=蓝(坏实现会平均出紫色)
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]);
  const out = resizeBox({ width: 2, height: 1, data }, 1, 1).data;
  assert.strictEqual(out[3], 128); // alpha 均值
  assert.strictEqual(out[0], 255); // 红不被透明蓝稀释
  assert.strictEqual(out[1], 0);
  assert.strictEqual(out[2], 0); // 无蓝 bleed
});

await t("T3c resizeBox 放大合法(≤96px 头件不再缩小场景)", () => {
  const one = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) };
  const up = resizeBox(one, 3, 3);
  assert.strictEqual(up.width, 3);
  assert.strictEqual(up.data[0], 10);
});

/* ---------------- T4 全链对拍(napi 后端 vs pure 后端) ---------------- */

const cutsJson = JSON.stringify({
  cuts: {
    headBody: [
      [0.03, 0.375],
      [0.97, 0.375],
    ],
    armLeft: [
      [0.335, 0.375],
      [0.335, 0.635],
    ],
    armRight: [
      [0.665, 0.375],
      [0.665, 0.635],
    ],
  },
});

/** A-pose fixture(与 ui-test 注入切分线同源),输出 PNG 字节。 */
function aposeFixturePng() {
  const cv = createCanvas(400, 600);
  const c = cv.getContext("2d");
  c.fillStyle = "#00B140";
  c.fillRect(0, 0, 400, 600);
  c.fillStyle = "#E8B88A";
  c.beginPath();
  c.arc(200, 110, 80, 0, Math.PI * 2);
  c.fill();
  c.fillRect(185, 180, 30, 45);
  c.fillRect(150, 220, 100, 150);
  c.lineCap = "round";
  c.lineWidth = 34;
  c.beginPath();
  c.moveTo(155, 245);
  c.lineTo(75, 355);
  c.stroke();
  c.beginPath();
  c.moveTo(245, 245);
  c.lineTo(325, 355);
  c.stroke();
  c.fillRect(165, 370, 30, 130);
  c.fillRect(205, 370, 30, 130);
  return cv.toBuffer("image/png");
}

async function cutOnce(pngBytes) {
  return cutCompanionFigure(
    { db: {}, locate: async () => cutsJson },
    { png: pngBytes },
  );
}

if (hasNapi) {
  await t("T4 全链对拍:napi 后端 vs pure 后端,route/manifest 全等 + 部件像素逐字节相等", async () => {
    const pngBytes = aposeFixturePng();
    const prev = process.env.LOOKATSTUDY_PNG_BACKEND;
    try {
      process.env.LOOKATSTUDY_PNG_BACKEND = "";
      const viaNapi = await cutOnce(pngBytes);
      process.env.LOOKATSTUDY_PNG_BACKEND = "pure";
      const viaPure = await cutOnce(pngBytes);

      assert.strictEqual(viaNapi.route, viaPure.route);
      assert.strictEqual(viaNapi.route, "vision");
      assert.deepStrictEqual(viaPure.manifest, viaNapi.manifest);
      assert.strictEqual(viaPure.parts.length, viaNapi.parts.length);
      for (let i = 0; i < viaNapi.parts.length; i++) {
        assert.strictEqual(viaPure.parts[i].name, viaNapi.parts[i].name);
        // 文件字节允许不同(压缩器),解码后的像素必须逐字节相等
        assert.ok(
          samePixels(rgbaOf(viaPure.parts[i].png), rgbaOf(viaNapi.parts[i].png)),
          `部件 ${viaNapi.parts[i].name} 像素不一致`,
        );
      }
    } finally {
      if (prev === undefined) delete process.env.LOOKATSTUDY_PNG_BACKEND;
      else process.env.LOOKATSTUDY_PNG_BACKEND = prev;
    }
  });
} else {
  tSkip("T4 全链对拍(Android 上 pure 即唯一后端,无可对拍对象)");
}

t("T4b 大图(>768 长边)预览降采样后切分不受影响,双后端 manifest 一致", async () => {
  // 2× A-pose(800×1200,长边>768 触发降采样),归一化切分线与 T4 相同
  const cv = createCanvas(800, 1200);
  const c = cv.getContext("2d");
  c.fillStyle = "#00B140";
  c.fillRect(0, 0, 800, 1200);
  c.fillStyle = "#E8B88A";
  c.beginPath(); c.arc(400, 220, 160, 0, Math.PI * 2); c.fill();
  c.fillRect(370, 360, 60, 90);
  c.fillRect(300, 440, 200, 300);
  c.lineCap = "round"; c.lineWidth = 68;
  c.beginPath(); c.moveTo(310, 490); c.lineTo(150, 710); c.stroke();
  c.beginPath(); c.moveTo(490, 490); c.lineTo(650, 710); c.stroke();
  c.fillRect(330, 740, 60, 260);
  c.fillRect(410, 740, 60, 260);
  const pngBytes = cv.toBuffer("image/png");
  const prev = process.env.LOOKATSTUDY_PNG_BACKEND;
  try {
    process.env.LOOKATSTUDY_PNG_BACKEND = "";
    const viaNapi = await cutOnce(pngBytes);
    process.env.LOOKATSTUDY_PNG_BACKEND = "pure";
    const viaPure = await cutOnce(pngBytes);
    assert.strictEqual(viaNapi.route, "vision", "降采样不得破坏归一化切分线(掉 L1 即坐标被破坏)");
    assert.deepStrictEqual(viaPure.manifest, viaNapi.manifest);
    assert.ok((viaNapi.parts ?? []).length >= 3);
  } finally {
    if (prev === undefined) delete process.env.LOOKATSTUDY_PNG_BACKEND;
    else process.env.LOOKATSTUDY_PNG_BACKEND = prev;
  }
});

/* ---------------- T5 坏 PNG 诚实抛错 ---------------- */

await t("T5 坏 PNG 诚实抛错(pure 后端不静默)", async () => {
  const prev = process.env.LOOKATSTUDY_PNG_BACKEND;
  try {
    process.env.LOOKATSTUDY_PNG_BACKEND = "pure";
    await assert.rejects(() => cutOnce(Buffer.from("not a png")), /./);
  } finally {
    if (prev === undefined) delete process.env.LOOKATSTUDY_PNG_BACKEND;
    else process.env.LOOKATSTUDY_PNG_BACKEND = prev;
  }
});

/* ---------------- T5b IEND 后杂尾(手机真机现场) ---------------- */

t("T5b IEND 后杂尾自动截断(生成站 PNG 常见,桌面 skia 宽容 pngjs 曾必炸)", () => {
  const img = syntheticRgba(50, 80);
  const clean = encodePngPure(img);
  const junk = Buffer.concat([clean, Buffer.from([0xde, 0xad, 0xbe, 0xef]), Buffer.alloc(97, 0x20), Buffer.from("some generator metadata")]);
  const back = decodePngPure(junk);
  assert.ok(samePixels(img, back), "截尾后解码应与干净解码逐字节一致");
  // 结构损坏(截半的 PNG)仍诚实抛错,不吞
  assert.throws(() => decodePngPure(clean.subarray(0, 20)), /./);
});

/* ---------------- T6 verify:core 链含本套件 ---------------- */

await t("T6 package.json verify:core 链含 verify-companion-png", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts["verify:core"].includes("verify-companion-png"));
});

console.log(`\nverify-companion-png: ${pass} 断言全部通过`);
