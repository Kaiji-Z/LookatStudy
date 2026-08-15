/**
 * verify-import-plan.mjs —— 导入管线"确定性"验证(ImportPlan 断点续跑 + 课程包)。
 *
 * 两层:
 * 1. 纯函数(pure/import-plan.ts):treeHash 顺序无关 / 序列化往返 + 版本守卫 /
 *    身份键 / 漂移检测 / bestEffortStructure 尽力保留 / URL 解析。
 * 2. 集成(import-job-service.runSmartImport,folder spec):真 sql.js 内存库 + 真临时文件夹,
 *    无 LLM key → Step2/4 走规则 fallback(零网络)。断言:
 *    - 首次导入落库且方案快照落盘;
 *    - 同一文件夹再导 → 身份+treeHash 命中 → 复用快照(reused=true,进度含"复用");
 *    - 内容漂移(删一个文件)→ bestEffort 保留其余课;
 *    - 断点 spec(kind:"plan")直接带快照续跑。
 *
 * 跑法: npx tsx scripts/verify-import-plan.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import {
  IMPORT_PLAN_FORMAT_VERSION,
  bestEffortStructure,
  computeTreeHash,
  parseGithubUrl,
  parsePlan,
  planIdentityKey,
  planMatchesInventory,
  serializePlan,
} from "../src/main/services/pure/import-plan.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";
import { runSmartImport } from "../src/main/services/import-job-service.ts";

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

/* ══════════════ Part 1: 纯函数 ══════════════ */

await test("T1 computeTreeHash 顺序无关,集合敏感", () => {
  const a = ["x.md", "a/b.md", "z/c.md"];
  const b = ["z/c.md", "x.md", "a/b.md"];
  assert.equal(computeTreeHash(a), computeTreeHash(b), "乱序同集合应同 hash");
  assert.notEqual(computeTreeHash(a), computeTreeHash([...a, "new.md"]), "集合变了 hash 应变");
});

await test("T2 serialize/parse 往返 + 版本守卫", () => {
  const plan = {
    formatVersion: IMPORT_PLAN_FORMAT_VERSION,
    planId: "p1",
    kind: "github",
    github: { owner: "o", repo: "r", branch: "main" },
    treeHash: "h",
    createdAt: "t1",
    updatedAt: "t1",
    reachedStep: 4,
    readmeMd: "rm",
    fileList: [],
    fullTree: ["a.md"],
    branch: "main",
    structure: { courseTitle: "T", sections: [{ title: "S", world: "study", lessons: [{ title: "L", file: "a.md", world: "study" }] }] },
  };
  const back = parsePlan(serializePlan(plan));
  assert.equal(back?.planId, "p1", "往返保 planId");
  assert.equal(back?.structure?.sections.length, 1, "往返保结构");
  assert.equal(parsePlan(JSON.stringify({ ...plan, formatVersion: 99 })), null, "版本不符 → null");
  assert.equal(parsePlan("{bad json"), null, "坏 JSON → null");
});

await test("T3 身份键:github 大小写不敏感,folder 按 absPath", () => {
  assert.equal(
    planIdentityKey({ kind: "github", github: { owner: "Kaiji", repo: "LookatStudy" } }),
    planIdentityKey({ kind: "github", github: { owner: "kaiji", repo: "lookatstudy" } }),
  );
  assert.notEqual(
    planIdentityKey({ kind: "folder", folder: { absPath: "C:/a" } }),
    planIdentityKey({ kind: "folder", folder: { absPath: "C:/b" } }),
  );
});

await test("T4 planMatchesInventory:同内容态 true,漂移 false", () => {
  const plan = {
    formatVersion: 1, planId: "p", kind: "github",
    github: { owner: "o", repo: "r", branch: "main" },
    treeHash: computeTreeHash(["a.md", "b.md"]),
    createdAt: "", updatedAt: "", reachedStep: 4, readmeMd: "", fileList: [], fullTree: ["a.md", "b.md"], branch: "main",
  };
  assert.ok(planMatchesInventory(plan, { kind: "github", github: { owner: "o", repo: "r" } }, ["b.md", "a.md"]));
  assert.ok(!planMatchesInventory(plan, { kind: "github", github: { owner: "o", repo: "r" } }, ["a.md", "b.md", "c.md"]), "内容漂移应 false");
  assert.ok(!planMatchesInventory(plan, { kind: "github", github: { owner: "o", repo: "other" } }, ["a.md", "b.md"]), "身份不同应 false");
});

await test("T5 bestEffortStructure:丢消失课/清空节/全灭 null", () => {
  const st = {
    courseTitle: "T",
    sections: [
      { title: "S1", world: "study", lessons: [
        { title: "L1", file: "a.md", world: "study" },
        { title: "L2", file: "gone.md", world: "study" },
      ] },
      { title: "S2", world: "study", lessons: [{ title: "L3", file: "gone2.md", world: "study" }] },
    ],
  };
  const be = bestEffortStructure(st, ["a.md"]);
  assert.equal(be?.structure.sections.length, 1, "空节丢弃");
  assert.equal(be?.structure.sections[0]?.lessons.length, 1, "消失文件的课丢弃");
  assert.equal(be?.dropped, 2, "dropped 计数");
  assert.equal(bestEffortStructure(st, ["other.md"]), null, "全灭 → null");
});

