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
  visemeFromFormants,
  readingAnchorFlex,
  glideTo,
  nextRoamPane,
  CRUISE_OP,
  CRUISE_ROAM,
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
// v7 共振峰元音三角直测:五锚点各自的近邻域 + 静音门限
assert.strictEqual(visemeFromFormants(750, 1500, 0.5), "A", "T3: F1 高+F2 中 → A");
assert.strictEqual(visemeFromFormants(450, 2100, 0.5), "E", "T3: F1 中+F2 高 → E");
assert.strictEqual(visemeFromFormants(280, 2400, 0.5), "I", "T3: F1 低+F2 高 → I");
assert.strictEqual(visemeFromFormants(450, 900, 0.5), "O", "T3: F1 中+F2 低 → O");
assert.strictEqual(visemeFromFormants(280, 800, 0.5), "U", "T3: F1 低+F2 低 → U");
assert.strictEqual(visemeFromFormants(750, 1500, 0.03), "closed", "T3: 共振峰法静音门限");
console.log("✓ T3 viseme:静音闭嘴 + 质心/响度六档 + 开口度 5 档量化 + 共振峰元音三角");

/* ---------- T4 audioToMouth:合成 Analyser 数据 ---------- */
// 常数时域 200 → level = |200-128|/128 = 0.5625
const td = new Uint8Array(128).fill(200);
// 频域:fftSize 1024, sr 48000 → 每 bin 46.875Hz
const fdA = new Uint8Array(512); fdA[21] = 200; // bin21 = 984.375Hz
const m = audioToMouth(td, fdA, 48000, 1024);
assert.ok(Math.abs(m.level - 0.5625) < 1e-9, `T4: level=${m.level}`);
assert.ok(Math.abs(m.centroidHz - 984.375) < 1e-6, `T4: centroid=${m.centroidHz}`);
// v7 共振峰法:单峰 984Hz 落 F2 段低区(f1 回退 400) → 后圆唇档 O
assert.strictEqual(m.viseme, "O");
// 单峰低频 bin5 = 234.375Hz → F1 低 + f2 回退 → 闭后圆唇 U
const fdO = new Uint8Array(512); fdO[5] = 255;
assert.strictEqual(audioToMouth(td, fdO, 48000, 1024).viseme, "U");
// 单峰高频 bin64 = 3000Hz → F2 顶格 → 闭前展唇 I
const fdE = new Uint8Array(512); fdE[64] = 200;
assert.strictEqual(audioToMouth(td, fdE, 48000, 1024).viseme, "I");
// 双峰(F1=703Hz + F2=1500Hz,真实元音都是双峰) → 开口 A
const fdV = new Uint8Array(512); fdV[15] = 220; fdV[32] = 200;
assert.strictEqual(audioToMouth(td, fdV, 48000, 1024).viseme, "A", "T4: 双峰 F1 高+F2 中 → A");
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

