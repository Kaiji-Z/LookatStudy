/**
 * 本地导入 fileList 构造回归测试（Layer A）。
 *
 * 背景Bug: 本地导入 D:\...\mathematics-for-machine-learning-and-data-science_files
 * （浏览器"保存完整网页"的 Coursera 课程，438 .txt + 91 .html + 11 .pdf）生成空课程。
 * 根因——ipc/index.ts 把 inventory.docs 过了一遍面向 GitHub 的 pathsToDiscoveredFiles，
 * 后者只保留 .md/.ipynb/.rst/.code，把 .txt/.html/.pdf 全部 else continue 丢弃，
 * 100% 文件被滤掉 → 分类空 → 结构空 → 空课程。
 *
 * 修复：本地路径改用 docsToDiscoveredFiles，直接用扫描器已解析的 docs，不再二次过滤。
 *
 * 跑法: npx tsx scripts/verify-local-filelist.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { docsToDiscoveredFiles, pathsToDiscoveredFiles } from "../src/main/services/pure/repo-fetcher.ts";

// 模拟本次 Bug 的文件夹清单（纯 txt/html/pdf + 对照的 md/code）
const docs = [
  { path: "machine-learning-calculus/week1.txt", title: "Week 1 讲义" },
  { path: "machine-learning-calculus/week2.html" },
  { path: "machine-learning-linear-algebra/lecture.pdf" },
  { path: "machine-learning-probability/notes.md", title: "笔记" },
  { path: "lab/solution.py" },
];

// ── 1. docsToDiscoveredFiles 必须保留全部格式（含 txt/html/pdf）──
const result = docsToDiscoveredFiles(docs);
assert.equal(result.length, 5, "应保留全部 5 个文档（含 txt/html/pdf）");
const keptPaths = result.map((r) => r.path);
for (const mustKeep of [
  "machine-learning-calculus/week1.txt",
  "machine-learning-calculus/week2.html",
  "machine-learning-linear-algebra/lecture.pdf",
  "machine-learning-probability/notes.md",
  "lab/solution.py",
]) {
  assert.ok(keptPaths.includes(mustKeep), `应保留 ${mustKeep}`);
}
console.log("✓ docsToDiscoveredFiles 保留全部 5 个文档（txt/html/pdf/md/code 都在）");

// ── 2. title：有则用，无则取文件名（去扩展名）──
const byPath = Object.fromEntries(result.map((r) => [r.path, r.title]));
assert.equal(byPath["machine-learning-calculus/week1.txt"], "Week 1 讲义", "优先用 doc.title");
assert.equal(byPath["machine-learning-calculus/week2.html"], "week2", "缺 title 时用文件名去扩展名");
assert.equal(byPath["machine-learning-linear-algebra/lecture.pdf"], "lecture");
console.log("✓ title 解析：有 title 用 title，无则文件名去扩展名");

// ── 3. kind 统一 "other"（下游分类/结构设计链路只读 path，不读 kind）──
assert.ok(result.every((r) => r.kind === "other"), "kind 统一 other");
console.log("✓ kind 统一 other");

// ── 4. 去重（同 path 只保留一条）──
const deduped = docsToDiscoveredFiles([{ path: "a.md" }, { path: "a.md" }, { path: "b.txt" }]);
assert.equal(deduped.length, 2, "同 path 去重");
console.log("✓ 同 path 去重");

// ── 5. 对照：旧函数 pathsToDiscoveredFiles 确实丢弃 txt/html/pdf（文档化原 Bug）──
// 这正是本地导入不能再走 pathsToDiscoveredFiles 的原因。
const oldKept = pathsToDiscoveredFiles(docs.map((d) => d.path)).map((r) => r.path);
assert.ok(!oldKept.some((p) => p.endsWith(".txt")), "pathsToDiscoveredFiles 应丢弃 .txt（原 Bug 根因）");
assert.ok(!oldKept.some((p) => p.endsWith(".html")), "pathsToDiscoveredFiles 应丢弃 .html");
assert.ok(!oldKept.some((p) => p.endsWith(".pdf")), "pathsToDiscoveredFiles 应丢弃 .pdf");
assert.equal(oldKept.length, 2, "旧函数只保留 md + code（notes.md + solution.py）");
console.log("✓ 对照：pathsToDiscoveredFiles 丢弃 txt/html/pdf（只留 2 个 md/code）—— 本地路径不走它");

console.log("\n=== local-filelist 测试通过 ✅ ===");
