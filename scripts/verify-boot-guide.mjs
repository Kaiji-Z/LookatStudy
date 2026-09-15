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

/* ============================================================
 * gatherBootState DB 级测试(内存 sql.js;boot-state-service 为 db 注入式,
 * import 链不触达 db/index 的 ?raw 链 —— 与 verify-translations 同模式)
 * ============================================================ */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { gatherBootState } from "../src/main/services/boot-state-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const wasmPath = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmPath, f) });

function freshDb() {
  const sqljs = new SQL.Database();
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  sqljs.run("PRAGMA foreign_keys = ON;");
  // raw 走 sqljs.run(drizzle 的 .run 吃 SQL 包装器,与 verify-translations 同款)
  const db = drizzle(sqljs, { schema });
  return { db, raw: sqljs };
}

const NOW = new Date("2026-09-15T10:00:00");

function seedCourse(raw, courseId) {
  raw.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES (?, '', 'r', 'ML 入门', 1)", [courseId]);
  raw.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('n1', ?, 'lesson', '梯度下降', 'a.md', 0)", [courseId]);
  raw.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('n2', ?, 'lesson', '反向传播', 'b.md', 1)", [courseId]);
  raw.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('n3', ?, 'exam', '期末考', 'c.md', 2)", [courseId]);
}

test("T40 gatherBootState:空库 → ready_room 输入(无 key 无课无信号,不炸)", () => {
  const { db, raw } = freshDb();
  const st = gatherBootState(db, NOW);
  assert.equal(st.hasKey, false);
  assert.equal(st.hasCourses, false);
  assert.equal(st.bootDone, false);
  assert.equal(st.dueCount, 0);
  assert.equal(st.lastSession, null);
  assert.equal(st.targets.resume, null);
  assert.equal(computeBootGuide({ ...st, bootDone: true }).scene, "ready_room");
});

test("T41 last_session 有效 → resume 目标带 id;课程被删 → 优雅回落", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{\"courseId\":\"c1\",\"nodeId\":\"n1\"}')");
  const st = gatherBootState(db, NOW);
  assert.deepEqual(st.lastSession, { courseTitle: "ML 入门", nodeTitle: "梯度下降" });
  assert.deepEqual(st.targets.resume, { courseId: "c1", nodeId: "n1" });
  raw.run("DELETE FROM courses WHERE id = 'c1'");
  const st2 = gatherBootState(db, NOW);
  assert.equal(st2.lastSession, null);
  assert.equal(st2.targets.resume, null);
});

test("T42 坏 last_session JSON → 静默回落不抛", () => {
  const { db, raw } = freshDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{oops')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.lastSession, null);
});

test("T43 SRS 到期计数 + 快毕业探测(0.7≤mastery<0.9 未 mastered)", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s1', 'n1', '2026-09-14T00:00:00.000Z')");
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s2', 'n2', '2027-01-01T00:00:00.000Z')");
  raw.run("INSERT INTO progress (node_id, status, mastery) VALUES ('n2', 'in_progress', 0.75)");
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{\"courseId\":\"c1\",\"nodeId\":\"n1\"}')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.dueCount, 1);
  assert.equal(st.nearMasteryNodeTitle, "反向传播");
  assert.equal(st.targets.nearMasteryNodeId, "n2");
  assert.equal(st.targets.reviewCourseId, "c1", "到期项归属课=复习目标课(未选课态点复习先切课)");
});

test("T43b reviewCourseId:跨课到期取众数课(众数=抽屉该开的课)", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES ('c2', '', 'r2', '第二课', 1)");
  raw.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('m1', 'c2', 'lesson', '课二节点', 'd.md', 0)");
  raw.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('m2', 'c2', 'lesson', '课二节点二', 'e.md', 1)");
  // c1 一项到期,c2 两项到期 → 众数 c2
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s1', 'n1', '2026-09-14T00:00:00.000Z')");
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s2', 'm1', '2026-09-13T00:00:00.000Z')");
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s3', 'm2', '2026-09-12T00:00:00.000Z')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.dueCount, 3);
  assert.equal(st.targets.reviewCourseId, "c2", "到期项最多的课胜出");
  // 空到期 → null
  const { db: db2 } = freshDb();
  const st2 = gatherBootState(db2, NOW);
  assert.equal(st2.targets.reviewCourseId, null);
});

test("T44 快毕业边界:已 mastered 或 <0.7 不算", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO progress (node_id, status, mastery) VALUES ('n1', 'mastered', 0.95)");
  raw.run("INSERT INTO progress (node_id, status, mastery) VALUES ('n2', 'in_progress', 0.4)");
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{\"courseId\":\"c1\",\"nodeId\":\"n1\"}')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.nearMasteryNodeTitle, null);
});

test("T45 friction 卡点(frustrated/confused 计数,agent_error 排除)", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO friction_log (id, node_id, category, summary) VALUES ('f1', 'n2', 'frustrated', 's1')");
  raw.run("INSERT INTO friction_log (id, node_id, category, summary) VALUES ('f2', 'n2', 'confused', 's2')");
  raw.run("INSERT INTO friction_log (id, node_id, category, summary) VALUES ('f3', 'n1', 'agent_error', 'e')");
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{\"courseId\":\"c1\",\"nodeId\":\"n1\"}')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.topFrictionNodeTitle, "反向传播");
  assert.equal(st.targets.frictionNodeId, "n2");
});

