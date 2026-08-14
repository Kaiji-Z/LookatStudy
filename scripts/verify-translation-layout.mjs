/**
 * 翻译布局检测验证 —— 测 translation-layout.ts 的 detectTranslationLayout。
 *
 * 不变量:
 *   - microsoft: translations/{lang}/ → layout=microsoft
 *   - parallel: {lang}/ 根级平行目录 → layout=parallel
 *   - suffix: {file}.{lang}.md → layout=suffix
 *   - none: 无翻译 → layout=none, langs=[]
 *   - pathResolver: 每种布局构造正确路径
 */
import assert from "node:assert";
import { detectTranslationLayout } from "../src/main/services/pure/translation-layout.ts";

// === T1: microsoft 约定 ===
{
  const tree = [
    "README.md",
    "lessons/1-Intro/README.md",
    "translations/zh-CN/README.md",
    "translations/zh-CN/lessons/1-Intro/README.md",
    "translations/ja/README.md",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "microsoft", "T1: layout=microsoft");
  assert.ok(result.langs.includes("zh-CN"), "T1: 检测到 zh-CN");
  assert.ok(result.langs.includes("ja"), "T1: 检测到 ja");
  assert.strictEqual(
    result.pathResolver("zh-CN", "lessons/1-Intro/README.md"),
    "translations/zh-CN/lessons/1-Intro/README.md",
    "T1: pathResolver 正确",
  );
  console.log("✓ T1 microsoft: translations/{lang}/ 检测 + pathResolver");
}

// === T2: parallel 约定（根级 {lang}/ 平行目录）===
{
  const tree = [
    "en/guide/intro.md",
    "en/guide/setup.md",
    "zh-CN/guide/intro.md",
    "zh-CN/guide/setup.md",
    "ja/guide/intro.md",
    "ja/guide/setup.md",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "parallel", `T2: layout=parallel, got ${result.layout}`);
  assert.ok(result.langs.includes("zh-CN"), "T2: 检测到 zh-CN");
  assert.ok(result.langs.includes("ja"), "T2: 检测到 ja");
  console.log("✓ T2 parallel: {lang}/ 平行目录检测");
}

// === T3: parallel docs/{lang}/ 约定 ===
{
  const tree = [
    "docs/en/intro.md",
    "docs/en/setup.md",
    "docs/zh-CN/intro.md",
    "docs/zh-CN/setup.md",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "parallel", `T3: layout=parallel (docs/{lang}/)`);
  assert.ok(result.langs.includes("zh-CN"), "T3: 检测到 zh-CN");
  console.log("✓ T3 parallel: docs/{lang}/ 约定检测");
}

// === T4: suffix 约定 ===
{
  const tree = [
    "intro.md",
    "intro.zh-CN.md",
    "intro.ja.md",
    "setup.md",
    "setup.zh-CN.md",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "suffix", `T4: layout=suffix`);
  assert.ok(result.langs.includes("zh-CN"), "T4: 检测到 zh-CN");
  assert.ok(result.langs.includes("ja"), "T4: 检测到 ja");
  const resolved = result.pathResolver("zh-CN", "intro.md");
  assert.strictEqual(resolved, "intro.zh-CN.md", `T4: suffix pathResolver → ${resolved}`);
  console.log("✓ T4 suffix: {file}.{lang}.md 检测 + pathResolver");
}

// === T5: none（无翻译文件）===
{
  const tree = ["README.md", "lessons/intro.md", "lessons/setup.md"];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "none", "T5: layout=none");
  assert.strictEqual(result.langs.length, 0, "T5: 无语言");
  console.log("✓ T5 none: 无翻译文件 → none");
}

// === T6: microsoft 优先于 parallel ===
{
  const tree = [
    "README.md",
    "lessons/intro.md",
    "translations/zh-CN/lessons/intro.md",
    "en/lessons/intro.md",
    "en/lessons/setup.md",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "microsoft", "T6: microsoft 优先");
  console.log("✓ T6 优先级: microsoft > parallel");
}

