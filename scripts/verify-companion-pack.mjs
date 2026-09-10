/**
 * verify-companion-pack —— CompanionBot M0 spike 的回归断言(纯函数 + 源级守卫)。
 *
 * 防止回归:
 *   - 角色包 manifest lint(structure/路径安全/文件存在性):外部包是用户供给面,
 *     恶意/畸形包绝不许穿到加载层(路径穿越/绝对路径/隐藏文件全拒)
 *   - PNG 三行规格检测器(透明底/单主体/别贴边):导入 UX 的分级依据全靠这些 code
 *   - 源级守卫(T15 风格):
 *       G1 CompanionCreature/companion-* 既有文件零 diff(新 bot 系统不碰现有伴学)
 *       G2 CompanionBot 对 bus 只读(onCelebration 在,命令入口零调用——bot 不驱动现有生物)
 *       G3 实验页必须懒加载(主束零增量),不许静态 import
 *       G4 本套件已注册进 verify:core 链
 *
 * 运行:npx tsx scripts/verify-companion-pack.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.resolve(root, p), "utf8");

const { lintCompanionPack, analyzePngSpec, resolveStateSrc, poseHoldMsOf, BOT_STATES } = await import(
  "../shared/companion-pack.ts"
);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.log(`✗ ${name}`);
    fail++;
  }
}

/** 挑出 issues 里的 code 集合。 */
const codesOf = (r) => new Set(r.issues.map((i) => i.code));

/** 合成 RGBA 测试图:透明底 + 若干椭圆不透明主体。 */
function makeImage(w, h, blobs, { bgAlpha = 0 } = {}) {
  const rgba = new Uint8Array(w * h * 4);
  if (bgAlpha > 0) {
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = bgAlpha;
  }
  for (const b of blobs) {
    const { cx, cy, rx, ry = rx } = b;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, Math.ceil(cx + rx)); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const idx = (y * w + x) * 4;
          rgba[idx] = 200;
          rgba[idx + 1] = 120;
          rgba[idx + 2] = 60;
          rgba[idx + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: h, rgba };
}

/** 合规样例:512²,单主体居中,四周 ~10% 空白。 */
const validChibi = () => makeImage(512, 512, [{ cx: 256, cy: 256, rx: 180, ry: 190 }]);

/* ---------------- T 组:manifest lint ---------------- */

const validManifest = (over = {}) => ({
  formatVersion: 1,
  id: "sample-chibi",
  name: "样例圆团",
  author: "lookatstudy",
  license: "CC0-1.0",
  tier: "sticker",
  states: { idle: "idle.png" },
  ...over,
});
const ioOK = { fileExists: () => true };

check("T1 合规最小包通过", lintCompanionPack(validManifest(), ioOK).ok);
check(
  "T2 合规 bongo 包(idle+keyL+happy)通过",
  lintCompanionPack(validManifest({ tier: "bongo", states: { idle: "idle.png", keyL: "keyl.png", happy: "happy.png" } }), ioOK).ok,
);
check("T3 非对象拒收", codesOf(lintCompanionPack("nope", ioOK)).has("NOT_OBJECT"));
check("T4 formatVersion≠1 拒收", codesOf(lintCompanionPack(validManifest({ formatVersion: 2 }), ioOK)).has("BAD_FORMAT_VERSION"));
check("T5 坏 id(大写/空格)拒收", codesOf(lintCompanionPack(validManifest({ id: "Sample Chibi" }), ioOK)).has("BAD_ID"));
check("T6 缺 author 拒收", codesOf(lintCompanionPack(validManifest({ author: "" }), ioOK)).has("MISSING_FIELD"));
check("T7 坏 tier 拒收", codesOf(lintCompanionPack(validManifest({ tier: "paperdoll" }), ioOK)).has("BAD_TIER"));
check("T8 坏 poseHoldMs 拒收", codesOf(lintCompanionPack(validManifest({ poseHoldMs: 5 }), ioOK)).has("BAD_POSE_HOLD"));
check("T9 缺 states.idle 拒收", codesOf(lintCompanionPack(validManifest({ states: { happy: "h.png" } }), ioOK)).has("MISSING_IDLE"));
check("T10 未知状态槽(walk)拒收", codesOf(lintCompanionPack(validManifest({ states: { idle: "i.png", walk: "w.png" } }), ioOK)).has("UNKNOWN_STATE"));
check(
  "T11 状态值非字符串拒收",
  codesOf(lintCompanionPack(validManifest({ states: { idle: "i.png", happy: 3 } }), ioOK)).has("BAD_STATE_FILE"),
);
check(
  "T12 路径穿越组(../ /sub/ 反斜杠 隐藏文件)全部拒收",
  ["../evil.png", "sub/dir.png", "C:\\evil.png", ".hidden.png", "i.png/"].every(
    (p) => !lintCompanionPack(validManifest({ states: { idle: p } }), ioOK).ok,
  ),
);
check("T13 文件缺失拒收", !lintCompanionPack(validManifest(), { fileExists: () => false }).ok);
check("T14 bongo 档无动作帧拒收", codesOf(lintCompanionPack(validManifest({ tier: "bongo" }), ioOK)).has("BONGO_WITHOUT_POSES"));
check("T15 未知顶层字段拒收(防拼错)", codesOf(lintCompanionPack(validManifest({ titel: "x" }), ioOK)).has("UNKNOWN_FIELD"));
check("T16 状态回落:happy 缺省→idle;poseHoldMs 缺省 1200", (() => {
  const m = lintCompanionPack(validManifest(), ioOK).ok ? validManifest() : null;
  assert(m);
  return resolveStateSrc(m, "happy") === "idle.png" && resolveStateSrc(m, "idle") === "idle.png" && poseHoldMsOf(m) === 1200;
})());
check("T17 BOT_STATES 词汇表五槽", BOT_STATES.join(",") === "idle,keyL,keyR,happy,thinking");

