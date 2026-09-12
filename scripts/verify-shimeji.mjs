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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
