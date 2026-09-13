import { isAbsolute, resolve, sep } from "node:path";

/**
 * zip/tar 条目名(或任意外部输入的相对路径)→ 落盘绝对路径的穿越守卫(纯函数)。
 *
 * 返回 null = 条目非法(绝对路径 / Windows 盘符 / 含 .. 段 / NUL 字节),调用方跳过或抛错;
 * 返回绝对路径 = 已验证 resolve 后仍落在 rootDir 目录树内。
 * 与 speech-plan.ts 的 tarEntryDest 同一纪律,抽出共用:shimeji zip 解包 /
 * confirmImport 的 characterRefs 等一切"外部字符串进文件路径"的入口。
 */
export function safeEntryDest(rootDir: string, entryName: string): string | null {
  if (!entryName || entryName.includes("\0")) return null;
  const norm = entryName.replace(/\\/g, "/");
  if (isAbsolute(norm) || /^[A-Za-z]:/.test(norm)) return null;
  if (norm.split("/").some((s) => s === "..")) return null;
  const root = resolve(rootDir);
  const dest = resolve(root, norm);
  if (dest !== root && !dest.startsWith(root + sep)) return null;
  return dest;
}
