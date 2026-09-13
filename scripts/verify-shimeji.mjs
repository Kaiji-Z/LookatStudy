/**
 * verify-shimeji.mjs —— Shimeji 第七形态判据套件(SPEC-shimeji.md)。
 *
 * 覆盖:
 *   T1 解析器·双格式:日版原版(日文标签)/Shimeji-ee(英文标签)合成样本解析,
 *      统一模型字段(anchor/velocity/duration)、Embedded 类名、BOM 容错
 *   T2 归档表:94 条全归档合法;合成样本动作 100% 可归档(scene/fx/skip)
 *   T3 行为表:頻度/Frequency 双写法
 *   T4 zip 导入管线(zipSync 合成):自包含布局+引擎布局(根 conf + img/<品种>/)+
 *      多角色发现;角色勾选→confirm 落盘→manifest/帧读回
 *   T5 真实大包增强断言(.shimeji-fixtures/ 存在才跑,否则 SKIP):
 *      巨人包 91 动作/128×128 帧/锚点;哆啦A梦 91 动作;AOT 多角色发现
 *   T6 源级守卫:shimeji 模块禁碰禁区(flight/mapPhysics/zone 状态机)
 *   T7-T10 二期调度器(shimeji-scheduler 纯状态机,注入 rng 复现):
 *      旧包 kind 退化 / 抓-放-扔出坠落 / 贴边 wall→ceiling→air→settle→ground
 *      全链 / 复现性 + confirm 管线 slot 烘焙
 *
 * 纯 node(fflate + node:fs),不依赖 Electron/DB。
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strToU8 } from "fflate";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

const { parseShimejiActions, parseShimejiBehaviors, ACTION_ARCHIVE, archiveOf } = await import(
  "../src/main/services/shimeji/pure/shimeji-parse.ts"
);
const { importShimejiZip, confirmShimejiImport, getShimejiPack, getShimejiFrameDataUrl } = await import(
  "../src/main/services/shimeji/shimeji-pack-service.ts"
);

// ── 合成 fixture:最小双格式包 ──
const JA_ACTIONS = `<?xml version="1.0" encoding="UTF-8" ?>
<マスコット xmlns="http://www.group-finity.com/Mascot">
  <動作リスト>
    <動作 名前="振り向く" 種類="組み込み" クラス="com.group_finity.mascot.action.Look" />
    <動作 名前="立つ" 種類="静止" 枠="地面">
      <アニメーション>
        <ポーズ 画像="/shime1.png" 基準座標="64,128" 移動速度="0,0" 長さ="200" />
        <ポーズ 画像="/shime2.png" 基準座標="64,128" 移動速度="0,0" 長さ="4" />
      </アニメーション>
    </動作>
    <動作 名前="歩く" 種類="移動" 枠="地面">
      <アニメーション>
        <ポーズ 画像="/shime1.png" 基準座標="64,128" 移動速度="-2,0" 長さ="6" />
        <ポーズ 画像="/shime2.png" 基準座標="64,128" 移動速度="-2,0" 長さ="6" />
      </アニメーション>
    </動作>
    <動作 名前="ドラッグされる" 種類="組み込み" クラス="com.group_finity.mascot.action.Dragged">
      <引数 名前="オフスクリーン飛び出し" 値="0" />
    </動作>
  </動作リスト>
</マスコット>`;
const EN_ACTIONS = `<?xml version="1.0" encoding="UTF-8" ?>
<Mascot xmlns="http://www.group-finity.com/Mascot">
  <ActionList>
    <Action Name="Look" Type="Embedded" Class="com.group_finity.mascot.action.Look" />
    <Action Name="Stand" Type="Stay" BorderType="Floor">
      <Animation>
        <Pose Image="/shime1.png" ImageAnchor="64,128" Velocity="0,0" Duration="150" />
        <Pose Image="/shime2.png" ImageAnchor="64,128" Velocity="0,0" Duration="4" />
      </Animation>
    </Action>
    <Action Name="Walk" Type="Move" BorderType="Floor">
      <Animation>
        <Pose Image="/shime1.png" ImageAnchor="64,128" Velocity="2,0" Duration="6" />
      </Animation>
    </Action>
    <Action Name="Dragged" Type="Embedded" Class="com.group_finity.mascot.action.Dragged" />
  </ActionList>
</Mascot>`;
const JA_BEHAVIORS = `<?xml version="1.0" encoding="UTF-8" ?>
<マスコット>
  <行動リスト>
    <行動 名前="歩く" 頻度="40">
      <次の行動リスト 追加="false">
        <行動参照 名前="立つ" 頻度="100" />
      </次の行動リスト>
    </行動>
  </行動リスト>
</マスコット>`;
const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

// 1×1 png → 假装 128 帧(尺寸断言用真帧)
const TINY_ACTIONS_JA = JA_ACTIONS;

await test("T1a 解析·日版原版:动作/种类归一/帧字段", () => {
  const actions = parseShimejiActions(JA_ACTIONS);
  assert.equal(actions.length, 4);
  const stand = actions.find((a) => a.name === "立つ");
  assert.equal(stand.kind, "Stay");
  assert.equal(stand.poses.length, 2);
  assert.deepEqual(stand.poses[0].anchor, [64, 128]);
  assert.deepEqual(stand.poses[0].velocity, [0, 0]);
  assert.equal(stand.poses[0].duration, 200);
  assert.equal(stand.poses[0].image, "shime1.png");
  const drag = actions.find((a) => a.name === "ドラッグされる");
  assert.equal(drag.kind, "Embedded");
  assert.equal(drag.className, "com.group_finity.mascot.action.Dragged");
  const look = actions.find((a) => a.name === "振り向く");
  assert.equal(look.className, "com.group_finity.mascot.action.Look");
});

await test("T1b 解析·Shimeji-ee:同构字段", () => {
  const actions = parseShimejiActions(EN_ACTIONS);
  assert.equal(actions.length, 4);
  const stand = actions.find((a) => a.name === "Stand");
  assert.equal(stand.kind, "Stay");
  assert.deepEqual(stand.poses[0].anchor, [64, 128]);
  assert.equal(stand.poses[0].duration, 150);
  const walk = actions.find((a) => a.name === "Walk");
  assert.deepEqual(walk.poses[0].velocity, [2, 0]);
});

await test("T1c 解析·BOM 容错", () => {
  const actions = parseShimejiActions("\uFEFF" + EN_ACTIONS);
  assert.equal(actions.length, 4);
});

await test("T2 归档表:全部合法 + 样本动作全可归档", () => {
  assert.ok(ACTION_ARCHIVE.length >= 88, `归档表应≥88 条,实际 ${ACTION_ARCHIVE.length}`);
  for (const e of ACTION_ARCHIVE) {
    assert.ok(["scene", "fx", "skip"].includes(e.archive), `${e.en} archive 非法`);
    if (e.archive === "scene") assert.ok(e.slot, `${e.en} scene 缺 slot`);
  }
  for (const a of parseShimejiActions(JA_ACTIONS)) assert.ok(archiveOf(a.name), a.name);
  for (const a of parseShimejiActions(EN_ACTIONS)) assert.ok(archiveOf(a.name), a.name);
  // 日英同条目互查
  assert.equal(archiveOf("立つ").entry?.en, "Stand");
  assert.equal(archiveOf("Stand").entry?.ja, "立つ");
  assert.equal(archiveOf("Stand").slot, "ground");
});

await test("T3 行为表:頻度/Frequency 双写法 + 后续链", () => {
  const behs = parseShimejiBehaviors(JA_BEHAVIORS);
  assert.equal(behs.length, 1);
  assert.equal(behs[0].name, "歩く");
  assert.equal(behs[0].frequency, 40);
  assert.equal(behs[0].next[0].name, "立つ");
});

// ── zip 管线(合成) ──
function makeZip(layout) {
  const trivial = zipSync({ "test.txt": strToU8("hello") });
  const mz = layout === "self" ? {
      "Eren/conf/Actions.xml": strToU8(EN_ACTIONS),
      "Eren/img/shime1.png": PNG_1PX,
      "Eren/img/shime2.png": PNG_1PX,
      "Eren/img/icon.png": PNG_1PX,
    } : {
      "conf/actions.xml": strToU8(JA_ACTIONS),
      "img/Doraemon/shime1.png": PNG_1PX,
      "img/Doraemon/icon.png": PNG_1PX,
    };
  const mzZip = zipSync(mz);
  void trivial;
  if (layout === "self") {
    // 自包含型:单一角色目录
    return zipSync({
      "Eren/conf/Actions.xml": strToU8(EN_ACTIONS),
      "Eren/img/shime1.png": PNG_1PX,
      "Eren/img/shime2.png": PNG_1PX,
      "Eren/img/icon.png": PNG_1PX,
    });
  }
  // 引擎布局:根 conf + img/<品种>/
  return zipSync({
    "conf/actions.xml": strToU8(JA_ACTIONS),
    "img/Doraemon/shime1.png": PNG_1PX,
    "img/Doraemon/icon.png": PNG_1PX,
  });
}

const dataDir = join(ROOT, ".verify-shimeji-data");

await test("T4a zip·自包含布局:发现/勾选/落盘/帧读回", async () => {
  const preview = await importShimejiZip(null, dataDir, Buffer.from(makeZip("self")).toString("base64"));
  assert.equal(preview.characters.length, 1);
  assert.equal(preview.characters[0].name, "Eren");
  assert.equal(preview.characters[0].frameCount, 2);
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, [preview.characters[0].ref]);
  assert.equal(packs.length, 1);
  assert.match(packs[0].id, /^shimeji-[0-9a-f]{8}$/);
  const manifest = await getShimejiPack(null, dataDir, packs[0].id);
  assert.ok(manifest);
  assert.equal(manifest.actions.length, 4);
  const src = await getShimejiFrameDataUrl(null, dataDir, packs[0].id, "shime1.png");
  assert.ok(src?.startsWith("data:image/png;base64,"));
  // 路径穿越守卫
  assert.equal(await getShimejiPack(null, dataDir, "../../etc"), null);
  assert.equal(await getShimejiFrameDataUrl(null, dataDir, packs[0].id, "../manifest.json"), null);
});

await test("T4b zip·引擎布局(根 conf + img/<品种>):品种识别为角色", async () => {
  const preview = await importShimejiZip(null, dataDir, Buffer.from(makeZip("engine")).toString("base64"));
  assert.equal(preview.characters.length, 1);
  assert.equal(preview.characters[0].name, "Doraemon");
  assert.equal(preview.characters[0].format, "原版");
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, [preview.characters[0].ref]);
  const manifest = await getShimejiPack(null, dataDir, packs[0].id);
  assert.equal(manifest.frames.length, 1); // icon 不算帧
  assert.ok(existsSync(join(dataDir, "shimeji-packs", packs[0].id, "img", "shime1.png")));
});

await test("T4c zip·多角色:引擎布局多品种 + 自包含多目录", async () => {
  const multi = zipSync({
    "Mikasa/conf/Actions.xml": strToU8(EN_ACTIONS),
    "Mikasa/img/shime1.png": PNG_1PX,
    "Eren/conf/Actions.xml": strToU8(EN_ACTIONS),
    "Eren/img/shime1.png": PNG_1PX,
  });
  const preview = await importShimejiZip(null, dataDir, Buffer.from(multi).toString("base64"));
  assert.equal(preview.characters.length, 2);
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, preview.characters.map((c) => c.ref));
  assert.equal(packs.length, 2);
});

await test("T4d zip·角色目录内引擎布局(<角色>/conf + <角色>/img/<品种>):用户真实哆啦A梦包形态", async () => {
  // conf 不在根、也不与 img 平级为直下帧——品种目录再套一层;旧实现 confDir 推导
  // 只认以 /img 结尾的 ref,在此布局 readFile(undefined) 必炸(实机预检抓到)
  const nested = zipSync({
    "Doraemon/conf/actions.xml": strToU8(EN_ACTIONS),
    "Doraemon/conf/behaviors.xml": strToU8(JA_BEHAVIORS),
    "Doraemon/img/icon.png": PNG_1PX,
    "Doraemon/img/Doraemon/shime1.png": PNG_1PX,
    "Doraemon/img/Doraemon/shime2.png": PNG_1PX,
  });
  const preview = await importShimejiZip(null, dataDir, Buffer.from(nested).toString("base64"));
  assert.equal(preview.characters.length, 1);
  assert.equal(preview.characters[0].name, "Doraemon");
  assert.equal(preview.characters[0].frameCount, 2);
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, [preview.characters[0].ref]);
  assert.equal(packs.length, 1);
  const manifest = await getShimejiPack(null, dataDir, packs[0].id);
  assert.equal(manifest.frames.length, 2);
  assert.ok(manifest.actions.length >= 3);
});

// ── 真实大包(本地 fixtures 存在才跑) ──
const FIXTURES = join(ROOT, ".shimeji-fixtures");
const realPackZip = (dir) => {
  // 已解压目录 → 现场打 zip(等价于用户的下载包)
  const files = {};
  const walk = (d, prefix) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, f.name);
      const key = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.isDirectory()) walk(full, key);
      else files[key] = new Uint8Array(readFileSync(full));
    }
  };
  walk(dir, "");
  return zipSync(files);
};

if (existsSync(FIXTURES)) {
  await test("T5a 真实包·哆啦A梦(Shimeji-ee):91 动作/80 帧/行为表", async () => {
    const preview = await importShimejiZip(null, dataDir, Buffer.from(realPackZip(join(FIXTURES, "doraemon"))).toString("base64"));
    assert.equal(preview.characters.length, 1);
    const c = preview.characters[0];
    assert.equal(c.name, "Doraemon");
    assert.equal(c.actionCount, 91);
    assert.ok(c.frameCount >= 70, `帧数 ${c.frameCount}`);
    assert.equal(c.iconBase64 != null, true);
    const packs = await confirmShimejiImport(null, dataDir, preview.importId, [c.ref]);
    const manifest = await getShimejiPack(null, dataDir, packs[0].id);
    assert.equal(manifest.actions.length, 91);
    assert.ok(manifest.behaviors.length >= 40);
    const stand = manifest.actions.find((a) => a.name === "Stand");
    assert.deepEqual(stand.poses[0].anchor, [64, 128]);
    // 91 动作全部可归档
    for (const a of manifest.actions) {
      const { entry, archive } = archiveOf(a.name);
      assert.ok(entry || archive === "fx", `动作 ${a.name} 未归档`);
    }
  });

  await test("T5b 真实包·巨人(日版原版):10 角色/91 动作/128×128 帧", async () => {
    const aotDir = join(FIXTURES, "Eren Jaeger");
    const single = zipSync({
      "Eren Jaeger/conf/Actions.xml": readFileSync(join(aotDir, "conf", "Actions.xml")),
      "Eren Jaeger/img/shime1.png": readFileSync(join(aotDir, "img", "shime1.png")),
    });
    // 完整多角色 zip:所有角色目录现场打包
    const charDirs = readdirSync(FIXTURES).filter((d) => d !== "doraemon" && existsSync(join(FIXTURES, d, "conf")));
    const files = {};
    for (const d of charDirs) {
      const walk = (dir, prefix) => {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, f.name);
          const key = `${prefix}/${f.name}`;
          if (f.isDirectory()) walk(full, key);
          else files[key] = new Uint8Array(readFileSync(full));
        }
      };
      walk(join(FIXTURES, d), d);
    }
    const fullZip = zipSync(files);
    const preview = await importShimejiZip(null, dataDir, Buffer.from(fullZip).toString("base64"));
    assert.equal(preview.characters.length, 10, `应发现 10 角色,实际 ${preview.characters.length}`);
    const eren = preview.characters.find((c) => c.name === "Eren Jaeger");
    assert.ok(eren, "应含 Eren Jaeger");
    assert.equal(eren.actionCount, 91);
    assert.equal(eren.format, "原版");
    const jaActions = parseShimejiActions(new TextDecoder().decode(readFileSync(join(aotDir, "conf", "Actions.xml"))));
    assert.equal(jaActions.length, 91);
    // 真帧尺寸断言(PNG 头)
    const png = readFileSync(join(aotDir, "img", "shime1.png"));
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    assert.equal(w, 128);
    assert.equal(h, 128);
    const stand = jaActions.find((a) => a.name === "立つ");
    assert.deepEqual(stand.poses[0].anchor, [64, 128]);
    assert.ok(stand.poses.length >= 10, `立つ 帧序应≥10,实际 ${stand.poses.length}`);
    for (const a of jaActions) {
      const { entry } = archiveOf(a.name);
      assert.ok(entry, `日版动作 ${a.name} 未归档`);
    }
    void single;
  });
} else {
  console.log("⚠ SKIP T5 真实大包断言(.shimeji-fixtures/ 不存在)");
}

// ── 源级守卫 ──
await test("T6 守卫:shimeji 模块不 import 禁区(flight/mapPhysics/zone)", () => {
  const files = [
    "src/main/services/shimeji/pure/shimeji-parse.ts",
    "src/main/services/shimeji/shimeji-pack-service.ts",
    "src/renderer/lib/companion/shimeji-pack-store.ts",
    "src/renderer/components/companion/forms/shimeji-form.tsx",
  ];
  const forbidden = ["companion-flight", "mapPhysics", "use-window-tier", "pane-tiers"];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const bad of forbidden) {
      assert.ok(!src.includes(bad), `${f} 引用了禁区模块 ${bad}`);
    }
  }
});

// ── 二期:调度器纯状态机(注入 rng 可复现) ──
const { initMotion, tickShimeji, SHIMEJI_SANDBOX, THROW_MIN_SPEED } = await import(
  "../src/renderer/lib/companion/shimeji-scheduler.ts"
);

/** mulberry32 种子 rng(verify 复现用) */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkManifest(actions) {
  return { id: "shimeji-t", name: "t", format: "ee", frames: [], actions, behaviors: [], archiveVersion: 1, importedAt: "" };
}
const pose = (img, v = [0, 0], d = 4) => ({ image: img, anchor: [64, 128], velocity: v, duration: d });
const SLOT_ACTIONS = [
  { name: "Stand", kind: "Stay", slot: "ground", poses: [pose("a.png")] },
  { name: "Walk", kind: "Move", slot: "ground", poses: [pose("b.png", [2, 0])] },
  { name: "Sit", kind: "Stay", slot: "ground", poses: [pose("c.png")] },
  { name: "Sprawl", kind: "Stay", slot: "ground", poses: [pose("d.png")] },
  { name: "ClimbWall", kind: "Move", slot: "wall", poses: [pose("e.png", [0, -2])] },
  { name: "CeilingWalk", kind: "Move", slot: "ceiling", poses: [{ image: "f.png", anchor: [64, 40], velocity: [1, 0], duration: 4 }] },
  { name: "Dragged", kind: "Embedded", slot: "interact", poses: [pose("g.png", [0, 0], 2), pose("g2.png", [0, 0], 2)] },
  { name: "Fall", kind: "Embedded", slot: "interact", poses: [pose("h.png", [0, 0], 3)] },
];
const SLOT_MANIFEST = mkManifest(SLOT_ACTIONS);
// 一期旧包:同名动作剥掉 slot
const LEGACY_MANIFEST = mkManifest(SLOT_ACTIONS.slice(0, 3).map(({ slot, ...a }) => a));
const tick = (m, manifest) => tickShimeji(m, manifest, { t: "tick" }, "");

