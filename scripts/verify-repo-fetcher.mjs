/**
 * 仓库导入器验证 —— 纯函数测试 repo-fetcher.ts。
 *
 * 覆盖:
 *   - extractInternalLinks: 从 README markdown 提取内部 .md/.ipynb 链接
 *   - filterLessonFiles: 过滤 translations/、LICENSE 等
 *   - detectRepoPattern: 三种形态检测（course/single-file/unsupported）
 *   - fetchMarkdownContents: 注入 fake fetchFn 测并发拉取 + 失败处理
 *   - buildCourseFromFiles: 多文件合并成 ParsedCourse
 *   - cdnUrl: URL 构造正确
 */
import assert from "node:assert";
import {
  extractInternalLinks,
  filterLessonFiles,
  detectRepoPattern,
  fetchMarkdownContents,
  buildCourseFromFiles,
  cdnUrl,
} from "../src/main/services/pure/repo-fetcher.ts";

// === T1: extractInternalLinks 提取 .md 和 .ipynb 链接 ===
const readmeWithLinks = `
# Course Title
- [Intro](./lessons/1-Intro/README.md)
- [Notebook](lessons/2-Topic/lab.ipynb)
- [External](https://example.com)
- [Anchor](#section)
- [Quiz](./lessons/1-Intro/quiz.md)
`;
const links = extractInternalLinks(readmeWithLinks);
assert.strictEqual(links.length, 3, "T1: 应提取 3 个内部文件链接（排除 http + 锚点）");
assert.ok(links.find((l) => l.path === "lessons/1-Intro/README.md"), "T1: 应有 README.md 链接");
assert.ok(links.find((l) => l.path === "lessons/2-Topic/lab.ipynb"), "T1: 应有 .ipynb 链接");
assert.ok(links.find((l) => l.path === "lessons/1-Intro/quiz.md"), "T1: 应有 quiz.md 链接");
console.log("✓ T1 extractInternalLinks: 提取 3 个文件链接（排除 http/锚点）");

// === T2: 去重 ===
const dupLinks = `[A](./a.md) [A again](./a.md) [B](./b.md)`;
const dups = extractInternalLinks(dupLinks);
assert.strictEqual(dups.length, 2, "T2: 去重后应只有 2 个");
console.log("✓ T2 去重: 重复路径只保留一个");

// === T3: filterLessonFiles 排除 translations + LICENSE ===
const mixedFiles = [
  { path: "lessons/1-Intro/README.md", title: "Intro", kind: "md" },
  { path: "translations/zh-CN/README.md", title: "中文", kind: "md" },
  { path: "LICENSE.md", title: "License", kind: "md" },
  { path: "CONTRIBUTING.md", title: "Contributing", kind: "md" },
  { path: "lessons/2-Topic/README.md", title: "Topic", kind: "md" },
];
const filtered = filterLessonFiles(mixedFiles);
assert.strictEqual(filtered.length, 2, "T3: 应过滤掉 translations + LICENSE + CONTRIBUTING");
assert.ok(filtered.find((f) => f.path === "lessons/1-Intro/README.md"));
assert.ok(!filtered.find((f) => f.path.includes("translations")));
console.log("✓ T3 filterLessonFiles: 排除 translations/LICENSE/CONTRIBUTING");

// === T4: detectRepoPattern — well-organized（编号目录 ≥3 个）===
const courseReadme = `
# AI Course
- [Lesson 1](./lessons/1-Intro/README.md)
- [Lesson 2](./lessons/2-NN/README.md)
- [Lesson 3](./lessons/3-CV/README.md)
- [Lesson 4](./lessons/4-NLP/README.md)
`;
const courseDetection = detectRepoPattern(courseReadme);
assert.strictEqual(courseDetection.pattern, "well-organized", "T4: 编号目录 → well-organized");
assert.ok(courseDetection.lessonFiles && courseDetection.lessonFiles.length >= 3);
console.log(`✓ T4 detectRepoPattern(well-organized): ${courseDetection.lessonFiles.length} 个课时文件`);