// v10 lastKey:键入字符随 press 入状态(胸屏数据源);组合键不上屏
{
  let k = initialCompanionState(0);
  k = companionReducer(k, { type: "press", side: -1, now: 100, key: "a" });
  assert.equal(k.lastKey, "a", "T7: 打印字符入 lastKey");
  assert.equal(k.keySeq, 1, "T7: keySeq 递增");
  k = companionReducer(k, { type: "press", side: 1, now: 120 });
  assert.equal(k.lastKey, null, "T7: 无字符键(功能/组合)→ null");
  k = companionReducer(k, { type: "press", side: -1, now: 140, key: "Z" });
  assert.equal(k.lastKey, "Z", "T7: 新字符覆盖");
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
  assert.equal(s.mode, "front", "T13: 初始前台");
  // v10:初始 roam(闲时跨栏游走)
  assert.equal(s.zone, "roam", "T13: v10 初始=roam 游走态");

  // 输入框聚焦 → chat;失焦等 ZONE_RETURN_MS → 回 roam
  s = companionReducer(s, { type: "zoneFocus", on: true, now: 1000 });
  s = companionReducer(s, { type: "tick", now: 1010 });
  assert.equal(s.zone, "chat", "T13: 聚焦输入框 → 中栏(即时跟进)");
  s = companionReducer(s, { type: "zoneFocus", on: false, now: 2000 });
  assert.equal(s.zone, "chat", "T13: 失焦瞬间不抖走(等驻留窗)");
  s = companionReducer(s, { type: "tick", now: 2000 + ZONE_RETURN_MS - 10 });
  assert.equal(s.zone, "chat", "T13: 驻留窗内仍在");
  s = companionReducer(s, { type: "tick", now: 2000 + ZONE_RETURN_MS + 60 });
  assert.equal(s.zone, "roam", "T13: 窗口过 → 回 roam 游走");

  // v10 最新动作优先:先朗读(notebook)后聚焦(chat)→ 跟最新的;
  // 聚焦释放后朗读已停 → 回 roam(不再有固定优先级)
  s = companionReducer(s, { type: "talking", on: true, now: 4000 });
  s = companionReducer(s, { type: "tick", now: 4010 });
  assert.equal(s.zone, "notebook", "T13: 朗读 → 右栏助教世界");
  s = companionReducer(s, { type: "zoneFocus", on: true, now: 4100 });
  s = companionReducer(s, { type: "tick", now: 4110 });
  assert.equal(s.zone, "chat", "T13: 边朗读边聚焦 → 跟最新动作(聚焦)");
  // 反过来:聚焦中开始朗读(更新) → notebook 赢
  s = companionReducer(s, { type: "talking", on: true, now: 4400 });
  s = companionReducer(s, { type: "tick", now: 4410 });
  assert.equal(s.zone, "notebook", "T13: 聚焦中开朗读(更新) → 跟朗读");
  s = companionReducer(s, { type: "talking", on: false, now: 5000 });
  s = companionReducer(s, { type: "tick", now: 5100 });
  assert.equal(s.zone, "chat", "T13: 朗读停但聚焦还在 → 回 chat");
  s = companionReducer(s, { type: "zoneFocus", on: false, now: 9000 });
  s = companionReducer(s, { type: "tick", now: 9000 + ZONE_RETURN_MS + 60 });
  assert.equal(s.zone, "roam", "T13: 全部操作结束 → roam");

  // 划线记笔记 → 右栏 + writing 姿势 + 短暂钉住(信号带到期)
  s = companionReducer(s, { type: "zoneNote", now: 20000 });
  s = companionReducer(s, { type: "tick", now: 20010 });
  assert.equal(s.zone, "notebook", "T13: 划线 → 右栏");
  assert.equal(s.pose, "writing", "T13: 记笔记姿势");
  assert.equal(desiredZone(s, 20000 + NOTE_HOLD_MS - 100), "notebook", "T13: 钉住期内意图在右栏");
  s = companionReducer(s, { type: "tick", now: 20000 + NOTE_HOLD_MS + 100 });
  assert.equal(desiredZone(s, 20000 + NOTE_HOLD_MS + 200), "roam", "T13: note 信号到期 → roam 意图");
  s = companionReducer(s, { type: "tick", now: 20000 + NOTE_HOLD_MS + ZONE_RETURN_MS + 100 });
  assert.equal(s.zone, "roam", "T13: 记完笔记开始游走");

  // 导入监工:importing 钉左栏(优先于一切信号)
  s = companionReducer(s, { type: "talking", on: true, now: 30000 });
  s = companionReducer(s, { type: "importing", on: true, now: 30100 });
  s = companionReducer(s, { type: "tick", now: 30110 });
  assert.equal(s.zone, "rail", "T13: 导入监工钉左栏(压过朗读)");

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
console.log("✓ T13 v10 zone 状态机:最新动作优先/roam 游走态/记笔记钉住/导入监工/纱帘判定/被拍晕眩");

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

/* ---------- T14b v11.5 朗读锚点(整句全部行盒零遮挡 + 四向指向) + 栏内漂浮 ---------- */
{
  // readingAnchorFlex:①整句右侧→②整句左侧→③整句正下方→④整句正上方→⑤最小遮挡+occluding
  const panel = { left: 0, right: 600, top: 0, bottom: 800 };
  const size = 120;
  const line = { left: 100, right: 300, top: 350, bottom: 370 };
  const mid = readingAnchorFlex(line, panel, size);
  assert.ok(mid.x - size / 2 > 300, `T14b: 宽屏=句右侧悬浮(实测 x=${mid.x.toFixed(0)},生物左缘=${(mid.x - size / 2).toFixed(0)})`);
  assert.ok(mid.y > 350 && mid.y < 470, `T14b: 纵向贴行底下沿(实测 y=${mid.y.toFixed(0)})`);
  assert.equal(mid.dir, "left", "T14b: 生物在字右侧 → 指左");
  assert.equal(mid.occluding, false, "T14b: 侧位零遮挡");
  // 不遮字:生物整盒在句矩形右侧(横向零交叠)
  assert.ok(mid.x - size / 2 >= 300, "T14b: 侧位候选横向不压高亮句");
  // 窄屏 A:行满宽(两侧都放不下) → 整句正下方(核心盒贴句底),指上
  const narrow = { left: 0, right: 320, top: 0, bottom: 800 };
  const n = readingAnchorFlex({ left: 10, right: 315, top: 200, bottom: 220 }, narrow, size);
  assert.ok(n.x >= narrow.left + size / 2 && n.x <= narrow.right - size / 2, "T14b: 窄屏 x 全程在面板内");
  assert.ok(n.y > 220, "T14b: 窄屏兜底=句正下方");
  assert.ok(n.y <= narrow.bottom - size / 2, "T14b: y 全程在面板内");
  assert.ok(n.y - size * 0.4 >= 220, `T14b: 核心盒顶缘在句底之下(实测 y=${n.y.toFixed(0)})`);
  assert.equal(n.dir, "up", "T14b: 句下方 → 指上");
  // 窄屏 B:缩进/短行(行首离面板左缘有余量) → 整句左侧镜像,横向零遮挡
  const ind = readingAnchorFlex({ left: 160, right: 310, top: 200, bottom: 220 }, narrow, size);
  assert.ok(ind.x + size / 2 < 160 + 4, `T14b: 缩进行=句左侧(实测 x=${ind.x.toFixed(0)})`);
  assert.equal(ind.dir, "right", "T14b: 生物在字左侧 → 指右");
  // 两侧都放不下(极窄) → 正下方兜底,仍不出面板
  const xn = { left: 0, right: 240, top: 0, bottom: 800 };
  const b = readingAnchorFlex({ left: 10, right: 230, top: 100, bottom: 120 }, xn, size);
  assert.ok(b.x + size / 2 <= xn.right, `T14b: 极窄兜底不出面板(实测 x=${b.x.toFixed(0)})`);
  assert.ok(b.y > 120, "T14b: 兜底=句正下方");
  // v11.5 多行句:前两行满宽、末行短——只让开末行的侧位会被上半身压住满宽行,
  // 障碍物=全部行盒 → 侧位被拒,落整句正下方
  const ml = readingAnchorFlex(
    { left: 0, right: 580, top: 100, bottom: 180 },
    { left: 0, right: 620, top: 0, bottom: 800 },
    size,
    { first: { left: 0, right: 580, top: 100, bottom: 124 }, last: { left: 0, right: 200, top: 156, bottom: 180 } },
    [
      { left: 0, right: 580, top: 100, bottom: 124 },
      { left: 0, right: 580, top: 128, bottom: 152 },
      { left: 0, right: 200, top: 156, bottom: 180 },
    ],
  );
  assert.equal(ml.dir, "up", "T14b: 多行满宽句=整句正下方");
  assert.equal(ml.occluding, false, "T14b: 多行句正下方零遮挡");
  assert.ok(ml.y - size * 0.4 >= 180, `T14b: 核心盒在末行底之下(实测 y=${ml.y.toFixed(0)})`);
  // v11.5 句贴面板底:正下方被 yMax 钳进句里 → 整句正上方,指下
  const ab = readingAnchorFlex(
    { left: 50, right: 500, top: 690, bottom: 780 },
    { left: 0, right: 560, top: 0, bottom: 820 },
    size,
    undefined,
    [{ left: 50, right: 500, top: 690, bottom: 780 }],
  );
  assert.equal(ab.dir, "down", "T14b: 句贴底=整句正上方 → 指下");
  assert.equal(ab.occluding, false, "T14b: 正上方零遮挡");
  assert.ok(ab.y + size * 0.4 <= 690, `T14b: 核心盒底缘在句顶之上(实测 y=${ab.y.toFixed(0)})`);
  // v11.5 极端窄面板(句占满面板):所有候选都压句 → 最小遮挡 + occluding(渲染层半透明)
  const tiny = readingAnchorFlex(
    { left: 10, right: 190, top: 60, bottom: 360 },
    { left: 0, right: 200, top: 0, bottom: 400 },
    size,
    undefined,
    [{ left: 10, right: 190, top: 60, bottom: 360 }],
  );
  assert.equal(tiny.occluding, true, "T14b: 全撞句时 occluding=true(半透明回执)");
  assert.ok(tiny.x >= 70 && tiny.x <= 130 && tiny.y >= 70 && tiny.y <= 330, "T14b: 兜底仍钳在面板内");
  // 确定性
  assert.deepEqual(readingAnchorFlex(line, panel, size), mid, "T14b: 锚点确定性");

  // zoneDrift:确定性 + 有界(保留断言)
  const a = zoneDrift("chat", 12345);
  const b2 = zoneDrift("chat", 12345);
  assert.deepEqual(a, b2, "T14b: 漂移确定性(同刻同值)");
  let cx = 0, cy = 0;
  for (let t = 0; t < 20000; t += 137) {
    const c = zoneDrift("chat", t);
    cx = Math.max(cx, Math.abs(c.x)); cy = Math.max(cy, Math.abs(c.y));
  }
  assert.ok(cx <= 11 && cy <= 5, `T14b: chat 漂移有界(实测 ${cx.toFixed(1)}/${cy.toFixed(1)})`);
}
console.log("✓ T14b v11.5 朗读锚点:整句全部行盒零遮挡(右/左/正下/正上)+四向指向+occluding 兜底");

/* ---------- T19 v10 连续移动:限速滑翔 + roam 栏调度 ---------- */
{
  // glideTo:近距指数收敛;远距封顶巡航(跨栏不闪现)
  const near = glideTo({ x: 0, y: 0 }, { x: 10, y: 0 }, 16, CRUISE_OP);
  assert.ok(near.x > 0 && near.x < 10, `T19: 近距平滑趋近(实测 ${near.x.toFixed(2)})`);
  const far = glideTo({ x: 0, y: 0 }, { x: 2000, y: 0 }, 16, CRUISE_ROAM);
  assert.ok(far.x <= CRUISE_ROAM * 16 + 1e-9, `T19: 远距封顶巡航速度(实测 ${far.x.toFixed(2)} ≤ ${(CRUISE_ROAM * 16).toFixed(2)})`);
  assert.ok(far.x > 0, "T19: 封顶仍前进");
  const diag = glideTo({ x: 0, y: 0 }, { x: 300, y: -400 }, 16, CRUISE_OP);
  const dd = Math.hypot(diag.x, diag.y);
  assert.ok(dd <= CRUISE_OP * 16 + 1e-9, `T19: 斜向同样限幅(实测 ${dd.toFixed(2)})`);

  // nextRoamPane:同桶不动/首桶稳定/跨栏率合理/不可用栏跳过
  const all = ["rail", "chat", "notebook"];
  assert.equal(nextRoamPane("chat", 0, all), "chat", "T19: 首桶稳定(启动不立刻跨栏)");
  assert.equal(nextRoamPane("chat", 7, ["chat", "notebook"]), nextRoamPane("chat", 7, ["chat", "notebook"]), "T19: 同参确定性");
  assert.equal(nextRoamPane("rail", 5, ["chat"]), "chat", "T19: 当前栏不可用 → 落到在场栏");
  let crossed = 0;
  let pane = "rail";
  for (let bkt = 1; bkt <= 400; bkt++) {
    const next = nextRoamPane(pane, bkt, all);
    if (next !== pane) crossed++;
    pane = next;
  }
  assert.ok(crossed > 40 && crossed < 240, `T19: 跨栏率 ~30%(实测 ${crossed}/400)`);
  // 相邻栏偏好:跨栏只跨一步(环形)
  let pane2 = "rail";
  for (let bkt = 1; bkt <= 200; bkt++) {
    const next = nextRoamPane(pane2, bkt, all);
    if (next !== pane2) {
      const dist = Math.min(Math.abs(all.indexOf(next) - all.indexOf(pane2)), 3 - Math.abs(all.indexOf(next) - all.indexOf(pane2)));
      assert.equal(dist, 1, "T19: 跨栏=相邻一步(rail→chat→notebook 环)");
    }
    pane2 = next;
  }
}
console.log("✓ T19 v10 连续移动:限速滑翔(远距封顶)/roam 栏调度(首桶稳定/跨栏率/相邻偏好)");

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
  // v5 接线:栏内漂浮 + 打字反馈加强(拍臂+整机弹跳);v6 撤 peek 改纯漂浮
  assert.ok(creature.includes('data-testid="composer-card"'), "T15: chat 锚定输入卡(composer-card)");
  assert.ok(!creature.includes("clipPath"), "T15: v6 已撤 peek 裁剪(无 clipPath)");
  assert.ok(creature.includes("zoneDrift"), "T15: 栏内锚点漂浮接线");
  assert.ok(creature.includes("rail: 76") && creature.includes("chat: 96") && creature.includes("notebook: 120"), "T15: v8 近大远小体型(左远 76/中 96/右近 120)");
  assert.ok(!creature.includes("crownBadge={"), "T15: v8 已按要求去掉皇冠徽标");
  assert.ok(creature.includes("getReadingRange") && creature.includes("wanderInPanel"), "T15: Range 跟句 + 右栏面板徘徊");
  assert.ok(read("lib/highlightText.ts").includes("highlights") && read("lib/highlightText.ts").includes("getReadingRange"), "T15: 朗读高亮=CSS Custom Highlight API(零 DOM 改动)");
  assert.ok(css.includes("::highlight(cp-reading)"), "T15: highlight CSS");
  // v0.18 整身投影:drop-shadow 跟随剪影(中/右栏),椭圆地影已删,左栏天空无影
  assert.ok(
    css.includes('[data-zone="chat"] .cp-mascot') && css.includes("drop-shadow(4px 6px 5px") && !css.includes(".cp-shadow"),
    "T15: v0.18 整身投影=drop-shadow(右下偏移对左上光源),椭圆地影删除",
  );
  assert.ok(!read("components/companion/forms/shared.tsx").includes("GroundShadow"), "T15: GroundShadow 组件已删");
  for (const f of ["ember", "frost", "moss", "astro", "ink"]) {
    const src = read(`components/companion/forms/${f}.tsx`);
    assert.ok(src.lastIndexOf("<Arms") > src.indexOf('className="cp-head"'), `T15: ${f} 手臂图层在头之上(抬臂不藏头后)`);
    assert.ok(!src.includes("GroundShadow"), `T15: ${f} 无地影`);
  }
  assert.ok(
    css.includes("overflow: visible") && css.includes("--cp-speed") && css.includes("rotate: var(--cp-thrust-deg")
      && creature.includes('setProperty("--cp-speed"') && creature.includes("prevPosRef"),
    "T15: v0.18 旋转不裁剪(svg overflow visible)+速度驱动喷焰(速度→不透明度/方向→朝向)",
  );
  assert.ok(
    css.includes(".tb-label") && css.includes(".coarse-only") && css.includes("flex-wrap: nowrap"),
    "T15: v0.18 手机端工具栏图标化单行(tb-label 隐藏/coarse-only 图标/不换行)",
  );
  assert.ok(creature.includes("nextRoamPane(roamRef.current.pane, bucket, avail)") && creature.includes("ROAM_BUCKET_MS"), "T15: v10 roam 跨栏调度(时间桶+留/跨栏)");
  assert.ok(creature.includes("glideTo(cur") && creature.includes("CRUISE_ROAM") && creature.includes("CRUISE_OP"), "T15: v10 限速滑翔(跨栏/跟操作不闪现)");
  assert.ok(creature.includes("zone === \"roam\""), "T15: v10 roam 分支(闲时游走/锚缺失回退在场栏)");
  assert.ok(creature.includes("cp-takeoff"), "T15: 起飞动效(蓄力弹射+喷焰增强)");
  assert.ok(
    mascotV4.includes("-44 : 44") && mascotV4.includes("scale(1.045, 0.93)") && mascotV4.includes("cubic-bezier(0.2, 1.5, 0.4, 1)"),
    "T15: v10 打字=敲自己身体(臂内收 ±44° + 整机弹跳 + 回弹过冲)",
  );
  assert.ok(
    mascotV4.includes("cp-screen-key") && mascotV4.includes("screenKey") && mascotV4.includes("cp-writing") && mascotV4.includes("cp-pen"),
    "T15: v10 胸屏显示按键字符 + 记笔记本笔道具",
  );
  assert.ok(
    /screenKey=\{\s*snap\.state\.typing[\s\S]{0,220}snap\.state\.lastKey/.test(creature) && creature.includes('lastKeyKind === "enter" ? "→"'),
    "T15: 生物把键入字符喂给胸屏(v0.18 含 Enter→/退格⌫ 字形回退)",
  );
  // v6 接线:朗读句级跟随(播放序 + karaoke 高亮 + 跟句指向 + 🔊 sticky)
  const useSpeechSrc = read("lib/useSpeech.ts");
  assert.ok(
    useSpeechSrc.includes("playingSentence") && useSpeechSrc.includes("pendingRef.current.get(nextSeqRef.current)"),
    "T15: useSpeech 播放序=按句序有序消费(pendingRef+nextSeq,非解码完成序)",
  );
  assert.ok(
    useSpeechSrc.includes("lookatstudy-speech-start"),
    "T15: 跨实例互停事件(讲解/对话两个 useSpeech 不再互相残留读态)",
  );
  assert.ok(
    notebook.includes("markReadingSentence") && notebook.includes("playedSentencePrefix(") && !notebook.includes("speechSentencesOf("),
    "T15: 讲解区 karaoke 高亮接线(合成侧权威原文前缀 + markReadingSentence,零复算)",
  );
  assert.ok(
    notebook.includes("resetReadingCursor") && read("components/ChatStream.tsx").includes("resetReadingCursor"),
    "T15: 两处 karaoke 调用都在新一轮朗读时重置匹配游标",
  );
  assert.ok(
    notebook.includes("sticky top-0") && notebook.includes('"node-content-speak"'),
    "T15: 🔊 朗读按钮 sticky 悬浮讲解视口右上(不随正文滚走)",
  );
  assert.ok(
    creature.includes("getReadingRange") && creature.includes("readingAnchorFlex") && creature.includes('"point"'),
    "T15: 伴学跟句(Range 行片段 + readingAnchorFlex 灵活避让锚 + 指向姿势)",
  );
  assert.ok(
    /\.cp-pose-point \.cp-armL[^}]*rotate\(92deg\)/.test(css) && /\.cp-pose-pointr \.cp-armR[^}]*rotate\(-92deg\)/.test(css),
    "T15: 指臂方向正确(armL +92° 左伸 / armR -92° 右伸;符号反=手臂横穿藏头后,实测踩过)",
  );
  assert.ok(
    /\.cp-pose-pointu \.cp-armL[^}]*rotate\(172deg\)/.test(css) && /\.cp-pose-pointd \.cp-armR[^}]*rotate\(-38deg\)/.test(css),
    "T15: v11.5 竖向指向(句下方→172° 抬臂指上 / 句上方→-38° 外展下指)",
  );
  assert.ok(
    creature.includes("sentLines,") && creature.includes('reading?.dir === "up"') && creature.includes('"pointu"') && creature.includes('"pointd"'),
    "T15: v11.5 全部行盒进锚点(调用点实参 sentLines,多行句每行都算)+四向指向接线",
  );
  assert.ok(
    css.includes(".cp-occluding") && creature.includes("setOccluding(pos.occluding)"),
    "T15: v11.5 全撞句兜底=半透明(cp-occluding)让出高亮文字可读性",
  );
  assert.ok(css.includes("cp-reading-mark"), "T15: 朗读句高亮 CSS 存在");
  // v7 接线:共振峰口型 + 航灯 + 块面伪 3D
  assert.ok(read("lib/companion/companion-core.ts").includes("visemeFromFormants"), "T15: 共振峰元音三角口型");
  assert.ok(css.includes("cp-beacon") && css.includes("cp-takeoff"), "T15: 航灯+起飞 CSS");
  assert.ok(read("components/companion/forms/shared.tsx").includes("BevelPlate") && read("components/companion/forms/ember.tsx").includes("BevelPlate"), "T15: 块面伪 3D 倒角套件+应用");
  assert.ok(mascotV4.includes("cp-beacons") && mascotV4.includes("transition"), "T15: 航灯壳层+尺寸过渡动画");
  // v6 chat karaoke:中栏对话消息朗读同样高亮+跟句
  const chatStream = read("components/ChatStream.tsx");
  assert.ok(
    chatStream.includes("markReadingSentence") && chatStream.includes("playingSentence={speech.playingSentence}"),
    "T15: 对话消息朗读 karaoke 接线(playingSentence 透传 + markReadingSentence)",
  );
  assert.ok(
    chatStream.includes(`within: '[data-testid="part-text"]'`),
    "T15: chat karaoke 限定正文 text part(思考块/工具产物显示但不朗读,搜进去必错位)",
  );
  assert.ok(
    creature.includes('[data-testid="chat-stream"]'),
    "T15: 伴学跟句覆盖中栏(mark 所在面板链含 chat-stream)",
  );
  // v9 接线:离线口型时间轴(播放时钟查表)+ 剧本口型(edge 词时序)+ 常驻 + 整句对齐
  assert.ok(
    useSpeechSrc.includes("analyzeVisemeTimeline") && useSpeechSrc.includes("setActivePlayback") && useSpeechSrc.includes("cuesToTimeline") && useSpeechSrc.includes("startedAtCtxTime: ctx.currentTime"),
    "T15: useSpeech 解码后建口型时间轴(剧本 cue 优先/DSP 兜底)+ 起播登记活动播放(带播放时钟零点)",
  );
  const useMouth = read("lib/companion/use-mouth.ts");
  assert.ok(
    useMouth.includes("getActivePlayback") && useMouth.includes("visemeAt"),
    "T15: use-mouth 时间轴优先(ctx.currentTime 播放时钟查表)",
  );
  assert.ok(read("lib/speech-analyser.ts").includes("ActiveSpeechPlayback"), "T15: 活动播放登记所(时间轴+起播时刻+兜底分析器)");
  assert.ok(
    app.includes("<CompanionCreature courseId=") && !app.includes("worldReady"),
    "T15: v9 伴学常驻(无课程也挂载,worldReady 门控移除)",
  );
  assert.ok(creature.includes("window.innerWidth - 8"), "T15: 空态/两栏锚点全缺 → 整窗游走兜底(不隐匿)");
  assert.ok(read("lib/highlightText.ts").includes("matchSentenceAligned") && read("lib/highlightText.ts").includes("canonicalSpeechIndex"), "T15: v9 整句对齐匹配(规范化+句界扩展)");
  assert.ok(
    readFileSync(new URL("../shared/speech-text.ts", import.meta.url), "utf8").includes("while (s > 0 && !endsWithSentenceEnd(texts[s - 1] ?? \"\")) s--;")
      && notebook.includes("playedSentencePrefix(speech.streamTexts, readingIdx)")
      && read("components/ChatStream.tsx").includes("playedSentencePrefix(streamTexts ?? [], readingIdx)"),
    "T15: v11.4 karaoke 已播前缀并组(强断句块并回同句只亮到进度,合成侧权威原文)",
  );
  assert.ok(
    creature.includes("[snap.enabledLoaded, snap.enabled, snap.petMode, reduced]"),
    "T15: rAF effect deps 含 enabledLoaded(首跑 ref 未挂时靠它重跑,否则左上角卡死)",
  );
  const edgeClient = readFileSync(new URL("../src/main/services/speech/edge-tts-client.ts", import.meta.url), "utf8");
  assert.ok(edgeClient.includes("saveSubtitles: true") && edgeClient.includes("wordCues"), "T15: edge 档开逐词边界(WordBoundary sidecar)");
  const ttsService = readFileSync(new URL("../src/main/services/speech/tts-service.ts", import.meta.url), "utf8");
  assert.ok(
    ttsService.includes("buildVisemeCues") && ttsService.includes("readCachedVisemeCues") && ttsService.includes("visemeCues: out.visemeCues"),
    "T15: tts-service 剧本口型接线(词时序→拼音声母 cue,随缓存落盘,事件携带)",
  );
  const speechTypes = readFileSync(new URL("../shared/speech-types.ts", import.meta.url), "utf8");
  assert.ok(speechTypes.includes("export type SpeechViseme"), "T15: SpeechViseme 九形词表(main/renderer 同一真源)");
  const emberForm = read("components/companion/forms/ember.tsx");
  assert.ok(
    emberForm.includes('case "SS"') && emberForm.includes('case "L"') && emberForm.includes('case "FV"'),
    "T15: ember 辅音口型艺术(齿擦/舌尖/咬唇)",
  );
  for (const f of ["frost", "moss", "astro", "ink"]) {
    const fsrc = read(`components/companion/forms/${f}.tsx`);
    assert.ok(
      fsrc.includes('case "SS"') && fsrc.includes('case "L"') && fsrc.includes('case "FV"'),
      `T15: ${f} 辅音口型艺术(齿擦/舌尖/咬唇)`,
    );
    assert.ok(!fsrc.includes("coarseViseme"), `T15: ${f} 不再走 coarseViseme 降级`);
  }
  // v10 新交互接线
  assert.ok(
    !read("components/companion/forms/shared.tsx").includes("export function Shoulders"),
    "T15: 肩甲组件已拆除(v11.3 用户拍板:取消 R-06 肩甲)",
  );
  for (const f of ["ember", "frost", "moss", "astro", "ink"]) {
    assert.ok(!read(`components/companion/forms/${f}.tsx`).includes("Shoulders"), `T15: ${f} 形态无肩甲残留`);
  }
  assert.ok(
    read("lib/highlightText.ts").includes("setLastNoteMark") && notebook.includes("setLastNoteMark") && creature.includes("getLastNoteMark"),
    "T15: 记笔记落点通道(画线 mark 登记 → 生物飞到线旁)",
  );
  assert.ok(css.includes("cp-screen-key") && css.includes("cp-scribble") && css.includes("cp-notebook-in"), "T15: 胸屏字符/本笔/弹入 CSS");
  // 竖线眼:全表情统一竖圆棒词汇(EVE 式),情绪=棒的长短/倾角/浓度;
  // 棒渲染进 cp-pupils 组 → 壳的视线 lerp=整眼平移,眨眼 scaleY 作用外层 cp-eyes 压扁竖棒
  const sharedFaceSrc = read("components/companion/forms/shared.tsx");
  assert.ok(
    sharedFaceSrc.includes("const bar = (x: number, y: number, len: number"),
    "T15: 竖线眼词汇=bar() 圆头竖棒助手(旧圆角矩形瞳孔眼/横线睡眼退役)",
  );
  assert.ok(
    sharedFaceSrc.includes("Q84,60.5 90,68") && sharedFaceSrc.includes("M78,65 h12"),
    "T15: 笑=竖棒弯成上拱弧(^_^) / 鼓脸=竖棒旋横(-_-)——竖线的两种变形",
  );
  assert.ok(
    (sharedFaceSrc.match(/<g ref=\{refs\.pupils\} className="cp-pupils">/g) ?? []).length >= 3,
    "T15: 竖线棒渲染在 cp-pupils 组内(星/横线/默认三分支)→视线跟随=整眼平移",
  );
  assert.ok(
    mascotV4.includes("g.x * 5") && mascotV4.includes("g.y * 3"),
    "T15: 视线跟随幅度 5/3px(竖线整眼平移可视幅度,旧瞳孔 3/2px 看不出)",
  );
}
console.log("✓ T15 v3 接线守卫:单例挂载/三触发点/左栏注册表/物理碰撞源级咬合");