await test("T7 旧包退化:无 slot 按 kind 驱动,永不出地面模式;策略池动作可达", () => {
  let m = { ...initMotion(), actionName: "Walk" };
  const names = new Set();
  for (let i = 0; i < 400; i++) {
    m = tick(m, LEGACY_MANIFEST);
    if (m.actionName) names.add(m.actionName);
    assert.equal(m.mode, "ground", "旧包不进 wall/air 等新模式");
    assert.ok(m.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m.x <= SHIMEJI_SANDBOX.maxX + 1e-9);
    assert.equal(m.y, SHIMEJI_SANDBOX.groundY);
  }
  assert.ok(names.size >= 2, `策略池可达多个动作(实际 ${[...names]})`);
  assert.ok([...names].every((n) => ["Stand", "Walk", "Sit"].includes(n)), `池内动作合法(实际 ${[...names]})`);
});

await test("T8 抓/放:grab→dragged 冻结位置+挣扎帧;轻放→settle→ground;快扔(≥2.5)→air 重力落地", () => {
  let m = tickShimeji(initMotion(), SLOT_MANIFEST, { t: "grab" }, "");
  assert.equal(m.mode, "dragged");
  assert.equal(m.actionName, "Dragged");
  const frozen = { x: m.x, y: m.y };
  const frames = new Set([m.poseIdx]);
  for (let i = 0; i < 30; i++) {
    m = tick(m, SLOT_MANIFEST);
    frames.add(m.poseIdx);
    assert.equal(m.mode, "dragged", "挣扎中不自行退出");
    assert.equal(m.x, frozen.x);
    assert.equal(m.y, frozen.y);
  }
  assert.ok(frames.size >= 2, "挣扎帧在推进");
  // 轻放:直接 settle(不进 air),缓冲后回地面
  let m2 = tickShimeji(m, SLOT_MANIFEST, { t: "release", speed: THROW_MIN_SPEED - 0.1 }, "");
  assert.equal(m2.mode, "settle");
  for (let i = 0; i < 40 && m2.mode !== "ground"; i++) m2 = tick(m2, SLOT_MANIFEST);
  assert.equal(m2.mode, "ground");
  // 快扔:air + 重力累积(vy 转正) + 不穿地不越界 + 200 tick 内落地
  let m3 = tickShimeji(m, SLOT_MANIFEST, { t: "release", speed: THROW_MIN_SPEED + 3 }, "");
  assert.equal(m3.mode, "air");
  let sawGravity = false;
  for (let i = 0; i < 200; i++) {
    m3 = tick(m3, SLOT_MANIFEST);
    if (m3.vy > 0) sawGravity = true;
    assert.ok(m3.y <= SHIMEJI_SANDBOX.groundY + 1e-9, "坠落不穿地");
    assert.ok(m3.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m3.x <= SHIMEJI_SANDBOX.maxX + 1e-9, "坠落不越界");
    if (m3.mode === "ground" || m3.mode === "settle") break;
  }
  assert.ok(sawGravity, "重力累积");
  assert.ok(m3.mode === "ground" || m3.mode === "settle", "200 tick 内必落地");
});

