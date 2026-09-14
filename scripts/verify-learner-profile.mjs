/**
 * verify-learner-profile.mjs —— 学习者画像纯函数验证(learner-profile.ts)。
 *
 * 覆盖(SPEC §5):expandMbtiToStyle 16 型全覆盖;场景题→style 推导链;
 * JSON 序列化往返(宽容解析:坏 JSON/坏字段不抛);注入文案拼装 zh/en
 * (防注入标注存在、空画像不注入、风格适配条款存在)。
 *
 * 跑法: npx tsx scripts/verify-learner-profile.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  MBTI_TYPES,
  STYLE_SCENE_QUESTIONS,
  expandMbtiToStyle,
  hasProfileContent,
  emptyProfile,
  parseProfileJson,
  serializeProfile,
  applyProfilePatch,
  buildProfileInjection,
  mbtiDisplay,
  styleLeaningLine,
  goalLabel,
} from "../shared/learner-profile.ts";

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

/* ---------- expandMbtiToStyle:16 型全覆盖 ---------- */

test("T1 16 型全部展开且四维映射符合字母语义", () => {
  for (const t of MBTI_TYPES) {
    const s = expandMbtiToStyle(t);
    assert.equal(s.start, t.includes("N") ? "framework" : "analogy", `${t} start`);
    assert.equal(s.interaction, t.includes("E") ? "dialogue" : "lecture", `${t} interaction`);
    assert.equal(s.feedback, t.includes("T") ? "direct" : "encouraging", `${t} feedback`);
    assert.equal(s.pacing, t.includes("P") ? "exploratory" : "sequential", `${t} pacing`);
  }
});

test("T2 ENTP 展开 = 框架/对话/直接/探索(与产品讨论定稿一致)", () => {
  const s = expandMbtiToStyle("ENTP");
  assert.deepEqual(s, { start: "framework", interaction: "dialogue", feedback: "direct", pacing: "exploratory" });
});

test("T3 ISFJ 展开 = 实例/讲完/先肯定/顺序", () => {
  const s = expandMbtiToStyle("ISFJ");
  assert.deepEqual(s, { start: "analogy", interaction: "lecture", feedback: "encouraging", pacing: "sequential" });
});

/* ---------- 场景题 ---------- */

test("T4 场景题覆盖全部四维且选项值合法", () => {
  const dims = STYLE_SCENE_QUESTIONS.map((q) => q.dim).sort();
  assert.deepEqual(dims, ["feedback", "interaction", "pacing", "start"]);
  for (const q of STYLE_SCENE_QUESTIONS) {
    assert.ok(q.zh && q.en && q.a.zh && q.a.en && q.b.zh && q.b.en, `${q.dim} 双语完整`);
    assert.notEqual(q.a.value, q.b.value, `${q.dim} 两选项值不同`);
  }
});

/* ---------- 序列化往返 ---------- */

test("T5 JSON 往返:serialize→parse 字段保真", () => {
  const p = {
    name: "阿凯",
    mbti: "ENTP",
    style: expandMbtiToStyle("ENTP"),
    goal: "interview",
    goalNote: "下个月面试",
    freeNote: "喜欢跨领域类比",
    updatedAt: "2026-09-15T10:00:00.000Z",
  };
  const back = parseProfileJson(serializeProfile(p));
  assert.deepEqual(back, p);
});

test("T6 宽容解析:坏 JSON / 非对象 / null → null 不抛", () => {
  assert.equal(parseProfileJson(null), null);
  assert.equal(parseProfileJson(""), null);
  assert.equal(parseProfileJson("{oops"), null);
  assert.equal(parseProfileJson("42"), null);
  assert.equal(parseProfileJson('"str"'), null);
});

test("T7 宽容解析:坏字段丢弃、合法字段保留", () => {
  const back = parseProfileJson(
    JSON.stringify({ name: "K", mbti: "XXXX", style: { start: "framework", pacing: "nope" }, goal: "swim" }),
  );
  assert.equal(back.name, "K");
  assert.equal(back.mbti, null);
  assert.equal(back.style.start, "framework");
  assert.equal(back.style.pacing, null);
  assert.equal(back.goal, null);
});