/* ---------- T16 v9 朗读句对齐(规范化整句 + 句界扩展 + 单调游标) ---------- */
{
  const { matchSentenceAligned, canonicalSpeechIndex } = await import("../src/renderer/lib/highlightText.ts");
  // 规范化:标点/全半角/空白全滤,全角字母→半角,小写
  const ci = canonicalSpeechIndex("ＡＢ。 x!");
  assert.equal(ci.canon, "abx", `T16: 规范串=文字字符全角归一半角(${ci.canon})`);
  assert.deepEqual(ci.map, [0, 1, 4], "T16: 规范位→原文下标映射正确");

  // ① 标点/引号差异归零 + 句界扩展:句首对齐,句末吃标点+闭引号
  const dom1 = "他说：“你好，世界！”然后走了。";
  const m1 = matchSentenceAligned(dom1, "他说:\"你好,世界!\"", 0);
  assert.ok(m1, "T16: 全半角标点差异句仍命中");
  assert.equal(dom1.slice(m1.start, m1.end), "他说：“你好，世界！”", `T16: 高亮覆盖完整可见句含句末标点+闭引号(实测 ${JSON.stringify(dom1.slice(m1.start, m1.end))})`);

  // ② 句首开引号回吃:不再从句中开始
  const dom2 = "「引言」开始了。";
  const m2 = matchSentenceAligned(dom2, "引言开始了", 0);
  assert.equal(dom2.slice(m2.start, m2.end), "「引言」开始了。", `T16: 句首「被吃进高亮(实测 ${JSON.stringify(dom2.slice(m2.start, m2.end))})`);

  // ③ 行内代码间隔:朗读剥代码,DOM 有 → span 跨接覆盖
  const dom3 = "使用 bar() 方法。";
  const m3 = matchSentenceAligned(dom3, "使用 方法", 0);
  assert.equal(dom3.slice(m3.start, m3.end), "使用 bar() 方法。", `T16: 行内代码间隔跨接(实测 ${JSON.stringify(dom3.slice(m3.start, m3.end))})`);

  // ④ 单调游标:重复文本不回跳
  const dom4 = "好的。再次好的。";
  const a4 = matchSentenceAligned(dom4, "好的", 0);
  const b4 = a4 ? matchSentenceAligned(dom4, "好的", a4.end) : null;
  assert.ok(a4 && b4 && a4.start === 0 && b4.start === 5, `T16: 游标单调(实测 ${a4 && a4.start}→${b4 && b4.start})`);

  // ⑤ 未命中/跨度异常 → null
  assert.equal(matchSentenceAligned("没有目标。", "别的句子", 0), null, "T16: 未命中返回 null");
  const far = "开头。" + "x".repeat(300) + "结尾。中间还有结尾。";
  assert.equal(matchSentenceAligned(far, "开头 结尾", 0), null, "T16: 跨度异常判失败(误命中保护)");

  // ⑥ v11.2 表意句的匹配坑(实测"高亮慢一句"根因):emoji/符号独立句 canonical 全滤成空串,
  // 旧逻辑 toks.length===0 直接 null → 高亮冻结在上一句。回退原文逐字查找 verbatim 命中。
  const domE = "它能帮你做什么\n📚 把任何仓库变课程：粘贴 URL。";
  const mE = matchSentenceAligned(domE, "📚", 0);
  assert.deepEqual(mE, { start: 8, end: 10 }, `T16: emoji 独立句原文直找(代理对 2 单位,实测 ${JSON.stringify(mE)})`);
  assert.deepEqual(matchSentenceAligned(domE, "📚", 8), { start: 8, end: 10 }, "T16: 游标起点后仍命中");
  const domS = "前文。\n……\n后文。";
  const mS = matchSentenceAligned(domS, "……", 0);
  assert.deepEqual(mS, { start: 4, end: 6 }, `T16: 省略号独立句直找(实测 ${JSON.stringify(mS)})`);
  const zw = matchSentenceAligned("家庭\n👨‍💻 聚餐", "👨‍💻", 0);
  assert.deepEqual(zw, { start: 3, end: 8 }, `T16: ZWJ 连写整序列 5 单位(实测 ${JSON.stringify(zw)})`);
  const vs = matchSentenceAligned("去看\n🗺️ 地图", "🗺️", 0);
  assert.deepEqual(vs, { start: 3, end: 6 }, `T16: VS16 序列含修饰符(实测 ${JSON.stringify(vs)})`);
  assert.equal(matchSentenceAligned("没有符号", "🚀", 0), null, "T16: DOM 没有该 emoji → null(旧高亮保留)");
}
console.log("✓ T16 v9 朗读句对齐:规范化(全半角/标点/引号)+句界扩展+游标单调+跨度保护");