/* ---------------- T 组:PNG 三行规格 ---------------- */

check("T18 合规样例(居中单主体)通过,blob=1", (() => {
  const r = analyzePngSpec(validChibi());
  return r.ok && r.blobCount === 1 && r.opaqueRatio > 0.2 && r.opaqueRatio < 0.8;
})());
check("T19 全不透明 → NO_ALPHA", codesOf(analyzePngSpec(makeImage(512, 512, [{ cx: 256, cy: 256, rx: 10 }], { bgAlpha: 255 }))).has("NO_ALPHA"));
check("T20 全透明 → ALL_TRANSPARENT", codesOf(analyzePngSpec(makeImage(512, 512, []))).has("ALL_TRANSPARENT"));
check("T21 双主体 → MULTI_BLOB,blob=2", (() => {
  const r = analyzePngSpec(makeImage(512, 512, [
    { cx: 150, cy: 256, rx: 90 },
    { cx: 380, cy: 256, rx: 90 },
  ]));
  return codesOf(r).has("MULTI_BLOB") && r.blobCount === 2;
})());
check("T22 小碎屑(天线≈2%)不误报,blob=1", (() => {
  const r = analyzePngSpec(makeImage(512, 512, [
    { cx: 256, cy: 280, rx: 170, ry: 180 },
    { cx: 256, cy: 60, rx: 12, ry: 22 },
  ]));
  return r.ok && r.blobCount === 1;
})());
check("T22b 同心结构(玻璃头盔:外环包内头)不误报,blob=1", (() => {
  // 外环(空心方框)+ 内部独立小方块,内块 bbox 被外环 bbox 完全包含 → 嵌套合并
  const w = 512, h = 512;
  const rgba = new Uint8Array(w * h * 4);
  const fill = (x, y) => { const i = (y * w + x) * 4; rgba[i] = 200; rgba[i + 1] = 120; rgba[i + 2] = 60; rgba[i + 3] = 255; };
  for (let y = 140; y < 380; y++) for (let t = 0; t < 24; t++) { fill(120 + t, y); fill(356 - t, y); }
  for (let x = 140; x < 380; x++) for (let t = 0; t < 24; t++) { fill(x, 140 + t); fill(x, 356 - t); }
  for (let y = 250; y < 300; y++) for (let x = 250; x < 300; x++) fill(x, y);
  const r = analyzePngSpec({ width: w, height: h, rgba });
  return r.ok && r.blobCount === 1;
})());
check("T22c 嵌套但不相交的旁块仍判 MULTI_BLOB", (() => {
  const w = 512, h = 512;
  const rgba = new Uint8Array(w * h * 4);
  const fill = (x, y) => { const i = (y * w + x) * 4; rgba[i] = 200; rgba[i + 1] = 120; rgba[i + 2] = 60; rgba[i + 3] = 255; };
  for (let y = 140; y < 380; y++) for (let t = 0; t < 24; t++) { fill(80 + t, y); fill(316 - t, y); }
  for (let x = 100; x < 300; x++) for (let t = 0; t < 24; t++) { fill(x, 140 + t); fill(x, 356 - t); }
  for (let y = 250; y < 300; y++) for (let x = 250; x < 300; x++) fill(x, y);
  for (let y = 240; y < 300; y++) for (let x = 420; x < 470; x++) fill(x, y);
  const r = analyzePngSpec({ width: w, height: h, rgba });
  return r.blobCount === 2;
})());
check("T22d 头从穹顶环伸出(相交非包含)合并为同一角色,blob=1", (() => {
  // 模拟宇航员:穹顶环 + 从环底部伸出的头,头 bbox 与环 bbox 重叠 ~60%
  const w = 512, h = 512;
  const rgba = new Uint8Array(w * h * 4);
  const fill = (x, y) => { const i = (y * w + x) * 4; rgba[i] = 200; rgba[i + 1] = 120; rgba[i + 2] = 60; rgba[i + 3] = 255; };
  for (let y = 100; y < 240; y++) for (let t = 0; t < 20; t++) { fill(140 + t, y); fill(352 - t, y); }
  for (let x = 140; x < 372; x++) for (let t = 0; t < 20; t++) { fill(x, 100 + t); fill(x, 220 + t); }
  for (let y = 200; y < 380; y++) for (let x = 200; x < 312; x++) fill(x, y);
  const r = analyzePngSpec({ width: w, height: h, rgba });
  return r.ok && r.blobCount === 1;
})());
check("T23 贴边 → EDGE_TOUCH", codesOf(analyzePngSpec(makeImage(512, 512, [{ cx: 60, cy: 256, rx: 70 }]))).has("EDGE_TOUCH"));
check("T24 短边 128 → TOO_SMALL", codesOf(analyzePngSpec(makeImage(128, 128, [{ cx: 64, cy: 64, rx: 40 }]))).has("TOO_SMALL"));
check("T25 超长边 → TOO_LARGE(opts 收紧验证,不分配大图)", codesOf(analyzePngSpec(makeImage(1024, 1024, [{ cx: 512, cy: 512, rx: 300 }]), { maxSide: 512 })).has("TOO_LARGE"));
check("T26 对抗:16K 巨图先撞尺寸守卫(零分配秒回)", (() => {
  const r = analyzePngSpec({ width: 16000, height: 16000, rgba: new Uint8Array(0) });
  const c = codesOf(r);
  return c.has("TOO_LARGE") && c.has("BAD_PIXEL_BUFFER") && !c.has("TOO_SMALL");
})());
check("T27 对抗:NaN/0/负尺寸 → BAD_DIMENSIONS", (() => {
  const cases = [NaN, 0, -5].map((h) => analyzePngSpec({ width: 512, height: h, rgba: new Uint8Array(512 * 4 * 4) }));
  return cases.every((r) => codesOf(r).has("BAD_DIMENSIONS"));
})());
check("T28 对抗:1×1 → TOO_SMALL 不炸", codesOf(analyzePngSpec({ width: 1, height: 1, rgba: new Uint8Array(4) })).has("TOO_SMALL"));
check("T29 对抗:rgba 缓冲长度不符 → BAD_PIXEL_BUFFER", codesOf(analyzePngSpec({ width: 512, height: 512, rgba: new Uint8Array(10) })).has("BAD_PIXEL_BUFFER"));
check("T30 下采样路径:2000² 单主体(4M 像素,stride=2)仍 blob=1", (() => {
  const r = analyzePngSpec(makeImage(2000, 2000, [{ cx: 1000, cy: 1000, rx: 800, ry: 850 }]));
  return r.ok && r.blobCount === 1;
})());

