/**
 * 内容源接口 —— 抽象"取文件内容/图片"的来源，让 executeImport 不关心数据来自
 * GitHub CDN 还是本地磁盘。
 *
 * - GithubContentSource: 通过 CDN 拉取（fetchSingleFileContent + fetchImageAsDataUrl）
 * - LocalContentSource（阶段 B 实现）: 从 scanFolder 已扫描的缓存读取
 */
import { fetchSingleFileContent, fetchImageAsDataUrl, cdnUrl } from "./pure/repo-fetcher.js";

export interface ContentSource {
  /** 取文件正文（已解析的 markdown 文本）。null = 文件不存在/读取失败 */
  getFile(path: string): Promise<string | null>;
  /** 取图片的 base64 data-url（< 200KB 内联）。null = 下载失败/超限 */
  getImageDataUrl(path: string): Promise<string | null>;
  /** 取图片的 fallback URL（下载失败时用）。GitHub 返回 CDN 外链，本地返回 null（保留原 src） */
  getImageFallbackUrl(path: string): string | null;
}

/**
 * GitHub 内容源：通过 cdn.jsdelivr.net CDN 拉取文件和图片。
 * 行为和改造前的 executeImport 直接调 fetch 一致。
 */
export class GithubContentSource implements ContentSource {
  constructor(
    private owner: string,
    private repo: string,
    private branch: string,
    private fetchFn: typeof fetch,
  ) {}

  async getFile(path: string): Promise<string | null> {
    return fetchSingleFileContent(path, this.owner, this.repo, this.branch, this.fetchFn);
  }

  async getImageDataUrl(path: string): Promise<string | null> {
    return fetchImageAsDataUrl(path, this.owner, this.repo, this.branch, this.fetchFn);
  }

  getImageFallbackUrl(path: string): string | null {
    return cdnUrl(this.owner, this.repo, this.branch, path);
  }
}
