/**
 * 伴学伙伴(Companion)纯逻辑验证。
 *
 * 覆盖 lib/companion/companion-core.ts 的纯函数(零 DOM,可 headless):
 *   T1 庆祝→表情映射:9 种 celebration kind 全部映射到允许的表情/姿势,
 *      且"错了"必须走鼓励向(不出现羞辱性表情)
 *   T2 状态机 reducer:优先级(庆祝>听写>朗读>流式>睡觉>待机)、保持时长到期回落、
 *      空闲入睡条件(不朗读不听写)、活动唤醒
 *   T3 viseme 判定:静音→闭嘴;按频谱质心+响度海报化分档(A/E/I/O/U)
 *   T4 audioToMouth:合成 Analyser 数据(常数时域/单峰频域)→ level/质心 精确值
 *   T5 视线几何:指针越界钳制/中心归零/lerp 收敛
 *   T6 设置门控:仅 "false"/"0" 关闭(null=默认开,垃圾值=开,回滚等价由 UI 层保证)
 *   T7 打字反应(Bongo Cat 式逐键):press 交替臂/typing 姿势/空闲过期回落/入睡唤醒/
 *      听写中表情优先于打字姿势
 *   T8 窗口失焦:blur 后短阈值入睡(BLUR_SLEEP_MS)/focus 回归=唤醒+打招呼反应/
 *      聚焦时仍走长阈值
 *   T9 发送消息:happy+出拳短反应(把消息"送出去")
 *   T10 闲置视线漫游:同种子确定性/幅值有界/不同种子有变化
 *   T11 麦克风包络:attack 快 release 慢 / 声波弧幅度 4 档量化(渲染防抖)
 */
import assert from "node:assert";

import {
  BLUR_SLEEP_MS,
  SLEEP_AFTER_MS,
  TYPE_IDLE_MS,
  audioToMouth,
  baseExpressionOf,
  clampGaze,
  companionReducer,
  computeViseme,
  expressionForCelebration,
  gazeFromPointer,
  initialCompanionState,
  isCompanionEnabled,
  lerp,
  micArcScale,
  mouthOpenScale,
  smoothMic,
  wanderTarget,
} from "../src/renderer/lib/companion/companion-core.ts";
import {
  COMPANION_FORM_IDS,
  DEFAULT_COMPANION_FORM,
  formIdFromSetting,
} from "../src/renderer/lib/companion/forms-index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- T1 庆祝→表情映射 ---------- */
const ALL_KINDS = [
  "correct",
  "wrong",
  "unlock",
  "mastery",
  "streak",
  "energy-full",
  "exam-pass",
  "lesson-complete",
  "level-up",
];
const ALLOWED_EXPRESSIONS = new Set([
  "base",
  "happy",
  "cheer",
  "encourage",
  "proud",
  "stars",
  "flame",
  "thinking",
  "listening",
  "talking",
  "sleeping",
  "serious",
]);
for (const kind of ALL_KINDS) {
  const r = expressionForCelebration(kind);
  assert.ok(ALLOWED_EXPRESSIONS.has(r.expression), `T1: ${kind} → ${r.expression} 不在允许集合`);
  assert.ok(r.holdMs > 0 && r.holdMs <= 3000, `T1: ${kind} holdMs=${r.holdMs} 应在 (0,3000]`);
}
// 答错必须鼓励向:不许出现负面/羞辱表情(reduce 挫败感是产品红线)
assert.strictEqual(expressionForCelebration("wrong").expression, "encourage");
// 里程碑家族:加冕/升级/考试通过 → 自豪/星星
assert.strictEqual(expressionForCelebration("mastery").expression, "proud");
assert.strictEqual(expressionForCelebration("exam-pass").expression, "stars");
// 连击 → 火焰
assert.strictEqual(expressionForCelebration("streak").expression, "flame");
console.log("✓ T1 庆祝→表情映射(9 kind 全覆盖,错题=鼓励,里程碑=自豪/星星)");

/* ---------- T2 reducer 状态机 ---------- */
// 优先级:活动中的庆祝反应 > 听写 > 朗读 > 流式 > 睡觉 > 待机
let s = initialCompanionState(0);
assert.strictEqual(baseExpressionOf(s), "base");

s = companionReducer(s, { type: "celebration", kind: "mastery", now: 1000 });
assert.strictEqual(s.expression, "proud", "T2: 庆祝应立即覆盖表情");
assert.strictEqual(s.until, 1000 + expressionForCelebration("mastery").holdMs);

