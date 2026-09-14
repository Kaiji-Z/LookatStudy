/**
 * verify-boot-quiz.mjs —— 试玩题库验证(boot-quiz.ts)。
 *
 * 覆盖(SPEC §5):题库结构(双语完整/id 唯一/≥5 道);确定性轮换
 * (同日期同题、不同日期覆盖多题、任意字符串稳定)。
 *
 * 跑法: npx tsx scripts/verify-boot-quiz.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import {
  BOOT_QUIZ_BANK,
  pickBootQuiz,
  quizIndexForDate,
} from "../shared/boot-quiz.ts";

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

test("T1 题库 ≥5 道且 id 唯一", () => {
  assert.ok(BOOT_QUIZ_BANK.length >= 5);
  assert.equal(new Set(BOOT_QUIZ_BANK.map((q) => q.id)).size, BOOT_QUIZ_BANK.length);
});

test("T2 每题双语完整:q/a/b/revealA/revealB 非空", () => {
  for (const item of BOOT_QUIZ_BANK) {
    for (const locale of ["zh", "en"]) {
      const q = item[locale];
      for (const field of ["q", "a", "b", "revealA", "revealB"]) {
        assert.ok(typeof q[field] === "string" && q[field].length > 0, `${item.id}.${locale}.${field} 非空`);
      }
    }
  }
});

test("T3 选项 a≠b(文字与语义都应可区分)", () => {
  for (const item of BOOT_QUIZ_BANK) {
    assert.notEqual(item.zh.a, item.zh.b, `${item.id} zh 选项重复`);
    assert.notEqual(item.en.a, item.en.b, `${item.id} en 选项重复`);
  }
});

test("T4 确定性:同日期多次取题一致", () => {
  for (const d of ["2026-09-15", "2026-01-01", "1999-12-31"]) {
    assert.equal(pickBootQuiz(d, "zh-CN").id, pickBootQuiz(d, "zh-CN").id);
  }
});

test("T5 覆盖性:一年 365 天至少命中 60% 的题(轮换真正生效)", () => {
  const seen = new Set();
  for (let i = 0; i < 365; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    seen.add(quizIndexForDate(d, BOOT_QUIZ_BANK.length));
  }
  assert.ok(seen.size >= Math.ceil(BOOT_QUIZ_BANK.length * 0.6), `命中 ${seen.size}/${BOOT_QUIZ_BANK.length}`);
});

test("T6 quizIndexForDate 稳定且在界内(任意字符串不炸)", () => {
  for (const s of ["", "x", "2026-09-15", "🔥emoji", String(Number.MAX_SAFE_INTEGER)]) {
    const idx = quizIndexForDate(s, 6);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < 6, `${JSON.stringify(s)} → ${idx}`);
  }
  assert.equal(quizIndexForDate("2026-09-15", 6), quizIndexForDate("2026-09-15", 6));
});

test("T6b 确定性跨时间:同输入在 >2ms 前后重算结果一致(防 Date.now 类种子混入)", () => {
  const a = quizIndexForDate("2026-09-15", BOOT_QUIZ_BANK.length);
  const t0 = Date.now();
  while (Date.now() - t0 < 3) { /* busy-wait: 跨过至少一个毫秒刻度 */ }
  const b = quizIndexForDate("2026-09-15", BOOT_QUIZ_BANK.length);
  assert.equal(a, b);
});

test("T7 locale 取词:zh 取中文题,en 取英文题", () => {
  const zh = pickBootQuiz("2026-09-15", "zh-CN");
  const en = pickBootQuiz("2026-09-15", "en");
  assert.equal(zh.id, en.id, "同日期同题不同语言");
  assert.notEqual(zh.q, en.q);
});

/* ---------- 学习 tips 库(未选课态右栏兜底卡) ---------- */
import { BOOT_TIPS, pickBootTip } from "../shared/boot-tips.ts";

test("T10 tips 库 ≥8 条且 id 唯一、双语非空", () => {
  assert.ok(BOOT_TIPS.length >= 8);
  assert.equal(new Set(BOOT_TIPS.map((x) => x.id)).size, BOOT_TIPS.length);
  for (const tipItem of BOOT_TIPS) {
    assert.ok(tipItem.zh && tipItem.zh.length > 5, `${tipItem.id}.zh`);
    assert.ok(tipItem.en && tipItem.en.length > 5, `${tipItem.id}.en`);
  }
});

test("T11 pickBootTip 确定性 + 双语取词 + 界内", () => {
  const a = pickBootTip("2026-09-15", "zh-CN");
  const b = pickBootTip("2026-09-15", "zh-CN");
  assert.equal(a.id, b.id);
  assert.equal(a.text, b.text);
  const en = pickBootTip("2026-09-15", "en");
  assert.equal(en.id, a.id);
  const ids = new Set(BOOT_TIPS.map((x) => x.id));
  assert.ok(ids.has(a.id));
});

test("T12 tips 轮换覆盖:一年至少命中 60% 条目", () => {
  const seen = new Set();
  for (let i = 0; i < 365; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    seen.add(pickBootTip(d, "zh-CN").id);
  }
  assert.ok(seen.size >= Math.ceil(BOOT_TIPS.length * 0.6), `命中 ${seen.size}/${BOOT_TIPS.length}`);
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error("FAILED");