await test("T9 贴边物理:wall→ceiling→air→settle→ground 全链 + 全程沙盒内", () => {
  let m = {
    ...initMotion(),
    mode: "wall",
    wallSide: 0,
    x: SHIMEJI_SANDBOX.minX,
    y: SHIMEJI_SANDBOX.groundY - 2,
    actionName: "ClimbWall",
    loopsLeft: 99,
  };
  const seq = ["wall"];
  for (let i = 0; i < 600 && m.mode !== "ground"; i++) {
    m = tick(m, SLOT_MANIFEST);
    if (seq[seq.length - 1] !== m.mode) seq.push(m.mode);
    assert.ok(m.y >= SHIMEJI_SANDBOX.ceilY - 1e-9 && m.y <= SHIMEJI_SANDBOX.groundY + 1e-9, "y 在沙盒内");
    assert.ok(m.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m.x <= SHIMEJI_SANDBOX.maxX + 1e-9, "x 在沙盒内");
  }
  assert.equal(m.mode, "ground");
  assert.deepEqual(seq, ["wall", "ceiling", "air", "settle", "ground"]);
});

await test("T10 复现性:同种子 300 tick 轨迹一致 + confirm 管线烘焙 slot 进 manifest", async () => {
  const run = () => {
    let m = initMotion();
    const lines = [];
    const rng = seeded(42);
    for (let i = 0; i < 300; i++) {
      m = tickShimeji(m, SLOT_MANIFEST, { t: "tick" }, "", rng);
      lines.push(`${m.mode}|${m.actionName}|${m.x.toFixed(2)}|${m.y.toFixed(2)}|${m.poseIdx}`);
    }
    return lines.join(nl2);
  };
  const nl2 = String.fromCharCode(10);
  assert.equal(run(), run(), "同种子轨迹逐字节一致");

  // slot 烘焙(真实 confirm 管线,与 T4a 同源)
  const preview = await importShimejiZip(null, dataDir, Buffer.from(makeZip("self")).toString("base64"));
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, [preview.characters[0].ref]);
  const manifest = await getShimejiPack(null, dataDir, packs[0].id);
  const byName = Object.fromEntries(manifest.actions.map((a) => [a.name, a]));
  assert.equal(byName.Stand?.slot, "ground");
  assert.equal(byName.Walk?.slot, "ground");
  assert.equal(byName.Dragged?.slot, "interact");
});

