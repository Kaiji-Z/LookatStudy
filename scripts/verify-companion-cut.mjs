/**
 * verify-companion-cut —— 单图切分管线(免费层供给)的回归断言。
 *
 * 覆盖(SPEC §17,切分线协议;旧几何链已退役):
 *   - 键控自动分流:绿幕(#00B140 系)/alpha 双路径 + 噪点过滤
 *   - 键控预览合成(VLM 输入图):背景涂深灰、角色原样
 *   - parseCutsJson:围栏/废话/键名变体/归一化还原/垃圾点
 *   - planCutCurves:端点外找背景、线要碰到角色、两线不交叉
 *   - partitionByCurves:栅栏 BFS 四件套 / 臂线缺席两件套(降级可以切坏不行)
 *   - routeCut 降级路由与失败原因码 / 白描边 / manifest / layoutParts
 *
 * 旧几何链(颈线/缝带/逐行切/box 划分)的断言随实现一并退役;其中"body 谓词
 * 切半"类事故(T34)在新划分下结构性不可能——body 是 BFS 连通块而非逐行谓词。
 *
 * 运行:npx tsx scripts/verify-companion-cut.mjs
 */
import assert from "node:assert";
import { createCanvas } from "@napi-rs/canvas";

const {
  keyFigure,
  applyFigureKey,
  composeKeyedPreview,
  routeCut,
  addWhiteOutline,
  buildCutManifest,
  parseCutsJson,
  planCutCurves,
  partitionByCurves,
  snapCurvesToEdges,
  layoutParts,
  armRestAngleDeg,
} = await import("../shared/companion-cut.ts");

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

/** Q版二头身 A-pose(45° 外张臂,肩部与躯干相连)。 */
function drawApose({ mode = "green" } = {}) {
  const [cv, c] = newCanvas(400, 600, mode);
  c.fillStyle = SKIN;
  c.strokeStyle = SKIN;
  c.lineCap = "round";
  c.beginPath();
  c.arc(200, 110, 80, 0, Math.PI * 2);
  c.fill();
  c.fillRect(185, 180, 30, 45); // 脖子
  c.fillRect(150, 220, 100, 150); // 躯干
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
  return toRgba(cv);
}

/** Q版二头身 T-pose(双臂水平,经肩桥与躯干相连)。 */
function drawTpose({ mode = "green" } = {}) {
  const [cv, c] = newCanvas(400, 600, mode);
  c.fillStyle = SKIN;
  c.beginPath();
  c.arc(200, 110, 80, 0, Math.PI * 2);
  c.fill();
  c.fillRect(185, 180, 30, 45);
  c.fillRect(140, 225, 120, 20); // 肩部桥
  c.fillRect(160, 245, 80, 205); // 躯干
  c.fillRect(30, 235, 125, 50); // 左臂
  c.fillRect(245, 235, 125, 50); // 右臂
  c.fillRect(165, 450, 30, 100);
  c.fillRect(205, 450, 30, 100);
  return toRgba(cv);
}

/** 巨头无颈形态(熊类):头圆直接坐在躯干上,臂与躯干矩形重叠(粘连形态)。 */
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

const A = drawApose();
const A_ALPHA = drawApose({ mode: "alpha" });
const T = drawTpose();
const BEAR = drawBearMerged();

/* ---------- 切分线 fixture(与绘制几何对齐的手工线,SPEC §17.1 语义) ---------- */

/** 内部类型是 {x,y} 对象;裸 [[x,y]] 对只有 parseCutsJson 负责,直调先转。 */
const toPoly = (pairs) => pairs.map(([x, y]) => ({ x, y }));
const viaParser = (cuts) => parseCutsJson(JSON.stringify({ cuts }), 400, 600);

/** A-pose 三线:颈中横线(y=205 落在脖子 x185-215)+ 臂缝竖折线(x≈140/260)。 */
const A_CUTS = {
  headBody: [[0.025, 0.342], [0.975, 0.342]],
  armLeft: [[0.35, 0.383], [0.355, 0.417], [0.345, 0.467], [0.35, 0.5], [0.35, 0.6], [0.35, 0.633]],
  armRight: [[0.65, 0.383], [0.645, 0.417], [0.655, 0.467], [0.65, 0.5], [0.65, 0.6], [0.65, 0.633]],
};

