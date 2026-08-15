/**
 * verify-structure-resilience.mjs —— Step 4 结构设计"截断自愈"+ planId 全步骤标注。
 *
 * 背景(2026-08 实测 181 文件仓库导入失败):40 文件/批的结构设计输出撞 provider
 * 输出上限,流正常结束但 JSON 只写了一半 → parseStructureDesignResult 抛
 * "Unexpected end of JSON input" → 整个 job 死。且 planId 标注只包住 Step 5,
 * Step 2-4 失败不带 planId → 渲染层"从断点重试"按钮不出现。
 *
 * 修复验证:
 * 1. designSectionsResilient(call 注入桩):
 *    - 解析失败 → 批拆半重试(输出体量随批缩小,截断概率指数下降)
 *    - 单文件仍失败 → h1/文件名兜底一课,绝不抛
 *    - 基础设施错误(网络/看门狗)→ 原样上抛,不无谓重试
 * 2. runSmartImport(classify/design 注入桩):Step 2 或 Step 4 崩溃 → 错误带
 *    planId,快照已落盘到崩溃前的最后一步。
 *
 * 跑法: npx tsx scripts/verify-structure-resilience.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { designSectionsResilient } from "../src/main/services/import-llm-service.ts";
import { runSmartImport, planIdOf } from "../src/main/services/import-job-service.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";

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

/* ══════════════ Part A: designSectionsResilient(call 桩) ══════════════ */

const FILES = ["xx1.md", "xx2.md", "xx3.md", "xx4.md"];
const infos = (names) =>
  names.map((f) => ({ file: f, role: "original", h1: `H1 ${f}`, totalChars: 500, headings: [] }));
// 桩从 prompt 里数出本批真实文件数(prompt 尾部 JSON 示例用的是 lessons/ 路径,不冲突)
const countIn = (p) => FILES.filter((f) => p.includes(`"${f}"`)).length;
const okJson = (p) => {
  const present = FILES.filter((f) => p.includes(`"${f}"`));
  return JSON.stringify({
    sections: [{
      title: `S${present.length}`,
      world: "study",
      lessons: present.map((f) => ({ title: f, file: f, world: "study" })),
    }],
  });
};

await test("T1 全部成功:一次调用直通,无重试", async () => {
  let calls = 0;
  const sections = await designSectionsResilient("readme", infos(["xx1.md"]), [], [], {
    call: async (p) => { calls++; assert.ok(countIn(p) === 1); return okJson(p); },
  });
  assert.equal(calls, 1, "单批成功不应重试");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].lessons.length, 1);
});

await test("T2 截断二分:>2 文件批输出截断 → 拆半各调成功", async () => {
  let calls = 0;
  const msgs = [];
  const sections = await designSectionsResilient("readme", infos(FILES), [], [], {
    call: async (p) => {
      calls++;
      return countIn(p) > 2 ? '{"sections": [{"title": "S", "wor' : okJson(p); // 大批截断
    },
    onProgress: (m) => msgs.push(m),
  });
  assert.equal(calls, 3, "4文件批失败 + 两个2文件半批 = 3 次调用");
  assert.equal(sections.length, 2, "两个半批各一个 section");
  assert.equal(sections.reduce((n, s) => n + s.lessons.length, 0), 4, "4 课一个不少");
  assert.ok(msgs.some((m) => m.includes("拆半重试")), "进度应宣布拆半");
});

await test("T3 永远截断:单文件兜底一课(h1 作标题),绝不抛", async () => {
  const msgs = [];
  const sections = await designSectionsResilient("readme", infos(["xx1.md", "xx2.md", "xx3.md"]), [], [], {
    call: async () => '{"sections": [trunc', // 所有批全部截断
    onProgress: (m) => msgs.push(m),
  });
  assert.equal(sections.length, 3, "每文件兜底一 section");
  const titles = sections.map((s) => s.title).sort();
  assert.deepEqual(titles, ["H1 xx1.md", "H1 xx2.md", "H1 xx3.md"], "h1 作兜底标题");
  for (const s of sections) {
    assert.equal(s.lessons.length, 1);
    assert.equal(s.lessons[0].world, "study");
  }
  assert.ok(msgs.some((m) => m.includes("兜底")), "进度应宣布兜底");
});

