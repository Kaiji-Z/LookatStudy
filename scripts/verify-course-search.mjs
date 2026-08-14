/**
 * 课程树搜索纯函数验证 —— course-tree-filter.ts。
 *
 * 覆盖:分组排序 / 考试解锁条件 / 多关键词 AND 过滤(章节命中→整章)
 * / 大小写与中文子串 / 高亮区间 / 搜索行锁定规则(与地图球一致)。
 */
import assert from "node:assert/strict";
import {
  buildCourseTree,
  filterCourseTree,
  findMatchRange,
  isSearchRowLocked,
} from "../src/renderer/lib/course-tree-filter.ts";

const TESTS = [];

/** 造一个最小课程:2 章(第 2 章是实操世界),章 1 = 3 课 + 1 考试,章 2 = 2 课。 */
function fixture() {
  const sec1 = { id: "s1", courseId: "c", parentId: null, type: "section", title: "快速上手", sourcePath: null, orderIdx: 1, world: "study" };
  const sec2 = { id: "s2", courseId: "c", parentId: null, type: "section", title: "Practice World", sourcePath: null, orderIdx: 0, world: "practice" };
  const les = (id, parentId, title, orderIdx) => ({
    id, courseId: "c", parentId, type: "lesson", title, sourcePath: null, orderIdx, world: "study",
  });
  const exam1 = { id: "e1", courseId: "c", parentId: "s1", type: "exam", title: "第一章测验", sourcePath: null, orderIdx: 99, world: "study" };
  const tree = [
    sec1, sec2,
    les("l1-3", "s1", "三栏布局导览", 2),
    les("l1-1", "s1", "欢迎使用 LookatStudy", 0),
    les("l1-2", "s1", "导入你的第一个课程", 1),
    exam1,
    les("l2-1", "s2", "Hello REPL", 0),
    les("l2-2", "s2", "hello cli", 1),
  ];
  return { sections: [sec1, sec2], tree };
}

TESTS.push({
  name: "buildCourseTree: 章节/课时按 orderIdx 排序,考试也是章内节点",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    assert.equal(rows.length, 2);
    assert.equal(rows[0].section.id, "s2"); // orderIdx 0 在前
    assert.equal(rows[1].section.id, "s1");
    assert.deepEqual(rows[1].lessons.map((l) => l.id), ["l1-1", "l1-2", "l1-3", "e1"]);
  },
});

TESTS.push({
  name: "buildCourseTree: 考试解锁 = 章内所有 lesson mastery ≥ 0.5(缺一不可,零课=锁)",
  fn: () => {
    const { sections, tree } = fixture();
    const mk = (m1, m2, m3) => ({
      "l1-1": { mastery: m1 }, "l1-2": { mastery: m2 }, "l1-3": { mastery: m3 },
    });
    assert.equal(buildCourseTree(sections, tree, mk(1, 0.9, 0.5))[1].chapterLessonsMastered, true);
    assert.equal(buildCourseTree(sections, tree, mk(1, 0.9, 0.49))[1].chapterLessonsMastered, false);
    assert.equal(buildCourseTree(sections, tree, mk(1, 0.9, 0.5))[0].chapterLessonsMastered, false); // s2 无课
    // mastery 缺失(无 progress 行)按 0 计
    assert.equal(buildCourseTree(sections, tree, mk(1, 0.9, 0.5, ))[1].chapterLessonsMastered, true);
    assert.equal(buildCourseTree(sections, tree, { "l1-1": { mastery: 1 } })[1].chapterLessonsMastered, false);
  },
});

TESTS.push({
  name: "filterCourseTree: 空查询原样返回(树状导航模式)",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    assert.equal(filterCourseTree(rows, ""), rows);
    assert.equal(filterCourseTree(rows, "   "), rows);
  },
});

TESTS.push({
  name: "filterCourseTree: 课时标题命中(大小写不敏感 + 中文子串)",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    const hit = filterCourseTree(rows, "导入");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].section.id, "s1");
    assert.deepEqual(hit[0].lessons.map((l) => l.id), ["l1-2"]);
    // 大小写:hello 命中 s2 的两课(Hello REPL / hello cli)
    const hit2 = filterCourseTree(rows, "hello");
    assert.equal(hit2.length, 1);
    assert.deepEqual(hit2[0].lessons.map((l) => l.id), ["l2-1", "l2-2"]);
  },
});

TESTS.push({
  name: "filterCourseTree: 多关键词 AND(与 searchContent 语义一致)",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    assert.deepEqual(
      filterCourseTree(rows, "hello cli")[0].lessons.map((l) => l.id),
      ["l2-2"],
    );
    assert.equal(filterCourseTree(rows, "hello 导入").length, 0); // 没有任何标题同时含两词
    assert.equal(filterCourseTree(rows, "hello 不存在").length, 0);
  },
});

TESTS.push({
  name: "filterCourseTree: 章节标题命中 → 整章保留(全部课时)",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    const hit = filterCourseTree(rows, "快速上手");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].section.id, "s1");
    assert.equal(hit[0].lessons.length, 4); // 3 课 + 考试全保留
    // 命中的章即使再无课时命中也不裁剪;返回的是原 row(引用相等)
    assert.equal(hit[0], rows[1]);
  },
});

TESTS.push({
  name: "filterCourseTree: 不命中任何标题 → 空数组(渲染 noResults)",
  fn: () => {
    const { sections, tree } = fixture();
    const rows = buildCourseTree(sections, tree, {});
    assert.deepEqual(filterCourseTree(rows, "zzz不存在的词"), []);
  },
});

TESTS.push({
  name: "findMatchRange: 首词命中区间(高亮用),大小写不敏感,未命中/空 → null",
  fn: () => {
    assert.deepEqual(findMatchRange("Hello REPL", "hello"), [0, 5]);
    assert.deepEqual(findMatchRange("导入你的第一个课程", "导入"), [0, 2]);
    assert.deepEqual(findMatchRange("abcDEF", "cde"), [2, 5]);
    assert.equal(findMatchRange("Hello", "zzz"), null);
    assert.equal(findMatchRange("Hello", ""), null);
    assert.equal(findMatchRange("Hello", "   "), null);
    // 多词取首词
    assert.deepEqual(findMatchRange("Hello REPL", "repl hello"), [6, 10]);
  },
});

TESTS.push({
  name: "isSearchRowLocked: 考试看整章通关,普通课看 status(与 MapNode 同规则)",
  fn: () => {
    const pm = { "l1-1": { status: "mastered" }, "l1-2": { status: "locked" }, "l1-3": { status: "available" } };
    const les1 = { id: "l1-1", type: "lesson" };
    const les2 = { id: "l1-2", type: "lesson" };
    const les3 = { id: "l1-3", type: "lesson" };
    const lesNoProgress = { id: "l9-9", type: "lesson" };
    const exam = { id: "e1", type: "exam" };
    assert.equal(isSearchRowLocked(les1, pm, false), false);
    assert.equal(isSearchRowLocked(les2, pm, true), true);
    assert.equal(isSearchRowLocked(les3, pm, false), false);
    assert.equal(isSearchRowLocked(lesNoProgress, pm, false), true); // 无 progress 行 = 锁
    assert.equal(isSearchRowLocked(exam, pm, false), true); // 章未通关 → 考试锁
    assert.equal(isSearchRowLocked(exam, pm, true), false); // 章通关 → 考试开
  },
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 课程树搜索: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
