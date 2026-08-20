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
  SWAT_DIZZY_MS,
  TYPE_IDLE_MS,
  PEEK_CLIP_MAX,
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
  peekClipPct,
  smoothMic,
  wanderTarget,
  zoneDrift,
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
  // 聚焦回归:唤醒 + 挥手打招呼(happy wave 短反应)
  st = companionReducer(st, { type: "focus", on: true, now: 20000 });
  assert.strictEqual(st.sleeping, false, "T8: 聚焦唤醒");
  assert.strictEqual(st.expression, "happy", "T8: 回归打招呼");
  assert.strictEqual(st.pose, "wave");
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

/* ---------- T13 v3 单生物:zone 状态机 + 纱帘 ---------- */
{
  const core = await import("../src/renderer/lib/companion/companion-core.ts");
  const { ZONE_RETURN_MS, VEIL_AFTER_MS, NOTE_HOLD_MS, desiredZone, veilDecision } = core;
  let s = initialCompanionState(0);
  assert.equal(s.zone, "rail", "T13: 初始在左栏老家");
  assert.equal(s.mode, "front", "T13: 初始前台");

  // 输入框聚焦 → 落中栏;失焦后等 ZONE_RETURN_MS → tick 回老家
  s = companionReducer(s, { type: "zoneFocus", on: true, now: 1000 });
  assert.equal(s.zone, "chat", "T13: 聚焦输入框 → 中栏宠物世界");
  assert.equal(desiredZone(s, 1200), "chat", "T13: 聚焦闩在 → 意图停留");
  s = companionReducer(s, { type: "zoneFocus", on: false, now: 2000 });
  assert.equal(s.zone, "chat", "T13: 失焦瞬间不抖走(等返回窗口)");
  s = companionReducer(s, { type: "tick", now: 2000 + ZONE_RETURN_MS - 10 });
  assert.equal(s.zone, "chat", "T13: 返回窗口内仍在");
  s = companionReducer(s, { type: "tick", now: 2000 + ZONE_RETURN_MS + 60 });
  assert.equal(s.zone, "rail", "T13: 窗口过 → 回左栏");

  // 朗读 → 右栏助教;聚焦输入框优先于朗读
  s = companionReducer(s, { type: "talking", on: true, now: 4000 });
  assert.equal(s.zone, "notebook", "T13: 朗读 → 右栏助教世界");
  s = companionReducer(s, { type: "zoneFocus", on: true, now: 4100 });
  assert.equal(s.zone, "chat", "T13: 聚焦输入框 > 朗读(宠物优先)");
  s = companionReducer(s, { type: "zoneFocus", on: false, now: 4200 });
  s = companionReducer(s, { type: "tick", now: 4200 + ZONE_RETURN_MS + 60 });
  assert.equal(s.zone, "notebook", "T13: 输入框释放后朗读仍续 → 回右栏");
  s = companionReducer(s, { type: "talking", on: false, now: 9000 });
  s = companionReducer(s, { type: "tick", now: 9000 + ZONE_RETURN_MS + 60 });
  assert.equal(s.zone, "rail", "T13: 朗读结束 → 回左栏");

  // 划线记笔记 → 右栏 + writing 姿势 + 短暂钉住
  s = companionReducer(s, { type: "zoneNote", now: 20000 });
  assert.equal(s.zone, "notebook", "T13: 划线 → 右栏");
  assert.equal(s.pose, "writing", "T13: 记笔记姿势");
  assert.equal(desiredZone(s, 20000 + NOTE_HOLD_MS - 100), "notebook", "T13: 钉住期内意图在右栏");
  s = companionReducer(s, { type: "tick", now: 20000 + NOTE_HOLD_MS + 100 });
  s = companionReducer(s, { type: "tick", now: 20000 + NOTE_HOLD_MS + ZONE_RETURN_MS + 100 });
  assert.equal(s.zone, "rail", "T13: 记完笔记回家");

  // 纱帘:空闲 VEIL_AFTER_MS 后入帘;滚动加速;点击唤醒;任务中豁免
  s = initialCompanionState(0);
  s = companionReducer(s, { type: "activity", now: 0 });
  assert.equal(veilDecision(s, VEIL_AFTER_MS - 1), false, "T13: 空闲未满不入帘");
  s = companionReducer(s, { type: "tick", now: VEIL_AFTER_MS + 100 });
  assert.equal(s.mode, "veil", "T13: 空闲满 → 纱帘后");
  s = companionReducer(s, { type: "poke", now: VEIL_AFTER_MS + 200 });
  assert.equal(s.mode, "front", "T13: 点击唤醒回前台");
  s = initialCompanionState(0);
  s = companionReducer(s, { type: "activity", now: 0 });
  s = companionReducer(s, { type: "scroll", now: 3000 });
  // 滚动进行中(1600ms 宽限窗内)且无交互已过 2500ms → 入帘
  s = companionReducer(s, { type: "tick", now: 3000 + 1500 });
  assert.equal(s.mode, "veil", "T13: 滚动中且无交互 → 加速入帘");
  s = initialCompanionState(0);
  s = companionReducer(s, { type: "talking", on: true, now: 0 });
  s = companionReducer(s, { type: "scroll", now: 100 });
  s = companionReducer(s, { type: "tick", now: 999999 });
  assert.equal(veilDecision(s, 999999), false, "T13: 朗读中永不入帘");

  // 被球拍中:surprised 晕眩短反应
  s = companionReducer(initialCompanionState(0), { type: "swat", now: 500 });
  assert.equal(s.expression, "surprised", "T13: 被拍 → 惊吓表情");
  assert.equal(s.pose, "flying", "T13: 被拍 → 飞行翻滚姿势");

  // poke 反应花样轮换:跳跳 → 挥手 → 转圈 → 回跳跳(确定性循环)
  {
    let p = initialCompanionState(0);
    const poses = [];
    for (let i = 0; i < 4; i++) {
      p = companionReducer(p, { type: "poke", now: 1000 + i * 2000 });
      poses.push(p.pose);
      assert.equal(p.pokeSeq, i + 1, "T13: pokeSeq 递增");
    }
    assert.deepEqual(poses, ["wave", "spin", "hop", "wave"], `T13: poke 花样轮换(实测=${poses.join(",")})`);
  }

  // v4 情境反应:考试加油/导入欢呼与鼓励/复习待命/隔天欢迎/卡点指向
  {
    let q = initialCompanionState(0);
    q = companionReducer(q, { type: "examEnter", now: 100 });
    assert.equal(q.expression, "cheer", "T13: 进考试=加油");
    q = companionReducer(q, { type: "importing", on: true, now: 200 });
    assert.equal(q.importing, true, "T13: 导入监工旗");
    assert.equal(veilDecision(q, 999999), false, "T13: 导入中豁免纱帘");
    q = companionReducer(q, { type: "importDone", ok: true, now: 300 });
    assert.equal(q.importing, false, "T13: 导入结束清旗");
    assert.equal(q.expression, "stars", "T13: 导入成功=星星眼欢呼");
    q = companionReducer(q, { type: "importDone", ok: false, now: 400 });
    assert.equal(q.expression, "encourage", "T13: 导入失败=鼓励不嘲讽");
    q = companionReducer(q, { type: "reviewing", on: true, now: 500 });
    assert.equal(q.expression, "proud", "T13: 复习开=自豪待命");
    q = companionReducer(q, { type: "dayWelcome", now: 600 });
    assert.equal(q.expression, "stars", "T13: 隔天回来=加倍欢迎");
    q = companionReducer(q, { type: "nodePoint", now: 700 });
    assert.equal(q.expression, "thinking", "T13: 卡点指向=托腮");
  }

  // v4 抓取:抓住挣扎/快扔晕眩→鼓脸/慢放温柔
  {
    let g = initialCompanionState(0);
    g = companionReducer(g, { type: "grab", on: true, now: 100 });
    assert.equal(g.grabbed, true, "T13: 抓住");
    assert.equal(g.expression, "surprised", "T13: 抓住=挣扎惊吓");
    // 快扔:晕眩(surprised)→ tick 过期 → 鼓脸余怒(huffy)
    g = companionReducer(g, { type: "grab", on: false, speed: 8, now: 200 });
    assert.equal(g.grabbed, false, "T13: 松手");
    assert.equal(g.expression, "surprised", "T13: 快扔=晕眩翻滚");
    g = companionReducer(g, { type: "tick", now: 200 + SWAT_DIZZY_MS + 100 });
    assert.equal(g.expression, "huffy", "T13: 晕眩结束=鼓脸生气");
    assert.ok(g.until !== null && g.until > 200 + SWAT_DIZZY_MS + 100, "T13: 鼓脸带保持");
    g = companionReducer(g, { type: "tick", now: 999999 });
    assert.notEqual(g.expression, "huffy", "T13: 余怒到期回常态");
    // 慢放:温柔 happy 不生气
    let g2 = initialCompanionState(0);
    g2 = companionReducer(g2, { type: "grab", on: true, now: 100 });
    g2 = companionReducer(g2, { type: "grab", on: false, speed: 1, now: 200 });
    assert.equal(g2.expression, "happy", "T13: 慢放=开心不生气");
  }
}
console.log("✓ T13 单生物 zone 状态机:三重世界往返/优先级(聚焦>朗读)/记笔记钉住/纱帘判定/被拍晕眩");