// 到期回落:无任何标志时回到 base
s = companionReducer(s, { type: "tick", now: s.until + 1 });
assert.strictEqual(s.expression, "base", "T2: 反应到期应回落");

// 朗读中:庆祝结束后回到 talking 而非 base
s = companionReducer(s, { type: "talking", on: true, now: 2000 });
assert.strictEqual(baseExpressionOf(s), "talking");
s = companionReducer(s, { type: "celebration", kind: "correct", now: 2500 });
assert.strictEqual(s.expression, "cheer");
s = companionReducer(s, { type: "tick", now: 2500 + expressionForCelebration("correct").holdMs + 1 });
assert.strictEqual(s.expression, "talking", "T2: 朗读中庆祝到期应回落到 talking");

// 听写 > 朗读
s = companionReducer(s, { type: "listening", on: true, now: 3000 });
assert.strictEqual(baseExpressionOf(s), "listening", "T2: 听写优先于朗读");
s = companionReducer(s, { type: "tick", now: 3001 });
assert.strictEqual(s.expression, "listening");
// 听写关 → 回朗读
s = companionReducer(s, { type: "listening", on: false, now: 3002 });
assert.strictEqual(baseExpressionOf(s), "talking");

// 流式 > 待机
s = companionReducer(s, { type: "talking", on: false, now: 3100 });
s = companionReducer(s, { type: "streaming", on: true, now: 3101 });
assert.strictEqual(baseExpressionOf(s), "thinking");

// 空闲入睡:超过 SLEEP_AFTER_MS 且不在朗读/听写 → sleeping;朗读中绝不睡
s = companionReducer(s, { type: "streaming", on: false, now: 3102 });
s = companionReducer(s, { type: "activity", now: 5000 }); // 最后活动时刻
s = companionReducer(s, { type: "tick", now: 5000 + SLEEP_AFTER_MS - 1 });
assert.strictEqual(s.sleeping, false, "T2: 未到阈值不应入睡");
s = companionReducer(s, { type: "tick", now: 5000 + SLEEP_AFTER_MS + 1 });
assert.strictEqual(s.sleeping, true, "T2: 到阈值应入睡");
assert.strictEqual(s.expression, "sleeping");
// 活动唤醒
s = companionReducer(s, { type: "activity", now: 5000 + SLEEP_AFTER_MS + 2000 });
assert.strictEqual(s.sleeping, false, "T2: 活动应唤醒");
assert.strictEqual(s.expression, "base");
// 朗读中不入睡
s = companionReducer(s, { type: "talking", on: true, now: 90000 });
s = companionReducer(s, { type: "tick", now: 90000 + SLEEP_AFTER_MS * 2 });
assert.strictEqual(s.sleeping, false, "T2: 朗读中绝不入睡");

// poke:短促开心,不改物理标志
s = companionReducer(s, { type: "talking", on: false, now: 200000 });
s = companionReducer(s, { type: "poke", now: 200001 });
assert.strictEqual(s.expression, "happy");
s = companionReducer(s, { type: "tick", now: 200001 + expressionForCelebration("correct").holdMs });
console.log("✓ T2 状态机:优先级链/保持到期/入睡条件/唤醒/poke");

/* ---------- T3 viseme 判定 ---------- */
assert.strictEqual(computeViseme(0, 0), "closed", "T3: 静音闭嘴");
assert.strictEqual(computeViseme(0.05, 1200), "closed", "T3: 低于门限闭嘴");
assert.strictEqual(computeViseme(0.6, 500), "O", "T3: 低质心+响 → O");
assert.strictEqual(computeViseme(0.1, 500), "U", "T3: 低质心+轻 → U");
assert.strictEqual(computeViseme(0.6, 1200), "A", "T3: 中质心 → A");
assert.strictEqual(computeViseme(0.6, 3000), "E", "T3: 高质心+响 → E");
assert.strictEqual(computeViseme(0.1, 3000), "I", "T3: 高质心+轻 → I");
// 边界:900/2200 是档界,落在界上归下档(<=2200 → A)
assert.strictEqual(computeViseme(0.5, 900), "A");
assert.strictEqual(computeViseme(0.5, 2200), "A");
// 开口度量化:5 档
assert.strictEqual(mouthOpenScale("closed", 0.9), 0);
assert.strictEqual(mouthOpenScale("A", 0.33), 0.25);
assert.strictEqual(mouthOpenScale("A", 1.5), 1);
console.log("✓ T3 viseme:静音闭嘴 + 质心/响度六档 + 开口度 5 档量化");