// === T7: languages 含显示名 ===
{
  const tree = ["translations/zh-CN/README.md", "translations/ja/README.md"];
  const result = detectTranslationLayout(tree);
  const zhCN = result.languages.find((l) => l.code === "zh-CN");
  const ja = result.languages.find((l) => l.code === "ja");
  assert.ok(zhCN?.name === "简体中文", `T7: zh-CN name=${zhCN?.name}`);
  assert.ok(ja?.name === "日本語", `T7: ja name=${ja?.name}`);
  console.log("✓ T7 languages: 含显示名");
}

// === T8: 噪声不误判（单文件平行）===
{
  const tree = ["README.md", "en.md", "guide.md"];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "none", "T8: 单文件不算 parallel");
  console.log("✓ T8 防误判: 单文件不算平行目录");
}

// === T9: suffix 约定 + .txt 扩展（本地保存的课程转写常见：xxx.en.txt / xxx.zh-CN.txt 成对）===
// 背景 Bug: 原 regex 只认 (md|markdown|ipynb|rst)，.txt 双语对完全检测不到 → layout=none
// → 中英全被当原文 → 重复成课 + 翻译表空。
{
  const tree = [
    "machine-learning-calculus/01_lesson/01_course-introduction.en.txt",
    "machine-learning-calculus/01_lesson/01_course-introduction.zh-CN.txt",
    "machine-learning-calculus/01_lesson/20_existence.en.txt",
    "machine-learning-calculus/01_lesson/20_existence.zh-CN.txt",
    "machine-learning-linear-algebra/02_lesson/04_row-echelon.en.txt",
    "machine-learning-linear-algebra/02_lesson/04_row-echelon.zh-CN.txt",
  ];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "suffix", `T9: layout=suffix, got ${result.layout}`);
  assert.ok(result.langs.includes("en"), "T9: 检测到 en");
  assert.ok(result.langs.includes("zh-CN"), "T9: 检测到 zh-CN");
  console.log("✓ T9 suffix + .txt: xxx.en.txt / xxx.zh-CN.txt 成对检测（原 Bug 场景）");
}

// === T10: suffix pathResolver 剥原文自带的语言后缀 ===
// 原文 xxx.en.txt → 翻译应为 xxx.zh-CN.txt（不是 xxx.en.zh-CN.txt）
{
  const tree = ["a/intro.en.txt", "a/intro.zh-CN.txt"];
  const result = detectTranslationLayout(tree);
  const resolved = result.pathResolver("zh-CN", "a/intro.en.txt");
  assert.strictEqual(resolved, "a/intro.zh-CN.txt", `T10: 应剥掉原文 .en 后缀, got ${resolved}`);
  // 反向: 原文 .zh-CN.txt → 翻译 .en.txt
  const resolvedBack = result.pathResolver("en", "a/intro.zh-CN.txt");
  assert.strictEqual(resolvedBack, "a/intro.en.txt", `T10: 反向解析, got ${resolvedBack}`);
  console.log("✓ T10 suffix pathResolver: 原文带语言后缀时剥掉再拼目标语言");
}

// === T11: suffix pathResolver 对不带语言后缀的原文保持旧行为 + .html 支持 ===
{
  const tree = ["intro.md", "intro.zh-CN.md", "page.html", "page.zh-CN.html"];
  const result = detectTranslationLayout(tree);
  assert.strictEqual(result.layout, "suffix", "T11: md+html suffix");
  assert.strictEqual(result.pathResolver("zh-CN", "intro.md"), "intro.zh-CN.md", "T11: 经典 hexo 风格不变");
  assert.strictEqual(result.pathResolver("zh-CN", "page.html"), "page.zh-CN.html", "T11: .html 支持");
  console.log("✓ T11 suffix pathResolver: 无语言后缀原文走旧行为 + .html");
}

// === T12: 非语言后缀不误剥（setup.py.txt 的 .py 不是语言码）===
{
  const tree = ["notes.en.txt", "notes.zh-CN.txt", "setup.py.txt"];
  const result = detectTranslationLayout(tree);
  const resolved = result.pathResolver("zh-CN", "setup.py.txt");
  assert.strictEqual(resolved, "setup.py.zh-CN.txt", `T12: .py 非语言码不剥, got ${resolved}`);
  console.log("✓ T12 防误剥: 非语言码后缀(.py)不动");
}

console.log("\n=== ALL TRANSLATION LAYOUT TESTS PASSED ✅ ===");
