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
  httpsGet,
  fetchRepoInventory,
  fetchFileOutlines,
  extractBodyPreview,
  extractOutlineWithCharCounts,
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

// === T6: detectRepoPattern — docs-rich（短文本无链接 → 让文件树补全）===
const shortReadme = "# Tiny Repo\n\nA link collection.";
const unsupportedDetection = detectRepoPattern(shortReadme);
assert.strictEqual(unsupportedDetection.pattern, "docs-rich", "T6: 短文本无链接 → docs-rich（给文件树机会）");
console.log("✓ T6 detectRepoPattern(docs-rich): 短 README 无链接 → 不急着拒绝，让文件树补全");

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
let _fetchCalls = 0;
const fakeFetch = async (url) => {
  _fetchCalls++;
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

// === httpsGet 硬性总截止:TCP 通但 TLS/响应卡死必须被 deadline 掐穿 ===
// 复现现场:fastgithub 半死态(接受连接永不回包),导入卡 700s+,
// 20s 空闲超时不触发。哑服务器 + 小 deadline 直接验证。
{
  const net = await import("node:net");
  const { performance } = await import("node:perf_hooks");
  const srv = net.createServer(() => { /* 接受连接,永不响应 */ });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const t0 = performance.now();
  const r = await httpsGet(`https://127.0.0.1:${port}/x`, { rejectUnauthorized: false, deadlineMs: 600 });
  const ms = performance.now() - t0;
  srv.close();
  assert.equal(r.ok, false, "哑服务器应失败");
  assert.equal(r.error, "deadline", `应被 deadline 掐穿: ${r.error}`);
  assert.ok(ms < 3000, `应在 deadline 附近返回: ${ms.toFixed(0)}ms`);
  console.log(`✓ httpsGet 硬截止: 哑服务器 ${ms.toFixed(0)}ms 被 deadline 掐穿`);
}

// === 取消信号穿透:点"取消导入"必须在网络层立即生效,不等截止/批次跑完 ===
// 覆盖:httpsGet(预中止 + 在飞撕断) / fetchFileOutlines(批间检查,防半截快照) /
// fetchRepoInventory(README 循环检查,取消不误报成"无法拉取 README")。
{
  const { performance } = await import("node:perf_hooks");
  const net = await import("node:net");

  // C1: httpsGet 预中止 → 不建连接立即返回 aborted
  {
    const ctl = new AbortController();
    ctl.abort();
    const t0 = performance.now();
    const r = await httpsGet("https://192.0.2.1/never-reached", { signal: ctl.signal });
    const ms = performance.now() - t0;
    assert.equal(r.ok, false, "C1: 预中止应失败");
    assert.equal(r.error, "aborted", `C1: error 应为 aborted: ${r.error}`);
    assert.ok(ms < 100, `C1: 预中止应立即返回: ${ms.toFixed(0)}ms`);
    console.log(`✓ C1 httpsGet 预中止: ${ms.toFixed(1)}ms 返回 aborted(未建连接)`);
  }

  // C2: httpsGet 在飞中止 → 哑服务器上 120ms 撕断,而非等 5s deadline
  {
    const srv = net.createServer(() => { /* 接受连接,永不响应 */ });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 120);
    const t0 = performance.now();
    const r = await httpsGet(`https://127.0.0.1:${port}/x`, { rejectUnauthorized: false, deadlineMs: 5000, signal: ctl.signal });
    const ms = performance.now() - t0;
    srv.close();
    assert.equal(r.error, "aborted", `C2: 在飞中止应返回 aborted: ${r.error}`);
    assert.ok(ms < 1000, `C2: 应在 abort 后立即返回而非等 deadline: ${ms.toFixed(0)}ms`);
    console.log(`✓ C2 httpsGet 在飞中止: 哑服务器 ${ms.toFixed(0)}ms 被撕断(5s deadline 未触发)`);
  }

  // C3: fetchFileOutlines 预中止 → 立即抛"导入已取消",零 fetch 调用
  {
    let calls = 0;
    const spy = async () => { calls++; return { ok: true, text: async () => "# x" }; };
    const ctl = new AbortController();
    ctl.abort();
    let threw = null;
    try {
      await fetchFileOutlines(["a.md", "b.md", "c.md"], "o", "r", "main", spy, undefined, ctl.signal);
    } catch (e) { threw = e.message; }
    assert.match(threw ?? "", /取消/, `C3: 应抛'导入已取消': ${threw}`);
    assert.equal(calls, 0, `C3: 预中止不应发起任何 fetch,实际 ${calls}`);
    console.log("✓ C3 fetchFileOutlines 预中止: 抛'导入已取消' + 零 fetch");
  }

  // C4: fetchFileOutlines 中途中止 → 抛错而非带半截大纲返回(allSettled 会吞 reject,靠批间检查兜住)
  // 注:直调本函数时 fetchFn 是裸的(signal 由生产环境编排器注入),这里用直接 throw 模拟被撕断的 fetch
  {
    const ctl = new AbortController();
    let call = 0;
    const slowFetch = async () => {
      if (++call > 5) { // 第 2 批(第 6 次调用起)触发取消
        ctl.abort();
        throw new Error("aborted");
      }
      return { ok: true, text: async () => "# 标题\n\n正文" };
    };
    const files = Array.from({ length: 12 }, (_, i) => `f${i}.md`);
    let threw = null;
    try {
      await fetchFileOutlines(files, "o", "r", "main", slowFetch, undefined, ctl.signal);
    } catch (e) { threw = e.message; }
    assert.match(threw ?? "", /取消/, `C4: 中途取消应抛'导入已取消': ${threw}`);
    console.log("✓ C4 fetchFileOutlines 中途中止: 抛错,半截大纲不落盘");
  }

  // C5: fetchRepoInventory 预中止 → README 循环开头即退出,零 fetch
  {
    let calls = 0;
    const spy = async () => { calls++; return { ok: true, text: async () => "# R" }; };
    const ctl = new AbortController();
    ctl.abort();
    let threw = null;
    try {
      await fetchRepoInventory("o", "r", "main", spy, undefined, ctl.signal);
    } catch (e) { threw = e.message; }
    assert.match(threw ?? "", /取消/, `C5: 应抛'导入已取消': ${threw}`);
    assert.equal(calls, 0, `C5: 预中止不应 fetch README,实际 ${calls}`);
    console.log("✓ C5 fetchRepoInventory 预中止: 抛'导入已取消' + 零 fetch");
  }

  // C6: fetchRepoInventory README 拉取中途取消 → 干净的"已取消",不误报"无法拉取 README"
  // 注:直调时 fetchFn 是裸的,用直接 throw 模拟被编排器 signal 撕断的 fetch
  {
    const ctl = new AbortController();
    let calls = 0;
    const fetchThenAbort = async () => {
      calls++;
      if (calls >= 2) { // 第 2 个候选:取消已请求,fetch 被撕断
        ctl.abort();
        throw new Error("aborted");
      }
      return { ok: false, text: async () => "" }; // 第 1 个候选 404 → 走第 2 个
    };
    let threw = null;
    try {
      await fetchRepoInventory("o", "r", "main", fetchThenAbort, undefined, ctl.signal);
    } catch (e) { threw = e.message; }
    assert.match(threw ?? "", /取消/, `C6: 取消应报'导入已取消'而非'无法拉取 README': ${threw}`);
    assert.ok(!/无法拉取/.test(threw ?? ""), `C6: 不应误报无法拉取 README: ${threw}`);
    console.log("✓ C6 fetchRepoInventory 拉取中取消: 报'已取消'不误报");
  }
}