/** T-pose 三线:颈中横线(y=210)+ 过肩桥接缝的竖线(x=147/253,把横臂从躯干分开)。 */
const T_CUTS = {
  headBody: [[0.025, 0.35], [0.975, 0.35]],
  armLeft: [[0.3675, 0.375], [0.3675, 0.5167]],
  armRight: [[0.6325, 0.375], [0.6325, 0.5167]],
};

/** 无颈熊的头底弧线:沿头圆(200,150) r=120 下缘,墙语义(归一化点列,过解析器还原)。 */
function bearArcCuts() {
  const pts = [];
  for (let x = 84; x <= 316; x += 8) {
    const dy = Math.sqrt(Math.max(0, 14400 - (x - 200) ** 2));
    pts.push([x / 400, (150 + dy - 4) / 600]);
  }
  return pts;
}
const viaParserArc = () => viaParser({ headBody: bearArcCuts(), armLeft: null, armRight: null });

/* ---------------- 键控与预览 ---------------- */

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
  c.fillRect(20, 560, 30, 18);
  const fm = keyFigure(toRgba(cv));
  assert.equal(fm.significantComponents, 1);
  assert.ok(fm.main.w >= 150 && fm.main.w <= 170, `主块宽 ${fm.main.w}`);
});

t("T4 键控预览合成:背景涂深灰 #2F2F36,角色原像素保留,全图不透明", () => {
  const fm = keyFigure(A);
  const prev = composeKeyedPreview(A, fm);
  assert.equal(prev.width, A.width);
  assert.equal(prev.height, A.height);
  const bg = (5 * A.width + 5) * 4; // 左上角绿幕
  assert.deepEqual([prev.data[bg], prev.data[bg + 1], prev.data[bg + 2], prev.data[bg + 3]], [47, 47, 54, 255]);
  const fig = (110 * A.width + 200) * 4; // 头圆心
  assert.deepEqual(
    [prev.data[fig], prev.data[fig + 1], prev.data[fig + 2], prev.data[fig + 3]],
    [A.data[fig], A.data[fig + 1], A.data[fig + 2], A.data[fig + 3]],
  );
});

