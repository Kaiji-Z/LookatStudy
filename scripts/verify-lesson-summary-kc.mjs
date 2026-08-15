/**
 * 首次点击节点球的一次性"摘要+KC"生成验证。
 *
 * 设计：generateLessonSummary（懒生成,首次点击触发）一次 LLM 调用同时产出
 * 1-2 句摘要 + 3-7 个知识组件，两字段都写库落盘（不是内存缓存），
 * 之后读取纯命中 DB 永不再调 LLM（省 token）。
 *
 * 本文件测纯函数 parser（LLM 返回 → {summary, knowledgePoints}）的确定性规则；
 * 端到端（真 LLM 落库）在 live-test-local-import 里验证。
 *
 * 跑法: npx tsx scripts/verify-lesson-summary-kc.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLessonSummaryKc } from "../src/main/services/course-structure-service.ts";

// ── T1: 合法 JSON（摘要 + KC）→ 双产出 ──
{
  const raw = JSON.stringify({
    summary: "本课介绍导数的定义与几何意义。",
    knowledgePoints: [
      { title: "导数定义", description: "理解差商极限如何定义瞬时变化率" },
      { title: "切线斜率", description: "理解导数与切线斜率的对应关系" },
      { title: "可导性", description: "理解连续与可导的关系" },
    ],
  });
  const parsed = parseLessonSummaryKc(raw);
  assert.equal(parsed?.summary, "本课介绍导数的定义与几何意义。", "T1: summary");
  assert.equal(parsed?.knowledgePoints?.length, 3, "T1: 3 个 KC");
  assert.equal(parsed?.knowledgePoints?.[0]?.title, "导数定义", "T1: KC title");
  console.log("✓ T1 合法 JSON: summary + knowledgePoints 双产出");
}

// ── T2: 带 markdown 代码围栏的 JSON → 剥围栏后解析 ──
{
  const raw = "```json\n" + JSON.stringify({
    summary: "积分入门。",
    knowledgePoints: [
      { title: "定积分", description: "理解曲边梯形面积" },
      { title: "原函数", description: "理解不定积分概念" },
    ],
  }) + "\n```";
  const parsed = parseLessonSummaryKc(raw);
  assert.equal(parsed?.summary, "积分入门。", "T2: 剥围栏");
  assert.equal(parsed?.knowledgePoints?.length, 2, "T2: KC");
  console.log("✓ T2 代码围栏: 剥掉后正常解析");
}

// ── T3: 纯文本（旧式 LLM 输出容错）→ 只当摘要，不产 KC ──
{
  const parsed = parseLessonSummaryKc("本课讲解线性代数中的行列式及其几何意义。");
  assert.equal(parsed?.summary, "本课讲解线性代数中的行列式及其几何意义。", "T3: 纯文本当摘要");
  assert.equal(parsed?.knowledgePoints, undefined, "T3: 无 KC（下次点击可重试补齐）");
  console.log("✓ T3 纯文本容错: 当摘要, KC 留空待重试");
}

// ── T4: 坏 JSON（以 { 开头但解析失败）→ 返回 null（不缓存垃圾,下次重试）──
{
  const parsed = parseLessonSummaryKc('{"summary": "断在中间');
  assert.equal(parsed, null, "T4: 坏 JSON → null");
  console.log("✓ T4 坏 JSON: null（不落垃圾,下次点击重试）");
}

// ── T5: KC 数量/格式校验：<2 个有效 KC → 丢弃 KC 只留摘要 ──
{
  const raw = JSON.stringify({
    summary: "很短的课。",
    knowledgePoints: [{ title: "唯一知识点", description: "" }],
  });
  const parsed = parseLessonSummaryKc(raw);
  assert.equal(parsed?.summary, "很短的课。", "T5: 摘要保留");
  assert.equal(parsed?.knowledgePoints, undefined, "T5: <2 有效 KC 丢弃");
  console.log("✓ T5 KC 校验: 不足 2 个有效 KC → 只留摘要");
}

// ── T6: KC 超 7 个截断 + 空 title 过滤 ──
{
  const kps = Array.from({ length: 9 }, (_, i) => ({
    title: i === 0 ? "  " : `知识点${i}`, // 第一个空 title 应被过滤
    description: "描述",
  }));
  const raw = JSON.stringify({ summary: "多 KC 课。", knowledgePoints: kps });
  const parsed = parseLessonSummaryKc(raw);
  assert.equal(parsed?.knowledgePoints?.length, 7, `T6: 过滤空 title 后截断到 7, 实际 ${parsed?.knowledgePoints?.length}`);
  assert.ok(parsed?.knowledgePoints?.every((k) => k.title.trim()), "T6: 无空 title");
  console.log("✓ T6 KC 边界: 空 title 过滤 + 上限 7 截断");
}

// ── T7: 空/白输出 → null ──
{
  assert.equal(parseLessonSummaryKc(""), null, "T7: 空串");
  assert.equal(parseLessonSummaryKc("```json\n```"), null, "T7: 空围栏");
  console.log("✓ T7 空输出: null");
}


// ── T8: 双语摘要——summaryEn 存在且非空 → 解析保留(去空白) ──
{
  const raw = JSON.stringify({
    summary: "本课介绍 BKT 掌握度模型。",
    summaryEn: "  This lesson introduces the BKT mastery model.  ",
    knowledgePoints: [
      { title: "BKT", description: "理解贝叶斯知识追踪" },
      { title: "掌握度", description: "理解估计与更新的关系" },
    ],
  });
  const parsed = parseLessonSummaryKc(raw);
  assert.equal(parsed?.summaryEn, "This lesson introduces the BKT mastery model.", "T8: summaryEn trim");
  console.log("✓ T8 双语摘要: summaryEn 保留并去空白");
}

// ── T9: 双语摘要——summaryEn 缺失/空串 → undefined(旧输出向后兼容,不落空值) ──
{
  const a = parseLessonSummaryKc(JSON.stringify({ summary: "旧式输出。" }));
  assert.equal(a?.summaryEn, undefined, "T9a: 无 summaryEn 字段");
  const b = parseLessonSummaryKc(JSON.stringify({ summary: "空英文。", summaryEn: "   " }));
  assert.equal(b?.summaryEn, undefined, "T9b: 空白 summaryEn");
  console.log("✓ T9 向后兼容: 缺失/空白 summaryEn → undefined");
}

// ── T10: 生成提示词要求双语(静态断言,防漂移) + 补齐函数存在 ──
{
  const src = readFileSync(new URL("../src/main/services/course-structure-service.ts", import.meta.url), "utf8");
  assert.ok(src.includes('"summary": "1-2 句中文摘要", "summaryEn": "1-2 sentence English summary"'), "T10: 单课 prompt 要求双语");
  assert.ok(src.includes("export async function generateLessonSummaryEn"), "T10: 历史节点英文补齐函数存在");
  assert.ok(src.includes("updateSet.summaryEn = parsed.summaryEn"), "T10: 单课写库带 summaryEn");
  console.log("✓ T10 提示词双语 + 补齐函数(静态扫描)");
}

// ── T11: 种子课程英文摘要齐备(6章+18课,防再生成时遗漏) ──
{
  const seed = JSON.parse(readFileSync(new URL("../src/main/assets/seed-course.json", import.meta.url), "utf8"));
  const need = seed.nodes.filter((n) => n.type === "section" || n.type === "lesson");
  assert.ok(need.length === 24, `T11: 应 24 个节点(6章+18课), 实际 ${need.length}`);
  const missing = need.filter((n) => !n.summaryEn || !String(n.summaryEn).trim());
  assert.equal(missing.length, 0, `T11: 缺 summaryEn 的节点: ${JSON.stringify(missing.map((n) => n.id))}`);
  console.log("✓ T11 种子英文摘要: 24/24 齐备");
}

console.log("\n=== ALL LESSON SUMMARY KC TESTS PASSED ✅ ===");
