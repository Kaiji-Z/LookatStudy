/**
 * 实验工具:把导入管线 Step2/Step4 的**真实 prompt** dump 出来,供"人当 LLM"实验 ——
 * 由 AI 直接阅读输入、亲手产出 JSON,校准任务难度与输出体量(截断预算的 ground truth)。
 *
 * 跑法: npx tsx scripts/live-test/dump-llm-task.mjs <plan.json> <outDir>
 * 数据源:被杀实测留下的 plan 快照(reachedStep≥3,含 readme/fileList/fullTree/classification/outlines)。
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { buildRolePrompt, buildStructureDesignPrompt } from "../../src/main/services/import-llm-service.ts";

const [planPath, outDir = ".llm-task-dump"] = process.argv.slice(2);
if (!planPath) {
  console.error("用法: npx tsx dump-llm-task.mjs <plan.json> [outDir]");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
mkdirSync(outDir, { recursive: true });

// ── Step 2 批 1 prompt:规则预处理后的 remaining 前 40(与 classifyFileRoles 同规则) ──
const allPaths = plan.fileList.map((f) => f.path);
const META_STEMS = ["license", "licence", "contributing", "code_of_conduct", "security", "changelog", "authors", "maintainers", "pull_request_template", "issue_template", "support", "faq", "citation", "codeowners"];
const remaining = allPaths.filter((p) => {
  const stem = p.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
  return !META_STEMS.includes(stem);
});
const s2chunk = remaining.slice(0, 40);
const s2prompt = buildRolePrompt(plan.readmeMd, s2chunk, plan.fullTree);

// ── Step 4 批 1 prompt:classification 的 original+practice 前 40 的元数据块 ──
const cls = plan.classification;
const allFiles = [...cls.original, ...cls.practice];
const fileInfos = allFiles.slice(0, 40).map((p) => {
  const ol = plan.outlines[p] ?? {};
  return {
    file: p,
    role: cls.practice.includes(p) ? "practice" : "original",
    h1: ol.h1 ?? "",
    totalChars: ol.totalChars ?? 0,
    headings: ol.headings ?? [],
  };
});
const s4prompt = buildStructureDesignPrompt(plan.readmeMd, fileInfos, []);

writeFileSync(`${outDir}/step2-prompt.md`, s2prompt, "utf8");
writeFileSync(`${outDir}/step4-prompt.md`, s4prompt, "utf8");
writeFileSync(`${outDir}/step4-fileinfos.json`, JSON.stringify(fileInfos, null, 2), "utf8");
console.log(`Step2 prompt: ${s2prompt.length} 字符(批 1/40 文件)→ ${outDir}/step2-prompt.md`);
console.log(`Step4 prompt: ${s4prompt.length} 字符(批 1/40 文件)→ ${outDir}/step4-prompt.md`);
console.log(`remaining 总数: ${remaining.length},original: ${cls.original.length},practice: ${cls.practice.length}`);
