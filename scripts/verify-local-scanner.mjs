/**
 * 本地文件夹扫描器验证 —— 测 local-folder-scanner.ts 的纯函数 + scanFolder。
 *
 * 不变量:
 *   - htmlToText: 去 script/style/标签,<li>→•,decode 实体
 *   - inferTitle: 去数字前缀/扩展名/语言后缀
 *   - dedupKey + dedupByLang: 中文优先(zh > en > other)
 *   - scanFolder: 递归收 txt/md/html,排除 node_modules,按路径排序
 */
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  htmlToText,
  inferTitle,
  dedupKey,
  dedupByLang,
  detectLang,
  scanFolder,
} from "../src/main/services/pure/local-folder-scanner.ts";

// === T1: htmlToText 去标签 + <li> 转 • ===
{
  const html = `<html><head><title>T</title></head><body><script>bad()</script>
  <p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul></body></html>`;
  const text = htmlToText(html);
  assert.ok(!text.includes("bad()"), "T1: script 被去掉");
  assert.ok(!text.includes("<"), "T1: 无残留标签");
  assert.ok(text.includes("• a"), "T1: li 转 • ");
  assert.ok(text.includes("Hello world"), "T1: 文本保留");
  console.log("✓ T1 htmlToText: 去标签/script,<li>→•");
}

// === T2: htmlToText decode 实体 ===
{
  const html = `<p>a &amp; b &lt;tag&gt; &nbsp; c</p>`;
  const text = htmlToText(html);
  assert.ok(text.includes("a & b <tag>"), `T2: 实体解码,实际: ${text}`);
  assert.ok(!text.includes("&amp;"), "T2: 无残留实体");
  console.log("✓ T2 htmlToText: decode &amp;/&lt;/&gt;/&nbsp;");
}

// === T3: inferTitle 去数字前缀 + 扩展名 + 语言后缀 ===
assert.strictEqual(inferTitle("07_derivatives-and-tangents.zh-CN.txt"), "Derivatives and tangents");
assert.strictEqual(inferTitle("01_lesson-1-intro/README.md"), "Lesson 1 intro");
assert.strictEqual(inferTitle("calculus/week1/notes.md"), "Notes");
console.log("✓ T3 inferTitle: 去数字前缀/扩展名/语言后缀");

// === T4: detectLang 语言检测 ===
assert.strictEqual(detectLang("06_motivation.zh-CN.txt"), "zh");
assert.strictEqual(detectLang("06_motivation.en.txt"), "en");
assert.strictEqual(detectLang("06_motivation.txt"), "other");
console.log("✓ T4 detectLang: zh/en/other 正确识别");

// === T5: dedupKey 同内容不同语言 → 同 key ===
assert.strictEqual(dedupKey("06_motivation.en.txt"), dedupKey("06_motivation.zh-CN.txt"));
assert.strictEqual(dedupKey("06_motivation.en.txt"), "06_motivation");
console.log("✓ T5 dedupKey: 去语言后缀+扩展名");

// === T6: dedupByLang 保留双语配对，只做同语言内部去重 ===
// 语义变更（v2）: 旧版跨语言"中文优先"会把 xxx.en.txt / xxx.zh-CN.txt 的英文原稿
// 直接丢掉——双语信息在扫描层就没了，翻译管线永远拿不到配对。现在成对双方都保留
// （分类层负责分流 原文+翻译），只合并同语言类别的真重复（08.en.txt vs 08.en.md）。
{
  const docs = [
    { path: "06.en.txt", title: "A", content: "english", lang: "en", kind: "txt" },
    { path: "06.zh-CN.txt", title: "A", content: "中文", lang: "zh", kind: "txt" },
    { path: "07.txt", title: "B", content: "x", lang: "other", kind: "txt" },
    { path: "08.en.txt", title: "C", content: "en-dup-1", lang: "en", kind: "txt" },
    { path: "08.en.md", title: "C", content: "en-dup-2", lang: "en", kind: "md" },
    { path: "09.zh-CN.txt", title: "D", content: "zh-dup-1", lang: "zh", kind: "txt" },
    { path: "09.zh.txt", title: "D", content: "zh-dup-2", lang: "zh", kind: "txt" },
  ];
  const deduped = dedupByLang(docs);
  assert.strictEqual(deduped.length, 5, `T6: 去重后 5 个(08/09 同语言合并,06 双语都留), 实际 ${deduped.length}`);
  // 06 的 en 和 zh 都活着（配对保留）
  assert.ok(deduped.some((d) => d.path === "06.en.txt"), "T6: 06 英文版保留");
  assert.ok(deduped.some((d) => d.path === "06.zh-CN.txt"), "T6: 06 中文版保留");
  // 同语言同 key 只留首个
  assert.ok(deduped.some((d) => d.path === "08.en.txt" && d.content === "en-dup-1"), "T6: 08 同语言合并留首个");
  assert.ok(!deduped.some((d) => d.path === "08.en.md"), "T6: 08.en.md 被合并");
  assert.ok(!deduped.some((d) => d.path === "09.zh.txt"), "T6: 09 同语言合并");
  console.log("✓ T6 dedupByLang: 双语配对保留 + 同语言内部去重");
}