/* ---------- T14 飞行物理纯函数 + 稳定性仿真 ---------- */
{
  const {
    bankAngle,
    createFlightWorld,
    cruiseTarget,
    crossImpulse,
    flightForce,
    pickPerchBase,
    SWAT_IMPULSE,
  } = await import("../src/renderer/lib/companion/companion-flight.ts");

  // 待机空地挑选:中部带 + 离球最远 + 确定性
  {
    const W = 300, H = 800;
    const empty = pickPerchBase(W, H, [], 0);
    assert.ok(empty.y >= H * 0.35 && empty.y <= H * 0.65, `T14: 待机点在中部带(实测 y=${empty.y.toFixed(0)})`);
    assert.ok(empty.x >= W * 0.1 && empty.x <= W * 0.9, "T14: 待机点横向安全区内");
    // 正中一颗大球 → 待机点必须避开它(净空 ≥ 球径)
    const ball = { x: W * 0.5, y: H * 0.5, r: 28 };
    const pick = pickPerchBase(W, H, [ball], 0);
    const clear = Math.hypot(pick.x - ball.x, pick.y - ball.y) - ball.r;
    assert.ok(clear >= 55, `T14: 待机空地避开球(实测净空=${clear.toFixed(0)} ≥ 55)`);
    // 同 seed 确定性;球挪走后能选到球原来位置附近(跟随空地变化)
    assert.deepEqual(pickPerchBase(W, H, [ball], 0), pick, "T14: 待机挑选确定性");
    const pick2 = pickPerchBase(W, H, [{ x: W * 0.14, y: H * 0.38, r: 28 }], 0);
    assert.notDeepEqual(pick2, pick, "T14: 空地变化 → 待机点跟着变");
  }

  // 悬浮力:重力补偿——Matter y 正方向向下,补偿力必须为**负**;
  // 写正=重力加倍,生物沉底趴住(实测炸过)
  const f0 = flightForce({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 2);
  assert.ok(Math.abs(f0.fy + 2 * 0.001) < 1e-9, "T14: 静止悬停 = 精确负向重力补偿");
  // 偏离目标 → 拉回方向;速度 → 阻尼反推
  const f1 = flightForce({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
  assert.ok(f1.fx > 0, "T14: 偏左 → 向右拉");
  const f2 = flightForce({ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 0 }, 1);
  assert.ok(f2.fx < 0, "T14: 向右冲 → 阻尼反推");
  // 力单位换算:Matter Δv = F/m × dt²(dt²≈278)——控制器加速度(px/step²)
  // 换算成力必须除以 dt²;忘除=弹簧放大 278 倍 → 40+px/step 钉墙抖动
  // (渲染层"瞬移",实测炸过)
  const f3 = flightForce({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1e6, y: 0 }, 1);
  assert.ok(f3.fx > 0 && f3.fx < 0.01, "T14: 控制器力按 dt² 归一(非裸加速度)");

  // 稳定性仿真(300×800 世界巡航 240 帧):连续性(无瞬移)+ 真悬浮(不沉底)
  {
    const W = 300, H = 800;
    const world = createFlightWorld({ width: W, height: H });
    let prev = { ...world.body.position };
    let maxStep = 0;
    for (let i = 0; i < 240; i++) {
      world.step(16.7, { x: W * 0.6, y: 150 }, [], i * 16.7);
      const p = world.body.position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = { x: p.x, y: p.y };
    }
    const p = world.body.position;
    assert.ok(maxStep < 15, `T14: 巡航连续性(实测 maxStep=${maxStep.toFixed(1)}px/帧 < 15,瞬移即红)`);
    assert.ok(
      Math.abs(p.x - W * 0.6) < 70 && Math.abs(p.y - 150) < 70,
      `T14: 巡航真悬浮在巡航点(实测=(${p.x.toFixed(0)},${p.y.toFixed(0)}),沉底/漂走即红)`,
    );
    world.dispose();
  }
  // 避让纯函数:域外零推力/方向推离/接近制动增强/重合安全
  {
    const { avoidAccel, AVOID_MARGIN, AVOID_MAX } = await import("../src/renderer/lib/companion/companion-flight.ts");
    const ball = { x: 100, y: 0, r: 28 };
    const far = avoidAccel(300, 0, 22, [ball]);
    assert.ok(Math.hypot(far.x, far.y) < 1e-9, "T14: 感知域外零避让");
    const inRange = avoidAccel(90, 0, 22, [ball]);
    assert.ok(inRange.x < 0, "T14: 避让方向推离球(生物在球左侧 → 推向 -x)");
    // 正在冲向球(速度朝 +x) → 制动增强
    const approaching = avoidAccel(90, 0, 22, [ball], 4, 0);
    assert.ok(approaching.x < inRange.x, "T14: 接近时避让增强(速度感知制动)");
    const coincident = avoidAccel(100, 0, 22, [ball], 0, 0);
    assert.ok(Number.isFinite(coincident.x) && Number.isFinite(coincident.y), "T14: 球心重合无 NaN");
    const clamped = avoidAccel(60, 0, 22, [ball], -12, 0);
    assert.ok(Math.hypot(clamped.x, clamped.y) <= AVOID_MAX * 2 + 1e-9, "T14: 避让合成钳制");
  }
  // 落脚点挑选:最近者优先/超距返回 null/空候选返回 null
  {
    const { pickRestSpot } = await import("../src/renderer/lib/companion/companion-flight.ts");
    const spots = [
      { x: 100, y: 100 },
      { x: 180, y: 140 },
      { x: 40, y: 60 },
    ];
    assert.deepEqual(pickRestSpot({ x: 170, y: 140 }, spots, 220), { x: 180, y: 140 }, "T14: 最近落脚点");
    assert.equal(pickRestSpot({ x: 10, y: 10 }, spots, 50), null, "T14: 超距不落");
    assert.equal(pickRestSpot({ x: 100, y: 100 }, [], 220), null, "T14: 无候选不落");
  }
  // 避让仿真A:球压巡航点,伴学从远处出发 → 全程保持分离 + 平滑 + 稳定悬停
  {
    const Matter = (await import("matter-js")).default;
    const W = 300, H = 800;
    const TOUCH = 28 + 22;
    const world = createFlightWorld({ width: W, height: H });
    Matter.Body.setPosition(world.body, { x: 60, y: 60 });
    const ball = { x: W * 0.6, y: 150, vx: 0, vy: 0, r: 28, isStatic: true, push: () => {} };
    let minD = Infinity, maxStep = 0;
    let prev = { ...world.body.position };
    for (let i = 0; i < 400; i++) {
      world.step(16.7, { x: W * 0.6, y: 150 }, [ball], i * 16.7);
      const p = world.body.position;
      if (i >= 20) minD = Math.min(minD, Math.hypot(p.x - ball.x, p.y - ball.y));
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = { x: p.x, y: p.y };
    }
    assert.ok(minD >= TOUCH - 2, `T14: 巡航绕开球不主动接触(实测 minD=${minD.toFixed(1)} ≥ touch-2=${TOUCH - 2},穿球即红)`);
    assert.ok(maxStep < 15, `T14: 避让机动连续(实测 maxStep=${maxStep.toFixed(1)}px/帧)`);
    const v = world.body.velocity;
    assert.ok(Math.hypot(v.x, v.y) < 2.5, `T14: 避让后稳定悬停(实测末速=${Math.hypot(v.x, v.y).toFixed(2)}px/step)`);
    world.dispose();
  }
  // 避让仿真B:三球链横档巡航点 → 绕行不穿链(地图布局不被自主行动搅乱)
  {
    const Matter = (await import("matter-js")).default;
    const W = 300, H = 800;
    const TOUCH = 28 + 22;
    const world = createFlightWorld({ width: W, height: H });
    Matter.Body.setPosition(world.body, { x: 60, y: 60 });
    const balls = [0.45, 0.6, 0.75].map((k) => ({
      x: W * k, y: 150, vx: 0, vy: 0, r: 28, isStatic: false, push: () => {},
    }));
    let minD = Infinity, jumps = 0;
    let prev = { ...world.body.position };
    for (let i = 0; i < 500; i++) {
      world.step(16.7, { x: W * 0.6, y: 150 }, balls, i * 16.7);
      const p = world.body.position;
      let d = Infinity;
      for (const b of balls) d = Math.min(d, Math.hypot(p.x - b.x, p.y - b.y));
      if (i >= 20) minD = Math.min(minD, d);
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 15) jumps++;
      prev = { x: p.x, y: p.y };
    }
    assert.ok(minD >= TOUCH - 2, `T14: 绕开球链不穿行(实测 minD=${minD.toFixed(1)} ≥ ${TOUCH - 2})`);
    assert.ok(jumps === 0, `T14: 绕行机动无瞬移(实测 jumps=${jumps})`);
    world.dispose();
  }

  // 巡航点:确定性 + 有界 + 围绕基点
  const a = cruiseTarget({ x: 100, y: 100 }, 3, 5000);
  const b2 = cruiseTarget({ x: 100, y: 100 }, 3, 5000);
  assert.deepEqual(a, b2, "T14: 巡航确定性");
  const c = cruiseTarget({ x: 100, y: 100 }, 3, 123456);
  assert.ok(Math.abs(c.x - 100) <= 34.1 && Math.abs(c.y - 100) <= 34 * 0.55 + 4.1, "T14: 巡逻幅值有界");

  // 跨引擎碰撞:分离时 null;重叠时法线朝伴学、接近才有冲量
  assert.equal(crossImpulse(0, 0, 0, 0, 10, 100, 0, 0, 0, 10), null, "T14: 不重叠不碰");
  const hit = crossImpulse(0, 0, 5, 0, 10, 8, 0, 0, 0, 10);
  assert.ok(hit, "T14: 重叠出解");
  assert.ok(hit.nx < 0, "T14: 法线从球指向伴学");
  assert.ok(hit.hitSpeed > SWAT_IMPULSE, "T14: 快球 = 重拍");
  assert.ok(hit.dvx < 0, "T14: 伴学被弹开");
  assert.ok(hit.bfx > 0, "T14: 球受等大反向力");
  const part = crossImpulse(0, 0, -5, 0, 10, 8, 0, 0, 0, 10);
  assert.ok(part && part.hitSpeed <= 0, "T14: 分离中不算击中");
  const slow = crossImpulse(0, 0, 0.5, 0, 10, 8, 0, 0, 0, 10);
  assert.ok(slow && slow.hitSpeed < SWAT_IMPULSE, "T14: 慢碰不算拍");

  // 倾角:静止归零,横速侧倾
  assert.equal(bankAngle(0, 0), 0, "T14: 静止无倾角");
  assert.ok(bankAngle(6, 0) > 0 && bankAngle(-6, 0) < 0, "T14: 倾角随横向速度");
}
console.log("✓ T14 飞行物理:PD 悬浮(重力补偿/钳制)/巡航确定性有界/跨引擎碰撞解算/倾角");

/* ---------- T14b v5 栏内世界:peek 裁剪 + 锚点漂浮 ---------- */
{
  // peekClipPct:完全在卡片上缘之上(飞行途中) → 0;骑在边上 → 按几何算;深潜 → 封顶
  assert.equal(peekClipPct(100, 76, 200), 0, "T14b: 底边在上缘之上不裁剪");
  assert.equal(peekClipPct(100, 76, 138), 0, "T14b: 底边恰好齐上缘不裁剪");
  const mid = peekClipPct(100, 76, 120); // 底边 138,藏 18 → 18/76 ≈ 23.7%
  assert.ok(Math.abs(mid - (18 / 76) * 100) < 0.01, `T14b: 骑边按几何裁剪(实测 ${mid.toFixed(2)}%)`);
  assert.ok(mid > 0 && mid < PEEK_CLIP_MAX, "T14b: 部分隐藏在 0..MAX 之间");
  const deep = peekClipPct(500, 76, 100); // 深潜到卡里
  assert.equal(deep, PEEK_CLIP_MAX, `T14b: 深潜封顶 ${PEEK_CLIP_MAX}%(头和手臂永远可见)`);
  assert.ok(PEEK_CLIP_MAX <= 34, "T14b: 封顶不超过 34%(手臂在 viewBox 60-75% 高度,必须露出来拍键)");

  // zoneDrift:确定性 + 有界(chat 幅度大于 notebook;不撞正文)
  const a = zoneDrift("chat", 12345);
  const b = zoneDrift("chat", 12345);
  assert.deepEqual(a, b, "T14b: 漂移确定性(同刻同值)");
  let cx = 0, cy = 0, nx = 0, ny = 0;
  for (let t = 0; t < 20000; t += 137) {
    const c = zoneDrift("chat", t);
    const n = zoneDrift("notebook", t);
    cx = Math.max(cx, Math.abs(c.x)); cy = Math.max(cy, Math.abs(c.y));
    nx = Math.max(nx, Math.abs(n.x)); ny = Math.max(ny, Math.abs(n.y));
  }
  assert.ok(cx <= 11 && cy <= 5, `T14b: chat 漂移有界(|x|≤11,|y|≤5,实测 ${cx.toFixed(1)}/${cy.toFixed(1)})`);
  assert.ok(nx <= 5 && ny <= 4, `T14b: notebook 漂移更收敛(|x|≤5,|y|≤4,实测 ${nx.toFixed(1)}/${ny.toFixed(1)})`);
  assert.ok(cx > nx, "T14b: chat 幅度大于 notebook(输入框上空开阔,讲解栏旁收敛)");
}
console.log("✓ T14b v5 栏内世界:peek 裁剪几何/封顶 + 锚点漂浮确定性/有界");

/* ---------- T15 v3 接线守卫(源码级:单例/触发点/注册表) ---------- */
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const app = read("App.tsx");
  const creature = read("components/companion/CompanionCreature.tsx");
  const bus = read("lib/companion/bus.ts");
  const mapRail = read("components/MapRail.tsx");
  const composer = read("components/ChatComposer.tsx");
  const notebook = read("components/NotebookPanel.tsx");

  assert.ok(app.includes("CompanionCreature") && !app.includes("ChatCompanion"), "T15: App 只挂单生物,旧栖息地摘除");
  assert.ok((app.match(/<CompanionCreature /g) ?? []).length === 1, "T15: 全应用恰好一只");
  assert.ok(!mapRail.includes("RailCompanion") && !notebook.includes("NotebookCompanion"), "T15: 栏内分身已删");
  assert.ok(creature.includes('data-testid="companion-creature"') && creature.includes("data-zone"), "T15: 生物带 zone 语义(测试锚)");
  assert.ok(creature.includes("createFlightWorld") && creature.includes("BallProbe"), "T15: 生物接飞行物理+球探针");
  assert.ok(bus.includes("companionZoneFocus") && bus.includes("companionNote") && bus.includes("getRailWorld"), "T15: bus 提供 zone 命令+世界注册表");
  assert.ok(composer.includes("companionZoneFocus(true)") && composer.includes("companionZoneFocus(false)"), "T15: 输入框聚焦/失焦接线");
  assert.ok(notebook.includes("companionNote()"), "T15: 划线记笔记接线");
  assert.ok(mapRail.includes("companionRailRegister") && mapRail.includes('visible: panel === "map"'), "T15: 左栏世界注册(岛+可见性)");
  assert.ok(bus.includes('fire("companion-zone-focus"') && bus.includes('fire("companion-rail-register"'), "T15: 组件→bus 触发全部走 window 事件(防打包双实例)");
  assert.ok(read("lib/companion/companion-flight.ts").includes("crossImpulse"), "T15: 跨引擎碰撞存在");
  // v3 细化接线:中部空地待机 / poke 花样 / 表情动效 CSS
  assert.ok(creature.includes("pickPerchBase") && creature.includes("perchDueRef"), "T15: 待机点=中部空地周期重选");
  // v4 接线:情境触发 / 抓取 / 音效 / 徽标 / 天气 / 栖息 / 触屏(app/mapRail 已在上方声明)
  assert.ok(app.includes("companion-exam-enter") && app.includes("companionReviewing"), "T15: 考试加油+复习待命接线");
  assert.ok(app.includes('courseId={selectedCourseId}'), "T15: 记忆联动 courseId 传递");
  assert.ok(mapRail.includes("companionImporting(true)") && mapRail.includes("companionImportDone"), "T15: 导入监工接线");
  const settingsV4 = read("components/SettingsView.tsx");
  assert.ok(settingsV4.includes("companion-sfx-toggle") && settingsV4.includes("companion_sfx"), "T15: 宠物音效设置开关");
  assert.ok(read("lib/companion/pet-sfx.ts").includes("playPetSfx"), "T15: pet-sfx 合成音模块");
  const mascotV4 = read("components/companion/Mascot.tsx");
  assert.ok(mascotV4.includes("onGrab") && mascotV4.includes("crownBadge") && mascotV4.includes("cp-thruster"), "T15: 抓取+皇冠+喷焰壳层");
  assert.ok(mascotV4.includes('touchAction: "none"'), "T15: 触屏抓取支持(touch-action)");
  assert.ok(creature.includes("grabRef") && creature.includes("throwDizzy") && creature.includes("pickRestSpot"), "T15: 抓取物理/扔出晕眩/落脚栖息");
  assert.ok(creature.includes("weatherPhysFor") && creature.includes("cp-shiver"), "T15: 天风吹斜+雨中抖水");
  assert.ok(bus.includes("companion-day-welcome") && bus.includes("getStreak"), "T15: 隔天欢迎(streak 日期)");
  const coreSrc = read("lib/companion/companion-core.ts");
  assert.ok(coreSrc.includes("pokeSeq"), "T15: poke 花样轮换状态");
  const css = read("index.css");
  assert.ok(
    css.includes("cp-pose-wave") && css.includes("cp-pose-spin") && css.includes("cp-star-tw") && css.includes("cp-sleep-breath"),
    "T15: 挥手/转圈/星星眼闪烁/睡眠呼吸 CSS 存在",
  );
  // v5 接线:chat 半身藏卡后 + 栏内漂浮 + 打字反馈加强(拍臂+整机弹跳)
  assert.ok(
    creature.includes('data-testid="composer-card"') && creature.includes("peekClipPct") && creature.includes("clipPath"),
    "T15: chat 锚定输入卡上缘 + peek 裁剪接线",
  );
  assert.ok(creature.includes("zoneDrift"), "T15: 栏内锚点漂浮接线");
  assert.ok(creature.includes("chat: 76") && creature.includes("notebook: 88"), "T15: v5 体型(chat 放大/notebook 看口型)");
  assert.ok(
    mascotV4.includes("52 : -52") && mascotV4.includes("scale(1.045, 0.93)") && mascotV4.includes("cubic-bezier(0.2, 1.5, 0.4, 1)"),
    "T15: 打字反馈加强(大幅拍臂 ±52° + 整机弹跳 + 回弹过冲)",
  );
}
console.log("✓ T15 v3 接线守卫:单例挂载/三触发点/左栏注册表/物理碰撞源级咬合");

console.log("\nverify-companion: ALL PASS");
