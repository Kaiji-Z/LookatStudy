/**
 * 季节×天气预设矩阵验证 —— 纯函数,易测。
 *
 * 核心不变量:
 *   1. 12 个预设 season/weather 合法
 *   2. 每个预设 sky 的 t 单调递增 + 首尾同色(无缝循环)
 *   3. PRESET_KEYS 长度=12 无重复
 *   4. rain/storm → particles="rain";snow → "snow";clear/cloudy → "none"
 *   5. storm → lightning=true,其他 false
 *   6. snow → fogAlpha>0(雪带轻雾),其他 0
 *   7. hashStr 确定性 + pickPreset 返回合法 key
 */
import assert from "node:assert";
import { PRESETS, PRESET_KEYS, hashStr, pickPreset } from "../src/renderer/lib/skyCanvas.ts";

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

const VALID_SEASONS = ["spring", "summer", "autumn", "winter"];
const VALID_WEATHERS = ["clear", "cloudy", "rain", "storm", "snow", "fog"];

// T1: 所有预设 season/weather 合法
test("T1 所有预设 season/weather 合法", () => {
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    assert.ok(p, `预设 ${key} 不存在`);
    assert.ok(VALID_SEASONS.includes(p.season), `${key} season=${p.season} 非法`);
    assert.ok(VALID_WEATHERS.includes(p.weather), `${key} weather=${p.weather} 非法`);
    // key 必须与 season|weather 一致
    assert.strictEqual(key, `${p.season}|${p.weather}`, `${key} 与 season|weather 不一致`);
  }
});

// T2: 每个预设 sky 的 t 单调递增 + 首尾同色(无缝循环)
test("T2 sky 关键帧 t 单调递增 + 首尾同色", () => {
  for (const key of PRESET_KEYS) {
    const sky = PRESETS[key].sky;
    assert.ok(sky.length >= 2, `${key} sky 至少 2 段`);
    // t 单调递增
    for (let i = 0; i < sky.length - 1; i++) {
      assert.ok(sky[i].t < sky[i + 1].t, `${key} sky[${i}].t=${sky[i].t} 应 < sky[${i + 1}].t=${sky[i + 1].t}`);
    }
    // 首尾同色(无缝循环:p=0 和 p=1 是同一时刻)
    const a = sky[0], b = sky[sky.length - 1];
    assert.deepStrictEqual([a.top, a.mid, a.hor], [b.top, b.mid, b.hor], `${key} 首尾色不一致`);
  }
});

// T3: PRESET_KEYS 长度=12 无重复
test("T3 PRESET_KEYS 长度=12 无重复", () => {
  assert.strictEqual(PRESET_KEYS.length, 12, `应有 12 个预设,实际 ${PRESET_KEYS.length}`);
  const set = new Set(PRESET_KEYS);
  assert.strictEqual(set.size, 12, "PRESET_KEYS 有重复");
});

// T4: particles 字段与 weather 一致
test("T4 particles 与 weather 一致", () => {
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    if (p.weather === "rain" || p.weather === "storm") {
      assert.strictEqual(p.particles, "rain", `${key} (weather=${p.weather}) particles 应为 rain`);
    } else if (p.weather === "snow") {
      assert.strictEqual(p.particles, "snow", `${key} (snow) particles 应为 snow`);
    } else {
      assert.strictEqual(p.particles, "none", `${key} (weather=${p.weather}) particles 应为 none`);
    }
  }
});

// T5: lightning 仅 storm 为 true
test("T5 lightning 仅 storm=true", () => {
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    if (p.weather === "storm") {
      assert.strictEqual(p.lightning, true, `${key} (storm) lightning 应 true`);
    } else {
      assert.strictEqual(p.lightning, false, `${key} (weather=${p.weather}) lightning 应 false`);
    }
  }
});

// T6: snow 带 fogAlpha>0,其他为 0
test("T6 snow fogAlpha>0,其他 0", () => {
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    if (p.weather === "snow") {
      assert.ok(p.fogAlpha > 0, `${key} (snow) fogAlpha 应 >0`);
    } else {
      assert.strictEqual(p.fogAlpha, 0, `${key} (weather=${p.weather}) fogAlpha 应 0`);
    }
  }
});

// T7: hashStr 确定性 + pickPreset 返回合法 key
test("T7 hashStr 确定性 + pickPreset 合法", () => {
  assert.strictEqual(hashStr("abc"), hashStr("abc"));
  assert.notStrictEqual(hashStr("abc"), hashStr("abd"));
  for (let i = 0; i < 20; i++) {
    const key = pickPreset("course-" + i);
    assert.ok(PRESETS[key], `pickPreset 返回非法 key: ${key}`);
  }
});

// T8: 所有预设都有 ground 配色;winter 预设 snowy=true,其他 false
test("T8 地面配色: winter snowy=true, 其他 false", () => {
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    assert.ok(p.ground, `${key} 缺 ground 配色`);
    assert.ok(Array.isArray(p.ground.far) && p.ground.far.length === 3, `${key} ground.far 非法`);
    assert.ok(Array.isArray(p.ground.near) && p.ground.near.length === 3, `${key} ground.near 非法`);
    if (p.season === "winter") {
      assert.strictEqual(p.ground.snowy, true, `${key} (winter) ground.snowy 应 true`);
    } else {
      assert.strictEqual(p.ground.snowy, false, `${key} (season=${p.season}) ground.snowy 应 false`);
    }
  }
});

// T9: 不同季节 ground.near 颜色明显不同(区分季节的关键视觉)
test("T9 各季节 ground.near 颜色互相不同(可区分季节)", () => {
  const bySeason = {};
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    if (!bySeason[p.season]) bySeason[p.season] = p.ground.near;
  }
  const seasons = Object.keys(bySeason);
  assert.strictEqual(seasons.length, 4, "应有 4 个季节");
  // 两两比较:近地色 RGB 元组不应完全相同
  for (let i = 0; i < seasons.length; i++) {
    for (let j = i + 1; j < seasons.length; j++) {
      const a = bySeason[seasons[i]], b = bySeason[seasons[j]];
      const diff = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      assert.ok(diff > 30, `${seasons[i]} 与 ${seasons[j]} 近地色太接近(diff=${diff}),无法区分季节`);
    }
  }
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 天空预设矩阵: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