/* ---------------- G 组:源级守卫(T15 风格) ---------------- */

// G1(M2 改造,SPEC §16.2/16.5):行为层守卫名单零 diff——bus/flight/core/口型/
// 桌宠音效/壳(CompanionCreature/Mascot/PetCompanion)/五形态 shared+皮肤。
// seam 白名单(forms-index/registry/custom-puppet/CustomPackCard/custom-pack-store/
// SettingsView/i18n/index.css)允许 diff——M2 走「第 6 形态」路径,行为不是移植
// 而是共享,守卫从「全目录零条」收窄为「行为文件零条」。
const behaviorGuardFiles = [
  "src/renderer/lib/companion/bus.ts",
  "src/renderer/lib/companion/companion-flight.ts",
  "src/renderer/lib/companion/companion-core.ts",
  "src/renderer/lib/companion/use-mouth.ts",
  "src/renderer/lib/companion/viseme-timeline.ts",
  "src/renderer/lib/companion/pet-sfx.ts",
  "src/renderer/components/companion/CompanionCreature.tsx",
  "src/renderer/components/companion/Mascot.tsx",
  "src/renderer/components/companion/PetCompanion.tsx",
  "src/renderer/components/companion/forms/shared.tsx",
  "src/renderer/components/companion/forms/ember.tsx",
  "src/renderer/components/companion/forms/frost.tsx",
  "src/renderer/components/companion/forms/moss.tsx",
  "src/renderer/components/companion/forms/astro.tsx",
  "src/renderer/components/companion/forms/ink.tsx",
];
const diff = spawnSync("git", ["diff", "main", "--name-only", "--", ...behaviorGuardFiles], {
  cwd: root,
  encoding: "utf8",
});
check("G1(M2) 行为零 diff 守卫名单(bus/flight/core/壳/五形态)零条", diff.status === 0 && diff.stdout.trim() === "");
if (diff.status !== 0 || diff.stdout.trim() !== "") {
  console.log("   G1 diff 输出:", JSON.stringify(diff.stdout.trim() || diff.stderr.trim()));
}