await test("T6 parseGithubUrl", () => {
  assert.deepEqual(parseGithubUrl("https://github.com/foo/bar"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseGithubUrl("https://github.com/foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.equal(parseGithubUrl("https://gitlab.com/foo/bar"), null);
});

/* ══════════════ Part 2: 集成(folder spec,无 LLM key → 规则 fallback) ══════════════ */

// 建临时课程文件夹:README + 3 课
const courseDir = mkdtempSync(join(tmpdir(), "ls-plan-course-"));
const plansDir = mkdtempSync(join(tmpdir(), "ls-plan-store-"));
mkdirSync(join(courseDir, "docs"), { recursive: true });
writeFileSync(join(courseDir, "README.md"), "# 测试课程\n\n这是集成测试用课程。\n\n- [第一课](docs/a.md)\n- [第二课](docs/b.md)\n", "utf8");
writeFileSync(join(courseDir, "docs", "a.md"), "# 第一课\n\n正文内容足够长以便被识别为课程文件,这里写满一些文字确保不是噪声。\n\n## 小节\n\n内容。\n", "utf8");
writeFileSync(join(courseDir, "docs", "b.md"), "# 第二课\n\n第二课正文,同样写一些实质内容让扫描器认出它是文档。\n\n## 小节二\n\n内容二。\n", "utf8");

// sql.js 内存库 + schema(同 verify-starter-prompts 模式,绕开 db/index 的 ?raw 链)
const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");
const sqljs = new SQL.Database();
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

const progress = [];
const send = (m) => progress.push(m);
const deps = {
  db,
  store: createPlanStore(plansDir),
  markDirty: () => {},
  onProgress: send,
  shouldAbort: () => false,
};

const countCourses = () => db.select().from(schema.courses).all().length;
const countLessons = () => db.select().from(schema.contentNodes).all().filter((n) => n.type === "lesson").length;

await test("T7 首次导入:课程落库 + 方案快照落盘 + reused=false", async () => {
  const r = await runSmartImport({ kind: "folder", path: courseDir }, deps);
  assert.ok(r.courseId, "应返回 courseId");
  assert.equal(r.reused, false, "首次导入不应复用");
  assert.ok(countCourses() >= 1, "courses 落库");
  assert.ok(countLessons() >= 2, "lesson 落库");
  const plan = deps.store.load(r.planId);
  assert.ok(plan, "方案快照已落盘");
  assert.equal(plan?.reachedStep, 4, "快照应到 Step4");
  assert.ok(plan?.structure, "快照含结构");
  assert.ok(plan?.classification, "快照含分类");
  assert.equal(plan?.courseId, r.courseId, "成功后回填 courseId");
});

await test("T8 同文件夹再导:身份+treeHash 命中 → 复用快照(reused=true)", async () => {
  const before = countCourses();
  const r = await runSmartImport({ kind: "folder", path: courseDir }, deps);
  assert.equal(r.reused, true, "第二次应复用");
  assert.ok(progress.some((m) => m.includes("复用")), "进度应宣布复用");
  assert.equal(countCourses(), before + 1, "第二门课照常创建");
});

await test("T9 内容漂移:删一个文件 → bestEffort 保留其余课", async () => {
  rmSync(join(courseDir, "docs", "b.md"));
  const r = await runSmartImport({ kind: "folder", path: courseDir }, deps);
  assert.equal(r.reused, true, "漂移但有可保留结构 → 仍零 LLM 复用");
  assert.ok(progress.some((m) => m.includes("不一致")), "进度应警告漂移");
  const plan = deps.store.load(r.planId);
  const files = plan?.structure?.sections.flatMap((s) => s.lessons.map((l) => l.file)) ?? [];
  assert.ok(!files.includes("docs/b.md"), "消失文件的课应被丢弃");
  assert.ok(files.some((f) => f.endsWith("a.md")), "仍存在的课应保留");
});

await test("T10 断点续跑 spec:直接带快照(kind:plan)进入", async () => {
  const plans = deps.store.list();
  assert.ok(plans.length >= 1, "应有快照");
  const latest = plans[0];
  assert.ok(latest, "至少一个快照");
  const r = await runSmartImport({ kind: "plan", plan: latest }, deps);
  assert.ok(r.courseId, "plan spec 应完成导入");
  assert.equal(r.reused, true, "带完整快照 → 复用");
});

await test("T11 planStore.findByCourse / deleteByCourse", () => {
  const plans = deps.store.list();
  const withCourse = plans.find((p) => p.courseId);
  assert.ok(withCourse, "应有带 courseId 的快照");
  const found = deps.store.findByCourse(withCourse.courseId);
  assert.equal(found?.planId, withCourse.planId);
  deps.store.deleteByCourse(withCourse.courseId);
  assert.equal(deps.store.findByCourse(withCourse.courseId), null, "删除后查不到");
});

// 清理
rmSync(courseDir, { recursive: true, force: true });
rmSync(plansDir, { recursive: true, force: true });

console.log(`\n${passed} passed`);