/* ---------- T4 audioToMouth:合成 Analyser 数据 ---------- */
// 常数时域 200 → level = |200-128|/128 = 0.5625
const td = new Uint8Array(128).fill(200);
// 频域:fftSize 1024, sr 48000 → 每 bin 46.875Hz
const fdA = new Uint8Array(512); fdA[21] = 200; // bin21 = 984.375Hz
const m = audioToMouth(td, fdA, 48000, 1024);
assert.ok(Math.abs(m.level - 0.5625) < 1e-9, `T4: level=${m.level}`);
assert.ok(Math.abs(m.centroidHz - 984.375) < 1e-6, `T4: centroid=${m.centroidHz}`);
assert.strictEqual(m.viseme, "A");
// 单峰低频 bin5 = 234.375Hz → O
const fdO = new Uint8Array(512); fdO[5] = 255;
assert.strictEqual(audioToMouth(td, fdO, 48000, 1024).viseme, "O");
// 单峰高频 bin64 = 3000Hz → E(响)
const fdE = new Uint8Array(512); fdE[64] = 200;
assert.strictEqual(audioToMouth(td, fdE, 48000, 1024).viseme, "E");
// 全零频域 → 质心 0 → 闭嘴路径不 NaN
const m0 = audioToMouth(new Uint8Array(128).fill(128), new Uint8Array(512), 48000, 1024);
assert.strictEqual(m0.level, 0);
assert.ok(Number.isFinite(m0.centroidHz), "T4: 全零质心必须有限");
assert.strictEqual(m0.viseme, "closed");
console.log("✓ T4 audioToMouth:合成数据 level/质心精确,零数据无 NaN");

/* ---------- T5 视线几何 ---------- */
assert.deepStrictEqual(clampGaze(5, -5), { x: 1, y: -1 });
assert.deepStrictEqual(clampGaze(0.3, 0.7), { x: 0.3, y: 0.7 });
const g = gazeFromPointer(300, 200, 100, 100, 100); // 右下方 2x/1x 半径外
assert.strictEqual(g.x, 1);
assert.strictEqual(g.y, 1);
const gc = gazeFromPointer(150, 100, 100, 100, 100);
assert.ok(Math.abs(gc.x - 0.5) < 1e-9 && gc.y === 0);
let cur = 0;
for (let i = 0; i < 60; i++) cur = lerp(cur, 1, 0.15);
assert.ok(Math.abs(cur - 1) < 1e-3, "T5: lerp 应收敛到目标");
console.log("✓ T5 视线:钳制/归一/lerp 收敛");

/* ---------- T6 设置门控 ---------- */
assert.strictEqual(isCompanionEnabled(null), true, "T6: 未设置=默认开");
assert.strictEqual(isCompanionEnabled(undefined), true);
assert.strictEqual(isCompanionEnabled("true"), true);
assert.strictEqual(isCompanionEnabled("garbage"), true, "T6: 垃圾值不误伤(诚实默认开)");
assert.strictEqual(isCompanionEnabled("false"), false);
assert.strictEqual(isCompanionEnabled("0"), false);
console.log("✓ T6 设置门控:仅显式 false/0 关闭");

/* ---------- T7 打字反应(Bongo Cat 式逐键) ---------- */
{
  let st = initialCompanionState(0);
  assert.strictEqual(st.typing, false, "T7: 初始非打字");
  st = companionReducer(st, { type: "press", side: -1, now: 1000 });
  assert.strictEqual(st.typing, true, "T7: 键击进入打字");
  assert.strictEqual(st.keySeq, 1);
  assert.strictEqual(st.keySide, -1);
  assert.strictEqual(st.pose, "typing", "T7: 打字姿势(双臂前悬)");
  st = companionReducer(st, { type: "press", side: 1, now: 1050 });
  assert.strictEqual(st.keySeq, 2);
  assert.strictEqual(st.keySide, 1, "T7: 交替臂跟随事件");
  // 空闲过期:TYPE_IDLE_MS 内保持,超过回落
  st = companionReducer(st, { type: "tick", now: 1050 + TYPE_IDLE_MS - 1 });
  assert.strictEqual(st.typing, true, "T7: 键击间隙未超时仍打字");
  st = companionReducer(st, { type: "tick", now: 1050 + TYPE_IDLE_MS + 1 });
  assert.strictEqual(st.typing, false, "T7: 停键超时退出打字");
  assert.strictEqual(st.pose, "float", "T7: 退出打字回悬浮");
  // 入睡被键击唤醒
  st = companionReducer(st, { type: "tick", now: 1050 + SLEEP_AFTER_MS + 60000 });
  assert.strictEqual(st.sleeping, true);
  st = companionReducer(st, { type: "press", side: 1, now: 1050 + SLEEP_AFTER_MS + 61000 });
  assert.strictEqual(st.sleeping, false, "T7: 键击唤醒");
  assert.strictEqual(st.typing, true);
  // 听写中打字:表情仍 listening(语音优先),但 typing 标志保留
  st = companionReducer(st, { type: "listening", on: true, now: 1050 + SLEEP_AFTER_MS + 62000 });
  assert.strictEqual(st.expression, "listening", "T7: 听写表情优先");
  assert.strictEqual(st.pose, "lean-right", "T7: 听写姿势优先");
  assert.strictEqual(st.typing, true, "T7: typing 标志不丢(臂动画仍可用)");
}
console.log("✓ T7 打字反应:逐键交替臂/typing 姿势/超时回落/唤醒/听写优先");

