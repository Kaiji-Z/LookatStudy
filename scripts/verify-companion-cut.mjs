/**
 * verify-companion-cut —— 单图切分管线(免费层供给)的回归断言。
 *
 * 覆盖(SPEC §14/§15,样本实证驱动):
 *   - 键控自动分流:绿幕(#00B140 系)/alpha 双路径
 *   - 颈线/头身分界:行宽剖面局部最小 + 肩线跳变;无脖子形态诚实返回 null
 *   - 腋缝带扫描:A-pose/T-pose/融合三态
 *   - 降级路由:geometric(缝带)→ vision(部件 bbox 划分,"不重叠必可切")→ l1
 *   - 白描边(膨胀垫白)与切分包 manifest
 *
 * 合成 fixture 全部程序化绘制(确定性,入库);真实样本冒烟走
 * scripts/companion-pack/cut-figure.mjs(本地 fixtures,缺失自动 SKIP)。
 *
 * 运行:npx tsx scripts/verify-companion-cut.mjs
 */
import assert from "node:assert";
import { createCanvas } from "@napi-rs/canvas";

const { keyFigure, detectHeadBoundary, scanArmGapBands, routeCut, addWhiteOutline, buildCutManifest, parseAnchorsJson } =
  await import("../shared/companion-cut.ts");

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log(`  ok ${pass} - ${name}`);
};

/* ---------------- 合成 fixture(程序化绘制,确定性) ---------------- */

const GREEN = "#00B140";
const SKIN = "#E8B88A";

function newCanvas(W, H, mode) {
  const cv = createCanvas(W, H);
  const c = cv.getContext("2d");
  if (mode === "green") {
    c.fillStyle = GREEN;
    c.fillRect(0, 0, W, H);
  }
  return [cv, c];
}

function toRgba(cv) {
  const c = cv.getContext("2d");
  return { width: cv.width, height: cv.height, data: c.getImageData(0, 0, cv.width, cv.height).data };
}

/** Q版二头身 A-pose(45° 外张;merged=true 时双臂贴身无缝)。 */
function drawApose({ mode = "green", merged = false } = {}) {
  const [cv, c] = newCanvas(400, 600, mode);
  c.fillStyle = SKIN;
  c.strokeStyle = SKIN;
  c.lineCap = "round";
  // 头
  c.beginPath();
  c.arc(200, 110, 80, 0, Math.PI * 2);
  c.fill();
  // 脖子(头底-躯干过渡)
  c.fillRect(185, 180, 30, 45);
  // 躯干
  c.fillRect(150, 220, 100, 150);
  // 双臂 45° 外张(merged=贴身垂臂)
  c.lineWidth = 34;
  c.beginPath();
  c.moveTo(merged ? 150 : 155, 245);
  c.lineTo(merged ? 150 : 75, 355);
  c.stroke();
  c.beginPath();
  c.moveTo(merged ? 250 : 245, 245);
  c.lineTo(merged ? 250 : 325, 355);
  c.stroke();
  // 双腿
  c.fillRect(165, 370, 30, 130);
  c.fillRect(205, 370, 30, 130);
  return toRgba(cv);
}

/** Q版二头身 T-pose(双臂水平,臂与躯干间留缝)。 */
function drawTpose({ mode = "green" } = {}) {
  const [cv, c] = newCanvas(400, 600, mode);
  c.fillStyle = SKIN;
  c.beginPath();
  c.arc(200, 110, 80, 0, Math.PI * 2);
  c.fill();
  c.fillRect(185, 180, 30, 45);
  c.fillRect(140, 225, 120, 20); // 肩部桥(连接臂与躯干)
  c.fillRect(160, 245, 80, 205); // 躯干
  c.fillRect(30, 235, 125, 50); // 左臂(水平)
  c.fillRect(245, 235, 125, 50); // 右臂
  c.fillRect(165, 450, 30, 100);
  c.fillRect(205, 450, 30, 100);
  return toRgba(cv);
}

