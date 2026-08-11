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

console.log("\n=== ALL TRANSLATION LAYOUT TESTS PASSED ✅ ===");