/* ---------- T17 v9 离线口型时间轴(FFT + 帧判类 + 查表) ---------- */
{
  const { analyzeVisemeTimeline, visemeAt, cuesToTimeline, classifyVisemeFrame } = await import("../src/renderer/lib/companion/viseme-timeline.ts");
  const VOWELS = new Set(["A", "E", "I", "O", "U"]);

  // 帧判类单元:静音闭 / 高频占比高=齿擦 / 弱高频+低响度=咬唇 / 浊音起音舌位区=舌尖
  assert.equal(classifyVisemeFrame({ level: 0.02, f1: 500, f2: 1500, hfRatio: 0.1 }, "A"), "closed", "T17: 静音→闭");
  assert.equal(classifyVisemeFrame({ level: 0.7, f1: 600, f2: 1500, hfRatio: 0.5 }, "A"), "SS", "T17: 高频占比高→齿擦 SS");
  assert.equal(classifyVisemeFrame({ level: 0.3, f1: 500, f2: 1500, hfRatio: 0.2 }, "A"), "FV", "T17: 弱高频+低响度→咬唇 FV");
  assert.equal(classifyVisemeFrame({ level: 0.6, f1: 400, f2: 2000, hfRatio: 0.05 }, "closed"), "L", "T17: 浊音起音+舌位 F2→舌尖 L");

  // 静音 PCM:全闭 + 时长正确
  const sr = 16000;
  const sil = new Float32Array(sr);
  const tl0 = analyzeVisemeTimeline(sil, sr);
  assert.ok(tl0.cues.length >= 1 && tl0.cues.every((c) => c.viseme === "closed"), "T17: 静音全闭");
  assert.ok(Math.abs(tl0.duration - 1) < 1e-6, "T17: 时长=len/sr");

  // 元音正弦(F1 频段单频):出现母音 cue(共振峰判位)
  const vow = new Float32Array(sr);
  for (let i = 0; i < vow.length; i++) vow[i] = 0.5 * Math.sin((2 * Math.PI * 500 * i) / sr);
  const tl1 = analyzeVisemeTimeline(vow, sr);
  assert.ok(
    tl1.cues.some((c) => VOWELS.has(c.viseme)),
    `T17: 500Hz 浊音→母音帧(实测 ${JSON.stringify(tl1.cues.map((c) => c.viseme))})`,
  );

  // 类白噪(LCG 宽带):出现齿擦 cue
  let seed = 12345;
  const noi = new Float32Array(sr);
  for (let i = 0; i < noi.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noi[i] = ((seed % 2000) / 1000 - 1) * 0.5;
  }
  const tl2 = analyzeVisemeTimeline(noi, sr);
  assert.ok(
    tl2.cues.some((c) => c.viseme === "SS"),
    `T17: 宽带噪声→齿擦帧(实测 ${JSON.stringify(tl2.cues.map((c) => c.viseme))})`,
  );

  // 连续性:cue 无缝无叠、句首句尾闭
  for (const tl of [tl1, tl2]) {
    assert.equal(tl.cues[0].viseme, "closed", "T17: 句首闭(起音准备)");
    assert.equal(tl.cues[tl.cues.length - 1].viseme, "closed", "T17: 句尾闭(收口)");
    for (let i = 1; i < tl.cues.length; i++) {
      assert.ok(Math.abs(tl.cues[i - 1].t + tl.cues[i - 1].dur - tl.cues[i].t) < 1e-6, "T17: cue 无缝衔接");
    }
  }

  // 剧本 cue(毫秒)→ 时间轴(秒):间隙补闭 + 相邻合并 + 查表
  const tl3 = cuesToTimeline([
    { t: 0, dur: 100, viseme: "closed", level: 0 },
    { t: 100, dur: 150, viseme: "A", level: 0.8 },
    { t: 250, dur: 150, viseme: "A", level: 0.9 },
    { t: 500, dur: 200, viseme: "SS", level: 0.4 },
  ]);
  assert.equal(tl3.duration, 0.7, "T17: cuesToTimeline 总时长");
  assert.equal(tl3.cues.filter((c) => c.viseme === "A").length, 1, "T17: 相邻同 viseme 合并");
  assert.equal(tl3.cues[tl3.cues.length - 2].viseme, "closed", "T17: 词间间隙(400-500ms)补闭");
  assert.equal(visemeAt(tl3, 0.05)?.viseme, "closed", "T17: 查表 0.05s=闭");
  assert.equal(visemeAt(tl3, 0.3)?.viseme, "A", "T17: 查表 0.3s=A");
  assert.equal(visemeAt(tl3, 0.55)?.viseme, "SS", "T17: 查表 0.55s=SS");
  assert.equal(visemeAt(tl3, 0.9), null, "T17: 超界 null(调用方闭嘴)");
  assert.equal(visemeAt(tl3, -0.1), null, "T17: 负时间 null");
}
console.log("✓ T17 v9 离线口型时间轴:帧判类(闭/SS/FV/L/母音)+连续性+查表");

