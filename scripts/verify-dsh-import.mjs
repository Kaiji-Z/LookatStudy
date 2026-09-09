/**
 * verify-dsh-import —— dsh 插件进度迁移(设置页入口)纯函数 + 服务层 + 接线守卫。
 *
 * 纯函数层(services/pure/dsh-import-map.ts):normalizeDshState 全版本形状
 * (v1 子集/v2 全量/坏输入)、mergeStreak、planXpMerge 水位幂等。
 * 服务层(services/dsh-import-service.ts):真 sql.js 内存库端到端——首次导入逐值、
 * 重导幂等(三态 refresh/map/create)、同结构课程直写不覆盖内容、XP 水位。
 * 源级守卫:IPC 三通道+import:done 刷新链、preload/api-channels、设置页 UI 三路入口、
 * i18n 双语、shared types。
 *
 * 跑法: npx tsx scripts/verify-dsh-import.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDshState,
  mergeStreak,
  planXpMerge,
  DSH_STATE_VERSION_SUPPORTED,
} from "../src/main/services/pure/dsh-import-map.ts";
import { importDshStateFromText } from "../src/main/services/dsh-import-service.ts";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* ---------- fixture:v2 全量形状 ---------- */
const v2State = {
  version: 2,
  courses: [
    {
      id: "course",
      title: "深度学习入门",
      source: "markdown",
      sourceRef: "README demo",
      createdAt: "2026-09-08T13:08:36.700Z",
      sections: [
        {
          title: "神经网络基础",
          anchor: "#ch1",
          lessons: [
            {
              id: "course:0:0",
              title: "线性与非线性",
              anchor: "#l1",
              body: "# 正文\n$$z = Wx + b$$",
              kind: "study",
              status: "in_progress",
              concepts: [{ title: "线性变换", description: "d" }, { title: "激活函数" }, { title: "第三概念" }],
              conceptMastery: { "0": 0.9625, "1": 0.9625, "2": 0.2 },
              mastery: 0.2,
              attempts: 5,
              correctCount: 4,
              lastAnsweredAt: "2026-09-08T12:00:00Z",
              completedAt: null,
              sm2: null,
              dueAt: null,
              friction: [],
              memory: null,
              notes: [],
            },
            {
              id: "course:0:1",
              title: "优化器",
              kind: "study",
              status: "mastered",
              concepts: [{ title: "SGD" }, { title: "Adam" }],
              conceptMastery: { "0": 0.9984, "1": 0.9984 },
              mastery: 0.9984,
              sm2: { easeFactor: 2.9, intervalDays: 45, repetitions: 4 },
              dueAt: "2026-09-07T01:08:36.703Z",
              completedAt: "2026-09-05T00:00:00Z",
              lastAnsweredAt: "2026-09-05T00:00:00Z",
            },
            {
              id: "course:0:2",
              title: "章节测验",
              kind: "exam",
              status: "in_progress",
              mastery: 0.5,
              examStars: 2,
              lastAnsweredAt: "2026-09-08T10:00:00Z",
            },
          ],
        },
        { title: "训练实践", lessons: [{ id: "course:1:0", title: "过拟合", kind: "practice", status: "available" }] },
      ],
    },
    { id: "empty", title: "空课程", sections: [{ lessons: [] }] }, // 应被跳过
  ],
  xp: { total: 171, todayKey: "2026-09-08", todayXp: 171 },
  streak: { currentStreak: 1, longestStreak: 1, lastActiveDate: "2026-09-08", freezeCount: 2 },
};

/* ---------- 纯函数:normalizeDshState ---------- */

test("normalize v2:课/章/课行规范化,exam/practice/world/KC/SRS/星数全落位", () => {
  const r = normalizeDshState(v2State);
  assert.ok(r.ok, "v2 应通过");
  const c = r.state.courses[0];
  assert.equal(c.title, "深度学习入门");
  assert.equal(c.sections.length, 2);
  const [l0, l1, l2] = c.sections[0].lessons;
  assert.equal(l0.type, "lesson");
  assert.equal(l0.world, "study");
  assert.equal(l0.kc.length, 3);
  assert.equal(l0.srs, null);
  const l3 = c.sections[1].lessons[0];
  assert.equal(l3.world, "practice", "practice kind → practice world");
  assert.equal(l2.type, "exam");
  assert.ok(l2.exam, "exam 计划存在");
  assert.equal(l2.exam?.stars, 2);
  assert.equal(l1.srs?.easeFactor, 290, "easeFactor ×100");
  assert.equal(l1.srs?.intervalDays, 45);
  assert.equal(l1.srs?.dueAt, "2026-09-07T01:08:36.703Z");
  assert.equal(r.state.skippedCourses.length, 1, "空课程被跳过");
});