// === T4b: detectRepoPattern — course（有链接但无编号目录）===
const courseReadmeB = `
# Messy Course
- [Intro](./intro.md)
- [Basics](./module-a/basics.md)
- [Advanced](./advanced/guide.md)
- [Lab](./lab/work.md)
`;
const courseDetectionB = detectRepoPattern(courseReadmeB);
assert.strictEqual(courseDetectionB.pattern, "course", "T4b: 无编号目录 → course(LLM 重组)");
console.log(`✓ T4b detectRepoPattern(course): 无编号目录走 LLM 重组`);

// === T5: detectRepoPattern — 单文件型（README 够长但无子文件链接）===
const singleFileReadme = "# Course\n\n" + "This is substantial teaching content. ".repeat(200);
const singleDetection = detectRepoPattern(singleFileReadme);
assert.strictEqual(singleDetection.pattern, "single-file", "T5: 长文本无链接 → single-file");
console.log("✓ T5 detectRepoPattern(single-file): README 够长但无子链接");

// === T6: detectRepoPattern — 不支持（太短 + 无链接）===
const shortReadme = "# Tiny Repo\n\nA link collection.";
const unsupportedDetection = detectRepoPattern(shortReadme);
assert.strictEqual(unsupportedDetection.pattern, "unsupported", "T6: 短文本无链接 → unsupported");
console.log("✓ T6 detectRepoPattern(unsupported): README 太短且无课程链接");

// === T7: cdnUrl 构造 ===
const url = cdnUrl("microsoft", "AI-For-Beginners", "main", "lessons/1-Intro/README.md");
assert.strictEqual(
  url,
  "https://cdn.jsdelivr.net/gh/microsoft/AI-For-Beginners@main/lessons/1-Intro/README.md",
);
console.log("✓ T7 cdnUrl: 正确构造 CDN URL");

// === T8: cdnUrl 去 ./ 前缀 ===
const url2 = cdnUrl("owner", "repo", "main", "./docs/readme.md");
assert.strictEqual(url2, "https://cdn.jsdelivr.net/gh/owner/repo@main/docs/readme.md");
console.log("✓ T8 cdnUrl: 去掉 ./ 前缀");

// === T9: fetchMarkdownContents — 注入 fake fetchFn 测并发拉取 ===
const fakeFiles = [
  { path: "a.md", title: "A", kind: "md" },
  { path: "b.md", title: "B", kind: "md" },
  { path: "c.md", title: "C", kind: "md" },
];
let fetchCalls = 0;
const fakeFetch = async (url) => {
  fetchCalls++;
  // 模拟 b.md 失败
  if (url.includes("b.md")) return { ok: false, status: 404 };
  return { ok: true, text: async () => `# Content for ${url}` };
};
const progressMsgs = [];
const result = await fetchMarkdownContents(
  fakeFiles,
  "owner",
  "repo",
  "main",
  fakeFetch,
  (done, total, path) => progressMsgs.push(`${done}/${total}: ${path}`),
);
assert.strictEqual(result.ok.length, 2, "T9: 2 个成功（a.md + c.md）");
assert.strictEqual(result.failed.length, 1, "T9: 1 个失败（b.md）");
assert.ok(result.failed[0].path.includes("b.md"), "T9: 失败的是 b.md");
assert.strictEqual(progressMsgs.length, 3, "T9: 3 次进度回调");
console.log(`✓ T9 fetchMarkdownContents: 2 成功 + 1 失败 + ${progressMsgs.length} 次进度回调`);

// === T10: buildCourseFromFiles — 多文件合并 ===
const fetchedFiles = [
  { path: "lessons/1-Intro/README.md", title: "Intro", md: "# Introduction\n\nIntro content.\n\n## What is AI\nAI is..." },
  { path: "lessons/2-NN/README.md", title: "Neural Nets", md: "# Neural Networks\n\nNN content." },
];
const course = buildCourseFromFiles("AI Course", fetchedFiles);
assert.ok(course.title === "AI Course", "T10: 课程标题正确");
assert.ok(course.sections.length >= 2, `T10: 至少 2 个 section（每文件至少一个），实际 ${course.sections.length}`);
// 每个文件应该至少产生一个 lesson
const totalLessons = course.sections.reduce((sum, s) => sum + s.lessons.length, 0);
assert.ok(totalLessons >= 2, `T10: 至少 2 个 lesson，实际 ${totalLessons}`);
// lesson 应有 body 内容
const firstLesson = course.sections[0]?.lessons[0];
assert.ok(firstLesson && firstLesson.body.length > 0, "T10: lesson 有 body 正文");
console.log(`✓ T10 buildCourseFromFiles: ${course.sections.length} section / ${totalLessons} lesson，body 有内容`);

