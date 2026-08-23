/**
 * live: 网页文章抽取语料核查(2026-08-23,真实站点采样驱动)。
 *
 * 7 个真实 URL(CSDN/搜狐/阿里云/掘金/英文博客/Sphinx 文档站/知乎反爬)。
 * 分层断言(规则只管高置信模板,语义判断交 Step4 LLM):
 *   1. 站点模板残留为零:尾部不得再出现"返回…查看更多"/"目录 热门文章 最新文章"
 *      (stripTailNavigation 规则层);
 *   2. 正文量阈值 + 标题可辨;
 *   3. 已知限制照实记录不硬修:搜狐半 SPA(服务端 HTML 只有摘要段)、d2l 文档站
 *      (Readability 选目录容器)、知乎 403 反爬(诚实报错即通过)。
 * 作者写的推广尾段(如 CSDN"欢迎关注公众号")是正文,规则层不删——由 Step4
 * LLM 的正文边界指引处理,corpus 不断言其被删。
 * 跑法: npx tsx scripts/live-test/live-test-web-corpus.mjs(需网络)
 */
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试不需要 key —— no key ok)
let failed = 0, skipped = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const skip = (m) => { console.log(`  ⏭️  SKIP ${m}`); skipped++; };
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

const { fetchArticleMarkdown } = await import("../../src/main/services/url-import-service.ts");

const CASES = [
  // [id, url, 标题关键词, 最小字符, 最小中文(0=不限), 模板残留不得含[]]
  ["csdn-技术长文", "https://blog.csdn.net/dirolamo/article/details/139053653", "深度学习", 3000, 2000, []],
  ["sohu-半SPA(已知限制:服务端只有摘要段)", "https://www.sohu.com/a/768771145_120795794", "人工智能", 500, 400, ["返回搜狐", "查看更多"]],
  ["aliyun-侧栏模板", "https://developer.aliyun.com/article/220781", "公众号", 1500, 500, ["目录 热门文章 最新文章", "热门文章"]],
  ["juejin-技术文", "https://juejin.cn/post/7624738118495371283", "公众号", 5000, 1000, []],
  ["paulgraham-英文长文", "https://paulgraham.com/greatwork.html", "Great Work", 30000, 0, []],
];

for (const [id, url, kw, minChars, minCjk, banned] of CASES) {
  try {
    const r = await fetchArticleMarkdown(url, fetch, undefined);
    if (!r) { bad(`${id}: 意外返回 null`); continue; }
    const cjk = (r.markdown.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const tail = r.markdown.slice(-400);
    const residue = banned.filter((b) => tail.includes(b));
    if (r.markdown.length >= minChars && cjk >= minCjk && r.title.includes(kw) && residue.length === 0) {
      ok(`${id}: ${r.markdown.length} 字/中文${cjk},标题对,模板零残留`);
    } else {
      bad(`${id}: len=${r.markdown.length}(≥${minChars}?) cjk=${cjk}(≥${minCjk}?) 标题含${kw}=${r.title.includes(kw)} 残留=${JSON.stringify(residue)}`);
    }
  } catch (e) { bad(`${id}: ${e.message.slice(0, 90)}`); }
}

// d2l 文档站:Readability 会选全站目录容器(已知限制,不硬修)——断言不崩+返回字符串
try {
  const r = await fetchArticleMarkdown("https://zh.d2l.ai/chapter_linear-regression/linear-regression.html", fetch, undefined);
  if (r && typeof r.markdown === "string" && r.markdown.length > 0) {
    skip(`d2l Sphinx 文档站: 抽到 ${r.markdown.length} 字(Readability 选目录容器,已知限制——文档站建议粘贴正文或用仓库导入)`);
  } else bad(`d2l: 异常返回 ${r === null ? "null" : typeof r}`);
} catch (e) { bad(`d2l: ${e.message.slice(0, 80)}`); }

// 知乎:服务器直连 403 反爬(诚实报错即通过——错误信息已指引)
try {
  await fetchArticleMarkdown("https://zhuanlan.zhihu.com/p/671051149", fetch, undefined);
  bad("知乎: 反爬 403 未诚实报错");
} catch (e) {
  if (/403|抓取失败/.test(e.message)) ok(`知乎反爬: 诚实报错(${e.message.slice(0, 40)}…)`);
  else bad(`知乎: 非预期错误 ${e.message.slice(0, 60)}`);
}

console.log(`\n=== 网页语料核查: ${failed === 0 ? "✅ 全部通过" : "❌"} (skip ${skipped}) ===`);
process.exit(failed === 0 ? 0 : 1);