test("normalize v1(0.4.x 子集):无 kind/xp/streak/examStars 也能过,全落 study/lesson", () => {
  const v1 = structuredClone(v2State);
  v1.version = 1;
  delete v1.xp;
  delete v1.streak;
  for (const c of v1.courses) for (const s of c.sections) for (const l of s.lessons) {
    delete l.kind;
    delete l.examStars;
    delete l.sm2;
    delete l.dueAt;
  }
  const r = normalizeDshState(v1);
  assert.ok(r.ok);
  assert.equal(r.state.xp, null);
  assert.equal(r.state.streak, null);
  const [l0, , l2] = r.state.courses[0].sections[0].lessons;
  assert.equal(l0.type, "lesson");
  assert.equal(l2.type, "lesson", "v1 无 kind → 全 lesson");
  assert.equal(l0.srs, null);
});

test("normalize 拒绝:v3+ / 缺 version / 缺 courses / 非 JSON 对象", () => {
  assert.ok(!normalizeDshState({ version: 99, courses: [] }).ok, "v99 拒");
  assert.match(normalizeDshState({ version: 99, courses: [] }).error ?? "", /新/);
  assert.ok(!normalizeDshState({ courses: [] }).ok, "缺 version 拒");
  assert.ok(!normalizeDshState({ version: 2 }).ok, "缺 courses 拒");
  assert.ok(!normalizeDshState("nope").ok, "非对象拒");
  assert.ok(!normalizeDshState(null).ok);
});

test("normalize 健壮性:无 id/标题的课行跳过;conceptMastery 坏键坏值丢弃;locked 课不产 KC", () => {
  const r = normalizeDshState({
    version: 2,
    courses: [
      {
        id: "c",
        title: "t",
        sections: [
          {
            lessons: [
              { id: "a", title: "ok", status: "in_progress", concepts: [{ title: "k" }], conceptMastery: { "0": 0.5, "x": 0.5, "1": "bad", "-1": 0.5 } },
              { title: "无id" },
              { id: "b", title: "locked 课", status: "locked", concepts: [{ title: "k" }], conceptMastery: { "0": 0.9 } },
            ],
          },
        ],
      },
    ],
  });
  assert.ok(r.ok);
  const lessons = r.state.courses[0].sections[0].lessons;
  assert.equal(lessons.length, 2, "无 id 行被跳");
  assert.equal(lessons[0].kc.length, 1, "仅合法下标+数值的 KC 存活");
  assert.equal(lessons[1].kc.length, 0, "locked 课不产 KC 行");
});

test("mergeStreak:取较大 + 活跃日期取较晚(幂等基础)", () => {
  const m = mergeStreak(
    { currentStreak: 3, longestStreak: 6, lastActiveDate: "2026-09-01", freezeCount: 1 },
    { currentStreak: 1, longestStreak: 1, lastActiveDate: "2026-09-08", freezeCount: 2 },
  );
  assert.equal(m.currentStreak, 3);
  assert.equal(m.longestStreak, 6);
  assert.equal(m.lastActiveDate, "2026-09-08");
  assert.equal(m.freezeCount, 2);
});

test("planXpMerge:水位差量 + 当日一次性并入 + 插件增长后再导补差", () => {
  const day = "2026-09-08";
  const first = planXpMerge({ totalXp: 800, seenTotal: 0, mergedDayKey: null }, { total: 171, todayKey: day, todayXp: 171 }, day);
  assert.equal(first.totalDelta, 171);
  assert.equal(first.dailyKey, `daily_xp_${day}`);
  assert.equal(first.dailyAdd, 171);
  const again = planXpMerge({ totalXp: 971, seenTotal: 171, mergedDayKey: day }, { total: 171, todayKey: day, todayXp: 171 }, day);
  assert.equal(again.totalDelta, 0, "重导零差量");
  assert.equal(again.dailyKey, null, "当日只并一次");
  const growth = planXpMerge({ totalXp: 971, seenTotal: 171, mergedDayKey: day }, { total: 250, todayKey: day, todayXp: 79 }, day);
  assert.equal(growth.totalDelta, 79, "插件后续再涨 → 补差");
  assert.equal(growth.dailyKey, null, "同一天不重复并当日");
  const otherDay = planXpMerge({ totalXp: 971, seenTotal: 250, mergedDayKey: day }, { total: 250, todayKey: "2026-09-09", todayXp: 30 }, "2026-09-09");
  assert.equal(otherDay.dailyKey, "daily_xp_2026-09-09", "新的一天并入新当日");
});