/* ---------- T8 窗口失焦打盹 / 聚焦唤醒 ---------- */
{
  let st = initialCompanionState(0);
  // 聚焦时:长阈值
  assert.strictEqual(st.windowFocused, true, "T8: 初始聚焦");
  st = companionReducer(st, { type: "activity", now: 10000 });
  st = companionReducer(st, { type: "tick", now: 10000 + BLUR_SLEEP_MS + 1 });
  assert.strictEqual(st.sleeping, false, "T8: 聚焦时短时不入睡");
  // 失焦:短阈值入睡(即使最近有活动)
  st = companionReducer(st, { type: "focus", on: false, now: 10100 });
  st = companionReducer(st, { type: "tick", now: 10000 + BLUR_SLEEP_MS + 1 });
  assert.strictEqual(st.sleeping, true, "T8: 失焦后短阈值入睡");
  assert.strictEqual(st.expression, "sleeping");
  // 聚焦回归:唤醒 + 打招呼(happy hop 短反应)
  st = companionReducer(st, { type: "focus", on: true, now: 20000 });
  assert.strictEqual(st.sleeping, false, "T8: 聚焦唤醒");
  assert.strictEqual(st.expression, "happy", "T8: 回归打招呼");
  assert.strictEqual(st.pose, "hop");
  assert.ok(st.until !== null && st.until > 20000, "T8: 打招呼带保持时长");
  // 重复 focus 事件(已聚焦)不反复触发反应
  const before = st.until;
  st = companionReducer(st, { type: "focus", on: true, now: 20100 });
  assert.strictEqual(st.until, before, "T8: 已聚焦的重复 focus 无副作用");
  // 朗读中失焦也不睡(声音还在放)
  st = companionReducer(st, { type: "talking", on: true, now: 30000 });
  st = companionReducer(st, { type: "focus", on: false, now: 30001 });
  st = companionReducer(st, { type: "tick", now: 50000 });
  assert.strictEqual(st.sleeping, false, "T8: 朗读中失焦不睡");
}
console.log("✓ T8 窗口失焦:短阈值打盹/聚焦唤醒+打招呼/重复 focus 幂等/朗读豁免");

/* ---------- T9 发送消息反应 ---------- */
{
  let st = initialCompanionState(0);
  st = companionReducer(st, { type: "send", now: 5000 });
  assert.strictEqual(st.expression, "happy", "T9: 发送=开心");
  assert.strictEqual(st.pose, "punch", "T9: 发送=出拳(把消息送出去)");
  assert.strictEqual(st.until, 5000 + 700);
  st = companionReducer(st, { type: "tick", now: 5701 });
  assert.strictEqual(st.expression, "base", "T9: 短反应回落");
}
console.log("✓ T9 发送消息:happy+出拳 700ms 短反应");

/* ---------- T10 闲置视线漫游 ---------- */
{
  const a = wanderTarget(42);
  const b = wanderTarget(42);
  assert.deepStrictEqual(a, b, "T10: 同种子确定性");
  assert.ok(Math.abs(a.x) <= 0.75 && Math.abs(a.y) <= 0.75, "T10: 幅值有界");
  assert.ok(!(a.x === 0 && a.y === 0), "T10: 漫游目标不是死中心");
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(JSON.stringify(wanderTarget(i)));
  assert.ok(seen.size >= 3, `T10: 不同种子应有变化(实测 ${seen.size} 种)`);
  // 连续整数种子也无 NaN
  for (let i = 0; i < 100; i++) {
    const w = wanderTarget(i * 7919);
    assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y), "T10: 无 NaN");
  }
}
console.log("✓ T10 视线漫游:确定性/有界/有变化");