// === T11: buildCourseFromFiles — 文件无 H2/H3 时整个文件作为一个 lesson ===
const flatFiles = [
  { path: "intro.md", title: "Intro", md: "# Just a title\n\nSome content without subheadings." },
];
const flatCourse = buildCourseFromFiles("Flat", flatFiles);
assert.ok(flatCourse.sections.length >= 1, "T11: 无 H2 的文件也生成 section");
assert.ok(flatCourse.sections[0].lessons.length >= 1, "T11: 至少 1 个 lesson");
assert.strictEqual(flatCourse.sections[0].lessons[0].title, "Just a title", "T11: 用 H1 做 lesson 标题");
console.log("✓ T11 buildCourseFromFiles(无 H2): 整个文件 → 1 个 lesson，标题取 H1");

console.log("\n=== ALL REPO FETCHER TESTS PASSED ✅ ===");

// === v0.8 多模态: extractImageRefsFromMd ===
{
  const { extractImageRefsFromMd } = await import("../src/main/services/pure/repo-fetcher.ts");
  const md = "# 课程\n\n![架构图](images/arch.png)\n\n正文\n![流程图](./flow.svg)\n![外链](https://e.com/x.png)\n![非图](doc.pdf)";
  const refs = extractImageRefsFromMd(md);
  assert.strictEqual(refs.length, 2, "v-img: 2 个本地图片引用(过滤外链+非图扩展名)");
  assert.strictEqual(refs[0].alt, "架构图");
  assert.strictEqual(refs[0].path, "images/arch.png");
  assert.strictEqual(refs[1].path, "flow.svg", "v-img: ./ 前缀去掉");
  console.log("✓ v-img extractImageRefsFromMd: 过滤外链+非图扩展名");
}

// === v0.8 多模态: extractImageRefsFromMd 无图返回空 ===
{
  const { extractImageRefsFromMd } = await import("../src/main/services/pure/repo-fetcher.ts");
  assert.strictEqual(extractImageRefsFromMd("纯文字").length, 0, "v-img: 无图返回空");
  assert.strictEqual(extractImageRefsFromMd("").length, 0);
  console.log("✓ v-img extractImageRefsFromMd: 无图返回空");
}

console.log("=== 多模态图片引用解析(repo-fetcher): 通过 ✅ ===");

// ============================================================
// extractLanguagesFromReadme: 翻译语言检测
// ============================================================
{
  const { extractLanguagesFromReadme } = await import("../src/main/services/pure/repo-fetcher.ts");

  const readmeWithTranslations = `# AI for Beginners

[Arabic](./translations/ar/README.md) | [Chinese (Simplified)](./translations/zh-CN/README.md) | [Japanese](./translations/ja/README.md) | [French](translations/fr/README.md)

## Lessons
`;

  const langs = extractLanguagesFromReadme(readmeWithTranslations);
  assert.strictEqual(langs.length, 4);
  assert.strictEqual(langs[0].code, "ar");
  assert.strictEqual(langs[0].name, "Arabic");
  assert.strictEqual(langs[1].code, "zh-CN");
  assert.strictEqual(langs[2].code, "ja");
  assert.strictEqual(langs[3].code, "fr"); // 无 ./ 前缀也能匹配
  console.log("✓ lang-detect extractLanguagesFromReadme: 4 语言正确提取");

  // 无翻译的 README
  const noTrans = "# Plain Repo\n\nNo translations here.";
  assert.strictEqual(extractLanguagesFromReadme(noTrans).length, 0);
  console.log("✓ lang-detect extractLanguagesFromReadme: 无翻译返回空");

  // 去重
  const dup = "[English](./translations/en/README.md) | [English Again](./translations/en/README.md)";
  assert.strictEqual(extractLanguagesFromReadme(dup).length, 1);
  console.log("✓ lang-detect extractLanguagesFromReadme: 重复语言去重");
}

console.log("=== 翻译语言检测(repo-fetcher): 通过 ✅ ===");