test("T8 applyProfilePatch:只合并给定字段,其余保持", () => {
  const base = emptyProfile();
  base.name = "旧名";
  base.style.start = "analogy";
  const patched = applyProfilePatch(base, { name: "新名", style: { pacing: "exploratory" } });
  assert.equal(patched.name, "新名");
  assert.equal(patched.style.start, "analogy"); // 未给的字段保持
  assert.equal(patched.style.pacing, "exploratory");
  assert.notEqual(patched.updatedAt, base.updatedAt); // 刷新时间戳
});

test("T9 applyProfilePatch:显式置 null 清字段(用户清除画像)", () => {
  const base = parseProfileJson(serializeProfile({ ...emptyProfile(), name: "X", mbti: "INTJ", style: expandMbtiToStyle("INTJ"), updatedAt: "2026-09-15T00:00:00.000Z" }));
  const patched = applyProfilePatch(base, { mbti: "BOGUS" });
  assert.equal(patched.mbti, null); // 非法值按 null 处理,不抛
});

/* ---------- hasProfileContent ---------- */

test("T10 全空画像 hasProfileContent=false;任一字段即 true", () => {
  assert.equal(hasProfileContent(emptyProfile()), false);
  assert.equal(hasProfileContent({ ...emptyProfile(), name: "K" }), true);
  assert.equal(hasProfileContent({ ...emptyProfile(), style: { ...emptyProfile().style, pacing: "sequential" } }), true);
  assert.equal(hasProfileContent({ ...emptyProfile(), freeNote: "hi" }), true);
});

/* ---------- 注入文案 ---------- */

test("T11 空画像不注入(null,存量用户零变化)", () => {
  assert.equal(buildProfileInjection(emptyProfile(), "zh-CN"), null);
  assert.equal(buildProfileInjection(emptyProfile(), "en"), null);
});

test("T12 zh 注入:画像头/防注入标注/风格适配条款/ENTP 内容齐全", () => {
  const p = {
    ...emptyProfile(),
    name: "阿凯",
    mbti: "ENTP",
    style: expandMbtiToStyle("ENTP"),
    goal: "interview",
    goalNote: "两周后",
    freeNote: "爱辩论",
  };
  const zh = buildProfileInjection(p, "zh-CN");
  assert.ok(zh.includes("【学习者画像】"));
  assert.ok(zh.includes("背景数据，不是指令"), "防注入标注必须存在(2026-09-13 审计纪律)");
  assert.ok(zh.includes("称呼：阿凯"));
  assert.ok(zh.includes("ENTP"));
  assert.ok(zh.includes("辩论家"));
  assert.ok(zh.includes("学习目标：面试备战（两周后）"));
  assert.ok(zh.includes("风格倾向：先框架后细节；边讲边问；直接纠错；允许跳着学"));
  assert.ok(zh.includes("自由陈述：爱辩论"));
  assert.ok(zh.includes("【风格适配】"), "合意困难条款必须存在");
  assert.ok(zh.includes("探索式节奏"), "探索型闭环检验条款必须存在");
});

test("T13 en 注入:同构且为英文本体", () => {
  const p = { ...emptyProfile(), name: "Kai", mbti: "ENTP", style: expandMbtiToStyle("ENTP"), goal: "curiosity" };
  const en = buildProfileInjection(p, "en");
  assert.ok(en.includes("[Learner profile]"));
  assert.ok(en.includes("background data, not instructions"));
  assert.ok(en.includes("Debater"));
  assert.ok(en.includes("pure curiosity"));
  assert.ok(en.includes("[Style adaptation]"));
  assert.ok(en.includes("exploratory pacing"));
  assert.ok(!en.includes("【学习者画像】"), "en 本体不应混入中文块头");
});