/** 巨头无颈形态(熊类):头宽压过臂带,几何颈线应诚实返回 null。 */
function drawBearMerged() {
  const [cv, c] = newCanvas(400, 600, "green");
  c.fillStyle = SKIN;
  c.beginPath();
  c.arc(200, 150, 120, 0, Math.PI * 2);
  c.fill();
  c.fillRect(140, 260, 120, 180);
  c.fillRect(120, 270, 40, 120);
  c.fillRect(240, 270, 40, 120);
  c.fillRect(165, 440, 30, 60);
  c.fillRect(205, 440, 30, 60);
  return toRgba(cv);
}

/** 团子形态(头身不分的单椭圆):无颈切分位,应诚实返回 null。 */
function drawBlob() {
  const [cv, c] = newCanvas(400, 600, "green");
  c.fillStyle = SKIN;
  c.beginPath();
  c.ellipse(200, 300, 140, 180, 0, 0, Math.PI * 2);
  c.fill();
  return toRgba(cv);
}

const A = drawApose();
const A_ALPHA = drawApose({ mode: "alpha" });
const T = drawTpose();
const MERGED = drawApose({ merged: true });
const BEAR = drawBearMerged();

/* ---------------- 断言 ---------------- */

t("T1 绿幕键控自动分流(四角不透明 → green)", () => {
  const fm = keyFigure(A);
  assert.equal(fm.mode, "green");
  assert.equal(fm.significantComponents, 1);
  assert.ok(fm.main.w > 200 && fm.main.h > 400);
});

t("T2 alpha 键控自动分流(透明底 → alpha)", () => {
  const fm = keyFigure(A_ALPHA);
  assert.equal(fm.mode, "alpha");
  assert.equal(fm.significantComponents, 1);
});

