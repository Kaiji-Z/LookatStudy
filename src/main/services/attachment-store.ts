/**
 * attachment-store —— 聊天图片附件的磁盘存取(userData/attachments/)。
 *
 * 与 node_assets(课程内容资产)分家:聊天附件是会话性的,不进 DB、不按课程归属。
 * 文件名全部由本模块生成(uuid.ext),读取侧只认 isSafeAttachmentFile 的名字,
 * 渲染层传什么路径都逃不出 attachments 目录。
 */
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import {
  isSafeAttachmentFile,
  isSupportedImageMime,
  makeAttachmentFilename,
} from "./pure/attachment-files.js";

/** 附件根目录:userData/attachments(与 db/index 的 DB 文件同层)。 */
export function getAttachmentsRoot(): string {
  return join(app.getPath("userData"), "attachments");
}

export interface SavedAttachment {
  /** attachments 目录内的文件名(uuid.ext) */
  file: string;
  mime: string;
}

/** 把图片 base64 落盘。返回目录内文件名;不支持的 mime 抛错(intake 已挡,双保险)。 */
export async function saveChatImage(base64: string, mime: string): Promise<SavedAttachment> {
  if (!isSupportedImageMime(mime)) throw new Error(`unsupported attachment mime: ${mime}`);
  const file = makeAttachmentFilename(mime, randomUUID);
  const dir = getAttachmentsRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), Buffer.from(base64, "base64"));
  return { file, mime };
}

/** 读回 data-url(渲染层历史缩略图)。文件名不安全/不存在 → null,永不抛。 */
export async function readAttachmentDataUrl(file: string): Promise<string | null> {
  if (!isSafeAttachmentFile(file)) return null;
  try {
    const buf = await readFile(join(getAttachmentsRoot(), file));
    const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
    const mime =
      ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/gif";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** 删除一组附件文件(thread 删除清理)。单个失败忽略(清理是尽力而为)。 */
export async function deleteAttachmentFiles(files: string[]): Promise<void> {
  const dir = getAttachmentsRoot();
  await Promise.all(
    files
      .filter((f) => isSafeAttachmentFile(f))
      .map((f) => unlink(join(dir, f)).catch(() => undefined)),
  );
}