/* ---------- 服务层:真 sql.js 内存库端到端 ---------- */

async function makeDb() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({ locateFile: (f) => join(ROOT, "node_modules/sql.js/dist", f) });
  const raw = new SQL.Database();
  raw.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return drizzle(raw, { schema });
}

const t = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

await t("服务层:首次导入(内存库)——课程/节点/进度/KC/SRS/考试/streak/XP 逐值", async () => {
  const db = await makeDb();
  const r = importDshStateFromText(db, JSON.stringify(v2State), null, new Date("2026-09-08T20:00:00Z"));
  assert.ok(r.ok, r.error);
  assert.equal(r.coursesCreated, 1);
  assert.equal(r.nodes, 4);
  assert.equal(r.progressRows, 4);
  assert.equal(r.kcRows, 5); // 3 + 2
  assert.equal(r.srsRows, 1);
  assert.equal(r.examRows, 1);
  assert.equal(r.xpDelta, 171);
  assert.equal(r.streakMerged, true);
  const courses = db.select().from(schema.courses).all();
  assert.equal(courses.length, 1);
  assert.equal(courses[0].title, "深度学习入门");
  const nodes = db.select().from(schema.contentNodes).all();
  assert.equal(nodes.length, 6, "2 section + 4 lesson/exam");
  const kc = db.select().from(schema.knowledgeComponentMastery).all();
  assert.equal(kc.length, 5);
  const srs = db.select().from(schema.srsItems).all();
  assert.equal(srs[0].easeFactor, 290);
  assert.equal(srs[0].dueAt, "2026-09-07T01:08:36.703Z");
  const exam = db.select().from(schema.examAttempts).all();
  assert.equal(exam[0].stars, 2);
  const prog = db.select().from(schema.progress).all();
  const mastered = prog.find((p) => p.status === "mastered");
  assert.equal(mastered?.crownLevel, 1);
  assert.equal(mastered?.mastery, 0.9984);
  const settingsRows = db.select().from(schema.settings).all();
  const totalXp = settingsRows.find((s) => s.key === "total_xp");
  assert.equal(totalXp?.value, "171");
  const streak = db.select().from(schema.streaks).all()[0];
  assert.equal(streak.currentStreak, 1);
});

await t("服务层:重导幂等——refresh 态,XP/streak 不变,节点数不变", async () => {
  const db = await makeDb();
  const text = JSON.stringify(v2State);
  const r1 = importDshStateFromText(db, text, null, new Date("2026-09-08T20:00:00Z"));
  assert.ok(r1.ok);
  const r2 = importDshStateFromText(db, text, null, new Date("2026-09-08T21:00:00Z"));
  assert.ok(r2.ok);
  assert.equal(r2.coursesCreated, 0);
  assert.equal(r2.coursesRefreshed, 1);
  assert.equal(r2.xpDelta, 0, "水位拦截重复累加");
  assert.equal(db.select().from(schema.courses).all().length, 1);
  assert.equal(db.select().from(schema.contentNodes).all().length, 6);
  assert.equal(db.select().from(schema.settings).all().find((s) => s.key === "total_xp")?.value, "171");
});