/* ---------- T18 v9 剧本口型(词时序+拼音声母 → viseme cue) ---------- */
{
  const { buildVisemeCues } = await import("../src/main/services/speech/viseme-script.ts");
  // zh:你好世界 → n=L / h=FV / sh=SS / j=SS;时序连续覆盖 [0,1200]
  const cues = buildVisemeCues([
    { text: "你好", start: 0, end: 600 },
    { text: "世界", start: 600, end: 1200 },
  ]);
  assert.ok(cues.length > 0, "T18: zh 词 cue 产出");
  assert.equal(cues[0].viseme, "L", `T18: 你(nǐ)声母→舌尖(实测 ${cues[0].viseme})`);
  const visemes = new Set(cues.map((c) => c.viseme));
  assert.ok(visemes.has("FV"), "T18: 好(hǎo)声母→咬唇");
  assert.ok(visemes.has("SS"), "T18: 世(shì)/界(jiè)声母→齿擦");
  assert.ok([...visemes].some((v) => ["A", "E", "I", "O", "U"].includes(v)), "T18: 韵母→母音");
  for (let i = 1; i < cues.length; i++) {
    assert.ok(Math.abs(cues[i - 1].t + cues[i - 1].dur - cues[i].t) < 1, "T18: cue 时序连续(词内按权重分配)");
  }
  const lastCue = cues[cues.length - 1];
  assert.ok(Math.abs(lastCue.t + lastCue.dur - 1200) < 1, "T18: 覆盖到词 cue 终点");

  // en:the → th=L 起音 + e=E 母音
  const en = buildVisemeCues([{ text: "the", start: 0, end: 300 }]);
  assert.equal(en[0].viseme, "L", `T18: en th→舌尖(实测 ${en[0].viseme})`);

  // 纯标点词 → 闭;词间间隙 → 闭;空输入 → []
  assert.deepEqual(
    buildVisemeCues([{ text: "。", start: 0, end: 200 }]).map((c) => c.viseme),
    ["closed"],
    "T18: 纯标点 cue→闭嘴",
  );
  const gap = buildVisemeCues([
    { text: "好", start: 0, end: 300 },
    { text: "的", start: 500, end: 800 },
  ]);
  assert.ok(gap.some((c) => c.viseme === "closed" && c.t >= 300 && c.t < 500), "T18: 词间间隙补闭");
  assert.deepEqual(buildVisemeCues([]), [], "T18: 空词 cue→空(调用方落 DSP)");
}
console.log("✓ T18 v9 剧本口型:拼音声母→辅音 viseme/拉丁词首规则/标点闭/间隙闭/时序连续");

