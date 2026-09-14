/**
 * verify-boot-guide.mjs —— 开屏导师状态机验证(boot-guide.ts)。
 *
 * 覆盖(SPEC §5):11 场景触发条件;回访优先级(继续上次/复习到期 > 火焰 >
 * 考试 > 快毕业 > 卡点 > 就绪教室);boot 向导步进与 key 自动跳过;
 * welcome_back 叠加不改排序;对抗(全空输入不炸、次 action ≤2)。
 *
 * 跑法: npx tsx scripts/verify-boot-guide.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  computeBootGuide,
  BOOT_WIZARD_STEPS,
} from "../shared/boot-guide.ts";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

/** 基线:已 boot、有 key、无任何信号的干净回访输入。 */
function baseInputs(over = {}) {
  return {
    hasKey: true,
    bootDone: true,
    wizardStep: 0,
    keyPromptDismissed: false,
    profileFilled: true,
    name: null,
    hasCourses: false,
    lastSession: null,
    dueCount: 0,
    streak: null,
    topFrictionNodeTitle: null,
    nearMasteryNodeTitle: null,
    suspendedExamNodeTitle: null,
    returningAfterDays: false,
    ...over,
  };
}

/* ---------- 向导(初次) ---------- */

test("T1 !bootDone 步0=welcome_intro,步1=key_setup", () => {
  assert.equal(computeBootGuide(baseInputs({ bootDone: false, wizardStep: 0, hasKey: false })).scene, "welcome_intro");
  assert.equal(computeBootGuide(baseInputs({ bootDone: false, wizardStep: 1, hasKey: false })).scene, "key_setup");
});

test("T2 key 步每步重查:已有 key 时步1 自动跳到 profile_quiz", () => {
  const s = computeBootGuide(baseInputs({ bootDone: false, wizardStep: 1, hasKey: true }));
  assert.equal(s.scene, "profile_quiz");
});

test("T3 向导步2=profile_quiz,步3=course_pick;步数=4", () => {
  assert.equal(computeBootGuide(baseInputs({ bootDone: false, wizardStep: 2 })).scene, "profile_quiz");
  assert.equal(computeBootGuide(baseInputs({ bootDone: false, wizardStep: 3 })).scene, "course_pick");
  assert.equal(BOOT_WIZARD_STEPS, 4);
});

test("T4 向导越界步(>3)落在 course_pick,不炸", () => {
  assert.equal(computeBootGuide(baseInputs({ bootDone: false, wizardStep: 9 })).scene, "course_pick");
});

/* ---------- 回访优先级 ---------- */

test("T10 有上次会话 → resume_last 优先于一切", () => {
  const s = computeBootGuide(baseInputs({
    hasCourses: true,
    lastSession: { courseTitle: "ML 课", nodeTitle: "梯度下降" },
    dueCount: 5,
    streak: { todayDone: false, atRisk: true, hoursLeft: 3 },
    suspendedExamNodeTitle: "期末考",
  }));
  assert.equal(s.scene, "resume_last");
  assert.ok(s.lines.some((l) => l.key === "boot.resume.title" && l.vars?.course === "ML 课" && l.vars?.node === "梯度下降"));
  assert.ok(s.actions.some((a) => a.kind === "review"), "dueCount>0 时复习作次 action");
});

test("T11 无上次会话但复习到期 → review_due", () => {
  const s = computeBootGuide(baseInputs({ hasCourses: true, dueCount: 3 }));
  assert.equal(s.scene, "review_due");
  assert.ok(s.lines.some((l) => l.key === "boot.review.title" && l.vars?.n === 3));
});

test("T12 火焰告急 > 考试中断 > 快毕业 > 卡点", () => {
  const all = baseInputs({
    streak: { todayDone: false, atRisk: true, hoursLeft: 5 },
    suspendedExamNodeTitle: "章考",
    nearMasteryNodeTitle: "CNN",
    topFrictionNodeTitle: "反向传播",
  });
  assert.equal(computeBootGuide(all).scene, "streak_danger");
  assert.equal(computeBootGuide({ ...all, streak: null }).scene, "exam_suspended");
  assert.equal(computeBootGuide({ ...all, streak: null, suspendedExamNodeTitle: null }).scene, "near_mastery");
  assert.equal(
    computeBootGuide({ ...all, streak: null, suspendedExamNodeTitle: null, nearMasteryNodeTitle: null }).scene,
    "friction_revisit",
  );
});

test("T13 streak 今日已续(atRisk 但 todayDone)不告急", () => {
  const s = computeBootGuide(baseInputs({ streak: { todayDone: true, atRisk: true, hoursLeft: 5 }, suspendedExamNodeTitle: "考" }));
  assert.equal(s.scene, "exam_suspended");
});