// === P 系列: extractBodyPreview 正文预览(Step 4 语义分组依据) ===

// P1: 常规 markdown——标题行/围栏代码/纯符号行不进预览,正文行空格连接
{
  const md = [
    "# 梯度下降",            // H1 跳
    "",                       // 空行跳
    "---",                    // 分隔线跳
    "梯度下降是迭代优化算法,沿负梯度方向更新参数。",
    "> 引用里的内容也算正文。", // 引用前缀剥掉,内容保留
    "## 收敛性",              // H2 跳
    "|---|---|",              // 表格分隔行跳
    "```python",
    "loss = fn(x)",           // 围栏内跳
    "```",
    "参见 [随机梯度下降](./sgd.md) 一节。", // 链接只留文字
    "![示意图](./fig.png)",   // 图片整体丢弃
  ].join("\n");
  const p = extractBodyPreview(md);
  assert.strictEqual(
    p,
    "梯度下降是迭代优化算法,沿负梯度方向更新参数。 引用里的内容也算正文。 参见 随机梯度下降 一节。",
    `P1: 预览应跳标题/围栏/符号行并降噪链接图片,实际: ${JSON.stringify(p)}`,
  );
  console.log("✓ P1 extractBodyPreview: 跳标题/围栏/符号行 + 链接留文字 + 图片丢弃");
}

// P2: 长文本截断到 maxChars(默认 300),单行无换行
{
  const long = "深度学习基础。".repeat(200); // 1400 字
  const p = extractBodyPreview(long);
  assert.strictEqual(p.length, 300, `P2: 默认截 300,实际 ${p.length}`);
  assert.ok(!p.includes("\n"), "P2: 预览是单行");
  const p100 = extractBodyPreview(long, 100);
  assert.strictEqual(p100.length, 100, "P2: maxChars 参数生效");
  console.log("✓ P2 extractBodyPreview: 截断到 maxChars + 单行输出");
}

// P3: 纯代码文件(markdown = docstring + 围栏代码) → 预览 = docstring 文字
{
  const codeMd = "nanoGPT 是一个极简的 GPT 训练实现,讲解注意力机制。\n\n```python\nimport torch\nmodel = GPT()\n```\n";
  const p = extractBodyPreview(codeMd);
  assert.strictEqual(p, "nanoGPT 是一个极简的 GPT 训练实现,讲解注意力机制。", `P3: ${JSON.stringify(p)}`);
  console.log("✓ P3 代码文件: docstring 进预览,围栏代码不进");
}

// P4: 全围栏代码 → 空预览(不炸)
{
  const p = extractBodyPreview("```\nprint(1)\n```\n");
  assert.strictEqual(p, "", "P4: 纯代码空预览");
  assert.strictEqual(extractBodyPreview(""), "", "P4: 空文本空预览");
  console.log("✓ P4 空预览: 纯代码/空文本返回空串");
}

// P5: CRLF 换行不炸 + outline 集成(bodyPreview 字段存在且与独立函数一致)
{
  const md = "# 标题\r\n\r\n正文第一段。\r\n## 小节\r\n第二段内容。\r\n";
  const ol = extractOutlineWithCharCounts(md, "a.md");
  assert.ok(typeof ol.bodyPreview === "string", "P5: outline 带 bodyPreview 字段");
  assert.strictEqual(ol.bodyPreview, "正文第一段。 第二段内容。", `P5: ${JSON.stringify(ol.bodyPreview)}`);
  assert.strictEqual(ol.bodyPreview, extractBodyPreview(md), "P5: 与独立函数一致");
  console.log("✓ P5 outline 集成: bodyPreview 字段随大纲产出(CRLF 安全)");
}

console.log("=== 翻译语言检测(repo-fetcher): 通过 ✅ ===");
