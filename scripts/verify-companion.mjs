/**
 * 伴学伙伴(Companion)纯逻辑验证。
 *
 * 覆盖 lib/companion/companion-core.ts 的三层纯函数(零 DOM,可 headless):
 *   T1 庆祝→表情映射:9 种 celebration kind 全部映射到允许的表情/姿势,
 *      且"错了"必须走鼓励向(不出现羞辱性表情)
 *   T2 状态机 reducer:优先级(庆祝>听写>朗读>流式>睡觉>待机)、保持时长到期回落、
 *      空闲入睡条件(不朗读不听写)、活动唤醒
 *   T3 viseme 判定:静音→闭嘴;按频谱质心+响度海报化分档(A/E/I/O/U)
 *   T4 audioToMouth:合成 Analyser 数据(常数时域/单峰频域)→ level/质心 精确值
 *   T5 视线几何:指针越界钳制/中心归零/lerp 收敛
 *   T6 设置门控:仅 "false"/"0" 关闭(null=默认开,垃圾值=开,回滚等价由 UI 层保证)
 */
import assert from "node:assert";

import {
  SLEEP_AFTER_MS,
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
  mouthOpenScale,
} from "../src/renderer/lib/companion/companion-core.ts";

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

console.log("\nverify-companion: ALL PASS");