t("T5 非法尺寸 → CUT_BAD_SIZE;全透明 → routeCut 诚实 L1", () => {
  assert.throws(() => keyFigure({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), /CUT_BAD_SIZE/);
  const [cv] = newCanvas(100, 100, "alpha");
  const r = routeCut(toRgba(cv));
  assert.equal(r.route, "l1");
  assert.equal(r.failure, "TOO_FEW_PARTS");
});

/* ---------------- parseCutsJson ---------------- */

t("T6 parseCutsJson:围栏+废话容忍+cuts 包裹层,归一化还原", () => {
  const raw =
    '好的,以下是切分线 JSON:\n```json\n{"cuts": {"headBody": [[0.025,0.342],[0.975,0.342]], "armLeft": [[0.35,0.4],[0.35,0.6]], "armRight": null}}\n```\n请查收。';
  const cuts = parseCutsJson(raw, 400, 600);
  assert.ok(cuts, "应解析成功");
  assert.deepEqual(cuts.headBody, [{ x: 10, y: 205 }, { x: 390, y: 205 }]);
  assert.deepEqual(cuts.armLeft, [{ x: 140, y: 240 }, { x: 140, y: 360 }]);
  assert.equal(cuts.armRight, null, "显式 null 保留");
});

t("T7 parseCutsJson:无包裹层/键名变体/{x,y} 点混制均可", () => {
  const cuts = parseCutsJson(
    '{"head_body": [{"x":0.1,"y":0.5},{"x":0.9,"y":0.5}], "leftarm": [[0.2,0.4],[0.2,0.6]], "RIGHT_ARM": [[0.8,0.4],[0.8,0.6]]}',
    400,
    600,
  );
  assert.ok(cuts);
  assert.ok(cuts.headBody && cuts.armLeft && cuts.armRight, "三线齐全");
  assert.equal(cuts.headBody[0].x, 40);
  assert.equal(cuts.armRight[0].x, 320);
});

t("T8 parseCutsJson:垃圾文本 → null;缺 headBody → headBody=null;垃圾点跳过", () => {
  assert.equal(parseCutsJson("这不是 JSON 输出", 400, 600), null);
  const cuts = parseCutsJson('{"cuts": {"armLeft": [[0.1,0.1],"垃圾",[0.2,0.2]]}}', 400, 600);
  assert.ok(cuts);
  assert.equal(cuts.headBody, null);
  assert.equal(cuts.armLeft.length, 2, "垃圾字符串点被跳过");
  const tooFew = parseCutsJson('{"cuts": {"headBody": [[0.1,0.1]]}}', 400, 600);
  assert.ok(tooFew);
  assert.equal(tooFew.headBody, null, "单点不可用");
});

/* ---------------- planCutCurves 校验链 ---------------- */

t("T9 planCutCurves:A-pose 三线全过校验(端点本在背景)", () => {
  const fm = keyFigure(A);
  const plan = planCutCurves(fm, viaParser(A_CUTS));
  assert.ok(plan, "校验应通过");
  assert.ok(plan.armLeft && plan.armRight, "双臂线在场");
});

t("T10 端点落在角色上 → 沿线方向外找背景补端点(半径 ≤2.5% 对角线)", () => {
  const fm = keyFigure(A);
  // 起点 (200,205) 在脖子(x185-215)上:向线反方向(左)找背景应落 ~x184
  const cuts = { headBody: toPoly([[200, 205], [390, 205]]), armLeft: null, armRight: null };
  const plan = planCutCurves(fm, cuts);
  assert.ok(plan, "端点修正后应通过");
  assert.ok(plan.headBody[0].x < 200 && plan.headBody[0].x >= 170, `起点应外移到背景(start=${plan.headBody[0].x})`);
  assert.ok(plan.headBody[plan.headBody.length - 1].x >= 389, "终点已在背景保持");
});

t("T11 端点深陷躯干、方向上无背景 → 线作废(headBody 作废 → null 计划)", () => {
  const fm = keyFigure(A);
  const cuts = { headBody: toPoly([[200, 300], [200, 330]]), armLeft: null, armRight: null };
  assert.equal(planCutCurves(fm, cuts), null, "竖线整体在躯干内,两端外找 ≤7px 无背景");
});

t("T12 线没碰到角色(<3 墙像素)→ 作废", () => {
  const fm = keyFigure(A);
  const cuts = { headBody: toPoly([[5, 100], [60, 100]]), armLeft: null, armRight: null };
  assert.equal(planCutCurves(fm, cuts), null, "线悬在左上背景,未切到任何角色像素");
});

t("T13 交叉守卫(2026-09-10 收窄):臂×头身交叉容忍(无颈臂根必然交叉),双臂互交→后者作废", () => {
  const fm = keyFigure(A);
  // 臂线穿过头身线(v9 语义下无颈形态几何必然)→ 仍采纳
  const p1 = planCutCurves(fm, {
    headBody: toPoly([[10, 205], [390, 205]]),
    armLeft: toPoly([[30, 30], [150, 550]]),
    armRight: null,
  });
  assert.ok(p1 && p1.armLeft, "臂×头身交叉不再拒线");
  // 双臂互交(X 形穿过躯干)→ 结构不可信,后者作废
  const p2 = planCutCurves(fm, {
    headBody: toPoly([[10, 205], [390, 205]]),
    armLeft: toPoly([[50, 50], [350, 550]]),
    armRight: toPoly([[350, 50], [50, 550]]),
  });
  assert.ok(p2, "计划仍成立");
  assert.ok(p2.armLeft, "前者保留");
  assert.equal(p2.armRight, null, "互交的后者作废");
});

/* ---------------- partitionByCurves + routeCut 全链 ---------------- */

t("T14 A-pose 四件套:头/身/双臂齐全,空间有序", () => {
  const r = routeCut(A, { cuts: viaParser(A_CUTS) });
  assert.equal(r.route, "vision");
  assert.equal(r.parts.length, 4, `parts=${r.parts.map((p) => p.name).join(",")}`);
  const cx = (p) => p.box.x + p.box.w / 2;
  const get = (n) => r.parts.find((p) => p.name === n);
  const l = get("armL"), b = get("body"), rr = get("armR"), h = get("head");
  assert.ok(l && b && rr && h);
  assert.ok(cx(l) < cx(b) && cx(b) < cx(rr), "armL-身-armR 从左到右");
  assert.ok(h.box.y < b.box.y && h.box.y + h.box.h <= b.box.y + b.box.h, "头在身体上方");
});

t("T15 T-pose 四件套:水平臂件宽大于高", () => {
  const r = routeCut(T, { cuts: viaParser(T_CUTS) });
  assert.equal(r.route, "vision");
  assert.ok(r.parts.length >= 3);
  const armL = r.parts.find((p) => p.name === "armL");
  assert.ok(armL, "缺左臂");
  assert.ok(armL.box.w > armL.box.h, "T-pose 臂件应为横向");
});

t("T16 臂线缺席/作废 → 头+身两件套,臂像素留在身体(降级可以)", () => {
  const r = routeCut(A, { cuts: viaParser({ headBody: A_CUTS.headBody, armLeft: null, armRight: null }) });
  assert.equal(r.route, "vision", "两件套是合法成功不是失败");
  assert.equal(r.parts.length, 2);
  const body = r.parts.find((p) => p.name === "body");
  assert.ok(body, "身体件存在");
  assert.ok(body.box.x < 100, `臂像素应留在身体(body.x=${body.box.x})`);
  assert.ok(!r.parts.some((p) => p.name === "head") === false, "头件在场");
});

t("T17 无脖子熊弧线切头:两件套 + 独立头件(墙语义,2026-09-10 重设计)", () => {
  const r = routeCut(BEAR, { cuts: viaParserArc() });
  assert.equal(r.route, "vision");
  const head = r.parts.find((p) => p.name === "head");
  const body = r.parts.find((p) => p.name === "body");
  assert.ok(head && body, `parts=${r.parts.map((p) => p.name).join(",")}`);
  assert.ok(head.box.y < 100, `头顶应接近圆顶(${head.box.y})`);
  assert.ok(head.box.w >= 200, `头宽应≈圆径(${head.box.w})`);
  assert.ok(body.box.y > head.box.y, "身体在头之下");
});

t("T18 headBody 缺失/无效 → L1(NO_HEAD_CUT);无 cuts → 同因", () => {
  const r1 = routeCut(A);
  assert.equal(r1.route, "l1");
  assert.equal(r1.failure, "NO_HEAD_CUT");
  const r2 = routeCut(A, { cuts: { headBody: null, armLeft: null, armRight: null } });
  assert.equal(r2.route, "l1");
  assert.equal(r2.failure, "NO_HEAD_CUT");
});

t("T19 白描边:尺寸不变,原外存在白色垫底,原图像素保留", () => {
  const src = A_ALPHA;
  const out = addWhiteOutline(src, 5);
  assert.equal(out.width, src.width);
  assert.equal(out.height, src.height);
  const q = (27 * src.width + 200) * 4;
  assert.ok(out.data[q] === 255 && out.data[q + 1] === 255 && out.data[q + 2] === 255 && out.data[q + 3] === 255, "头顶外应有白色垫底");
  const p = (110 * src.width + 200) * 4;
  assert.ok(out.data[p + 3] === 255 && out.data[p + 2] !== 255, "原图像素保留");
});

t("T20 切分包 manifest:字段与部件条目(route 记 vision)", () => {
  const r = routeCut(A, { cuts: viaParser(A_CUTS) });
  const m = buildCutManifest(A, r.route, "green", r.parts, { head: "head.png", body: "body.png", armL: "armL.png", armR: "armR.png" }, { id: "test-pack", name: "测试包", author: "tester", license: "CC0-1.0" });
  assert.equal(m.formatVersion, 1);
  assert.equal(m.kind, "companion-cut");
  assert.equal(m.id, "test-pack");
  assert.equal(m.source.route, "vision");
  assert.equal(m.source.keyMode, "green");
  assert.equal(m.parts.head.file, "head.png");
  assert.ok(m.parts.head.box.w > 0);
});

t("T21 layoutParts:等比 contain 居中/部件相对位置逐像素一致/确定性", () => {
  const stage = { x: 24, y: 22, w: 152, h: 154 };
  const base = {
    head: { file: "head.png", box: { x: 80, y: 30, w: 240, h: 240 } },
    body: { file: "body.png", box: { x: 140, y: 260, w: 120, h: 180 } },
  };
  const a = layoutParts({ width: 400, height: 600 }, base, stage);
  const b = layoutParts({ width: 400, height: 600 }, base, stage);
  assert.deepEqual(a, b, "确定性");
  const s = Math.min(152 / 400, 154 / 600);
  assert.equal(s.toFixed(6), (154 / 600).toFixed(6), "高约束(2:3 竖图)");
  const offX = stage.x + (stage.w - 400 * s) / 2;
  const offY = stage.y;
  const head = a.find((p) => p.name === "head");
  const body = a.find((p) => p.name === "body");
  assert.equal(head.x.toFixed(2), (offX + 80 * s).toFixed(2), "头落位");
  assert.equal(body.y.toFixed(2), (offY + 260 * s).toFixed(2), "身落位");
  assert.equal((head.x + head.w - (body.x + body.w)).toFixed(2), ((80 + 240 - 260) * s).toFixed(2), "部件间距=原图等比");
  assert.equal(layoutParts({ width: 0, height: 100 }, base).length, 0, "坏尺寸诚实空");
});

t("T21b layoutParts:带 x/y 偏移的标定框(figureBox 并集)内容必须居中", () => {
  // 用户实包数字(图1):曾把 width/height 回写成画布尺寸→两坐标系混杂,纸偶左偏 20 舞台px
  const fb = { x: 198, y: 268, width: 628, height: 1023 };
  const parts = {
    head: { file: "head.png", box: { x: 198, y: 268, w: 626, h: 508 } },
    body: { file: "body.png", box: { x: 243, y: 666, w: 480, h: 625 } },
    armL: { file: "armL.png", box: { x: 198, y: 770, w: 190, h: 223 } },
    armR: { file: "armR.png", box: { x: 636, y: 770, w: 190, h: 223 } },
  };
  const a = layoutParts(fb, parts);
  const s = Math.min(152 / 628, 154 / 1023);
  const xs = a.map((p) => p.x);
  const xe = a.map((p) => p.x + p.w);
  const left = Math.min(...xs);
  const right = Math.max(...xe);
  assert.equal((left + right) / 2, 100, "部件并集中心=舞台中心 100");
  assert.equal((right - left).toFixed(2), (628 * s).toFixed(2), "并集宽=标定框宽×s(628,非 1024)");
  const ys = a.map((p) => p.y);
  const ye = a.map((p) => p.y + p.h);
  assert.equal((Math.min(...ys) + Math.max(...ye)) / 2, 22 + 154 / 2, "纵向中心=目标框中心");
});


t("T22 partitionByCurves 直接调用:墙像素(接缝)不归任何部件", () => {
  const fm = keyFigure(A);
  const plan = planCutCurves(fm, viaParser(A_CUTS));
  assert.ok(plan);
  const parts = partitionByCurves(A, fm, plan);
  const total = parts.reduce((n, p) => {
    for (let i = 3; i < p.rgba.length; i += 4) if (p.rgba[i] > 128) n++;
    return n;
  }, 0);
  // 三条墙的接缝像素(1~2px 宽,几百 px)不归任何部件,白描边愈合;
  // 部件像素总量应 ≥ 主体真实面积的 97%(墙本身只吃掉边缘一线)
  let figArea = 0;
  const { main } = fm;
  for (let y = main.y; y < main.y + main.h; y++)
    for (let x = main.x; x < main.x + main.w; x++)
      if (fm.mask[y * fm.width + x]) figArea++;
  assert.ok(total >= 0.97 * figArea, `部件像素总量 ${total} / 主体 ${figArea}`);
});


t("T23 孤儿清理:主框内的漂浮小碎片不归任何部件(熊女孩黑斜条回归锁)", () => {
  const [cv, c] = newCanvas(200, 300, "alpha");
  c.fillStyle = SKIN;
  c.beginPath(); c.arc(100, 85, 50, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(100, 195, 60, 0, Math.PI * 2); c.fill();
  c.fillRect(146, 136, 8, 8);
  const img = toRgba(cv);
  const cuts = { headBody: toPoly([[20, 134], [180, 134]]), armLeft: null, armRight: null };
  const r = routeCut(img, { cuts });
  assert.equal(r.route, "vision");
  const body = r.parts.find((p) => p.name === "body");
  assert.ok(body, "body 应存在");
  let leak = 0;
  for (const part of r.parts) {
    for (let y = 136; y < 144; y++) {
      const ly = y - part.box.y;
      if (ly < 0 || ly >= part.box.h) continue;
      for (let x = 146; x < 154; x++) {
        const lx = x - part.box.x;
        if (lx >= 0 && lx < part.box.w && part.rgba[(ly * part.box.w + lx) * 4 + 3] > 128) leak++;
      }
    }
  }
  assert.equal(leak, 0, `碎片泄漏 ${leak}px(旧版并回 body 会挂成孤儿)`);
});

t("T24 梯度门控吸附:内部点吸向最近强颜色边界;平坦区不动;端点不动", () => {
  const mk = (twoTone) => {
    const [cv, c] = newCanvas(400, 400, "alpha");
    c.fillStyle = "#E8B88A"; c.fillRect(0, 50, 400, 300);
    if (twoTone) { c.fillStyle = "#3C3C3C"; c.fillRect(200, 50, 200, 300); }
    return toRgba(cv);
  };
  const plan = { headBody: toPoly([[210, 100], [210, 200], [210, 300]]), armLeft: null, armRight: null };
  const snapped = snapCurvesToEdges(mk(true), keyFigure(mk(true)), plan);
  const mid = snapped.headBody[1];
  assert.ok(Math.abs(mid.x - 200) <= 2, `应吸附到 x≈200,实际 ${mid.x}`);
  assert.equal(snapped.headBody[0].x, 210, "首点不吸附");
  assert.equal(snapped.headBody[2].x, 210, "末点不吸附");
  const flat = snapCurvesToEdges(mk(false), keyFigure(mk(false)), plan);
  assert.equal(flat.headBody[1].x, 210, "无强边界不应移动");
});

t("T25 armRestAngleDeg:臂 rest 角量测(竖直90/外展120/水平0/退化null)", () => {
  const mk = (draw) => {
    const cv = createCanvas(200, 200);
    const ctx = cv.getContext("2d");
    draw(ctx);
    const d = ctx.getImageData(0, 0, 200, 200).data;
    return { w: 200, h: 200, at: (x, y) => d[(y * 200 + x) * 4 + 3] / 255 };
  };
  const org = { x: 172, y: 20 }; // armL 肩原点(86%,10%)
  // 竖直垂放臂:从原点向下的粗条(rest=90°)
  const vertical = mk((ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(160, 20, 24, 160);
  });
  assert.equal(Math.round(armRestAngleDeg(vertical, org)), 90, "竖直臂=90°");
  // 外展 30° 臂:沿 120° 方向的圆头粗线(armL A-pose)
  const splay = mk((ctx) => {
    ctx.fillStyle = "#000";
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(172, 20);
    const rad = (120 * Math.PI) / 180;
    ctx.lineTo(172 + Math.cos(rad) * 150, 20 + Math.sin(rad) * 150);
    ctx.stroke();
  });
  const gotSplay = armRestAngleDeg(splay, org);
  assert.ok(gotSplay != null && Math.abs(gotSplay - 120) < 4, "外展臂≈120°,实际 " + String(gotSplay));
  // 水平右指臂(armR 语义,rest=0°)
  const horiz = mk((ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(28, 8, 160, 24);
  });
  assert.equal(Math.round(armRestAngleDeg(horiz, { x: 28, y: 20 })), 0, "水平右臂=0°");
  // 退化:不透明像素不足 → null(调用方回退 90°)
  const tiny = mk((ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(170, 18, 6, 6);
  });
  assert.equal(armRestAngleDeg(tiny, org), null, "退化臂=null");
});

t("T26 白描边平滑:AA 阈值抖动不再造成轮廓 ±1px 凹凸(实测熊女 96/147 交替回归锁)", () => {
  // 底半不透明,顶缘一行 AA,alpha 按列 96/147 交替(跨旧阈值 128 两侧)
  const W = 120, H = 80;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      data[p] = 200; data[p + 1] = 160; data[p + 2] = 120;
      data[p + 3] = y >= 50 ? 255 : y === 49 ? (x % 2 ? 147 : 96) : 0;
    }
  }
  const out = addWhiteOutline({ width: W, height: H, data }, 4);
  // 轮廓平直:所有列首个不透明像素落在同一行(旧二值化会随 96/147 交替在 49/50 间跳)
  const firstRow = [];
  for (let x = 4; x < W - 4; x++) {
    for (let y = 0; y < H; y++) {
      if (out.data[(y * W + x) * 4 + 3] > 0) { firstRow.push(y); break; }
    }
  }
  assert.equal(new Set(firstRow).size, 1, `描边外缘应齐平,实测行 ${[...new Set(firstRow)].join(",")}`);
  // 白垫底仍在:AA 行收进部件(原像素半透明保留),其上一行是白垫底
  const aa = (49 * W + 60) * 4;
  assert.ok(out.data[aa] === 200 && out.data[aa + 3] === 96, "AA 行保留原像素(半透明)");
  const white = (48 * W + 60) * 4;
  assert.ok(out.data[white] === 255 && out.data[white + 3] === 255, "其上应是白垫底");
  // 确定性
  const out2 = addWhiteOutline({ width: W, height: H, data }, 4);
  assert.deepEqual(Buffer.from(out.data).equals(Buffer.from(out2.data)), true, "同输入同输出");
});

