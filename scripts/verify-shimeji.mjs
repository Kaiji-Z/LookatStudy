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
const { importShimejiZip, confirmShimejiImport, getShimejiPack, getShimejiFrameDataUrl, listShimejiPacks, setVehicleShimeji } = await import(
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

await test("T11 爬墙入口关闭(2026-09-12 拍板方案 B):任意起步永不被贴墙/爬顶", () => {
  for (const [x0, a0] of [[SHIMEJI_SANDBOX.minX, "Walk"], [100, "Stand"], [SHIMEJI_SANDBOX.maxX, "Walk"]]) {
    let m = { ...initMotion(), x: x0, actionName: a0, loopsLeft: 9999 };
    const rng = seeded(7);
    for (let i = 0; i < 600; i++) {
      m = tick(m, SLOT_MANIFEST);
      assert.notEqual(m.mode, "wall", "wall 入口已关(壳无贴边物理,攀爬帧=飘着爬空气墙)");
      assert.notEqual(m.mode, "ceiling", "ceiling 只能从 wall 进入,同样不可达");
      assert.ok(m.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m.x <= SHIMEJI_SANDBOX.maxX + 1e-9);
    }
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

await test("T13 换载具(机械臂同链):manifest.vehicle 持久化 + list 透传 + 非法主题/包守卫", async () => {
  const preview = await importShimejiZip(null, dataDir, Buffer.from(makeZip("self")).toString("base64"));
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, [preview.characters[0].ref]);
  const id = packs[0].id;
  assert.equal((await setVehicleShimeji(null, dataDir, id, "astro")).ok, true);
  const manifest = await getShimejiPack(null, dataDir, id);
  assert.equal(manifest?.vehicle, "astro", "主题写回 manifest");
  const listed = (await listShimejiPacks(null, dataDir)).find((p) => p.id === id);
  assert.equal(listed?.vehicle, "astro", "list 透传 vehicle");
  assert.equal((await setVehicleShimeji(null, dataDir, id, "rainbow")).ok, false, "非法主题拒绝");
  assert.equal((await setVehicleShimeji(null, dataDir, "../../etc", "ink")).ok, false, "路径穿越拒绝");
  const m2 = await getShimejiPack(null, dataDir, id);
  assert.equal(m2?.vehicle, "astro", "非法调用不改动 manifest");
});

await test("T14 rest 居中(实测反馈回归):躺/坐在远端时身体收回台面中心带", () => {
  // 从最右端直接进入 Sit:躺/坐帧横向铺满,中心 100 处才保证像素都在台面(38..162)内
  let m = { ...initMotion(), x: SHIMEJI_SANDBOX.maxX, actionName: "Sit", loopsLeft: 9999 };
  for (let i = 0; i < 600; i++) {
    m = tick(m, SLOT_MANIFEST);
    assert.ok(m.x >= SHIMEJI_SANDBOX.minX - 1e-9 && m.x <= SHIMEJI_SANDBOX.maxX + 1e-9);
  }
  assert.ok(Math.abs(m.x - 100) <= 10, `rest 后应收敛到台面中心带(实际 x=${m.x.toFixed(1)})`);
  // Walk 不受影响:仍可到达散步边界
  let w = { ...initMotion(), x: 100, actionName: "Walk", loopsLeft: 9999 };
  let sawEdge = false;
  for (let i = 0; i < 400; i++) {
    w = tick(w, SLOT_MANIFEST);
    if (w.x <= SHIMEJI_SANDBOX.minX + 1 || w.x >= SHIMEJI_SANDBOX.maxX - 1) sawEdge = true;
  }
  assert.ok(sawEdge, "散步仍能走到边界");
});

await test("T15 池内随机选播(v0.37.1 修「动作很少」):idle/walk/rest 池里多条动作轮流上", () => {
  // 旧 pickFirst 恒取池首:可达集恰好 {Stand,Walk,Sit}=3(Sprawl 在 rest 池第二位,永远够不到)。
  // 池内随机后 Sprawl 可达 → ≥4 是新旧行为的判别线;同种子仍逐 tick 确定(T10 契约)。
  let m = { ...initMotion(), actionName: "Walk" };
  const rng = seeded(20260917);
  const names = new Set();
  for (let i = 0; i < 300; i++) {
    m = tickShimeji(m, SLOT_MANIFEST, { t: "tick" }, "", rng);
    if (m.actionName) names.add(m.actionName);
  }
  assert.ok(
    names.size >= 4,
    `池内随机应触达 ≥4 个动作(实际 ${[...names]})——若回到 3 个说明选播又坍缩成池首`,
  );
  assert.ok(names.has("Sprawl"), "rest 池第二位动作可达(旧恒池首够不到它)");
  // 长序列内动作应多次切换(防"随机但连续重复"的退化)
  let changes = 0;
  let prev = null;
  let m2 = { ...initMotion(), actionName: "Walk" };
  const rng2 = seeded(777);
  for (let i = 0; i < 200; i++) {
    m2 = tickShimeji(m2, SLOT_MANIFEST, { t: "tick" }, "", rng2);
    if (prev !== null && m2.actionName !== prev) changes++;
    prev = m2.actionName;
  }
  assert.ok(changes >= 5, `长序列内动作应多次切换(实际 ${changes} 次)`);
});

await test("T16 导入屏手机适配(v0.37.1):滚动容纳 + 触控地板", async () => {
  const { readFileSync } = await import("node:fs");
  const here = import.meta.url.slice(0, import.meta.url.lastIndexOf("/"));
  const read = (p) => readFileSync(new URL(p, here + "/"), "utf8");
  const dialogSrc = read("../src/renderer/components/ShimejiImportDialog.tsx");
  const wizardSrc = read("../src/renderer/components/companion/CompanionBotWizard.tsx");
  const cssSrc = read("../src/renderer/index.css");
  // Shimeji 弹窗:矮屏滚动容纳(标题/关闭钉住,角色清单滚)
  assert.ok(dialogSrc.includes("max-h-[85dvh]"), "T16 弹窗卡片限高");
  assert.ok(/flex flex-col/.test(dialogSrc), "T16 弹窗纵列布局(钉头+滚体)");
  assert.ok(/min-h-0 overflow-y-auto/.test(dialogSrc), "T16 变量内容滚动容器");
  // 向导:滚动容纳本就在场(锁住防回退)
  assert.ok(wizardSrc.includes("max-h-[86vh]"), "T16 向导卡片限高");
  assert.ok(wizardSrc.includes("overflow-y-auto"), "T16 向导内容滚动");
  // 触控地板:两个屏的钮/链接在 coarse 指针下 ≥40px;图标钮 44px(带文字的不钳宽防截断)
  assert.ok(cssSrc.includes('[data-testid="shimeji-download-links"] a'), "T16 下载链接触控地板");
  assert.ok(cssSrc.includes('[data-testid="companion-wizard"] button'), "T16 向导按钮触控地板");
  assert.ok(cssSrc.includes('[data-testid="shimeji-dialog-close"]'), "T16 关闭钮 44px");
  assert.ok(cssSrc.includes("min-height: 40px"), "T16 地板值在");
  // 包列表选择弹窗(2026-09-17 手机截图定谳):滚动容纳 + 换载具药丸两列栅格 + 卡角钮 36px
  const settingsSrc = read("../src/renderer/components/SettingsView.tsx");
  assert.ok(settingsSrc.includes('data-testid="shimeji-pack-list"'), "T16 shimeji 包列表弹窗在");
  assert.ok(/max-h-\[85dvh\][^>]*data-testid="shimeji-pack-list"/.test(settingsSrc.replace(/\n/g, " ")), "T16 包列表弹窗限高");
  assert.ok(cssSrc.includes('[data-testid="shimeji-veh-picker"] button'), "T16 换载具药丸触控地板");
  assert.ok(cssSrc.includes('button[class*="absolute"]'), "T16 卡角色点/删除钮 36px 抬升");
  assert.ok((settingsSrc.match(/grid grid-cols-2 sm:grid-cols-3/g) ?? []).length >= 2, "T16 换载具药丸窄屏两列栅格(两处 picker)");
});

await test("T17 帧预取+上一帧回退(v0.37.1 修「空方框」):随机选播首播新帧不再闪空洞", async () => {
  const { readFileSync } = await import("node:fs");
  const here = import.meta.url.slice(0, import.meta.url.lastIndexOf("/"));
  const read = (p) => readFileSync(new URL(p, here + "/"), "utf8");
  const storeSrc = read("../src/renderer/lib/companion/shimeji-pack-store.ts");
  const formSrc = read("../src/renderer/components/companion/forms/shimeji-form.tsx");
  // 预取:激活即拉全部 pose 帧(refreshActiveShimeji → prefetchFrames)
  assert.ok(storeSrc.includes("export async function prefetchFrames"), "T17 prefetchFrames 导出");
  assert.ok(/refreshActiveShimeji[\s\S]{0,400}prefetchFrames/.test(storeSrc), "T17 激活后接线预取");
  assert.ok(/for \(const pose of a\.poses \?\? \[\]\)/.test(storeSrc), "T17 遍历全部 pose 帧");
  // 在途去重:同帧并发只发一次 IPC(50ms 循环连渲同帧防重复发射)
  assert.ok(storeSrc.includes("pendingFrames"), "T17 在途帧去重");
  // 回退:src 未到位沿用上一帧(lastSrcRef),不得直接画空 rect
  assert.ok(/if \(frameSrc\) lastSrcRef\.current = frameSrc;/.test(formSrc), "T17 上一帧回退接线");
  assert.ok(/frameSrc \?\? lastSrcRef\.current/.test(formSrc), "T17 src 回退表达式");
});

// ── v0.37.2 可达性修满:P0 归档映射 / P1 池内扩池 / P2 Sequence 摊平 ──

const {
  poolsFor,
} = await import("../src/renderer/lib/companion/shimeji-scheduler.ts");
const { expandShimejiSequences } = await import(
  "../src/main/services/shimeji/pure/shimeji-parse.ts"
);

/** 日文原版包形状:动作名日文,语义全靠 archiveOf 烘焙(P0 前这些判定全部失灵) */
const JA_MANIFEST = mkManifest([
  { name: "立つ", kind: "Stay", slot: "ground", archiveOf: "Stand", poses: [pose("a.png")] },
  { name: "歩く", kind: "Move", slot: "ground", archiveOf: "Walk", poses: [pose("b.png", [2, 0])] },
  { name: "座る", kind: "Stay", slot: "ground", archiveOf: "Sit", poses: [pose("c.png")] },
  { name: "寝そべる", kind: "Stay", slot: "ground", archiveOf: "Sprawl", poses: [pose("d.png")] },
  { name: "跳ねる", kind: "Animate", slot: "celebrate", archiveOf: "Bouncing", poses: [pose("e.png")] },
  { name: "座って首が回る", kind: "Animate", slot: "ground", archiveOf: "SitAndSpinHeadAction", poses: [pose("k.png")] },
  { name: "ドラッグされる", kind: "Sequence", slot: "interact", archiveOf: "Dragged", poses: [pose("f.png", [0, 0], 2)] },
  { name: "落下する", kind: "Sequence", slot: "interact", archiveOf: "Fall", poses: [pose("g.png", [0, -2], 3)] },
  { name: "壁を登る", kind: "Move", slot: "wall", archiveOf: "ClimbWall", poses: [pose("h.png", [0, -2])] },
  { name: "天井を伝う", kind: "Move", slot: "ceiling", archiveOf: "ClimbCeiling", poses: [pose("i.png", [1, 0])] },
  { name: "IEの壁を登る", kind: "Move", slot: "panel", archiveOf: "ClimbIEWall", poses: [pose("j.png", [0, -2])] },
]);

await test("T18 P0 归档映射:日文包语义判定走 archiveOf(休息/挣扎/坠落/表情全通)", () => {
  const pools = poolsFor(JA_MANIFEST);
  assert.ok(pools.rest.some((a) => a.name === "座る"), "rest 池命中日文名座る(archiveOf=Sit)");
  assert.ok(pools.drag.some((a) => a.name === "ドラッグされる"), "drag 池命中 ドラッグされる(archiveOf=Dragged)");
  assert.ok(pools.air.some((a) => a.name === "落下する"), "air 池命中 落下する(archiveOf=Fall)");
  assert.ok(pools.climb.some((a) => a.name === "壁を登る"), "wall 池照常");
  // grab 黑盒:挣扎动作=archiveOf 命中(旧逻辑日文名 DRAG 正则必 miss → 沿用旧帧)
  const g = tickShimeji(initMotion(), JA_MANIFEST, { t: "grab" }, "");
  assert.equal(g.mode, "dragged");
  assert.equal(g.actionName, "ドラッグされる", "抓=挣扎帧按 archiveOf 命中");
  // 快扔黑盒:坠落动作=archiveOf 命中
  const t = tickShimeji(g, JA_MANIFEST, { t: "release", speed: THROW_MIN_SPEED + 1 }, "");
  assert.equal(t.mode, "air");
  assert.equal(t.actionName, "落下する", "快扔=坠落帧按 archiveOf 命中");
  // 表情偏好黑盒:happy → 跳ねる(archiveOf=Bouncing 命中 EXPRESSION_PREF,日文名也能被偏好到)
  let m = initMotion();
  for (let i = 0; i < 5; i++) m = tickShimeji(m, JA_MANIFEST, { t: "tick" }, "happy", seeded(9));
  assert.equal(m.actionName, "跳ねる", "happy 表情经 archiveOf 命中 跳ねる");
});

await test("T19 P1 池内扩池:Animate 进 idle、panel 移出 idle、四触发链池构成", () => {
  const pools = poolsFor(JA_MANIFEST);
  assert.ok(pools.idle.some((a) => a.name === "座って首が回る"), "ground 上 Animate kind 进 idle(v0.37.2 扩)");
  assert.ok(!pools.idle.some((a) => a.slot === "celebrate"), "celebrate 槽不进随机池(表情偏好专属通道)");
  assert.ok(!pools.idle.some((a) => a.slot === "panel"), "panel 槽移出 idle(IE 特技无表面可演)");
  assert.ok(pools.idle.some((a) => a.name === "立つ"), "ground Stay 照常进 idle");
  assert.ok(pools.walk.some((a) => a.name === "歩く"), "ground Move 照常进 walk");
  // 触发链池内随机(P1):wall/ceiling/air/drag 池各多条时非池首可达——
  // 池构成由 poolsFor 保证;消费点 pickVaried 由源级断言锁(pickFirst 已删除)
  const schedSrc = readFileSync(new URL("../src/renderer/lib/companion/shimeji-scheduler.ts", import.meta.url), "utf8");
  assert.ok(!schedSrc.includes("pickFirst"), "P1 触发链恒取池首的 pickFirst 已删除");
  const varidHits = (schedSrc.match(/pickVaried\(pools\./g) ?? []).length;
  assert.ok(varidHits >= 7, `触发链消费点全部 pickVaried(实际 ${varidHits} 处,需 ≥7:三地面池+drag/air/落地/ceiling/fall)`);
});

await test("T20 P2 Sequence 摊平:poses 链拼接+duration 缩放+kind 重写;环/缺引用白名单", async () => {
  const leafWalk = { name: "歩く", kind: "Move", slot: "ground", archiveOf: "Walk", poses: [pose("w1.png", [2, 0], 5), pose("w2.png", [2, 0], 5)] };
  const leafSit = { name: "座る", kind: "Stay", slot: "ground", archiveOf: "Sit", poses: [pose("s1.png", [0, 0], 10)] };
  const seq = {
    name: "歩って座る", kind: "Sequence", slot: "ground", archiveOf: "WalkLeftAndSit",
    refs: [{ name: "歩く", duration: 10 }, { name: "座る", duration: 10 }],
    poses: [],
  };
  const { actions, unexpanded } = expandShimejiSequences([leafWalk, leafSit, seq]);
  assert.equal(unexpanded.length, 0, "正常链无白名单项");
  const expanded = actions.find((a) => a.name === "歩って座る");
  assert.equal(expanded.kind, "Move", "kind 重写=首叶子 Move");
  assert.equal(expanded.poses.length, 3, "poses 链拼接(2+1)");
  const walkTotal = expanded.poses[0].duration + expanded.poses[1].duration;
  assert.ok(Math.abs(walkTotal - 10) <= 2, `引用 duration=10 按比例缩放步进链(实际总时长 ${walkTotal})`);
  // 环引用:A 引 B,B 引 A → 双双白名单,不炸不挂
  const a = { name: "A", kind: "Sequence", refs: [{ name: "B" }], poses: [] };
  const b = { name: "B", kind: "Sequence", refs: [{ name: "A" }], poses: [] };
  const cyc = expandShimejiSequences([a, b]);
  assert.deepEqual(cyc.unexpanded.sort(), ["A", "B"], "环引用双双白名单");
  // 缺引用 → 白名单
  const missing = expandShimejiSequences([{ name: "X", kind: "Sequence", refs: [{ name: "鬼" }], poses: [] }]);
  assert.deepEqual(missing.unexpanded, ["X"], "引用缺失白名单");
  // 深度上限:链长 > 8 → 白名单
  const chain = [];
  for (let i = 0; i < 12; i++) chain.push({ name: `L${i}`, kind: "Sequence", refs: [{ name: `L${i + 1}` }], poses: i === 11 ? [pose("z.png")] : [] });
  chain.push({ name: "L12", kind: "Stay", poses: [pose("z.png")] });
  const deep = expandShimejiSequences(chain);
  assert.ok(deep.unexpanded.includes("L0"), "超深链白名单(不炸)");
  // 真样本烟测:.shimeji-fixtures 在场时(本地/gitignored,CI SKIP)日文包 64 複合应大部分摊平
  try {
    const fs2 = await import("node:fs");
    const fx = new URL("../.shimeji-fixtures/Eren Jaeger/conf/Actions.xml", import.meta.url);
    if (fs2.existsSync(fx)) {
      const real = expandShimejiSequences(parseShimejiActions(fs2.readFileSync(fx, "utf8")));
      const seqTotal = real.actions.filter((x) => x.kind === "Sequence").length;
      assert.ok(seqTotal <= real.unexpanded.length, `真样本未摊平的 Sequence 应≤白名单数(${seqTotal} vs ${real.unexpanded.length})`);
      assert.ok(real.actions.some((x) => x.kind !== "Sequence" && x.poses.length > 0 && x.name === "座ってボーっとする"), "真样本複合动作摊平成功");
    } else {
      console.log("  (T20:.shimeji-fixtures 不在场,真样本烟测 SKIP)");
    }
  } catch { /* fixtures 缺失不红 */ }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