test("T14 就绪教室:有课无信号 → 引导选课;无课 → 引导导入", () => {
  assert.equal(computeBootGuide(baseInputs({ hasCourses: true })).scene, "ready_room");
  assert.ok(computeBootGuide(baseInputs({ hasCourses: true })).actions.some((a) => a.kind === "pick_course"));
  assert.equal(computeBootGuide(baseInputs({ hasCourses: false })).scene, "ready_room");
  assert.ok(computeBootGuide(baseInputs({ hasCourses: false })).actions.some((a) => a.kind === "pick_course"));
});

test("T15 就绪教室无 key:带 key 提示行;keyPromptDismissed 后消失", () => {
  const hint = computeBootGuide(baseInputs({ hasKey: false }));
  assert.ok(hint.lines.some((l) => l.key === "boot.ready.key_hint"));
  const dismissed = computeBootGuide(baseInputs({ hasKey: false, keyPromptDismissed: true }));
  assert.ok(!dismissed.lines.some((l) => l.key === "boot.ready.key_hint"));
});

test("T16 画像未填时 ready_room/resume_last 提供 edit_profile 次 action", () => {
  assert.ok(computeBootGuide(baseInputs({ profileFilled: false })).actions.some((a) => a.kind === "edit_profile"));
  assert.ok(
    computeBootGuide(baseInputs({ profileFilled: false, hasCourses: true, lastSession: { courseTitle: "c", nodeTitle: null } }))
      .actions.some((a) => a.kind === "edit_profile"),
  );
});

/* ---------- welcome_back 叠加 ---------- */

test("T20 隔天回归:welcomeBack 置位且不改主场景排序", () => {
  const s = computeBootGuide(baseInputs({
    hasCourses: true,
    lastSession: { courseTitle: "c", nodeTitle: "n" },
    returningAfterDays: true,
  }));
  assert.equal(s.scene, "resume_last");
  assert.equal(s.welcomeBack, true);
  const fresh = computeBootGuide(baseInputs({
    hasCourses: true,
    lastSession: { courseTitle: "c", nodeTitle: "n" },
    returningAfterDays: false,
  }));
  assert.equal(fresh.welcomeBack, false);
});

test("T21 向导期间不叠加 welcomeBack", () => {
  const s = computeBootGuide(baseInputs({ bootDone: false, returningAfterDays: true }));
  assert.equal(s.welcomeBack, false);
});

/* ---------- 对抗与结构 ---------- */

test("T30 全空/极端输入不炸且落在 ready_room;次 action ≤2", () => {
  const s = computeBootGuide(baseInputs());
  assert.equal(s.scene, "ready_room");
  assert.ok(Array.isArray(s.lines) && s.lines.length > 0);
  assert.ok(s.actions.length >= 1 && s.actions.length <= 3, "主 action + 次 action ≤2");
});

test("T31 lastSession 存在但课程全删(hasCourses=false)不 resume", () => {
  const s = computeBootGuide(baseInputs({ hasCourses: false, lastSession: { courseTitle: "已删", nodeTitle: null }, dueCount: 0 }));
  assert.equal(s.scene, "ready_room");
});

test("T32 hoursLive 负数/NaN 容忍:Math.max 兜底不产生 NaN 插值", () => {
  const s = computeBootGuide(baseInputs({ streak: { todayDone: false, atRisk: true, hoursLeft: -3 } }));
  assert.equal(s.scene, "streak_danger");
  const line = s.lines.find((l) => l.key === "boot.streak.title");
  assert.ok(Number.isFinite(line.vars.hours));
});

test("T33 全场景 i18n key 前缀纪律:lines/actions 的 key 均为 boot.*", () => {
  const scenes = [
    baseInputs({ bootDone: false, wizardStep: 0, hasKey: false }),
    baseInputs({ bootDone: false, wizardStep: 1, hasKey: false }),
    baseInputs({ bootDone: false, wizardStep: 2 }),
    baseInputs({ bootDone: false, wizardStep: 3 }),
    baseInputs({ hasCourses: true, lastSession: { courseTitle: "c", nodeTitle: "n" } }),
    baseInputs({ dueCount: 2 }),
    baseInputs({ streak: { todayDone: false, atRisk: true, hoursLeft: 4 } }),
    baseInputs({ suspendedExamNodeTitle: "e" }),
    baseInputs({ nearMasteryNodeTitle: "m" }),
    baseInputs({ topFrictionNodeTitle: "f" }),
    baseInputs(),
  ];
  for (const inp of scenes) {
    const s = computeBootGuide(inp);
    for (const l of s.lines) assert.ok(l.key.startsWith("boot."), `${s.scene} line ${l.key}`);
    for (const a of s.actions) assert.ok(a.labelKey.startsWith("boot.action."), `${s.scene} action ${a.labelKey}`);
  }
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error("FAILED");