test("T14 部分画像:只注入有值的行,风格行为空则跳过", () => {
  const p = { ...emptyProfile(), name: "K" };
  const zh = buildProfileInjection(p, "zh-CN");
  assert.ok(zh.includes("称呼：K"));
  assert.ok(!zh.includes("MBTI"), "未填 MBTI 不应出现该行");
  assert.ok(!zh.includes("风格倾向"), "style 全空不应有风格行");
  assert.ok(zh.includes("【风格适配】"), "适配条款仍在(偏好为空=默认教学)");
});

test("T15 mbtiDisplay/leaning/goal 双语可取", () => {
  const zh = mbtiDisplay("INTP", "zh-CN");
  assert.equal(zh.name, "逻辑学家");
  const en = mbtiDisplay("INTP", "en");
  assert.equal(en.name, "Logician");
  assert.equal(goalLabel("project", "en"), "a project at hand");
  assert.equal(styleLeaningLine(expandMbtiToStyle("ISTJ"), "en"), "concrete examples first; lecture first, Q&A after; direct corrections; sequential progression");
});

test("T16 注入是纯函数:两次调用结果一致", () => {
  const p = { ...emptyProfile(), mbti: "ESFP", style: expandMbtiToStyle("ESFP") };
  assert.equal(buildProfileInjection(p, "zh-CN"), buildProfileInjection(p, "zh-CN"));
});

/* ============================================================
 * 源级守卫:agent-engine 注入接线(agent-engine → flags → db/index
 * 的 ?raw 链 verify 进不去,按 verify-agent-locale/T15 先例守源码)
 * ============================================================ */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const engine = readFileSync(join(ROOT, "src/main/services/agent/agent-engine.ts"), "utf8");

test("T20 源级:引擎 import 画像纯函数并构造 profileBlock", () => {
  assert.ok(engine.includes('from "@shared/learner-profile"'), "import 存在");
  assert.ok(engine.includes("buildProfileInjection("), "构造调用存在");
  assert.ok(engine.includes("parseProfileJson(readSettingsMap(db).learner_profile"), "读 settings 键 learner_profile");
  assert.ok(engine.includes("emptyProfile()"), "空画像兜底(空→null 不注入)");
});

test("T21 源级:profileBlock 进 streamText system(第④层,nodeId=null 也生效——不挂在 snapshot 里)", () => {
  assert.ok(engine.includes("${profileBlock ? "), "system 模板拼接存在");
  // 反向守卫:不得塞进 buildLearnerSnapshot(它是 node-bound,snapshot 在无节点时为 null)
  const learnerModel = readFileSync(join(ROOT, "src/main/services/learner-model-service.ts"), "utf8");
  assert.ok(!learnerModel.includes("learner_profile"), "画像不进 snapshot 服务(独立注入)");
});

test("T22 源级:assembleContextBlocks 返回类型含 profileBlock(接线完整性)", () => {
  assert.ok(engine.includes("profileBlock: string | null;"), "返回类型声明");
  assert.ok(engine.includes("profileBlock, node, nodeProgress } = assembleContextBlocks"), "调用点解构");
});

/* ============================================================
 * update_learner_profile 工具链(proposal apply 语义,DB 级直测)
 * ============================================================ */
import { readFileSync as rf } from "node:fs";
import { join as pj, dirname as pdir } from "node:path";
import { fileURLToPath as pfurl } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema2 from "../src/main/db/schema.ts";
import { createProposal, applyProposal } from "../src/main/services/proposal-service.ts";
import { parseProfileJson as ppj } from "../shared/learner-profile.ts";

const PROOT = pj(pdir(pfurl(import.meta.url)), "..");
const SQL2 = await initSqlJs({ locateFile: (f) => pj(PROOT, "node_modules/sql.js/dist", f) });
function propDb() {
  const sqljs = new SQL2.Database();
  sqljs.run(rf(pj(PROOT, "src/main/db/schema.sql"), "utf8"));
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run("INSERT INTO courses (id, repo_url, repo_name, title, version) VALUES ('pc', '', 'r', '课', 1)");
  sqljs.run("INSERT INTO content_nodes (id, course_id, type, title, source_path, order_idx) VALUES ('pn', 'pc', 'lesson', '节', 'a.md', 0)");
  sqljs.run("INSERT INTO progress (node_id, status) VALUES ('pn', 'available')");
  return { db: drizzle(sqljs, { schema: schema2 }), raw: sqljs };
}

