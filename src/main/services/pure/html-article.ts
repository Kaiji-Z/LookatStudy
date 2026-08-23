/**
 * 网页文章正文抽取 —— linkedom DOM + @mozilla/readability + turndown。
 *
 * 三层纯 JS(零原生编译,符合 gotcha #8):
 *   html → linkedom 解析 DOM → readability 抽正文(去导航/侧栏/广告)
 *        → 图片/链接地址绝对化(相对地址在 CSP 与离线场景都是死链)
 *        → turndown 转 markdown(保留 h1-h6/代码块/图片/链接)
 *
 * 绝对 URL 图片零额外接线:import-pipeline 的 inlineImages 对 http(s) 直接
 * 透传,CSP img-src 已允许 https:。
 *
 * 纯函数(html 字符串进,markdown 出),verify 直测。
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ExtractedArticle {
  title: string;
  markdown: string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/** 主进程无 DOM lib:用结构化类型描述"能查/改属性的节点集合",linkedom 节点天然满足。 */
interface QueryableNode {
  querySelectorAll(selector: string): Iterable<{
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): unknown;
    remove(): unknown;
  }>;
}

/** 图片 src 绝对化(相对地址 → 基于 baseUrl 解析);data: 与绝对地址原样保留。 */
function absolutizeImgs(root: QueryableNode, baseUrl: string): void {
  if (!baseUrl) return;
  for (const img of root.querySelectorAll("img")) {
    const raw = img.getAttribute("src") ?? "";
    if (!raw || raw.startsWith("data:") || /^https?:/i.test(raw)) continue;
    try {
      img.setAttribute("src", new URL(raw, baseUrl).toString());
    } catch {
      /* 非法地址保留原样 */
    }
  }
}

/** turndown 的输入类型(避免引用 DOM lib 的 HTMLElement)。 */
type TurndownInput = Parameters<TurndownService["turndown"]>[0];

/**
 * 从完整 HTML 抽取文章正文并转 markdown。
 * readability 判不了正文(非文章页/结构怪异)返回 null——调用方给诚实报错,
 * 不退回"整页转 markdown"(导航噪声成课,比失败更糟)。
 */
export function extractArticle(html: string, baseUrl = ""): ExtractedArticle | null {
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();
  if (!article?.content) return null;

  const contentDoc = parseHTML(`<div id="r">${article.content}</div>`);
  const root = contentDoc.document.querySelector("#r");
  if (!root) return null;
  absolutizeImgs(root as unknown as QueryableNode, baseUrl);

  let body = turndown.turndown(root as unknown as TurndownInput).trim();
  // readability 通常把主标题从正文剥走(变成 article.title)——补回 H1;
  // 若正文自带首行 H1 且与标题几乎一致则不重复
  const title = (article.title ?? "").trim();
  const firstLine = body.split("\n")[0] ?? "";
  const alreadyHasTitleH1 = /^#\s+/.test(firstLine) && title && firstLine.slice(2).trim() === title;
  const md = alreadyHasTitleH1 ? body : `# ${title || "无标题文章"}\n\n${body}`;
  return { title: title || "无标题文章", markdown: stripTailNavigation(md) };
}

/**
 * 尾部**站点模板指纹**清理(2026-08-23,真实站点采样驱动)。
 * 原则:规则只管高置信度的**机器生成模板**(跨文章稳定、作为正文出现概率≈0);
 * 除此之外的不确定判断(作者自己写的推广段/水印/相关阅读算不算正文)一律不猜——
 * 那是 Step4 LLM 的职责(设计课程时排除非正文尾段),解析层动了就是误删正文
 * (实测:按"欢迎关注公众号"删规则,把 CSDN 作者自己写的推广段删了)。
 */
const NAV_TAIL_PATTERNS = [
  /返回\S{0,6}[，,]?\s*查看更多/,   // 搜狐模板
  /点击进入\S{0,8}首页/,             // 搜狐模板
  /^热门文章$/,                       // 阿里云侧栏
  /^最新文章$/,                       // 阿里云侧栏
  /^目录\s*$/,                        // 阿里云侧栏(尾部窗口内)
  /^END\b.*版权/,                     // 公众号转载页模板
];
/** 行内导航后缀:正文与模板被 turndown 并成一行时剥掉(精确短语,全文安全) */
const INLINE_NAV_SUFFIXES = ["目录 热门文章 最新文章"];
export function stripTailNavigation(md: string): string {
  if (!md) return md;
  for (const suffix of INLINE_NAV_SUFFIXES) md = md.split(suffix).join("");
  const lines = md.split("\n");
  let end = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
    const ln = lines[i]!.trim();
    if (!ln) continue;
    // markdown 标记前缀剥掉再判(模板可能被转成 "## " 标题行)
    const bare = ln.replace(/^#{1,6}\s*/, "").replace(/^[>\-*]\s*/, "");
    const isNav = NAV_TAIL_PATTERNS.some((re) => re.test(bare) || re.test(ln));
    // 纯图片行:整行就是一张图或无空格裸图路径(CSDN 尾模板图)
    const isBareImage = /^!\[[^\]]*\]\([^)]*\)$/.test(ln) || /^\S+\.(jpeg|jpg|png|gif|webp)\)?$/i.test(ln);
    if (isNav || isBareImage) continue;
    end = i + 1;
    break;
  }
  return lines.slice(0, end).join("\n").trimEnd();
}

/**
 * 任意 HTML/XHTML → markdown(epub 章节用,不走 readability——章节本身就是正文)。
 * @param stripImages epub v1 不解包图片:img 标签整体剥除(文本优先)
 */
export function htmlToMarkdown(html: string, opts: { stripImages?: boolean } = {}): string {
  let { document } = parseHTML(html);
  // linkedom 对无 <html> 包裹的片段(如裸 <body> 或纯内联标签)会给出空 body ——
  // 补一层包裹重解析,内容才能挂上。
  if (!document.body || document.body.childNodes.length === 0) {
    document = parseHTML(`<html><body>${html}</body></html>`).document;
  }
  // v0.19 公式回收(在 script 清理**之前**做,MathJax v2 的 TeX 就存在 script 里):
  //   KaTeX 渲染节点 → 读 .katex-mathml annotation 的 TeX 原文,回写成 $..$/$$..$$;
  //   MathJax v2 → script[type="math/tex"] 同款;MathJax v3(mjx-container)无 TeX
  //   源可回收,退化为按现状转文字(已知边界)。
  type MathNode = { textContent: string | null; replaceWith(n: unknown): void; querySelector(s: string): { textContent: string | null } | null };
  for (const el of Array.from(document.querySelectorAll("script[type='math/tex']")) as unknown as MathNode[]) {
    const tex = (el.textContent ?? "").trim();
    if (tex) el.replaceWith(document.createTextNode(tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`));
  }
  for (const el of Array.from(document.querySelectorAll(".katex")) as unknown as MathNode[]) {
    const tex = (el.querySelector("annotation")?.textContent ?? "").trim();
    if (tex) el.replaceWith(document.createTextNode(tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`));
  }
  for (const tag of ["script", "style", "head"]) {
    for (const el of document.querySelectorAll(tag)) el.remove();
  }
  if (opts.stripImages) {
    for (const el of document.querySelectorAll("img, picture, svg, figure")) el.remove();
  }
  const body = document.body;
  if (!body) return "";
  return turndown.turndown(body as unknown as TurndownInput).trim();
}