t("T27 键控 L1:applyFigureKey 抠背景+bbox 裁剪,box 为原图坐标", () => {
  const img = drawApose({ mode: "green" });
  const fm = keyFigure(img);
  const { image: keyed, box } = applyFigureKey(img, fm);
  assert.ok(box.w < 400 && box.h < 600 && box.x >= 0 && box.y >= 0 && box.x + box.w <= 400 && box.y + box.h <= 600);
  let opaque = 0;
  for (let i = 0; i < keyed.width * keyed.height; i++) if (keyed.data[i * 4 + 3] === 255) opaque++;
  let maskCount = 0;
  for (let i = 0; i < fm.mask.length; i++) if (fm.mask[i]) maskCount++;
  assert.equal(opaque, maskCount);
  let green = 0;
  for (let i = 0; i < keyed.width * keyed.height; i++) {
    const p = i * 4;
    if (keyed.data[p + 3] === 255 && keyed.data[p] < 80 && keyed.data[p + 1] > 150 && keyed.data[p + 2] < 120) green++;
  }
  assert.equal(green, 0);
  const outlined = addWhiteOutline(keyed, 4);
  const cx = 200 - box.x;
  const cy = 295 - box.y;
  const pc = (cy * keyed.width + cx) * 4;
  assert.equal(outlined.data[pc + 3], 255);
});

t("T28 键控 L1 全链(routeCut→applyFigureKey→addWhiteOutline)无 cuts 也出带 box 的单件", () => {
  const img = drawTpose({ mode: "green" });
  const fm = keyFigure(img);
  const r = routeCut(img, {});
  assert.equal(r.route, "l1");
  const { box } = applyFigureKey(img, fm);
  assert.ok(box.x <= fm.main.x && box.y <= fm.main.y && box.x + box.w >= fm.main.x + fm.main.w && box.y + box.h >= fm.main.y + fm.main.h);
});


console.log(`\nverify-companion-cut: ${pass} 断言全部通过`);