// === T7: scanFolder 递归扫描 + 排除 node_modules ===
{
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-scan-"));
  try {
    // 造一个迷你课程结构
    mkdirSync(join(tmp, "ch1", "lesson1"), { recursive: true });
    mkdirSync(join(tmp, "node_modules"), { recursive: true });
    writeFileSync(join(tmp, "ch1", "lesson1", "01_intro.zh-CN.txt"), "这是中文导论,内容足够长不会被过滤掉。");
    writeFileSync(join(tmp, "ch1", "lesson1", "01_intro.en.txt"), "This is english intro, long enough.");
    writeFileSync(join(tmp, "ch1", "notes.md"), "# Notes\n\n数学笔记内容足够长。");
    writeFileSync(join(tmp, "ch1", "reading.html"), "<co-content><p>阅读材料正文内容</p></co-content>");
    writeFileSync(join(tmp, "node_modules", "junk.txt"), "should be excluded");

    const docs = await scanFolder(tmp);
    assert.strictEqual(docs.length, 4, `T7: 扫到 4 个(node_modules 被排除,中英配对都保留),实际 ${docs.length}`);
    // node_modules 被排除
    assert.ok(!docs.some((d) => d.path.includes("node_modules")), "T7: node_modules 排除");
    // 双语配对都保留（分流交给分类层）
    assert.ok(docs.some((d) => d.path.includes("01_intro.en.txt")), "T7: intro 英文版保留");
    assert.ok(docs.some((d) => d.path.includes("01_intro.zh-CN.txt")), "T7: intro 中文版保留");
    // html 被转纯文本
    const htmlDoc = docs.find((d) => d.path.includes("reading.html"));
    assert.ok(htmlDoc && htmlDoc.content.includes("阅读材料正文") && !htmlDoc.content.includes("<"), "T7: html 转纯文本");
    console.log(`✓ T7 scanFolder: 递归+排除 node_modules+双语配对保留+html 转文本(${docs.length} 个)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// === T8: scanFolder 按路径自然排序(数字前缀)===
{
  const tmp = mkdtempSync(join(tmpdir(), "lookatstudy-sort-"));
  try {
    mkdirSync(join(tmp, "02_second"), { recursive: true });
    mkdirSync(join(tmp, "10_tenth"), { recursive: true });
    mkdirSync(join(tmp, "01_first"), { recursive: true });
    writeFileSync(join(tmp, "01_first", "a.txt"), "第一个足够长的内容在这里。");
    writeFileSync(join(tmp, "02_second", "b.txt"), "第二个足够长的内容在这里。");
    writeFileSync(join(tmp, "10_tenth", "c.txt"), "第十个足够长的内容在这里。");
    const docs = await scanFolder(tmp);
    assert.strictEqual(docs[0]?.path, "01_first/a.txt", "T8: 01 排第一(不是字典序的 01<02<10)");
    assert.strictEqual(docs[2]?.path, "10_tenth/c.txt", "T8: 10 排最后");
    console.log("✓ T8 scanFolder: 数字前缀自然排序(01<02<10)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\n=== ALL LOCAL SCANNER TESTS PASSED ✅ ===");