/* ---------- T11 麦克风包络与声波弧 ---------- */
{
  // attack 快:0 → 0.9 一步过半
  const up1 = smoothMic(0, 0.9);
  assert.ok(up1 > 0.45, `T11: attack 应快(实测 ${up1.toFixed(3)})`);
  assert.ok(up1 < 0.9, "T11: attack 不是瞬时跳变(平滑)");
  // release 慢:0.9 → 0.1 一步降不到一半
  const down1 = smoothMic(0.9, 0.1);
  assert.ok(down1 > 0.45 && down1 < 0.9, `T11: release 应慢(实测 ${down1.toFixed(3)})`);
  assert.ok(up1 - 0 > 0.9 - down1, "T11: 起音快于释放(attack 步幅 > release 步幅)");
  // 收敛:反复趋近 raw
  let v = 0;
  for (let i = 0; i < 40; i++) v = smoothMic(v, 0.8);
  assert.ok(Math.abs(v - 0.8) < 1e-6, "T11: 包络收敛到 raw");
  // 声波弧 4 档量化(渲染防抖)
  assert.strictEqual(micArcScale(0), 0, "T11: 静默无弧");
  assert.strictEqual(micArcScale(0.1), 0.35);
  assert.strictEqual(micArcScale(0.3), 0.7);
  assert.strictEqual(micArcScale(0.8), 1);
  assert.strictEqual(micArcScale(1.5), 1, "T11: 越界钳制到顶档");
}
console.log("✓ T11 麦克风:attack快/release慢/收敛 + 声波弧 4 档量化");

/* ---------- T12 形象注册表(皮肤系统) ---------- */
{
  // id 清单:唯一、有序、默认在列
  assert.strictEqual(new Set(COMPANION_FORM_IDS).size, COMPANION_FORM_IDS.length, "T12: 形象 id 必须唯一");
  assert.ok(COMPANION_FORM_IDS.includes(DEFAULT_COMPANION_FORM), "T12: 默认形象必须在清单内");
  assert.strictEqual(COMPANION_FORM_IDS.length, 5, "T12: 五款形象(小焰/霜绒/苔芽/星尘/墨墨)");
  // 设置回退:合法值直通,空/垃圾值回默认(绝不在渲染层炸)
  for (const id of COMPANION_FORM_IDS) assert.strictEqual(formIdFromSetting(id), id, `T12: ${id} 直通`);
  assert.strictEqual(formIdFromSetting(null), DEFAULT_COMPANION_FORM, "T12: 未设置→默认");
  assert.strictEqual(formIdFromSetting(undefined), DEFAULT_COMPANION_FORM);
  assert.strictEqual(formIdFromSetting("hacker-cat"), DEFAULT_COMPANION_FORM, "T12: 垃圾值→默认");
  assert.strictEqual(formIdFromSetting(""), DEFAULT_COMPANION_FORM);
  // 源级接线守卫:注册表/壳/设置选择器三者必须存在且互相咬合
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const registry = readFileSync(join(root, "src/renderer/components/companion/forms/registry.tsx"), "utf-8");
  const mascot = readFileSync(join(root, "src/renderer/components/companion/Mascot.tsx"), "utf-8");
  const settings = readFileSync(join(root, "src/renderer/components/SettingsView.tsx"), "utf-8");
  const bus = readFileSync(join(root, "src/renderer/lib/companion/bus.ts"), "utf-8");
  for (const id of COMPANION_FORM_IDS) {
    assert.ok(registry.includes(id), `T12: registry.tsx 缺形态 ${id}`);
    assert.ok(settings.includes("${id}"), `T12: SettingsView 缺形态 ${id} 的渲染`);
  }
  assert.ok(mascot.includes("data-form"), "T12: Mascot 壳必须带 data-form(供测试/UI 断言)");
  assert.ok(settings.includes("companion-form-") && settings.includes("COMPANION_FORM_IDS"), "T12: 设置页必须有形象选择卡(testid companion-form-*)");
  assert.ok(mascot.includes("FORM_ART"), "T12: Mascot 壳必须走注册表分发");
  assert.ok(bus.includes("companion_form"), "T12: bus 必须加载 companion_form 设置");
  assert.ok(settings.includes("companion_form"), "T12: 设置页必须写 companion_form");
}
console.log("✓ T12 形象注册表:5 形态唯一/回退安全/注册表·壳·设置·bus 源级咬合");

console.log("\nverify-companion: ALL PASS");
