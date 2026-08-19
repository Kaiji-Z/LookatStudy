/**
 * 内容源接口 —— 抽象"取文件内容/图片"的来源，让 executeImport 不关心数据来自
 * GitHub CDN 还是本地磁盘还是内存里的虚拟文件。
 *
 * - GithubContentSource: 通过 CDN 拉取（fetchSingleFileContent + fetchImageAsDataUrl）
 * - LocalContentSource: 从 scanFolder 已扫描的缓存读文件，图片从磁盘读
 * - MemoryContentSource: 纯内存虚拟文件(url 文章/粘贴文本/epub 章节)——
 *   图片一律 null:网页文章的图是绝对 URL,import-pipeline 的 inlineImages
 *   对 http(s) 直接透传,根本不会走到 ContentSource
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
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

/** 图片扩展名 → MIME 映射（LocalContentSource 用） */
const LOCAL_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/**
 * 本地内容源：文件内容从 scanFolder 已解析的缓存读取，图片从磁盘读取。
 *
 * - docs Map 的 key 是相对根目录的路径（用 / 分隔），如 "lessons/1-Intro/README.md"
 *   翻译文件 key 是 "translations/{lang}/{原路径}"
 * - getImageDataUrl 从磁盘读文件（rootDir + path），转 base64 data-url
 * - getImageFallbackUrl 返回 null（本地无 CDN，下载失败时保留原 src）
 */
export class LocalContentSource implements ContentSource {
  constructor(
    private rootDir: string,
    private docs: Map<string, string>,
  ) {}

  async getFile(path: string): Promise<string | null> {
    return this.docs.get(path) ?? null;
  }

  async getImageDataUrl(path: string, maxBytes = 200_000): Promise<string | null> {
    try {
      const abs = join(this.rootDir, path);
      if (!existsSync(abs)) return null;
      const buf = await readFile(abs);
      if (buf.length > maxBytes) return null; // 太大不内联
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      const mime = LOCAL_IMAGE_MIME[ext] ?? "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }

  getImageFallbackUrl(_path: string): string | null {
    return null; // 本地无 CDN fallback，保留原 src
  }
}

/**
 * 内存内容源:url 文章 / 粘贴文本 / epub 章节 / 音频转写稿等"虚拟文件"用。
 * Step5 的正文全部来自内存 Map;图片不处理(绝对 URL 在 inlineImages 已透传,
 * 相对路径图片在这类来源里本就不存在)。
 */
export class MemoryContentSource implements ContentSource {
  constructor(private docs: Map<string, string>) {}

  async getFile(path: string): Promise<string | null> {
    return this.docs.get(path) ?? null;
  }

  async getImageDataUrl(_path: string): Promise<string | null> {
    return null;
  }

  getImageFallbackUrl(_path: string): string | null {
    return null;
  }
}