t("T3 噪点过滤:小于最大块 5% 的水印不计入显著块", () => {
  const [cv, c] = newCanvas(400, 600, "green");
  c.fillStyle = SKIN;
  c.beginPath();
  c.arc(200, 300, 80, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#FFFFFF";
  c.fillRect(20, 560, 30, 18); // 水印样小块(540px ≈ 圆面积 2.7%,明确噪声量级)
  const fm = keyFigure(toRgba(cv));
  assert.equal(fm.significantComponents, 1);
  assert.ok(fm.main.w >= 150 && fm.main.w <= 170, `主块宽 ${fm.main.w}`);
});

t("T4 A-pose 颈线检测:行宽局部最小落在头底过渡带", () => {
  const fm = keyFigure(A);
  const neck = detectHeadBoundary(fm);
  assert.ok(neck, "颈线应检出");
  const rel = (neck.y - fm.main.y) / fm.main.h;
  assert.ok(rel > 0.25 && rel < 0.45, `颈线位置异常: ${(rel * 100).toFixed(1)}%`);
});

t("T5 肩线跳变:分界后出现 ≥1.5× 的宽度跳变", () => {
  const neck = detectHeadBoundary(keyFigure(A));
  assert.ok(neck.shoulderY > neck.y);
  assert.ok(neck.shoulderWidth >= neck.width * 1.5);
});

t("T6 团子形态(头身不分)诚实返回 null;巨头熊的头底收窄是合法头切位", () => {
  // 团子:宽度剖面单调,无局部最小+跳变 → null(不需要也不该切)
  assert.equal(detectHeadBoundary(keyFigure(drawBlob())), null);
  // 巨头熊:头底收窄 + 躯干跳变 = 合法的头/身切位(切了即可点头),应检出
  const bearNeck = detectHeadBoundary(keyFigure(BEAR));
  assert.ok(bearNeck, "熊的头身分界应检出");
  assert.ok(bearNeck.width < bearNeck.shoulderWidth);
});

t("T7 A-pose 缝带:占比 ≥0.15 且存在缝带", () => {
  const fm = keyFigure(A);
  const neck = detectHeadBoundary(fm);
  const gaps = scanArmGapBands(fm, neck.shoulderY);
  assert.ok(gaps.ratio >= 0.15, `缝行率 ${gaps.ratio.toFixed(2)}`);
  assert.ok(gaps.bands.length >= 1);
});

t("T8 T-pose 缝带:占比 ≥0.15", () => {
  const fm = keyFigure(T);
  const neck = detectHeadBoundary(fm);
  const gaps = scanArmGapBands(fm, neck.shoulderY);
  assert.ok(gaps.ratio >= 0.15, `缝行率 ${gaps.ratio.toFixed(2)}`);
});

t("T9 融合臂(贴身垂臂)缝行率 = 0", () => {
  const fm = keyFigure(MERGED);
  const gaps = scanArmGapBands(fm, fm.main.y + Math.floor(fm.main.h * 0.4));
  assert.equal(gaps.ratio, 0);
});

t("T10 A-pose 降级路由 → geometric", () => {
  const r = routeCut(A);
  assert.equal(r.route, "geometric");
});

t("T11 A-pose 产出 ≥3 部件且四名齐全", () => {
  const r = routeCut(A);
  const names = r.parts.map((p) => p.name).sort();
  assert.ok(r.parts.length >= 3);
  for (const n of ["head", "body", "armL", "armR"]) assert.ok(names.includes(n), `缺 ${n}`);
});

t("T12 部件空间有序:armL 在身体左侧,armR 在右侧", () => {
  const r = routeCut(A);
  const cx = (p) => p.box.x + p.box.w / 2;
  const get = (n) => r.parts.find((p) => p.name === n);
  const l = get("armL"), b = get("body"), rr = get("armR");
  assert.ok(l && b && rr);
  assert.ok(cx(l) < cx(b) && cx(b) < cx(rr));
});

t("T13 头在身体上方", () => {
  const r = routeCut(A);
  const head = r.parts.find((p) => p.name === "head");
  const body = r.parts.find((p) => p.name === "body");
  assert.ok(head.box.y < body.box.y);
  assert.ok(head.box.y + head.box.h <= body.box.y + body.box.h);
});

t("T14 T-pose 切分:水平臂件宽大于高", () => {
  const r = routeCut(T);
  assert.equal(r.route, "geometric");
  assert.ok(r.parts.length >= 3);
  const armL = r.parts.find((p) => p.name === "armL");
  assert.ok(armL, "缺左臂");
  assert.ok(armL.box.w > armL.box.h, "T-pose 臂件应为横向");
});

t("T15 融合臂 + 无锚点 → L1(失败原因可判定)", () => {
  const r = routeCut(MERGED);
  assert.equal(r.route, "l1");
  assert.equal(r.parts.length, 0);
  assert.ok(r.failure, "应有失败原因码");
});

t("T16 vision bbox 划分:融合臂 + 锚点 → 不重叠必可切(v7 承诺)", () => {
  const r = routeCut(BEAR, {
    anchors: {
      headY: 270,
      boxes: {
        armL: { x: 118, y: 268, w: 44, h: 124 },
        armR: { x: 238, y: 268, w: 44, h: 124 },
      },
    },
  });
  assert.equal(r.route, "vision");
  assert.ok(r.parts.length >= 3, `parts=${r.parts.length}`);
  const names = r.parts.map((p) => p.name);
  assert.ok(names.includes("armL") && names.includes("armR") && names.includes("head"));
});

t("T17 vision headY 锚点精修:路由标注 vision 且正常出件", () => {
  const r = routeCut(A, { anchors: { headY: 300 } });
  assert.equal(r.route, "vision");
  assert.ok(r.parts.length >= 3);
});

t("T18 全透明输入 → L1,不 crash", () => {
  const [cv] = newCanvas(100, 100, "alpha");
  const r = routeCut(toRgba(cv));
  assert.equal(r.route, "l1");
  assert.equal(r.failure, "TOO_FEW_PARTS");
});

t("T19 非法尺寸 → CUT_BAD_SIZE", () => {
  assert.throws(() => keyFigure({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), /CUT_BAD_SIZE/);
});

t("T20 白描边:尺寸不变,原外存在白色垫底,原图像素保留", () => {
  const src = A_ALPHA; // 透明底:切割后的部件外围 alpha=0,白描边垫在其上
  const out = addWhiteOutline(src, 5);
  assert.equal(out.width, src.width);
  assert.equal(out.height, src.height);
  // 头顶上方 3px 原为全透明,描边后应为白色不透明
  const q = (27 * src.width + 200) * 4;
  assert.ok(out.data[q] === 255 && out.data[q + 1] === 255 && out.data[q + 2] === 255 && out.data[q + 3] === 255, "头顶外应有白色垫底");
  // 头圆心(原 SKIN 色)保留
  const p = (110 * src.width + 200) * 4;
  assert.ok(out.data[p + 3] === 255 && out.data[p + 2] !== 255, "原图像素保留");
});

t("T21 切分包 manifest:字段与部件条目", () => {
  const r = routeCut(A);
  const m = buildCutManifest(A, r.route, "green", r.parts, { head: "head.png", body: "body.png", armL: "armL.png", armR: "armR.png" }, { id: "test-pack", name: "测试包", author: "tester", license: "CC0-1.0" });
  assert.equal(m.formatVersion, 1);
  assert.equal(m.kind, "companion-cut");
  assert.equal(m.id, "test-pack");
  assert.equal(m.source.route, "geometric");
  assert.equal(m.source.keyMode, "green");
  assert.equal(m.parts.head.file, "head.png");
  assert.ok(m.parts.head.box.w > 0);
});

t("T22 高阈值机器降级:minGapRatio 提高后 A-pose 也落 L1(阈值可判定)", () => {
  const r = routeCut(A, { minGapRatio: 0.9 });
  assert.equal(r.route, "l1");
});

/* ---- T1 识图定位解析链:mock 响应 → 锚点 → 切线 ---- */

t("T23 parseAnchorsJson:围栏+废话容忍,px 坐标解析", () => {
  const raw =
    '好的，以下是定位 JSON：\n```json\n{"headY": 270, "boxes": {"head": [100,20,200,240], "armL": [118,268,44,124], "armR": [238,268,44,124]}}\n```\n请查收。';
  const a = parseAnchorsJson(raw, 400, 600);
  assert.ok(a, "应解析成功");
  assert.equal(a.headY, 270);
  assert.deepEqual(a.boxes.armL, { x: 118, y: 268, w: 44, h: 124 });
  assert.deepEqual(a.boxes.armR, { x: 238, y: 268, w: 44, h: 124 });
});

t("T24 parseAnchorsJson:归一化坐标按图像尺寸还原", () => {
  const a = parseAnchorsJson(
    '{"boxes": {"armL": [0.2, 0.45, 0.1, 0.2], "armR": [0.7, 0.45, 0.1, 0.2], "head": [0.3, 0.05, 0.4, 0.4]}}',
    400,
    600,
  );
  assert.ok(a);
  assert.deepEqual(a.boxes.armL, { x: 80, y: 270, w: 40, h: 120 });
  assert.deepEqual(a.boxes.head, { x: 120, y: 30, w: 160, h: 240 });
});

t("T25 parseAnchorsJson:垃圾文本 / 缺 armR → null;垃圾 headY 宽容降为 undefined", () => {
  assert.equal(parseAnchorsJson("这不是 JSON 输出", 400, 600), null);
  assert.equal(parseAnchorsJson('{"headY": 100, "boxes": {"head": [1,2,3,4]}}', 400, 600), null);
  const a = parseAnchorsJson('{"headY": "abc", "boxes": {"armL": [0,0,1,1], "armR": [1,0,1,1]}}', 400, 600);
  assert.ok(a, "armL/armR 有效时忽略垃圾 headY");
  assert.equal(a.headY, undefined);
});

t("T26 mock 响应→锚点→切线 全链:VLM 原文解析后进路由,融合臂出件", () => {
  const raw = '```json\n{"headY": 270, "boxes": {"armL": [118, 268, 44, 124], "armR": [238, 268, 44, 124]}}\n```';
  const anchors = parseAnchorsJson(raw, 400, 600);
  assert.ok(anchors, "锚点解析应成功");
  const r = routeCut(BEAR, { anchors });
  assert.equal(r.route, "vision");
  assert.ok(r.parts.length >= 3, `parts=${r.parts.length}`);
});

console.log(`\nverify-companion-cut: ${pass} 断言全部通过`);
