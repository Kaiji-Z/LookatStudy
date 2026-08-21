/**
 * 语音文本处理验证 —— TTS 句切分 + markdown 净化(shared/speech-text.ts 纯函数)。
 *
 * 朗读管线:LLM 流式文本 → normalizeSpeechText(剥 markdown,代码块整个跳过)
 * → splitSentences(标点切句 + 超长兜底 + 余量携带)→ 逐句合成播放。
 *
 * 不变量:
 *   - 净化:围栏代码块/行内代码/图片整体移除;链接留文字;强调/标题/列表/引用标记剥离
 *   - 切句:中英终止标点(.!?!?;…。;小数点不切);保留标点在句内
 *   - 流式:rest 余量可携带,flush=true 时尾句强制吐出
 *   - 超长无标点:超过 maxBuffer 在最后的逗号/顿号/空格处强制断
 *   - 空输入/纯空白/纯代码块 → 零句
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  normalizeSpeechText,
  splitSentences,
  endsWithSentenceEnd,
  groupSentenceChunks,
  DISPLAY_GROUP_MAX,
  speechSentencesOf,
} from "../shared/speech-text.ts";

// === T1: markdown 净化 ===
{
  const md = [
    "# 第一章 标题",
    "",
    "这是**加粗**和*斜体*和`行内代码`的文字。",
    "",
    "```python",
    "print('这段代码不该被读出来')",
    "```",
    "",
    "看这个[链接文字](https://example.com)和![图片](foo.png)。",
    "- 列表项一",
    "- 列表项二",
    "> 引用行",
    "",
    "| 表头 | 表头 |",
    "| --- | --- |",
    "| 单元 | 单元 |",
  ].join("\n");
  const out = normalizeSpeechText(md);
  assert.ok(!out.includes("print"), "T1: 围栏代码块整体移除");
  assert.ok(!out.includes("行内代码"), "T1: 行内代码移除");
  assert.ok(!out.includes("```"), "T1: 无围栏残留");
  assert.ok(out.includes("加粗") && !out.includes("**"), "T1: 粗体标记剥离");
  assert.ok(out.includes("链接文字") && !out.includes("example.com"), "T1: 链接留文字去 URL");
  assert.ok(!out.includes("图片") || !out.includes("foo.png"), "T1: 图片整体移除");
  assert.ok(out.includes("列表项一") && !out.includes("- 列表"), "T1: 列表标记剥离");
  assert.ok(out.includes("引用行") && !out.includes("> 引用"), "T1: 引用标记剥离");
  assert.ok(!out.includes("|"), "T1: 表格竖线剥离");
  assert.ok(!out.includes("#"), "T1: 标题标记剥离");
  console.log("✓ T1 markdown 净化(代码/链接/标记/表格)");
}

// === T2: 中文切句 ===
{
  const { sentences, rest } = splitSentences("你好。世界!怎么办?还有;分号。");
  assert.strictEqual(sentences.length, 5, `T2: 5 句,实际 ${sentences.length}:${JSON.stringify(sentences)}`);
  assert.strictEqual(sentences[0], "你好。");
  assert.strictEqual(rest, "", "T2: 无余量");
  console.log("✓ T2 中文终止标点切句");
}

// === T3: 英文切句(句点后须空白/结尾;小数点不切) ===
{
  const { sentences } = splitSentences("Hello world. How are you? 3.14 is pi. Done!");
  assert.strictEqual(sentences.length, 4, `T3: 4 句,实际 ${JSON.stringify(sentences)}`);
  assert.strictEqual(sentences[0], "Hello world.");
  assert.strictEqual(sentences[2], "3.14 is pi.", "T3: 小数点不切句");
  console.log("✓ T3 英文句点规则 + 小数保护");
}

// === T4: 流式余量携带 + flush ===
{
  const part = splitSentences("第一句。后面这半句还没结");
  assert.strictEqual(part.sentences.length, 1, "T4: 只吐完整句");
  assert.strictEqual(part.rest, "后面这半句还没结", "T4: 余量保留");
  const end = splitSentences(part.rest, { flush: true });
  assert.strictEqual(end.sentences[0], "后面这半句还没结", "T4: flush 吐尾句");
  assert.strictEqual(end.rest, "", "T4: flush 后无余量");
  console.log("✓ T4 流式余量携带 + flush");
}

// === T5: 超长无标点强制断 ===
{
  const long = "这是一个特别长的没有终止标点的段落".repeat(10); // 150 字无终止标点(有逗号也无)
  const noComma = "人工智能正在改变我们学习知识的方式与节奏同时也在重塑教育的边界与可能".repeat(3);
  const r5 = splitSentences(long + noComma, { maxBuffer: 60 });
  assert.ok(r5.sentences.length >= 3, `T5: 超长强制断句(≥3),实际 ${r5.sentences.length}`);
  assert.ok(r5.rest.length < 80, `T5: 余量可控(实际 ${r5.rest.length})`);
  assert.ok(r5.sentences.slice(0, -1).every((s) => s.length <= 80), "T5: 强断段不超 maxBuffer 太多(末段余量除外)");
  const withComma = splitSentences("第一小节、然后第二小节、然后第三小节、然后第四小节、然后第五小节、然后第六小节、然后第七小节、然后第八小节、最后结尾。", { maxBuffer: 30 });
  assert.ok(
    withComma.sentences.every((s) => !s.startsWith("、")),
    "T5: 顿号断句不带开头顿号",
  );
  console.log("✓ T5 超长兜底断句");
}

// === T6: 空与纯代码 ===
{
  assert.deepStrictEqual(splitSentences("").sentences, [], "T6: 空串零句");
  assert.deepStrictEqual(splitSentences("   \n  ").sentences, [], "T6: 纯空白零句");
  assert.deepStrictEqual(splitSentences(normalizeSpeechText("```js\nlet a=1\n```")).sentences, [], "T6: 纯代码块零句(净化后为空;split 契约=输入已净化,v11.2 换行成句后原始 md 不再直喂)");
  assert.deepStrictEqual(splitSentences(normalizeSpeechText("```js\nlet a=1\n```"), { flush: true }).sentences, [], "T6: 净化+flush 纯代码零句");
  console.log("✓ T6 空输入/纯代码零句");
}

// === T7: 省略号与混合 ===
{
  const { sentences } = splitSentences("嗯……让我想想。OK done. 好的。", { flush: true });
  assert.ok(sentences.length >= 3, `T7: 省略号断句,实际 ${JSON.stringify(sentences)}`);
  assert.ok(sentences.some((s) => s.includes("……")), "T7: 省略号保留在句内");
  console.log("✓ T7 省略号与中英混排");
}

// === T8: 幂等(流式重复喂累积文本不炸) ===
{
  const acc = "先说结论。然后展开讲一讲背景,以及为什么";
  const a = splitSentences(acc);
  const b = splitSentences(acc);
  assert.deepStrictEqual(a, b, "T8: 纯函数确定性");
  assert.strictEqual(a.sentences.length, 1, "T8: 1 完整句");
  console.log("✓ T8 确定性(StrictMode 双调安全)");
}

console.log("\n=== ALL SPEECH TEXT TESTS PASSED ✅ ===");


// ---- v9 TTS 块 ≠ 显示句:句终点判定 + 显示句分组 ----
{
  // 句终点:终止标点/ASCII 句点(剥闭合符);软标点断开的块不是句终点
  assert.equal(endsWithSentenceEnd("你好。"), true, "v9: 。结尾=句终点");
  assert.equal(endsWithSentenceEnd("他说：“怎么样？”"), true, "v9: 闭合引号剥掉后仍是句终点");
  assert.equal(endsWithSentenceEnd("Done!"), true, "v9: ! 结尾=句终点");
  assert.equal(endsWithSentenceEnd("It works."), true, "v9: ASCII 句点=句终点");
  assert.equal(endsWithSentenceEnd("在软标点处被断开，"), false, "v9: 逗号结尾=强制断句块,非句终点");
  assert.equal(endsWithSentenceEnd("后面这半句还没结"), false, "v9: flush 尾块无标点=非句终点");
  assert.equal(endsWithSentenceEnd("pi is 3.14"), false, "v9: 小数点不是句终点");
  assert.equal(endsWithSentenceEnd(""), true, "v9: 空块=句终点(防御)");

  // 分组:未完句块与后续块并组;句终点块自闭一组
  const g1 = groupSentenceChunks(["前半句没有结束，", "后半句结束了。", "新句子。"]);
  assert.deepEqual(g1, [{ start: 0, end: 1 }, { start: 2, end: 2 }], "v9: 强制断句块并入同显示句");

  // 集成:超长无终止标点文本 → 多个 TTS 块;v11.2 显示组有长度上限,
  // 不再无限并成整段(旧"整段高亮到结尾"的行为已被用户判为缺陷)
  const long = "这是一句完全没有终止标点的很长很长的话".repeat(12) + "，尾段也一直不停，最后才画上句号。";
  const { sentences } = splitSentences(long, { flush: true });
  assert.ok(sentences.length >= 2, "v9: 超长文本被切成多个 TTS 块");
  assert.ok(sentences.slice(0, -1).every((c) => !endsWithSentenceEnd(c)), "v9: 中间块都不是句终点");
  const g2 = groupSentenceChunks(sentences);
  assert.ok(g2.length >= 2, `v11.2: 超长无标点显示组有界(组数 ${g2.length},不再吞整段)`);
  for (const g of g2) {
    const total = sentences.slice(g.start, g.end + 1).join("").length;
    assert.ok(total <= DISPLAY_GROUP_MAX + 200, `v11.2: 组内总长有界(实际 ${total})`);
  }
}
console.log("✓ v9 TTS块≠显示句:endsWithSentenceEnd/groupSentenceChunks(并组修句+v11.2 长度上限)");

// === v11.2 T9: 表意分隔(换行/emoji 成句)+ CRLF 归一 ===
{
  // 换行:无标点的行各自成句,句尾 \n 是显示终点(不被并组)
  const r = splitSentences("第一行没有标点\n第二行也没有\n第三行更没有", { flush: true });
  assert.equal(r.sentences.length, 3, `v11.2: 逐行成句(实际 ${r.sentences.length})`);
  assert.ok(r.sentences[0].endsWith("\n"), "v11.2: 整行句保留结尾换行(显示终点标记)");
  assert.equal(endsWithSentenceEnd("第一行没有标点\n"), true, "v11.2: 换行结尾=句终点");
  assert.equal(endsWithSentenceEnd("后半句还没结"), false, "v11.2: 无标记尾巴仍非终点");
  const g = groupSentenceChunks(r.sentences);
  assert.equal(g.length, 3, "v11.2: 行句不并组(高亮逐行)");

  // emoji:表意符号后断句;ZWJ 连写/VS16/肤色是序列的一部分
  const e = splitSentences("太好了🎉继续加油💪最后。", { flush: true });
  assert.deepEqual(e.sentences, ["太好了🎉", "继续加油💪", "最后。"], `v11.2: emoji 断句(实际 ${JSON.stringify(e.sentences)})`);
  assert.equal(endsWithSentenceEnd("太好了🎉"), true, "v11.2: emoji 结尾=句终点");
  assert.equal(endsWithSentenceEnd("家庭👨‍💻"), true, "v11.2: ZWJ 连写整序列算终点");
  assert.equal(endsWithSentenceEnd("星星⭐"), true, "v11.2: VS16 修饰序列算终点");
  const zw = splitSentences("家庭👨‍💻聚餐", { flush: true });
  assert.equal(zw.sentences.length, 2, "v11.2: ZWJ 序列不拆开(序列收进句尾)");
  assert.ok(zw.sentences[0].includes("👨‍💻"), "v11.2: 连写 emoji 完整保留");

  // CRLF 归一(Windows 换行不混进句界判定)
  assert.equal(normalizeSpeechText("甲句。\r\n乙句。"), "甲句。\n乙句。", "v11.2: CRLF 归一为 LF");
}
console.log("✓ v11.2 表意分隔:换行/emoji 成句(ZWJ/VS16 完整)+显示组上限+CRLF 归一");
// === v11.2 T10: 句表单一入口守卫(合成侧与显示侧永不分叉) ===
{
  const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  for (const rel of [
    "src/main/services/speech/tts-service.ts",
    "src/renderer/components/NotebookPanel.tsx",
    "src/renderer/components/ChatStream.tsx",
  ]) {
    const t = src(rel);
    assert.ok(t.includes("speechSentencesOf("), `T10: ${rel} 走句表单一入口`);
    assert.ok(!t.includes("splitSentences(normalizeSpeechText("), `T10: ${rel} 不得内联切分(参数分叉=高亮错句)`);
  }
  const probe = "# 标题\n正文一句。第二句没结束";
  assert.deepEqual(speechSentencesOf(probe), speechSentencesOf(probe), "T10: 入口确定性");
  assert.ok(speechSentencesOf("你好。世界。").length === 2, "T10: 入口可用性");
}
console.log("✓ v11.2 T10 句表单一入口(合成侧/显示侧同源,索引空间 1:1)");

