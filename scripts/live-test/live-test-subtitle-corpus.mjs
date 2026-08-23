/**
 * live: 字幕解析语料核查(2026-08-23,多样本采样驱动)。
 *
 * 真实样本缓存 scripts/fixtures/subtitle-corpus/(gitignored,缺则从
 * freeCodeCamp/subtitle-translations 经 jsdelivr 重下,不可达记 SKIP)。
 * 语料库坑:多数"Chinese Simplified/Traditional"文件与英文版逐字节同大小=
 * 未翻译占位(实测 55 份里真翻译的只有 build-your-own-functions 与
 * intro-elements-of-python 两份);占位样本只做"不崩"断言。断言四类硬指标:
 *   1. 正文量:中文样本成文 ≥ 3000 字符、CJK ≥ 500 字;
 *   2. CJK 接行零污染:全文无 "汉字 空格 汉字"(旧实现实测 78 处);
 *   3. 时间轴零残留:输出不含 "-->" / 纯序号行痕迹;
 *   4. 双语混排保留:中文行内英文(如 Python)不丢、实体零残留。
 *
 * 网络局限(诚实记录,见 .goal/SPEC.md 停止条件):本网不可达 YouTube/ gist,
 * YouTube 自动字幕滚动窗结构按 yt-dlp issue #1734 公开文档构造进
 * verify-video-import.mjs T4b(确定性 fixture);B站 CC 字幕 API 免登录返回
 * 空列表(需 SESSDATA),CC 直取对免登录定位不可行,维持音轨转写路径。
 * 跑法: npx tsx scripts/live-test/live-test-subtitle-corpus.mjs(需网络首次)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试不需要 key —— no key ok,纯下载+解析)
let failed = 0, skipped = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const skip = (m) => { console.log(`  ⏭️  SKIP ${m}`); skipped++; };
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

const BASE = "https://cdn.jsdelivr.net/gh/freeCodeCamp/subtitle-translations@main/subtitles";
const SAMPLES = [
  // [缓存名, 说明, URL, {minChars, minCjk, keyword}]
  ["zh-hans_intro-elements-of-python.srt", "简体人翻(Python 入门)",
    `${BASE}/Chinese%20Simplified/scientific-computing-with-python/python-for-everybody/intro-elements-of-python.srt`,
    { minChars: 6000, minCjk: 500, keyword: "Python" }],
  ["zh-hans_build-your-own-functions.srt", "简体人翻(真翻译,函数)",
    `${BASE}/Chinese%20Simplified/scientific-computing-with-python/python-for-everybody/build-your-own-functions.srt`,
    { minChars: 3000, minCjk: 2000, keyword: "def" }],
  ["zh-hant_intermediate-strings.srt", "繁体占位(语料库未翻译,内容为英文)",
    `${BASE}/Chinese%20Traditional/scientific-computing-with-python/python-for-everybody/intermediate-strings.srt`,
    { minChars: 6000, minCjk: 0, keyword: "string" }],
  ["english_intro-elements-of-python.srt", "英文原文(与简体同视频)",
    `${BASE}/english/scientific-computing-with-python/python-for-everybody/intro-elements-of-python.srt`,
    { minChars: 8000, minCjk: 0, keyword: "Python" }],
  ["english_build-your-own-functions.srt", "英文原文(与简体真翻译同视频)",
    `${BASE}/english/scientific-computing-with-python/python-for-everybody/build-your-own-functions.srt`,
    { minChars: 8000, minCjk: 0, keyword: "def" }],
  ["english_web-services-json.srt", "英文原文(Web 服务 JSON)",
    `${BASE}/english/scientific-computing-with-python/python-for-everybody/web-services-json.srt`,
    { minChars: 5000, minCjk: 0, keyword: "JSON" }],
];

mkdirSync("scripts/fixtures/subtitle-corpus", { recursive: true });
const { parseSubtitleToText } = await import("../../src/main/services/pure/subtitle-parse.ts");

for (const [name, note, url, want] of SAMPLES) {
  const cache = `scripts/fixtures/subtitle-corpus/${name}`;
  if (!existsSync(cache)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) { skip(`${note}: 下载 ${res.status}`); continue; }
      writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    } catch {
      skip(`${note}: 网络不可达(${url.slice(0, 60)}…)`);
      continue;
    }
  }
  try {
    const out = parseSubtitleToText(readFileSync(cache, "utf8"));
    const cjk = (out.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const cjkSpace = (out.match(/[\u4e00-\u9fff] [\u4e00-\u9fff]/g) ?? []).length;
    const timelineLeak = out.includes("-->") || /\b00:0\d:\d\d\b/.test(out);
    const entities = (out.match(/&[a-z]+;|&#\d+;/gi) ?? []).length;
    let pass = true;
    if (out.length < want.minChars) { bad(`${note}: 正文量 ${out.length} < ${want.minChars}`); pass = false; }
    if (cjk < want.minCjk) { bad(`${note}: CJK ${cjk} < ${want.minCjk}`); pass = false; }
    if (!out.toLowerCase().includes(want.keyword.toLowerCase())) { bad(`${note}: 缺关键词 ${want.keyword}`); pass = false; }
    if (cjkSpace > 0) { bad(`${note}: CJK 间空格污染 ${cjkSpace} 处(应为 0)`); pass = false; }
    if (timelineLeak) { bad(`${note}: 时间轴残留泄漏进正文`); pass = false; }
    if (entities > 0) { bad(`${note}: 实体残留 ${entities} 处`); pass = false; }
    if (pass) ok(`${note}: ${out.length} 字符,CJK ${cjk},零污染`);
  } catch (e) {
    bad(`${note}: 解析抛错 ${e.message}`);
  }
}

/** 滚动窗 vtt(按 yt-dlp issue #1734 文档结构)成文后重复率核查(本地,不依赖网)。 */
{
  const rolling = [
    "WEBVTT", "Kind: captions", "",
    "00:00:00.719 --> 00:00:03.829 align:start position:0%",
    "hello world", "this is<00:00:01.099><c> a</c> test", "",
    "00:00:03.829 --> 00:00:05.340 align:start position:0%",
    "hello world", "this is a test", "",
    "00:00:05.340 --> 00:00:07.000 align:start position:0%",
    "this is a test", "second thought begins", "",
    "00:00:07.000 --> 00:00:08.000 align:start position:0%",
    "second thought begins", "[Music]", "",
  ].join("\n");
  const out = parseSubtitleToText(rolling);
  const words = out.split(" ");
  const dup = words.length !== new Set(words).size;
  if (out === "hello world this is a test second thought begins" && !dup) {
    ok(`滚动窗去重: ${JSON.stringify(out)}`);
  } else {
    bad(`滚动窗去重失败: ${JSON.stringify(out)}`);
  }
}

console.log(`\n${failed === 0 ? "ALL GREEN" : "FAILURES"}: fail=${failed} skip=${skipped}`);
process.exit(failed === 0 ? 0 : 1);
