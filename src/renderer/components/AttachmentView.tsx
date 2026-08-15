/**
 * AttachmentView —— 用户消息里的附件渲染(v0.10)。
 *
 * 图片:96px 缩略图(乐观消息用本地 previewUrl;历史消息经 attachment:getDataUrl
 * 惰性取回,模块级缓存避免重复 IPC),点击全屏灯箱查看。
 * 文本文件:FileText chip(正文已内联 content 给 LLM,气泡只显示名字)。
 */
import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import type { ChatAttachmentRef } from "@shared/types";
import type { ChatMessagePart } from "@shared/part-accumulator";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";

/** 历史附件 data-url 的模块级缓存(同一文件跨消息只拉一次)。 */
const dataUrlCache = new Map<string, string>();

function AttachmentImage({ ref_, onOpen }: { ref_: ChatAttachmentRef; onOpen: (src: string) => void }) {
  const t = useLang();
  const [src, setSrc] = useState<string | null>(ref_.previewUrl ?? (ref_.file ? dataUrlCache.get(ref_.file) ?? null : null));

  useEffect(() => {
    if (src || !ref_.file) return;
    let cancelled = false;
    (async () => {
      const cached = dataUrlCache.get(ref_.file!);
      if (cached) {
        if (!cancelled) setSrc(cached);
        return;
      }
      const url = await api.getAttachmentDataUrl(ref_.file!);
      if (url && !cancelled) {
        dataUrlCache.set(ref_.file!, url);
        setSrc(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref_.file, src]);

  if (!src) {
    // 落盘失败/文件已被清理:占位块(不裂图)
    return (
      <div
        className="w-24 h-24 rounded-lg bg-ink/[0.06] flex items-center justify-center text-caption text-ink-faint"
        title={ref_.name}
      >
        {ref_.name.slice(0, 8)}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(src)}
      aria-label={t("chat.attach.preview", { name: ref_.name })}
      className="w-24 h-24 rounded-lg overflow-hidden border border-[var(--border)] hover:border-accent transition-colors shrink-0"
    >
      <img src={src} alt={ref_.name} className="w-full h-full object-cover" />
    </button>
  );
}

/** 灯箱:全屏遮罩 + 原图,点击任意处关闭。 */
function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label={name}
      className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-8 cursor-zoom-out animate-[toast-enter_.15s_ease-out]"
      onClick={onClose}
      data-testid="attachment-lightbox"
    >
      <img src={src} alt={name} className="max-w-full max-h-full object-contain rounded-lg shadow-elevated" />
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** 用户消息的附件区:图片缩略图行 + 文本 chip 行。无附件渲染 null。 */
export function UserAttachments({ parts }: { parts: ChatMessagePart[] }) {
  const t = useLang();
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const attachments = parts
    .filter((p): p is Extract<ChatMessagePart, { type: "attachment" }> => p.type === "attachment")
    .map((p) => p.attachment);
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === "image");
  const texts = attachments.filter((a) => a.kind === "text");
  return (
    <div className="flex flex-col gap-1.5 mb-1" data-testid="message-attachments">
      {images.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {images.map((a, i) => (
            <AttachmentImage key={a.file ?? a.previewUrl ?? `${a.name}:${i}`} ref_={a} onOpen={(src) => setLightbox({ src, name: a.name })} />
          ))}
        </div>
      )}
      {texts.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {texts.map((a, i) => (
            <span
              key={`${a.name}:${i}`}
              data-tooltip={t("chat.attach.textChip")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ink/[0.06] text-caption text-ink-muted"
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[12rem]">{a.name}</span>
            </span>
          ))}
        </div>
      )}
      {lightbox && (
        <Lightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
