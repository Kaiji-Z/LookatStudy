/**
 * 聊天附件的文件名/ mime 纯工具 —— attachment-store(磁盘侧)与 thread 清理共用。
 *
 * 安全是这里的重点:attachment:getDataUrl 的 file 参数来自渲染层,必须是
 * "我们生成的 uuid 文件名",不允许任何路径成分(../、盘符、分隔符)。
 */
import type { ChatAttachmentRef } from "@shared/types";

/** mime → 扩展名(落盘文件名的 ext 段;不认识的 mime 拒绝落盘)。 */
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 安全文件名判定:uuid.(png|jpg|webp|gif),不允许路径分隔符/点号开头/其他扩展名。
 * 大小写不敏感(生成侧永远小写,守卫侧宽容)。
 */
export function isSafeAttachmentFile(file: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/i.test(
    file,
  );
}

/** mime 是否可落盘(聊天附件只收这四种图,与 intake 层的图片判定对齐)。 */
export function isSupportedImageMime(mime: string): boolean {
  return mime in MIME_EXT;
}

/** 由 mime 生成落盘文件名(uuid + 扩展)。不支持的 mime 抛错(调用方在 intake 已挡)。 */
export function makeAttachmentFilename(mime: string, uuid: () => string): string {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`unsupported attachment mime: ${mime}`);
  return `${uuid()}.${ext}`;
}

/** 从持久化 parts_json 里收集附件的落盘文件名(thread 删除时清理磁盘用)。
 * 解析失败/无附件 → 空数组(清理是尽力而为,永不抛)。 */
export function collectAttachmentFilesFromParts(partsJson: string | null | undefined): string[] {
  if (!partsJson) return [];
  try {
    const parsed = JSON.parse(partsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const p of parsed) {
      if (
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "attachment"
      ) {
        const ref = (p as { attachment?: ChatAttachmentRef }).attachment;
        if (ref && typeof ref.file === "string" && isSafeAttachmentFile(ref.file)) {
          out.push(ref.file);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
