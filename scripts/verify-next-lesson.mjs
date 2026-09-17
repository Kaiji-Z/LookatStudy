/**
 * verify-next-lesson —— 课程推进边界卡(v0.37)确定性测试。
 *
 * 设计(用户拍板 2026-09-17):一课掌握毕业(!wasMastered 过渡)→ 对话区出边界卡
 * →点「开始下一课」:伴学飞左栏下一颗球旁指向 + 球加虚线环(常驻到点球),
 * T3 先切屏到左栏;**用户自己点球进入**——bot 指路、用户开车,不自动切节点。
 * 排序权在系统(shared/next-lesson 纯函数),agent 不参与;最后一课 → 终点态卡。
 *
 * T1 nextLessonAfter 纯函数矩阵(同段顺延/跨段/空段跳过/终点/异树)
 * T2 主进程双过渡点发 lesson:mastered(proposal:apply + quiz:recordAnswer)
 * T3 渲染层接线:事件类型声明 + App 订阅 + 边界卡 + 指路编排(切栏三连+吹哨+指向)
 * T4 MapRail 虚线环(next-cue 类) + index.css 环样式
 * T5 i18n 双语键
 * T6 verify:core 链注册自检
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextLessonAfter } from "../shared/next-lesson.ts";

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf("/"));
const read = (p) => readFileSync(new URL(p, here + "/"), "utf8");
const ipcSrc = read("../src/main/ipc/index.ts");
const typesSrc = read("../shared/types.ts");
const appSrc = read("../src/renderer/App.tsx");
const railSrc = read("../src/renderer/components/MapRail.tsx");
const cssSrc = read("../src/renderer/index.css");
const i18nSrc = read("../src/renderer/lib/i18n.ts");
const pkg = JSON.parse(read("../package.json"));

// ---------------------------------------------------------------- T1 纯函数
{
  const mk = (id, type, parentId, orderIdx) => ({ id, type, parentId, orderIdx });
  // 两段各两课: S1[L1,L2] S2[L3,L4]
  const tree = [
    mk("s1", "section", null, 0), mk("s2", "section", null, 1),
    mk("l1", "lesson", "s1", 0), mk("l2", "lesson", "s1", 1),
    mk("l3", "lesson", "s2", 0), mk("l4", "lesson", "s2", 1),
  ];
  assert.equal(nextLessonAfter(tree, "l1").id, "l2", "T1 同段顺延");
  assert.equal(nextLessonAfter(tree, "l2").id, "l3", "T1 段末接下一段首课");
  assert.equal(nextLessonAfter(tree, "l4"), null, "T1 最后一课=终点态");
  assert.equal(nextLessonAfter(tree, "ghost"), null, "T1 异树/不存在节点不出卡");
  assert.equal(nextLessonAfter(tree, "s1"), null, "T1 section 不是完成主体");
  // 空段跳过:s2 无课,s3 有课
  const gap = [
    mk("s1", "section", null, 0), mk("s2", "section", null, 1), mk("s3", "section", null, 2),
    mk("l1", "lesson", "s1", 0), mk("l9", "lesson", "s3", 0),
  ];
  assert.equal(nextLessonAfter(gap, "l1").id, "l9", "T1 空段跳过,接下一段有课的");
  // 单课课程
  assert.equal(nextLessonAfter([mk("s1", "section", null, 0), mk("only", "lesson", "s1", 0)], "only"), null, "T1 单课即终点");
  // orderIdx 乱序输入(树排序不保证传入序)
  const shuffled = [...tree].reverse();
  assert.equal(nextLessonAfter(shuffled, "l2").id, "l3", "T1 排序不依赖传入顺序");
  console.log("T1 nextLessonAfter 纯函数矩阵✓");
}

// ---------------------------------------------------------------- T2 主进程双过渡点
{
  const applyBlock = ipcSrc.slice(ipcSrc.indexOf("handle(\"proposal:apply\""), ipcSrc.indexOf("handle(\"proposal:reject\""));
  assert.ok(
    applyBlock.includes('"lesson:mastered"'),
    "T2 proposal:apply 的 mark_mastered 首次毕业要发 lesson:mastered",
  );
  const quizBlock = ipcSrc.slice(ipcSrc.indexOf("handle(\"quiz:recordAnswer\""), ipcSrc.indexOf("/* ---------- 仪表盘"));
  assert.ok(
    quizBlock.includes('"lesson:mastered"'),
    "T2 quiz:recordAnswer 的毕业过渡要发 lesson:mastered",
  );
  console.log("T2 主进程双过渡点发事件✓");
}

// ---------------------------------------------------------------- T3 渲染层接线
{
  assert.ok(typesSrc.includes('"lesson:mastered"'), "T3 IpcEvents 声明事件(preload on() 泛型通道)");
  assert.ok(appSrc.includes('api.on("lesson:mastered"'), "T3 App 订阅毕业事件");
  assert.ok(appSrc.includes("nextLessonAfter"), "T3 App 用系统排序真源,不让 LLM 排序");
  // 指路编排:切栏三连(handleBootPickCourse 同款活路,不走 setView 死线)+ 吹哨 + 指向
  const cueBlock = appSrc.slice(appSrc.indexOf("lesson:mastered"), appSrc.indexOf("lesson:mastered") + 2500);
  assert.ok(cueBlock.includes('setT2Side("rail")'), "T3 T2 强制左栏");
  assert.ok(cueBlock.includes("setLeftPaneVisible(true)"), "T3 左栏可见");
  assert.ok(cueBlock.includes('setT3Pane("rail")'), "T3 手机切屏到左栏");
  assert.ok(cueBlock.includes("companionWhistle("), "T3 伴学吹哨飞往下一球");
  assert.ok(cueBlock.includes("companionNodePoint("), "T3 指向表情");
  assert.ok(appSrc.includes("data-testid=\"next-lesson-card\""), "T3 边界卡挂载");
  assert.ok(appSrc.includes("终点"), "T3 终点态卡分支(最后一课)");
  console.log("T3 渲染层接线(事件+卡+指路编排)✓");
}

// ---------------------------------------------------------------- T4 虚线环
{
  assert.ok(railSrc.includes("nextCueNodeId"), "T4 MapRail 收 cue prop");
  assert.ok(railSrc.includes("next-cue"), "T4 球元素挂 next-cue 类(环随球走,物理零耦合)");
  assert.ok(cssSrc.includes(".lesson-bubble.next-cue"), "T4 环样式在 index.css");
  assert.ok(cssSrc.includes("next-cue-pulse"), "T4 环呼吸动画");
  assert.ok(cssSrc.includes("dashed"), "T4 虚线环(用户拍板的视觉语汇)");
  console.log("T4 虚线环✓");
}

// ---------------------------------------------------------------- T5 i18n
{
  const keys = ["lesson.next.title", "lesson.next.button", "lesson.next.terminal", "lesson.next.guide"];
  for (const k of keys) {
    const hits = (i18nSrc.match(new RegExp(k.replace(/\./g, "\\.") + '"', "g")) ?? []).length;
    assert.ok(hits >= 2, `T5 双语键齐: ${k}`);
  }
  console.log("T5 i18n 双语键✓");
}

// ---------------------------------------------------------------- T6 链注册
{
  assert.ok(pkg.scripts["verify:core"].includes("verify-next-lesson"), "T6 verify:core 链含本套件");
  console.log("T6 verify:core 链注册✓");
}

console.log("verify-next-lesson 全部通过 ✓");