/* ---------- T20 v11 目的性游走 + 情绪层 + 记忆闭环 ---------- */
{
  const core = await import("../src/renderer/lib/companion/companion-core.ts");
  const { pickRoamIntent, INTENT_HOLD_MS, companionReducer, initialCompanionState } = core;

  // pickRoamIntent:确定性 + 分布(意图是调味,~2/3 桶照常游走)+ 让位链
  assert.equal(
    pickRoamIntent(3, { hasReview: true, hasNext: true, hasFriction: true }),
    pickRoamIntent(3, { hasReview: true, hasNext: true, hasFriction: true }),
    "T20: 意图确定性(同桶同果)",
  );
  let nullN = 0, reviewN = 0, inspectN = 0, fricN = 0;
  for (let b = 0; b < 2000; b++) {
    const k = pickRoamIntent(b, { hasReview: true, hasNext: true, hasFriction: true });
    if (k === null) nullN++; else if (k === "review") reviewN++; else if (k === "inspect") inspectN++; else fricN++;
  }
  assert.ok(nullN > 1200 && nullN < 1500, `T20: 意图占比有界(实测 null=${nullN}/2000)`);
  assert.ok(reviewN > 0 && inspectN > 0 && fricN > 0, `T20: 三类意图都会出现(实测 r/i/f=${reviewN}/${inspectN}/${fricN})`);
  for (let b = 0; b < 500; b++) {
    const k = pickRoamIntent(b, { hasReview: false, hasNext: true, hasFriction: false });
    assert.ok(k === null || k === "inspect", "T20: 复习缺位只允许打量");
  }
  assert.equal(pickRoamIntent(1, { hasReview: false, hasNext: false, hasFriction: false }), null, "T20: 无料可指=null");
  assert.equal(typeof INTENT_HOLD_MS, "number", "T20: 意图保持时长导出");

  // 情绪层:连对计数;3 连对 flame 得意(盖过单次 correct 普通开心);答错清零
  let s = initialCompanionState(0);
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 100 });
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 200 });
  assert.equal(s.correctStreak, 2, "T20: 两连对计数");
  assert.notEqual(s.expression, "flame", "T20: 两连对不点燃");
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 300 });
  assert.equal(s.correctStreak, 3, "T20: 三连对");
  assert.equal(s.expression, "flame", "T20: 三连对=flame 得意");
  assert.equal(s.pose, "spin", "T20: flame 配转圈");
  assert.ok(s.until !== null && s.until > 300 + 1500 && s.until <= 300 + 1600, "T20: flame 保持 1600ms");
  s = companionReducer(s, { type: "celebration", kind: "wrong", now: 400 });
  assert.equal(s.correctStreak, 0, "T20: 答错清零");
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 500 });
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 600 });
  s = companionReducer(s, { type: "celebration", kind: "correct", now: 700 });
  assert.equal(s.expression, "flame", "T20: 清零后再三连对重新点燃");

  // 记忆闭环:noteTick=卡点毕业金勾(骄傲+书写姿势+1.9s 窗口)
  let n = initialCompanionState(0);
  n = companionReducer(n, { type: "noteTick", now: 1000 });
  assert.equal(n.expression, "proud", "T20: 勾销=骄傲");
  assert.equal(n.pose, "writing", "T20: 勾销=书写姿势");
  assert.equal(n.noteTickUntil, 1000 + 1900, "T20: 金勾窗口 1900ms");
}
console.log("✓ T20 v11 意图调度(确定性/占比/让位)+情绪层(3连对 flame)+记忆闭环(noteTick)");

/* ---------- T21 v11 桌宠模式接线守卫(源码级) ---------- */
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const petWin = readFileSync(new URL("../src/main/pet-window.ts", import.meta.url), "utf8");
  assert.ok(petWin.includes("setIgnoreMouseEvents(passThrough, { forward: passThrough })"), "T21: 桌宠窗穿透切换(forward 保 move)");
  assert.ok(
    petWin.includes("skipTaskbar: true") && petWin.includes("focusable: false") && petWin.includes("transparent: true"),
    "T21: 桌宠窗透明/无任务栏/不抢焦点",
  );
  const channels = readFileSync(new URL("../shared/api-channels.ts", import.meta.url), "utf8");
  assert.ok(channels.includes('companionPetSetClickThrough: "companionPet:setClickThrough"'), "T21: 通道映射");
  const preload = readFileSync(new URL("../src/preload/index.ts", import.meta.url), "utf8");
  assert.ok(preload.includes("companionPetSetClickThrough"), "T21: preload 暴露");
  const ipcSrc = readFileSync(new URL("../src/main/ipc/index.ts", import.meta.url), "utf8");
  assert.ok(ipcSrc.includes('if (key === "companion_pet_mode") deps.pet?.sync(value === "1")'), "T21: 设置落库→桌宠窗同步");
  const busSrc = readFileSync(new URL("../src/renderer/lib/companion/bus.ts", import.meta.url), "utf8");
  assert.ok(busSrc.includes('getSetting("companion_pet_mode")') && busSrc.includes("petMode"), "T21: bus petMode 快照");
  const creatureSrc = read("components/companion/CompanionCreature.tsx");
  assert.ok(creatureSrc.includes("snap.petMode) return null"), "T21: 主窗生物在桌宠模式隐身");
  assert.ok(creatureSrc.includes("pickRoamIntent") && creatureSrc.includes("INTENT_HOLD_MS"), "T21: 目的性游走接线");
  assert.ok(creatureSrc.includes("companionNoteTick") && creatureSrc.includes("companion-state-changed"), "T21: 卡点毕业金勾触发+掌握监听");
  const settingsSrc = read("components/SettingsView.tsx");
  assert.ok(settingsSrc.includes("companion-pet-toggle"), "T21: 设置页桌宠开关");
  const petComp = read("components/companion/PetCompanion.tsx");
  assert.ok(petComp.includes("companionPetSetClickThrough(!inside)") && petComp.includes("glideTo"), "T21: 桌宠渲染层热区检测+滑翔");
  const petHtml = readFileSync(new URL("../src/renderer/pet.html", import.meta.url), "utf8");
  assert.ok(petHtml.includes("/pet.tsx"), "T21: 桌宠页入口");
  const viteCfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.ok(viteCfg.includes("pet: resolve"), "T21: vite 双页输入");
  // v11 其余接线:听写胸屏波形 + 四形态主题斜面
  const mascotSrc = read("components/companion/Mascot.tsx");
  assert.ok(mascotSrc.includes("cp-screen-wave") && mascotSrc.includes("{listening && !screenKey"), "T21: 听写胸屏波形");
  const cssSrc = readFileSync(new URL("../src/renderer/index.css", import.meta.url), "utf8");
  assert.ok(cssSrc.includes("cp-wave-bar") && cssSrc.includes(".cp-core-lit") && cssSrc.includes(".cp-note-tick"), "T21: 波形/金环/金勾样式");
  for (const f of ["frost", "moss", "astro", "ink"]) {
    assert.ok(read(`components/companion/forms/${f}.tsx`).includes("<BevelPlate"), `T21: ${f} 主题化斜面`);
  }
  const nbSrc = read("components/NotebookPanel.tsx");
  assert.ok(nbSrc.includes("companionNote()"), "T21: 笔记 tab → 掏本动画触发");
}
console.log("✓ T21 v11 桌宠接线(穿透切换/协议/bus 隐身/设置开关/双页构建)+波形与斜面守卫");

/* ---------- T22 v11.1 三修守卫:karaoke 含画线 / rail 滑翔 / 拖选即现 / 笔记锚点自愈 ---------- */
{
  const read = (p2) => readFileSync(new URL(`../src/renderer/${p2}`, import.meta.url), "utf8");
  const hl = read("lib/highlightText.ts");
  assert.ok(
    hl.includes("includeMarks") && hl.includes("getTextModel(container, opts?.within, { includeMarks: true })"),
    "T22: karaoke 句子匹配收全文本(含画线 mark——划线落在朗读句里不再断高亮)",
  );
  assert.ok(
    hl.includes("lastNoteMarkText") && hl.includes("isConnected"),
    "T22: 画线锚点重渲染自愈(元素悬空按文本找回)",
  );
  const creatureSrc = read("components/companion/CompanionCreature.tsx");
  assert.ok(
    creatureSrc.includes("noteAnchored"),
    "T22: noteMark 无效宿主不消费分支链(加笔记不隐身)",
  );
  assert.ok(
    creatureSrc.includes("glideTo(curPos, bodyPos, dt, CRUISE_OP)"),
    "T22: rail 物理体位置经滑翔趋近(入左栏不再瞬移)",
  );
  const nb = read("components/NotebookPanel.tsx");
  assert.ok(
    nb.includes("const SETTLE = coarsePointer ? 600 : 250;")
      && nb.includes("if (!hideTimer && selectionHasText()) evaluateSelection(); // 松开立即落位")
      && nb.includes("(cur ? null : cur)); // 变化流中一律隐藏"),
    "T22: 划线浮钮松手才现(变化流一律隐藏,稳定/pointerup 才落位;2026-08-22 用户拍板取代旧 80ms 途中即现)",
  );
}
console.log("OK T22 v11.1 guards: karaoke-with-marks / rail glide / quote btn on release / note anchor self-heal");