// G2 CompanionBot 对 bus 只读:订阅口在,命令入口零调用
const labDir = path.join(root, "src/renderer/companion-bot-lab");
const labFiles = existsSync(labDir)
  ? ["CompanionBot.tsx", "CompanionBotLab.tsx", "sample-pack.ts", "mesh-warp.ts"]
    .map((f) => path.join(labDir, f))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
  : [];
const labSrc = labFiles.join("\n");
check("G2a CompanionBot 源存在且订阅 onCelebration(只读)", labFiles.length >= 2 && labSrc.includes("onCelebration"));
const forbiddenBusCalls = [
  "companionPoke(",
  "companionSetTalking(",
  "companionSetListening(",
  "companionSetStreaming(",
  "companionZoneFocus(",
  "companionSend(",
  "companionSwat(",
  "from \"../lib/companion/bus",
  "from \"../lib/companion/bus.ts",
];
check("G2b bot 不调用 bus 命令入口(不驱动现有生物)", !forbiddenBusCalls.some((s) => labSrc.includes(s)));

// G2c(M2,SPEC §16.5) 纸偶形态对 bus 只读:custom-puppet 只吃 store 与 refs 契约
const puppetSrc = read("src/renderer/components/companion/forms/custom-puppet.tsx");
check(
  "G2c(M2) CustomPuppetArt 存在且不 import bus 命令入口(只读)",
  puppetSrc.includes("CustomPuppetArt") && !forbiddenBusCalls.some((s) => puppetSrc.includes(s)),
);
// G2d(2026-09-10) 纸偶臂必须挂姿势 class(cp-armL/cp-armR):姿势 CSS(朗读指向/
// 写字/挥手/飞行臂)按连字符类命中,漏挂则纸偶手臂对全部姿势静默(实测回归)
check(
  "G2d(M2) 纸偶臂挂姿势 class cp-arm cp-${name}(pose CSS 命中契约)",
  puppetSrc.includes("cp-arm cp-${name}"),
);
// G2e(2026-09-10) 壳层"机身装饰"对纸偶裁剪:航灯(左红右绿)与喷焰假设火箭机身
// 存在,纸偶身体窄则悬空成游离绿点(用户实测报"脏点/偏心");CSS 按形态隐藏
const appCss = read("src/renderer/index.css");
check(
  "G2e(M2) custom 形态隐藏壳层航灯/喷焰(悬空绿点根因)",
  appCss.includes(".cp-form-custom .cp-beacons") && appCss.includes(".cp-thruster { display: none; }"),
);

// G5(M2) 盘与纸偶零二进制资产:全程序化 SVG,无静态图 import、无 http 图源
check(
  "G5(M2) 盘与纸偶零二进制资产(无静态图 import/无 http 图源)",
  !/\.(png|jpe?g|webp|gif)["']/.test(puppetSrc) && !puppetSrc.includes("http://") && !puppetSrc.includes("https://"),
);

// G3 实验页懒加载(主束零增量)
const appSrc = read("src/renderer/App.tsx");
check(
  "G3a App 以 lazy(() => import) 挂 lab",
  /lazy\(\(\) => import\("\.\/companion-bot-lab\/CompanionBotLab/.test(appSrc),
);
check("G3b App 无对 lab 的静态 import", !/^import [^;]*companion-bot-lab/m.test(appSrc));

// G4 本套件已注册 verify:core
const pkg = JSON.parse(read("package.json"));
check("G4 verify:core 链含 verify-companion-pack", pkg.scripts["verify:core"].includes("verify-companion-pack.mjs"));

/* ---------------- 汇总 ---------------- */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