test("T46 streak:昨日活跃+无冻结 → atRisk+returningAfterDays;freeze 余量则不告急", () => {
  const { db, raw } = freshDb();
  raw.run("UPDATE streaks SET current_streak = 3, last_active_date = '2026-09-14', freeze_count = 0 WHERE id = 'singleton'");
  const st = gatherBootState(db, NOW);
  assert.equal(st.streak.todayDone, false);
  assert.equal(st.streak.atRisk, true);
  assert.ok(st.streak.hoursLeft >= 1 && st.streak.hoursLeft <= 24);
  assert.equal(st.returningAfterDays, true);
  raw.run("UPDATE streaks SET freeze_count = 1 WHERE id = 'singleton'");
  const st2 = gatherBootState(db, NOW);
  assert.equal(st2.streak.atRisk, false);
  raw.run("UPDATE streaks SET last_active_date = '2026-09-15' WHERE id = 'singleton'");
  const st3 = gatherBootState(db, NOW);
  assert.equal(st3.streak.todayDone, true);
  assert.equal(st3.streak.atRisk, false);
  assert.equal(st3.returningAfterDays, false);
});

test("T47 考试中断:未结未终止 attempt → 目标节点;已终止不算", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO exam_attempts (id, exam_node_id, started_at, terminated) VALUES ('a1', 'n3', '2026-09-14T20:00:00', 0)");
  const st = gatherBootState(db, NOW);
  assert.equal(st.suspendedExamNodeTitle, "期末考");
  assert.equal(st.targets.examNodeId, "n3");
  raw.run("UPDATE exam_attempts SET terminated = 1 WHERE id = 'a1'");
  const st2 = gatherBootState(db, NOW);
  assert.equal(st2.suspendedExamNodeTitle, null);
});

test("T48 hasKey 与 agent:isReady 同源(glm_api_key 在 → ready)", () => {
  const { db, raw } = freshDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('glm_api_key', 'sk-test')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.hasKey, true);
});

test("T49 key_prompt_count ≥2 → keyPromptDismissed", () => {
  const { db, raw } = freshDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('key_prompt_count', '2')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.keyPromptDismissed, true);
});

test("T50 端到端:全信号库 → computeBootGuide(gather) 得 resume_last(优先于一切)", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO settings (key, value) VALUES ('glm_api_key', 'sk-test')");
  raw.run("INSERT INTO settings (key, value) VALUES ('boot_done', '1')");
  raw.run("INSERT INTO settings (key, value) VALUES ('last_session', '{\"courseId\":\"c1\",\"nodeId\":\"n1\"}')");
  raw.run("INSERT INTO srs_items (id, node_id, due_at) VALUES ('s1', 'n1', '2026-09-01T00:00:00.000Z')");
  raw.run("INSERT INTO exam_attempts (id, exam_node_id, started_at, terminated) VALUES ('a1', 'n3', '2026-09-14T20:00:00', 0)");
  raw.run("UPDATE streaks SET current_streak = 2, last_active_date = '2026-09-14', freeze_count = 0 WHERE id = 'singleton'");
  const st = gatherBootState(db, NOW);
  const guide = computeBootGuide(st);
  assert.equal(guide.scene, "resume_last");
  assert.equal(guide.welcomeBack, true);
});

test("T52 recap:total_xp/mastered 数/streak 天聚合(右栏学习回顾数据源)", () => {
  const { db, raw } = freshDb();
  seedCourse(raw, "c1");
  raw.run("INSERT INTO settings (key, value) VALUES ('total_xp', '860')");
  raw.run("INSERT INTO progress (node_id, status, mastery) VALUES ('n1', 'mastered', 0.95)");
  raw.run("INSERT INTO progress (node_id, status, mastery) VALUES ('n2', 'in_progress', 0.4)");
  raw.run("UPDATE streaks SET current_streak = 7 WHERE id = 'singleton'");
  const st = gatherBootState(db, NOW);
  assert.deepEqual(st.recap, { totalXp: 860, masteredCount: 1, streakDays: 7 });
});

test("T53 recap 空库:全零(渲染层据此落到 tips 兜底卡)", () => {
  const { db } = freshDb();
  const st = gatherBootState(db, NOW);
  assert.deepEqual(st.recap, { totalXp: 0, masteredCount: 0, streakDays: 0 });
});

test("T51 boot_done='1' 与 learner_profile 解析(画像填充度/称呼)", () => {
  const { db, raw } = freshDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('boot_done', '1')");
  raw.run("INSERT INTO settings (key, value) VALUES ('learner_profile', '{\"name\":\"阿凯\",\"mbti\":\"ENTP\",\"style\":{\"start\":\"framework\",\"interaction\":\"dialogue\",\"feedback\":\"direct\",\"pacing\":\"exploratory\"},\"updatedAt\":\"2026-09-15T00:00:00.000Z\"}')");
  const st = gatherBootState(db, NOW);
  assert.equal(st.bootDone, true);
  assert.equal(st.profileFilled, true);
  assert.equal(st.name, "阿凯");
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error("FAILED");