// ---------------------------------------------------------------------------
console.log("T23 跟句悬空不隐身(v0.18:detached readingRange 兜底)");
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const creature = read("components/companion/CompanionCreature.tsx");
  const notebook = read("components/NotebookPanel.tsx");
  const chat = read("components/ChatStream.tsx");
  // ①跟句分支的悬空兜底:pr/行盒全空时必须就地游弋,不许 target 滞留 null
  //   (null → opacity 0 永久隐身,v9"常驻绝不隐匿"的旁路点)
  assert.ok(creature.includes("跟句悬空兜底(永不隐身)"), "T23: 跟句分支有悬空兜底标记");
  assert.ok(
    creature.includes("wanderInPanel(box, zoneSize, now)") && creature.includes("glideTo(cur, wp, dt, CRUISE_ROAM, 140)"),
    "T23: 悬空时在宿主面板/整窗游弋(target 必非空)",
  );
  // ②两面板卸载清全局高亮:清理不得读 ref(React 卸载时先置空 ref 再跑 passive
  //   cleanup,`if (ref.current)` 永假=守卫自废,v0.18 实测踩过)
  for (const [name, src] of [["NotebookPanel", notebook], ["ChatStream", chat]]) {
    assert.ok(
      src.includes("wasReadingRef.current = readingIdx != null") && src.includes("clearReadingMark(document.body)"),
      `T23: ${name} 卸载按渲染期快照清全局高亮`,
    );
    assert.ok(
      !/useEffect\(\(\) => \(\) => \{ if \(\w+Ref\.current\) clearReadingMark\(\w+Ref\.current\)/.test(src),
      `T23: ${name} 卸载清理不再读 ref(自废写法禁止回归)`,
    );
  }
  console.log("OK T23: 跟句悬空兜底 + 卸载清高亮(ref 自废守卫)");
}

// ---------------------------------------------------------------------------
console.log("T24 v0.18 屏内表情机器人化 + 喷焰可见 + 点球互动");
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/renderer/index.css", import.meta.url), "utf8");
  // ① 脸=屏幕渲染:五形态 Face+FaceExtras 剪进屏框;皇冠(实体徽章)在剪裁外
  for (const f of ["ember", "frost", "moss", "astro", "ink"]) {
    const src = read(`components/companion/forms/${f}.tsx`);
    assert.ok(src.includes('className="cp-scr-face" clipPath={`url(#${uid}-scr)`}'), `T24: ${f} 表情剪进屏幕`);
    assert.ok(src.includes("flags.proud && <CrownMark"), `T24: ${f} 皇冠在剪裁组外`);
    // 嘴型去 flesh 化:肉/叶/纸色舌唇禁用(只匹配 inline fill;装甲色是变量不误伤)
    assert.ok(!/fill="#(FF9DB0|A8E89A|BFF3FF|7CC4DC|57BD74|E8543F|5D4FD1|8B7BF0|DCD2B8)"/.test(src), `T24: ${f} 无肉色舌/唇`);
    assert.ok(src.includes('fill={p.pupil}'), `T24: ${f} 舌=发光音素条(p.pupil 屏光件)`);
  }
  const shared = read("components/companion/forms/shared.tsx");
  assert.ok(shared.includes('className="cp-brow" x="70" y="55"'), "T24: 思考眉在屏幕内(y55;屏顶=54,旧版 y42 在屏外)");
  assert.ok(!shared.includes('y="42" width="22"'), "T24: 屏外眉已删");
  // ② 喷焰可见:粒子推出身形半径外(旧 150-158 距旋转原点仅 ~15-23px,被身体盖死)
  const mascot = read("components/companion/Mascot.tsx");
  assert.ok(mascot.includes('cy="187"') && mascot.includes('cy="198"'), "T24: 喷焰粒子在身形外(定向尾焰)");
  assert.ok(css.includes("scale: calc(0.5 + 0.6 * min(1, var(--cp-speed, 0)))"), "T24: 焰长随速度伸缩");
  // ③ 点球互动:桌面飞到球右肩指住+轻顶;T3 无 rail 朝左注目;三条跳转路径都发射
  const bus = readFileSync(new URL("../src/renderer/lib/companion/bus.ts", import.meta.url), "utf8");
  const creature = read("components/companion/CompanionCreature.tsx");
  const mapRail = read("components/MapRail.tsx");
  assert.ok(bus.includes("export function companionBallTap") && bus.includes("getLastBallTap"), "T24: bus 点球事件+ref 注册表");
  assert.ok(creature.includes("getLastBallTap()") && creature.includes("x - navRect!.left + 34"), "T24: Creature 飞到球右肩位");
  assert.ok(/ballAck\r?\n\s+\? "point"/.test(creature), "T24: 点球应答姿势=指向");
  assert.ok(creature.includes("applyForce(b.body, b.body.position, { x: 0.0035, y: -0.005 })"), "T24: 轻顶非锁定球");
  assert.ok(creature.includes("fly: false"), "T24: T3 分支(朝左注目不飞)");
  assert.ok(mapRail.split("companionBallTap").length - 1 >= 3, "T24: 物理球/键盘球/搜索三路发射");
  console.log("OK T24: 屏内表情机器人化 + 喷焰重定位 + 点球互动双分支");

// ---------------------------------------------------------------------------
console.log("T25 v0.18 键盘反馈包(信号面板/真实键位/节奏/仪式/IME)");
{
  const core = await import("../src/renderer/lib/companion/companion-core.js");
  // ① 真实键位:QWERTY 物理分区(左=-1 右=1,未知沿用 fallback)
  assert.equal(core.sideFromCode("KeyQ", 1), -1, "Q 在左半区");
  assert.equal(core.sideFromCode("KeyP", -1), 1, "P 在右半区");
  assert.equal(core.sideFromCode("KeyB", 1), -1, "B 在左半区(边界键)");
  assert.equal(core.sideFromCode("KeyN", -1), 1, "N 在右半区(边界键)");
  assert.equal(core.sideFromCode("Digit4", 1), -1, "4 在左");
  assert.equal(core.sideFromCode("Digit7", -1), 1, "7 在右");
  assert.equal(core.sideFromCode("Enter", -1), 1, "Enter 在右");
  assert.equal(core.sideFromCode("Backspace", -1), 1, "Backspace 在右");
  assert.equal(core.sideFromCode("Process", -1), -1, "未知键沿用 fallback");
  assert.equal(core.sideFromCode("", 1), 1, "空 code 沿用 fallback(合成事件)");
  // ② 信号面板条:确定性 + 范围 + 左→右延迟
  const bars = core.scopeBars(42);
  assert.equal(bars.length, 7, "7 条");
  assert.deepEqual(core.scopeBars(42), bars, "同 seq 确定性");
  assert.notDeepEqual(core.scopeBars(43), bars, "异 seq 波形不同");
  for (const b of bars) assert.ok(b.h >= 4 && b.h <= 11, `条高在 4~11(${b.h})`);
  assert.ok(bars[0].d === 0 && bars[6].d === 132, "延迟左→右传播");
  // ③ reducer:Enter 仪式 / 退格连击 / 爆发专注
  const st0 = core.initialCompanionState(0);
  const press = (st, key, kind, now, side = 1) => core.companionReducer(st, { type: "press", side, now, key, kind });
  const stE = press(st0, undefined, "enter", 1000);
  assert.ok(stE.expression === "happy" && stE.pose === "hop" && stE.lastKeyKind === "enter", "Enter=小跳+happy(交接仪式)");
  let st = st0;
  for (let i = 0; i < 3; i++) st = press(st, undefined, "back", 2000 + i * 200);
  assert.ok(st.backStreak === 3 && st.expression === "encourage", "3 连退格=汗滴担忧");
  st = press(st, "a", "char", 2600);
  assert.equal(st.backStreak, 0, "常规键清退格连击");
  st = st0;
  for (let i = 0; i < 6; i++) st = press(st, "k", "char", 5000 + i * 300);
  assert.ok(st.burstN === 6 && st.expression === "thinking", "3s 内 6 键=专注(屏内思考眉)");
  // 暂停相位:1.2~6s=listening,6~15s=thinking,之后回 0
  assert.equal(core.pausePhaseOf({ typing: true, lastPress: 10_000 }, 12_500), 1, "停 2.5s=抬头等待");
  assert.equal(core.pausePhaseOf({ typing: true, lastPress: 10_000 }, 18_000), 2, "停 8s=若有所思");
  assert.equal(core.pausePhaseOf({ typing: true, lastPress: 10_000 }, 40_000), 0, "停 30s=回常态");
  assert.equal(core.pausePhaseOf({ typing: true, lastPress: 10_000 }, 10_500), 0, "打字中=0");
  const stTick = core.companionReducer({ ...st, lastPress: 10_000, typing: true, pausePhase: 0 }, { type: "tick", now: 12_500 });
  assert.ok(stTick.expression === "listening" && stTick.pausePhase === 1, "tick 相位转移=等待表情");
  // ④ 接线:bus 真实键位/compositionend,Mascot 信号面板+闪发,Creature squash
  const bus = readFileSync(new URL("../src/renderer/lib/companion/bus.ts", import.meta.url), "utf8");
  const mascot = read("components/companion/Mascot.tsx");
  const creature = read("components/companion/CompanionCreature.tsx");
  const css = readFileSync(new URL("../src/renderer/index.css", import.meta.url), "utf8");
  assert.ok(bus.includes("sideFromCode(e.code, nextSide)") && bus.includes('"compositionend"'), "bus:真实键位+IME 汉字上屏");
  assert.ok(bus.includes('e.code === "Enter" ? "enter"'), "Enter 分型");
  assert.ok(mascot.includes("cp-key-scope") && mascot.includes("scopeBars(keySeq)") && mascot.includes("keyclip"), "胸屏信号面板(裁剪+脉冲条)");
  assert.ok(mascot.includes("cp-screen-key-flash"), "闪发样式挂接");
  assert.ok(creature.includes("cp-keypress") && creature.includes("void wrap.offsetWidth"), "整机 squash 重触发");
  assert.ok(css.includes("cp-key-squash") && css.includes("cp-scope-pulse") && css.includes("cp-key-flash"), "CSS 三动画");
  assert.ok(css.includes(".cp-scope-bar { animation: none; opacity: 0.7; }"), "reduced-motion 双轨");
  console.log("OK T25: 键盘反馈包(信号面板/键位/节奏/仪式/IME)");
}

// ---------------------------------------------------------------------------
console.log("T26 v0.18 吹哨召唤(点左栏空白处叫它过来)");
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const core = await import("../src/renderer/lib/companion/companion-core.js");
  // ① reducer:whistle → happy+wave 爆发 + 刷新活动/唤醒到前台
  const s0 = core.initialCompanionState(0);
  const sw = core.companionReducer(s0, { type: "whistle", now: 5000 });
  assert.ok(sw.expression === "happy" && sw.pose === "wave", "吹哨应答=开心+挥手");
  assert.equal(sw.until, 7400, "挥手保持 2.4s");
  assert.ok(sw.lastActivity === 5000 && sw.sleeping === false && sw.mode === "front", "刷新活动/唤醒出纱帘");
  const stb = core.companionReducer(sw, { type: "tick", now: 20000 });
  assert.ok(stb.expression !== "happy" || stb.pose !== "wave", "到期回落(不再挥手应答)");
  // ② 接线:bus 事件+注册表;MapRail 空白点击发哨(拖动/控件双守卫);Creature 消费
  const bus = read("lib/companion/bus.ts");
  const mapRail = read("components/MapRail.tsx");
  const creature = read("components/companion/CompanionCreature.tsx");
  assert.ok(bus.includes("export function companionWhistle") && bus.includes("getLastWhistle"), "bus 哨事件+注册表");
  assert.ok(/whistle = \{ x: d\.x, y: d\.y, seq: \(whistle\?\.seq \?\? 0\) \+ 1/.test(bus), "seq 单调递增");
  assert.ok(bus.includes('dispatch({ type: "whistle"'), "应答爆发派发");
  assert.ok(/typeof d\?\.x !== "number" \|\| typeof d\?\.y !== "number"/.test(bus), "畸形 detail 守卫");
  assert.ok(mapRail.includes("companionWhistle(e.clientX, e.clientY)"), "空白点击发哨");
  assert.ok(mapRail.includes("Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6"), "拖动/滚动松手不误触");
  assert.ok(mapRail.includes('closest("button, a, input, textarea, select")'), "控件上的点击不算空白");
  assert.ok(creature.includes("getLastWhistle()") && creature.includes("ws.seq !== whistleSeqRef.current"), "rAF seq 去重消费");
  assert.ok(/whistleOk \|\| zone === "rail"/.test(creature), "哨点把生物带进 rail 分支");
  assert.ok(creature.includes("whistleAckRef.current.x + 28, y: whistleAckRef.current.y - 52"), "悬停哨点右上上空");
  console.log("OK T26: 吹哨召唤(reducer/接线/双守卫)");
}

// ---------------------------------------------------------------------------
console.log("T27 v0.18 标题栏禁入带(物理天花板+哨点钳制+视觉钳带)");
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  // ① 物理层:ceilY 硬天花板——把生物放进带内并向上冲,一步内压回线下+竖速反弹
  const cf = await import("../src/renderer/lib/companion/companion-flight.js");
  const Matter = (await import("matter-js")).default;
  const fw = cf.createFlightWorld({ width: 300, height: 800 });
  Matter.Body.setPosition(fw.body, { x: 150, y: 80 });
  Matter.Body.setVelocity(fw.body, { x: 0, y: -6 });
  fw.step(16, null, [], 100, { ceilY: 120 });
  assert.ok(fw.body.position.y >= 142 - 1e-6, `圆心压回天花板下(y=${fw.body.position.y.toFixed(1)})`);
  assert.ok(fw.body.velocity.y > 0, `竖速反弹向下(vy=${fw.body.velocity.y.toFixed(2)})`);
  const fw2 = cf.createFlightWorld({ width: 300, height: 800 });
  Matter.Body.setPosition(fw2.body, { x: 150, y: 80 });
  fw2.step(16, null, [], 100);
  assert.ok(fw2.body.position.y < 120, "未传 ceilY 不启用天花板(向后兼容)");
  fw.dispose();
  fw2.dispose();
  // ② 接线:带底缓存(标题栏∪轨道tab条)、rail step 传 ceilY、哨点钳带、收尾视觉钳带
  const creature = read("components/companion/CompanionCreature.tsx");
  const mapRail = read("components/MapRail.tsx");
  assert.ok(creature.includes('document.querySelector("header.app-header")') && creature.includes("map-rail-topbar"), "带底=应用标题栏∪轨道tab条");
  assert.ok(creature.includes("{ settle, ceilY: railCeilLocal() }"), "rail 物理接硬天花板");
  assert.ok(/target\.y < ceilBand \+ w \/ 2 \+ 10/.test(creature), "收尾视觉钳带(全分支兜底,含拖拽)");
  assert.ok(creature.includes("Math.max(ceilLocal + 52, ws.y - navRect.top)"), "哨点不许落进禁入带");
  assert.ok(mapRail.includes('data-testid="map-rail-topbar"'), "轨道顶部条有测量锚");
  console.log("OK T27: 标题栏禁入(物理/哨点/视觉三层)");
}

