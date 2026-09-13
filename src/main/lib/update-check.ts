/**
 * 启动时新版本检查(2026-09-13 审计后续,轻量通道:只提示、不自动下载安装)。
 *
 * 设计约束:
 * - 零新依赖:走 releases/latest 页面重定向取 tag(比 GitHub API 轻,代理友好)。
 * - 失败零打扰:离线/被墙/超时(8s)一律返回 null,绝不弹错。
 * - 24h 结果缓存(settings update_check_cache),避免每次开窗都打一跳网络。
 * - 每版本只提示一次(update_prompt_seen 由渲染层在真正弹出时写——提示了才算见过,
 *   检查失败下一轮还会再试)。
 */
import { version as APP_VERSION } from "../../../package.json";
import type { UpdateInfo } from "@shared/types";

export const RELEASES_PAGE = "https://github.com/Kaiji-Z/LookatStudy/releases";
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
export const UPDATE_CACHE_TTL_MS = 24 * 3600 * 1000;

export type { UpdateInfo };

/**
 * semver 主.次.修比较(current < tag → -1;相等 → 0;> → 1)。
 * 容忍 v 前缀与预发布/构建尾缀(v0.35.0-beta.1 → 取 0.35.0;预发布差异不细究——
 * 本仓发版 tag 均为纯三段)。
 */
export function compareVersions(current: string, tag: string): number {
  const parse = (s: string): number[] =>
    s
      .trim()
      .replace(/^v/i, "")
      .split(/[+-]/)[0]!
      .split(".")
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(tag);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** 从 releases/latest 的最终跳转 URL 抽 tag(…/releases/tag/v0.35.0 → v0.35.0);非 tag 页 → null。 */
export function tagFromReleaseUrl(url: string): string | null {
  const m = /\/releases\/tag\/(v?[0-9][\w.\-]*)/i.exec(url);
  return m ? m[1]! : null;
}

/** 拉最新 tag;任何失败(网络/超时/非 tag 跳转)返回 null。fetchFn 可注入供测试。 */
export async function fetchLatestTag(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPDATE_CHECK_TIMEOUT_MS);
    try {
      const res = await fetchFn(`${RELEASES_PAGE}/latest`, {
        redirect: "follow",
        signal: ctrl.signal,
      });
      return tagFromReleaseUrl(res.url);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function buildUpdateInfo(current: string, tag: string): UpdateInfo {
  return {
    current,
    latest: tag,
    hasUpdate: compareVersions(current, tag) < 0,
    releaseUrl: `${RELEASES_PAGE}/tag/${encodeURIComponent(tag)}`,
  };
}

export { APP_VERSION };