await test("T11 不原地起爬(实测反馈回归):居中静止的精灵永不被贴墙", () => {
  let m = { ...initMotion(), actionName: "Stand", loopsLeft: 9999 };
  const rng = seeded(7);
  for (let i = 0; i < 600; i++) {
    m = tick(m, SLOT_MANIFEST);
    assert.notEqual(m.mode, "wall", "远离边界不得进 wall");
    assert.ok(m.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m.x <= SHIMEJI_SANDBOX.maxX + 1e-9);
  }
  // 沙盒收紧:脚点范围 ±36=精灵半宽,帧图(128 宽)不出舞台
  assert.ok(SHIMEJI_SANDBOX.minX >= 64 && SHIMEJI_SANDBOX.maxX <= 136);
});

await test("T12 动态沙盒覆盖(墙对齐可见容器边的机制):传入 sandbox 后边界生效", () => {
  let m = { ...initMotion(), actionName: "Walk", loopsLeft: 99 };
  const box = { minX: 90, maxX: 110, ceilY: 100 };
  let sawClamp = false;
  for (let i = 0; i < 400; i++) {
    m = tickShimeji(m, SLOT_MANIFEST, { t: "tick" }, "", seeded(i + 3), box);
    assert.ok(m.x >= box.minX - 1e-9 && m.x <= box.maxX + 1e-9, "x 被钳在覆盖沙盒内");
    if (Math.abs(m.x - box.minX) < 1e-6 || Math.abs(m.x - box.maxX) < 1e-6) sawClamp = true;
  }
  assert.ok(sawClamp, "确实触及过覆盖边界");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
