/**
 * verify-voice-append —— 续录拼接纯函数守卫(issue #20)。
 *
 * T1 空侧守卫:任一侧为空返回另一侧原样(空段不吞已有文本——续录段转出
 *    空字符串时,复查浮层里手改过的文本不能被清掉)。
 * T2 CJK 直接拼接:中文+中文、中文结尾接拉丁开头、拉丁结尾接中文开头。
 * T3 拉丁补空格:两侧都是拉丁词,中间恰好一个空格。
 * T4 前段尾部空白/换行:直接拼接,不叠加空格。
 * T5 后段标点开头:逗号句号贴前句,不加空格。
 * T6 病态输入:超长、emoji、代理对结尾不崩,返回包含两侧内容。
 * T7 幂等性:同段重复追加结果一致(纯函数,无隐藏状态)。
 * T8 源级接线守卫:ChatComposer 的 appendNextRef 消费/window 级释放监听/
 *    VoicePanel 继续说按钮/错误重试不吞文本——GUI 端到端在 ui-test 受假设备
 *    音频限制(正弦音转不出成功文本,续录环节 best-effort),接线靠源码守卫锁。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appendTranscript } from "../shared/voice-append.ts";

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
};

console.log("verify-voice-append");

t("T1 空侧守卫", () => {
  assert.equal(appendTranscript("", "你好"), "你好");
  assert.equal(appendTranscript("你好", ""), "你好");
  assert.equal(appendTranscript("", ""), "");
});

t("T2 CJK 直接拼接", () => {
  assert.equal(appendTranscript("我想学", "递归"), "我想学递归");
  assert.equal(appendTranscript("什么是", "BKT 算法"), "什么是BKT 算法");
  assert.equal(appendTranscript("什么是 BKT", "算法"), "什么是 BKT算法");
  // 全角标点结尾同 CJK 处理
  assert.equal(appendTranscript("第一步，", "然后第二步"), "第一步，然后第二步");
});

t("T3 拉丁补空格", () => {
  assert.equal(appendTranscript("hello world", "again"), "hello world again");
  assert.equal(appendTranscript("foo", "bar"), "foo bar");
});

t("T4 前段尾部空白/换行", () => {
  assert.equal(appendTranscript("你好\n", "第二句"), "你好\n第二句");
  assert.equal(appendTranscript("hello ", "world"), "hello world");
});

t("T5 后段标点开头", () => {
  assert.equal(appendTranscript("我想学递归", "，应该从哪开始"), "我想学递归，应该从哪开始");
  assert.equal(appendTranscript("what is bkt", ", exactly"), "what is bkt, exactly");
});

t("T6 病态输入", () => {
  const long = "很".repeat(10000);
  const r = appendTranscript(long, "尾部");
  assert.equal(r.length, long.length + 2);
  // emoji(代理对)结尾:不崩,内容不丢
  const r2 = appendTranscript("看这个🐱", "可爱吗");
  assert.ok(r2.includes("🐱") && r2.includes("可爱吗"));
});

t("T7 幂等性", () => {
  const once = appendTranscript("我想学", "递归");
  assert.equal(appendTranscript(once, ""), once);
});

t("T8 源级接线守卫", () => {
  const composer = read("src/renderer/components/ChatComposer.tsx");
  assert.ok(composer.includes("appendTranscript(prev, text)"), "T8 onFinal 走追加拼接");
  assert.ok(composer.includes("appendNextRef.current = true"), "T8 继续说按下置位追加档");
  // window 级释放:按钮随视图切换卸载后元素级 pointerup 收不到——这是本接线的关键约束
  assert.ok(
    composer.includes('window.addEventListener("pointerup", end)') &&
      composer.includes('window.addEventListener("pointercancel", end)'),
    "T8 释放监听挂 window(pointerup+pointercancel)",
  );
  assert.ok(composer.includes("onDismissError={dismissVoiceError}"), "T8 错误重试走 dismiss(不吞文本)");
  const panel = read("src/renderer/components/VoicePanel.tsx");
  assert.ok(panel.includes('data-testid="voice-continue-btn"'), "T8 复查浮层渲染继续说按钮");
  assert.ok(panel.includes("onPointerDown"), "T8 继续说按住语义(pointerdown 起录)");
});

console.log(`verify-voice-append: ${passed}/8 通过`);
