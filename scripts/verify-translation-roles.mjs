/**
 * 翻译角色分类验证 —— 测 import-llm-service 的 translation 角色解析
 * + translation-layout 的 excludeSuffixTranslations 规则排除
 * + classifyFileRoles 无 LLM 路径的端到端分流。
 *
 * 背景 Bug: 本地导入 xxx.en.txt / xxx.zh-CN.txt 成对双语文件夹时，
 * 管线把两种语言都当 original → 中英重复成课 + 翻译表空 + 🌐 切换器没数据。
 *
 * 跑法: npx tsx scripts/verify-translation-roles.mjs (也被 verify:core 调用)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { detectTranslationLayout, excludeSuffixTranslations } from "../src/main/services/pure/translation-layout.ts";
import { classifyFileRoles, classifyFilesResilient, parseRoleResult } from "../src/main/services/import-llm-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ══════════ excludeSuffixTranslations（规则排除，纯函数）══════════

// === T1: 成对双语分流（本 Bug 场景）===
{
  const paths = [
    "calc/01.en.txt", "calc/01.zh-CN.txt",
    "calc/20.en.txt", "calc/20.zh-CN.txt",
    "plain.md",
  ];
  const layout = detectTranslationLayout(paths);
  assert.equal(layout.layout, "suffix");
  const split = excludeSuffixTranslations(paths, layout.langs, "en");
  assert.deepEqual(split.originals.sort(), ["calc/01.en.txt", "calc/20.en.txt", "plain.md"], "T1: 原文=en+无后缀");
  assert.deepEqual(split.translations.get("zh-CN")?.sort(), ["calc/01.zh-CN.txt", "calc/20.zh-CN.txt"], "T1: zh-CN 分流");
  assert.equal(split.pairs.get("calc/01.en.txt"), "calc/01.zh-CN.txt", "T1: 配对 en→zh");
  assert.equal(split.pairs.get("calc/20.en.txt"), "calc/20.zh-CN.txt", "T1: 配对 en→zh");
  console.log("✓ T1 excludeSuffixTranslations: 成对双语分流 + 配对");
}

// === T2: 无语言后缀的原文（readme.md ↔ readme.ja.md）也能配对 ===
{
  const paths = ["readme.md", "readme.ja.md", "guide.md"];
  const layout = detectTranslationLayout(paths);
  const split = excludeSuffixTranslations(paths, layout.langs, "en");
  assert.deepEqual(split.originals.sort(), ["guide.md", "readme.md"], "T2: readme.md 留原文");
  assert.deepEqual(split.translations.get("ja"), ["readme.ja.md"], "T2: ja 分流");
  assert.equal(split.pairs.get("readme.md"), "readme.ja.md", "T2: 无后缀原文配对");
  console.log("✓ T2 excludeSuffixTranslations: 无语言后缀原文配对");
}

// === T3: 孤儿翻译（无原文对应）不排除，保守留原文（不丢内容）===
{
  const paths = ["orphan.ja.md", "main.en.md", "main.zh-CN.md"];
  const layout = detectTranslationLayout(paths);
  const split = excludeSuffixTranslations(paths, layout.langs, "en");
  assert.ok(split.originals.includes("orphan.ja.md"), "T3: 孤儿翻译留原文");
  assert.ok(!split.translations.get("ja")?.includes("orphan.ja.md"), "T3: 孤儿不进翻译表");
  assert.equal(split.pairs.get("main.en.md"), "main.zh-CN.md", "T3: 正常对不受影响");
  console.log("✓ T3 excludeSuffixTranslations: 孤儿翻译保守留原文");
}

// === T4: sourceLang 后缀的文件留原文；非语言后缀不动 ===
{
  const paths = ["a.en.txt", "a.zh-CN.txt", "setup.py.txt"];
  const layout = detectTranslationLayout(paths);
  const split = excludeSuffixTranslations(paths, layout.langs, "en");
  assert.ok(split.originals.includes("a.en.txt"), "T4: sourceLang(en)后缀留原文");
  assert.ok(split.originals.includes("setup.py.txt"), "T4: 非语言后缀不动");
  console.log("✓ T4 excludeSuffixTranslations: sourceLang 后缀留原文");
}

// ══════════ parseRoleResult（LLM 返回解析，纯函数）══════════

// === T5: translation 角色透传 lang + translates ===
{
  const raw = JSON.stringify({
    sourceLang: "en",
    files: [
      { path: "a.en.txt", role: "original" },
      { path: "a.zh-CN.txt", role: "translation", lang: "zh-CN", translates: "a.en.txt" },
    ],
  });
  const parsed = parseRoleResult(raw, ["a.en.txt", "a.zh-CN.txt"]);
  assert.equal(parsed.sourceLang, "en", "T5: sourceLang");
  const trans = parsed.files.find((f) => f.path === "a.zh-CN.txt");
  assert.equal(trans?.role, "translation", "T5: translation 角色保留");
  assert.equal(trans?.lang, "zh-CN", "T5: lang 透传");
  assert.equal(trans?.translates, "a.en.txt", "T5: translates 透传");
  console.log("✓ T5 parseRoleResult: translation + lang + translates 透传");
}

// === T6: translates 指向跨批文件（不在本 chunk validPaths）也不被丢 ===
// 配对校验在 classifyFileRoles 用全量列表做，parse 不该用 chunk 列表过滤 translates。
{
  const raw = JSON.stringify({
    sourceLang: "en",
    files: [
      { path: "b.zh-CN.txt", role: "translation", lang: "zh-CN", translates: "z/zz.en.txt" },
    ],
  });
  const parsed = parseRoleResult(raw, ["b.zh-CN.txt"]); // 本 chunk 只有 b.zh-CN.txt
  const trans = parsed.files.find((f) => f.path === "b.zh-CN.txt");
  assert.equal(trans?.role, "translation", "T6: 条目保留");
  assert.equal(trans?.translates, "z/zz.en.txt", "T6: translates 跨批不丢");
  console.log("✓ T6 parseRoleResult: 跨批 translates 不被 chunk 过滤掉");
}

// === T7: 坏 JSON 降级全 original（既有行为不回归）===
{
  const parsed = parseRoleResult("not json at all", ["a.md"]);
  assert.equal(parsed.files[0]?.role, "original", "T7: 降级 original");
  console.log("✓ T7 parseRoleResult: 坏 JSON 降级 original");
}

// ══════════ classifyFileRoles 无 LLM 端到端 ══════════

// === T8: 无 LLM（DB 无 provider）+ suffix 双语树 → 分流 + 配对 + 语言列表 ===
{
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  const db = drizzle(sqljs, { schema }); // 无 provider → isLlmReady=false → 规则路径

  const paths = [
    "calc/01.en.txt", "calc/01.zh-CN.txt",
    "calc/20.en.txt", "calc/20.zh-CN.txt",
    "plain.md",
  ];
  const fileList = paths.map((p) => ({ path: p, title: p, kind: "other" }));
  const roles = await classifyFileRoles(db, "", fileList, paths);

  assert.equal(roles.translationLayout, "suffix", `T8: layout=suffix, got ${roles.translationLayout}`);
  assert.deepEqual([...roles.original].sort(), ["calc/01.en.txt", "calc/20.en.txt", "plain.md"], "T8: 原文只含 en + 无后缀");
  assert.equal(roles.translations.get("zh-CN")?.length, 2, "T8: zh-CN 2 份进翻译表");
  assert.equal(roles.translationPairs.get("calc/01.en.txt"), "calc/01.zh-CN.txt", "T8: 配对 en→zh");
  assert.ok(roles.languages.some((l) => l.code === "zh-CN"), "T8: 语言列表含 zh-CN");
  assert.equal(roles.sourceLang, "en", "T8: sourceLang=en");
  console.log("✓ T8 classifyFileRoles(无LLM): suffix 双语分流 + 配对 + 语言列表");
}

// === T9: parseRoleResult 截断 → degraded 标记(上层据此拆半) ===
{
  const truncated = '{"sourceLang":"en","files":[{"path":"a.md","role":"original"},{"path":"b.md","ro';
  const d = parseRoleResult(truncated, ["a.md", "b.md"]);
  assert.equal(d.degraded, true, "T9: 截断 JSON → degraded=true");
  assert.deepEqual(d.files.map((f) => f.role), ["original", "original"], "T9: 兜底全 original");
  const ok = parseRoleResult(JSON.stringify({ sourceLang: "en", files: [{ path: "a.md", role: "skip" }] }), ["a.md"]);
  assert.equal(ok.degraded, false, "T9: 正常解析 degraded=false");
  console.log("✓ T9 parseRoleResult: degraded 截断信号");
}

// === T10: classifyFilesResilient 截断自愈 —— 批>1 截断则拆半,单文件兜底,sourceLang 传播 ===
{
  const calls = [];
  const progress = [];
  // 桩:批 >1 个文件时返回半个 JSON(截断),单文件返回完整判定
  const call = async (prompt) => {
    const n = (prompt.match(/"path"/g) || []).length; // buildPrompt 桩里我们直接数文件数
    calls.push(n);
    return n; // 占位,真实返回在下面拼
  };
  // 更直接的桩:buildPrompt 收到 files,按长度决定截断/完整
  const files5 = ["a.md", "b.md", "c.md", "d.md", "e.md"];
  const stub = {
    buildPrompt: (fs) => JSON.stringify(fs),
    call: async (prompt) => {
      const fs = JSON.parse(prompt);
      if (fs.length > 1) {
        return '{"sourceLang":"","files":[{"path":"' + fs[0] + '","role":"original"'; // 半个 JSON
      }
      return JSON.stringify({ sourceLang: fs[0] === "a.md" ? "en" : "", files: [{ path: fs[0], role: fs[0] === "b.md" ? "skip" : "practice" }] });
    },
    onProgress: (m) => progress.push(m),
  };
  const out = await classifyFilesResilient(files5, stub);
  assert.equal(out.degraded, false, "T10: 自愈后整体不 degraded");
  assert.equal(out.sourceLang, "en", "T10: sourceLang 从成功子批传播");
  const byRole = Object.fromEntries(out.files.map((f) => [f.path, f.role]));
  assert.equal(byRole["a.md"], "practice", "T10: a=practice(桩,bisect 到单文件)");
  assert.equal(byRole["b.md"], "skip", "T10: b=skip(桩)");
  assert.equal(byRole["c.md"], "practice", "T10: c=practice(桩)");
  assert.ok(progress.some((m) => m.includes("拆半重试")), "T10: 进度应有拆半消息");
  console.log("✓ T10 classifyFilesResilient: 截断拆半自愈 + sourceLang 传播");
}

// === T11: classifyFilesResilient 单文件仍截断 → 兜底当原文,不抛 ===
{
  const progress = [];
  const out = await classifyFilesResilient(["x.md"], {
    buildPrompt: (fs) => JSON.stringify(fs),
    call: async () => "{截断",
    onProgress: (m) => progress.push(m),
  });
  assert.equal(out.files[0].role, "original", "T11: 单文件兜底 original");
  assert.ok(progress.some((m) => m.includes("单文件兜底")), "T11: 兜底进度消息");
  console.log("✓ T11 classifyFilesResilient: 单文件截断兜底不抛");
}


// === T12: classifyFilesResilient 取消 —— shouldAbort 置位后不再发起 LLM 调用,抛"导入已取消" ===
{
  let calls = 0;
  await assert.rejects(
    classifyFilesResilient(["a.md", "b.md"], {
      buildPrompt: (fs) => JSON.stringify(fs),
      call: async () => { calls++; return "{}"; },
      shouldAbort: () => true,
    }),
    /导入已取消/,
    "T12: 取消应抛 导入已取消",
  );
  assert.equal(calls, 0, "T12: 取消后零 LLM 调用");
  console.log("✓ T12 classifyFilesResilient: 取消即断,零新调用");
}


console.log("\n=== ALL TRANSLATION ROLES TESTS PASSED ✅ ===");