await test("T4 基础设施错误原样上抛,不二分", async () => {
  let calls = 0;
  await assert.rejects(
    () => designSectionsResilient("readme", infos(FILES), [], [], {
      call: async () => { calls++; throw new Error("LLM 调用无输出超过 120s"); },
    }),
    /无输出超过 120s/,
  );
  assert.equal(calls, 1, "看门狗/网络错误重试无意义,只调一次");
});

await test("T5 JSON 合法但缺 sections 数组:同样按解析失败二分自愈", async () => {
  let calls = 0;
  const sections = await designSectionsResilient("readme", infos(FILES), [], [], {
    call: async (p) => { calls++; return countIn(p) > 2 ? "{}" : okJson(p); }, // 形状不对
  });
  assert.equal(calls, 3);
  assert.equal(sections.reduce((n, s) => n + s.lessons.length, 0), 4);
});

await test("T6 practice 角色单文件兜底进 practice world", async () => {
  const practiceInfos = [{ file: "lab.py", role: "practice", h1: "", totalChars: 100, headings: [] }];
  const sections = await designSectionsResilient("readme", practiceInfos, ["lab.py"], [], {
    call: async () => "not json at all",
  });
  assert.equal(sections[0].world, "practice");
  assert.equal(sections[0].lessons[0].file, "lab.py");
  assert.equal(sections[0].title, "lab", "无 h1 时用去扩展名的文件名");
});

/* ══════════════ Part B: runSmartImport planId 全步骤标注(注入桩) ══════════════ */

const courseDir = mkdtempSync(join(tmpdir(), "ls-resilience-course-"));
const plansDir = mkdtempSync(join(tmpdir(), "ls-resilience-store-"));
mkdirSync(join(courseDir, "docs"), { recursive: true });
writeFileSync(join(courseDir, "README.md"), "# 韧性测试课程\n\n- [a](docs/a.md)\n- [b](docs/b.md)\n", "utf8");
writeFileSync(join(courseDir, "docs", "a.md"), "# A 课\n\n正文写长一点让扫描器认出这是文档内容。\n\n## 小节\n\n内容。\n", "utf8");
writeFileSync(join(courseDir, "docs", "b.md"), "# B 课\n\n第二课正文,同样有实质内容。\n\n## 小节二\n\n内容二。\n", "utf8");

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");
const sqljs = new SQL.Database();
sqljs.run(schemaSql);
const db = drizzle(sqljs, { schema });

const mkDeps = (extra) => ({
  db,
  // 每次独立 store 目录:前一个测试留下的快照会命中身份复用,跳过要测的那一步
  store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-resilience-store-"))),
  markDirty: () => {},
  onProgress: () => {},
  shouldAbort: () => false,
  ...extra,
});

await test("T7 Step 4 崩溃:错误带 planId,快照停在第 3 步", async () => {
  const deps = mkDeps({
    design: async () => { throw new Error("模拟 Step4 输出截断崩溃"); },
  });
  let caught = null;
  try {
    await runSmartImport({ kind: "folder", path: courseDir }, deps);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "应抛错");
  assert.match(caught.message, /模拟 Step4/);
  const pid = planIdOf(caught);
  assert.ok(pid, "Step 4 失败的错误应带 planId");
  const plan = deps.store.load(pid);
  assert.ok(plan, "planId 对应的快照已落盘");
  assert.equal(plan.reachedStep, 3, "分类+大纲已保存,结构未保存");
  assert.ok(plan.classification, "Step2 产物在快照里");
  assert.ok(!plan.structure, "Step4 产物不在(崩溃了)");
});

await test("T8 Step 2 崩溃:错误同样带 planId(此前只有 Step5 标注)", async () => {
  const deps = mkDeps({
    classify: async () => { throw new Error("模拟 Step2 分类崩溃"); },
  });
  let caught = null;
  try {
    await runSmartImport({ kind: "folder", path: courseDir }, deps);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "应抛错");
  const pid = planIdOf(caught);
  assert.ok(pid, "Step 2 失败的错误也应带 planId");
  const plan = deps.store.load(pid);
  assert.ok(plan, "快照存在(至少 Step1 清点)");
  assert.ok(!plan.classification, "分类未完成");
});

await test("T9 快照落盘审计日志:savePlan 后 dir() 可诊断", () => {
  const store = createPlanStore(plansDir);
  assert.ok(typeof store.dir() === "string" && store.dir().length > 0, "dir() 暴露落盘目录");
});

// 清理
rmSync(courseDir, { recursive: true, force: true });
rmSync(plansDir, { recursive: true, force: true });

console.log(`\n${passed} passed`);