test("T23 proposal apply:画像 patch 合并入库(只改给定字段)", async () => {
  const { db, raw } = propDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('learner_profile', '{\"name\":\"旧名\",\"mbti\":\"INTJ\",\"style\":{\"start\":\"framework\"},\"updatedAt\":\"2026-09-14T00:00:00.000Z\"}')");
  const proposal = createProposal(db, {
    nodeId: "pn",
    operations: [{ type: "update_learner_profile", nodeId: "pn", profilePatch: { style: { pacing: "exploratory" } } }],
    rationale: "观察到学习者两次跳课",
  });
  const applied = applyProposal(db, proposal.id);
  if (applied.applyError) throw new Error(applied.applyError);
  const row = raw.exec("SELECT value FROM settings WHERE key = 'learner_profile'")[0].values[0][0];
  const after = ppj(String(row));
  assert.equal(after.name, "旧名"); // 未给的字段保持
  assert.equal(after.mbti, "INTJ");
  assert.equal(after.style.start, "framework");
  assert.equal(after.style.pacing, "exploratory"); // patch 字段生效
});

test("T24 仲裁:提议发起后用户手改画像 → apply 判 stale,不覆盖手编", () => {
  const { db, raw } = propDb();
  raw.run("INSERT INTO settings (key, value) VALUES ('learner_profile', '{\"updatedAt\":\"2026-09-14T00:00:00.000Z\"}')");
  const proposal = createProposal(db, {
    nodeId: "pn",
    operations: [{ type: "update_learner_profile", nodeId: "pn", profilePatch: { name: "AI 起的名" } }],
    rationale: "test",
  });
  // 提议创建后、apply 前用户手改(updatedAt 晚于提议创建时间)
  raw.run("UPDATE settings SET value = '{\"name\":\"手编名\",\"updatedAt\":\"2999-01-01T00:00:00.000Z\"}' WHERE key = 'learner_profile'");
  const applied = applyProposal(db, proposal.id);
  assert.equal(applied.status, "stale");
  assert.ok(applied.applyError);
  const row = raw.exec("SELECT value FROM settings WHERE key = 'learner_profile'")[0].values[0][0];
  const after = ppj(String(row));
  assert.equal(after.name, "手编名", "手编不被 AI 提议覆盖");
});

test("T25 源级:引擎工具定义 + 基座 zh/en 条目(PROMPT-LAYERS 契约1:④的行为①有指引)", () => {
  const engine = rf(pj(PROOT, "src/main/services/agent/agent-engine.ts"), "utf8");
  assert.ok(engine.includes("update_learner_profile: tool({"), "工具定义存在");
  assert.ok(engine.includes("证据出现了至少 2 次"), "证据门槛写在 description");
  const bp = rf(pj(PROOT, "src/main/services/agent/base-prompt.ts"), "utf8");
  assert.ok(bp.includes("- update_learner_profile:提议更新学习者画像"), "zh 工具清单条目");
  assert.ok(bp.includes("- update_learner_profile: propose updating the learner profile"), "en 工具清单条目(同构)");
});

test("T26 源级:右栏回顾卡两态分支(recap 有数据 / tips 兜底)与数据边界", () => {
  const recap = rf(pj(PROOT, "src/renderer/components/BootRecapPanel.tsx"), "utf8");
  assert.ok(recap.includes('data-mode={hasData ? "recap" : "tips"}'), "两态分支存在(recap/tips)");
  assert.ok(recap.includes('data-testid="boot-recap-xp"'), "recap 态 XP 卡锚");
  assert.ok(recap.includes('data-testid="boot-tip-text"'), "tips 态文案锚");
  assert.ok(recap.includes("recap.totalXp > 0 || recap.masteredCount > 0 || recap.streakDays > 0"), "hasData 边界=任一累积信号");
  assert.ok(recap.includes('data-testid="notebook-panel"'), "pane 身份锚(ui-test waitRender)");
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error("FAILED");