// ---------------------------------------------------------------------------
console.log("T28 v0.19 考试静栖(伴学钉在计时区,庆祝动作静默)");
{
  const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");
  const core = await import("../src/renderer/lib/companion/companion-core.js");
  // ① reducer:examActive 状态 + 庆祝动作静默(轻表情/pose=float/短保持)
  const s0 = core.initialCompanionState(0);
  assert.equal(s0.examActive, false, "初始不在考试");
  const on = core.companionReducer(s0, { type: "examActive", on: true, now: 1000 });
  assert.equal(on.examActive, true, "开考进入静栖");
  const cheer = core.companionReducer(on, { type: "celebration", kind: "correct", now: 1200 });
  assert.ok(cheer.pose === "float" && cheer.expression === "cheer", "考试中庆祝=轻表情(cheer)无动作");
  assert.ok(cheer.until === 2000, "轻表情只保持 800ms");
  const off = core.companionReducer(cheer, { type: "examActive", on: false, now: 3000 });
  const cheer2 = core.companionReducer(off, { type: "celebration", kind: "correct", now: 3200 });
  assert.ok(cheer2.pose !== "float" || cheer2.expression === "flame" || cheer2.until > 2000, "交卷后庆祝动作恢复");
  // ② 接线:bus 事件/监听、ExamView 挂卸发 on/off、Creature 钉计时锚 + 静默门
  const bus = read("lib/companion/bus.ts");
  const examView = read("components/ExamView.tsx");
  const creature = read("components/companion/CompanionCreature.tsx");
  assert.ok(bus.includes("companion-exam-active") && bus.includes("export function companionExamActive"), "bus 事件+入口");
  assert.ok(examView.includes("companionExamActive(true)") && examView.includes("companionExamActive(false)"), "ExamView 挂/卸发 on/off");
  assert.ok(creature.includes("examTimerRect") && creature.includes('data-testid="exam-timer"'), "Creature 钉计时条锚");
  assert.ok(creature.includes("生成中/就绪页探测不到"), "非答题阶段不落锚(绝不隐匿)");
  assert.ok(creature.includes("bt.seq !== ballTapSeqRef.current && !st.examActive"), "考试中点球互动静默");
  assert.ok(creature.includes("ws.seq !== whistleSeqRef.current && !st.examActive"), "考试中吹哨静默");
  assert.ok(creature.includes("keySeqPrevRef.current || snap.state.examActive"), "考试中击键 squash 静默");
  console.log("OK T28: 考试静栖(reducer 轻庆祝/接线/三道静默门)");
}
}

console.log("\nverify-companion: ALL PASS");