await t("服务层:同标题同结构既有课 → map 模式直写,内容不被覆盖", async () => {
  const db = await makeDb();
  // 预造同标题课程:2 章(3+1 节点),结构一致
  db.insert(schema.courses).values({ id: "existing", repoName: "x", title: "深度学习入门" }).run();
  const secIds = ["s0", "s1"];
  secIds.forEach((sid, i) => {
    db.insert(schema.contentNodes).values({ id: sid, courseId: "existing", type: "section", title: `第${i}章`, orderIdx: i }).run();
    for (let j = 0; j < (i === 0 ? 3 : 1); j++) {
      db.insert(schema.contentNodes).values({ id: `${sid}-l${j}`, courseId: "existing", parentId: sid, type: "lesson", title: `旧课${j}`, orderIdx: j, content: "旧正文" }).run();
    }
  });
  const r = importDshStateFromText(db, JSON.stringify(v2State), null);
  assert.ok(r.ok);
  assert.equal(r.coursesMapped, 1);
  assert.equal(r.coursesCreated, 0);
  assert.equal(db.select().from(schema.courses).all().length, 1, "未另建课程");
  const oldContent = db.select().from(schema.contentNodes).all().find((n) => n.content === "旧正文");
  assert.ok(oldContent, "旧正文保留");
  const prog = db.select().from(schema.progress).all();
  assert.equal(prog.length, 4, "进度写进既有节点");
});

await t("服务层:坏 JSON / v99 拒绝,库零写入", async () => {
  const db = await makeDb();
  const r1 = importDshStateFromText(db, "{broken", null);
  assert.ok(!r1.ok && /JSON/.test(r1.error ?? ""));
  const r2 = importDshStateFromText(db, JSON.stringify({ version: 99, courses: [] }), null);
  assert.ok(!r2.ok);
  assert.equal(db.select().from(schema.courses).all().length, 0);
});

/* ---------- 源级守卫 ---------- */

test("接线:IPC 三通道注册 + import:done 刷新链 + flushDb 先于备份", () => {
  const ipc = read("../src/main/ipc/index.ts");
  assert.ok(ipc.includes('"dsh:detect"') && ipc.includes('"dsh:importFromPath"') && ipc.includes('"dsh:importFromText"'), "T: 三通道");
  assert.ok(ipc.includes("registerDshImportHandlers(deps)"), "T: 挂入 registerAllHandlers(serve 同表)");
  assert.ok(ipc.includes('deps.emitter.send("import:done"'), "T: 成功后发 import:done(课程列表刷新链)");
  assert.ok(/flushDb\(\);\s*\n\s*return runImport\(importDshStateFromPath/.test(ipc), "T: 先落盘再备份(running app 内存是真相)");
});

test("接线:preload 三方法 + api-channels 三映射(web 模式同面)", () => {
  const preload = read("../src/preload/index.ts");
  assert.ok(preload.includes("dshImportDetect") && preload.includes("dshImportFromPath") && preload.includes("dshImportFromText"));
  const channels = read("../shared/api-channels.ts");
  assert.ok(channels.includes('dshImportDetect: "dsh:detect"'));
  assert.ok(channels.includes('dshImportFromText: "dsh:importFromText"'));
});

test("接线:设置页三路入口(探测一键/文件上传全平台)+ 结果/错误 testid", () => {
  const sv = read("../src/renderer/components/SettingsView.tsx");
  assert.ok(sv.includes('data-testid="settings-dsh-import"'));
  assert.ok(sv.includes("api.dshImportDetect()"), "T: 打开即探测");
  assert.ok(sv.includes("api.dshImportFromPath(detect.path"), "T: 探测到 → 一键导");
  assert.ok(sv.includes('type="file"') && sv.includes("api.dshImportFromText(text)"), "T: input type=file → 文本通道(web/手机同路)");
  assert.ok(sv.includes('data-testid="settings-dsh-result"') && sv.includes('data-testid="settings-dsh-error"'));
});

test("接线:i18n 双语 + shared types(DshImportSummary/ApiExpose 三方法)", () => {
  const i18n = read("../src/renderer/lib/i18n.ts");
  for (const key of ["settings.group.data", "settings.dsh.title", "settings.dsh.detectFound", "settings.dsh.pickFile", "settings.dsh.done"]) {
    assert.equal(i18n.split(`"${key}"`).length - 1, 2, `T: ${key} zh/en 双册`);
  }
  const types = read("../shared/types.ts");
  assert.ok(types.includes("dshImportFromText(jsonText: string): Promise<DshImportSummary>"));
  assert.ok(types.includes("export interface DshImportSummary"));
});

test("ui-test:dsh 导入端到端断言在场", () => {
  const idx = read("../src/main/index.ts");
  assert.ok(idx.includes("dsh-import:"), "T: ui-test 套件标记");
  assert.ok(idx.includes("dshImportFromText"), "T: 真 IPC 通道被测");
});

console.log(`\n${passed} passed`);
void DSH_STATE_VERSION_SUPPORTED;
