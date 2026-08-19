/**
 * URL 导入服务 —— 网页文章正文抽取 + arXiv 论文下载(Step 1 的 url 分支用)。
 *
 * 网络层走注入的 fetchFn(import-job-service 已统一挂取消 signal);解析层是
 * pure/html-article(readability+turndown)与 lib/pdf-text(pdf-inspector)。
 * 失败必须抛带指引的错误——绝不静默降级成"整页噪声"。
 */
import { extractArticle } from "./pure/html-article.js";
import { downloadToBuffer } from "./pure/repo-fetcher.js";

const UA_HEADERS = { "User-Agent": "lookatstudy-import/0.1 (course importer; +https://github.com/Kaiji-Z/LookatStudy)" };

/** 抓网页 → readability 正文 → markdown。非文章页/抽取失败抛诚实错误。 */
export async function fetchArticleMarkdown(
  url: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<{ title: string; markdown: string }> {
  const r = await fetchFn(url, { signal, headers: UA_HEADERS });
  if (!r.ok) throw new Error(`网页抓取失败(HTTP ${r.status})——请检查链接是否可公开访问`);
  const contentType = r.headers.get("content-type") ?? "";
  if (/pdf/i.test(contentType)) {
    throw new Error("这个链接是 PDF 文件——请改用 arXiv 链接或把 PDF 放进文件夹导入");
  }
  const html = await r.text();
  const article = extractArticle(html, url);
  if (!article) {
    throw new Error("无法从该网页抽取正文(可能是非文章页、需要登录或由脚本渲染)——可把正文复制到「粘贴文本」导入");
  }
  return article;
}

/** 抓 arXiv:abs 页拿标题(尽力而为,失败用 ID 当标题)+ pdf 页拿正文。 */
export async function fetchArxivMarkdown(
  arxivId: string,
  pdfUrl: string,
  absUrl: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ title: string; markdown: string }> {
  let title = `arXiv ${arxivId}`;
  try {
    const absResp = await fetchFn(absUrl, { signal, headers: UA_HEADERS });
    if (absResp.ok) {
      const html = await absResp.text();
      // <title>[2401.12345] Paper Title</title>
      const m = html.match(/<title>[^<]*\]?\s*([^<]+)<\/title>/i);
      if (m?.[1]) {
        const t = m[1].trim().replace(/\s+/g, " ");
        if (t && !/arxiv/i.test(t)) title = t;
        else if (m[1].includes("]")) title = m[1].split("]").pop()!.trim() || title;
      }
    }
  } catch {
    /* 标题尽力而为,不影响正文 */
  }

  onProgress?.(`下载 PDF(${arxivId})…`);
  const buf = await downloadToBuffer(pdfUrl, fetchFn, { signal, headers: UA_HEADERS });
  const { parsePdfText } = await import("../lib/pdf-text.js");
  const markdown = await parsePdfText(buf);
  if (!markdown.trim()) {
    throw new Error("PDF 文本提取为空——可能是扫描版论文(纯图片页),暂不支持");
  }
  return { title, markdown };
}
