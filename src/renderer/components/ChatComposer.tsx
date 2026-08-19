/**
 * ChatComposer —— 中栏输入区。
 *
 * v0.2:starter prompts 横条 + 教学人设药丸 + textarea + 发送/停止。
 * v0.10 新增:
 *   - 附件:📎按钮/粘贴/拖拽收图(走 vision)与文本文件(内联正文),缩略图栏可删
 *   - 底部工具栏(工具栏后撤原则,caption 调):思考强度 · 上下文用量表 · 模型切换
 *   - 上下文数据自取 agent:getContextUsage(与实发同源),本地叠加草稿估算
 *
 * 未配 key 时显示引导(去设置)。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowUp, Square, BookOpen, Compass, Hammer, Paperclip, FileText, ScanText, X, Mic, Loader2 } from "lucide-react";
import type { Soul, StarterPrompt, HumanFrictionCategory, ChatAttachmentInput, ContextUsageInfo } from "@shared/types";
import { checkAttachmentFile, ATTACHMENT_LIMITS } from "@shared/attachment-intake";
import { estimateTokens } from "@shared/token-estimate";
import { api } from "../lib/api.js";
import { useLang, useLangValue, translate } from "../lib/i18n.js";
import { useAsrInput } from "../lib/useAsrInput.js";
import { ModelPicker } from "./ModelPicker.js";
import { ContextMeter } from "./ContextMeter.js";
import { EffortPicker } from "./EffortPicker.js";

/** soul 名 → i18n key(短标签,显示在药丸里)。 */
const SOUL_LABEL_KEY: Record<string, string> = {
  direct: "soul.direct",
  guide: "soul.guide",
  practice: "soul.practice",
};

/** soul → lucide 图标(场景语义,非装饰)。 */
const SOUL_ICONS: Record<string, typeof Compass> = {
  direct: BookOpen, // 书:讲解/精讲
  guide: Compass, // 罗盘:探索/指引方向
  practice: Hammer, // 锤子:动手做
};

/** soul 名 → i18n key(完整说明,data-tooltip 显示)。 */
const SOUL_DESC_KEY: Record<string, string> = {
  direct: "soul.direct.desc",
  guide: "soul.guide.desc",
  practice: "soul.practice.desc",
};

/** 文件选择器的 accept 串(图片 + 文本/代码扩展,与 intake 的判定表对齐)。 */
const ATTACH_ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
  ".txt", ".md", ".markdown", ".rst", ".org", ".adoc", ".log", ".csv", ".tsv",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".py", ".js", ".mjs", ".cjs", ".ts",
  ".tsx", ".jsx", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb",
  ".sh", ".sql", ".html", ".css", ".scss", ".vue", ".svelte", ".kt", ".swift", ".php",
].join(",");

/** 输入框里的草稿附件(读完后停在本地,send 时转 ChatAttachmentInput)。 */
interface DraftAttachment {
  id: number;
  kind: "image" | "text";
  name: string;
  mime: string;
  size: number;
  /** image:本地预览(objectURL;发送后所有权移交乐观消息,unmount 时统一 revoke) */
  previewUrl?: string;
  /** image:纯 base64 */
  base64?: string;
  /** text:文件正文 */
  text?: string;
}

let attachIdCounter = 0;

interface ChatComposerProps {
  nodeId: string | null;
  agentReady: boolean;
  streaming: boolean;
  souls: Soul[];
  activeSoul: string | null;
  starterPrompts: StarterPrompt[];
  onPickSoul: (name: string) => void;
  onSend: (text: string, displayText?: string, attachments?: ChatAttachmentInput[]) => void;
  onStop: () => void;
  /** "我没太懂"等带 frictionCategory 的选择会额外记一条 friction(原 ? 卡点的归宿)。 */
  onLogFriction?: (category: HumanFrictionCategory, summary: string | null) => void;
  onGotoSettings: () => void;
  /** 外部注入文字(哪里不会点哪里:右栏选中→追加到输入框)。每次变化触发追加。 */
  insertText?: string;
  /** 当前 thread 全部消息的估算 token(上下文表的历史段;App useMemo 算好传入)。 */
  historyTokens: number;
}

export function ChatComposer({
  nodeId,
  agentReady,
  streaming,
  souls,
  activeSoul,
  starterPrompts,
  onPickSoul,
  onSend,
  onStop,
  onLogFriction,
  onGotoSettings,
  insertText,
  historyTokens,
}: ChatComposerProps) {
  const t = useLang();
  const uiLang = useLangValue();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [ctxInfo, setCtxInfo] = useState<ContextUsageInfo | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  // v0.13 语音输入(质量优先管线):停录 → 整段转录 → 全文追加进输入框
  // (已有内容则空格衔接);开了"静音后自动发送"则直接发。PTT 按住 400ms 即录。
  const [asrAutoStop, setAsrAutoStop] = useState(true);
  const asrAutoSendRef = useRef(false);
  useEffect(() => {
    void api.getSetting("asr_auto_stop").then((v) => setAsrAutoStop(v !== "0"));
    const sync = () => {
      void api.getSetting("asr_auto_send").then((v) => {
        asrAutoSendRef.current = v === "1";
      });
    };
    sync();
    window.addEventListener("llm-config-changed", sync);
    return () => window.removeEventListener("llm-config-changed", sync);
  }, []);
  const asr = useAsrInput(
    (text) => {
      const prev = inputRef.current;
      const merged = prev.trim() ? `${prev} ${text}` : text;
      if (asrAutoSendRef.current) {
        inputRef.current = "";
        setInput("");
        sendTextNow(merged);
      } else {
        inputRef.current = merged;
        setInput(merged);
      }
    },
    { locale: uiLang, autoStop: asrAutoStop },
  );
  useEffect(() => {
    const err = asr.startError ?? asr.transcribeError;
    if (!err) return;
    const key =
      err === "model-missing"
        ? "chat.speech.asr_model_missing"
        : err === "engine-unavailable"
          ? "chat.speech.engine_unavailable"
          : err === "groq-key-missing"
            ? "chat.speech.groq_key_missing"
            : err === "azure-key-missing"
              ? "chat.speech.azure_stt_key_missing"
              : err === "azure-region-missing"
                ? "chat.speech.azure_stt_region_missing"
                : err === "mic-unavailable"
                  ? "chat.speech.asr_start_fail"
                  : "chat.speech.asr_failed";
    setNotice(t(key));
    asr.clearTranscribeError();
  }, [asr.startError, asr.transcribeError, asr, t]);

  // 外部插入文字(哪里不会点哪里:右栏选中→注入提问)。每次 insertText 变化时追加到输入框。
  useEffect(() => {
    if (insertText) {
      setInput((prev) => (prev.trim() ? `${prev}\n\n${insertText}` : insertText));
    }
  }, [insertText]);

  // 上下文固定开销(system/课文/学习者):节点/语言/模型配置变化时重拉。
  // 与 runAgentTurn 实发同源(assembleContextBlocks),表显=实发。
  useEffect(() => {
    if (!nodeId) {
      setCtxInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await api.getContextUsage(nodeId, uiLang);
        if (!cancelled) setCtxInfo(info);
      } catch {
        if (!cancelled) setCtxInfo(null);
      }
    })();
    const onCfg = () => {
      api.getContextUsage(nodeId, uiLang).then((info) => {
        if (!cancelled) setCtxInfo(info);
      }).catch(() => undefined);
    };
    window.addEventListener("llm-config-changed", onCfg);
    return () => {
      cancelled = true;
      window.removeEventListener("llm-config-changed", onCfg);
    };
  }, [nodeId, uiLang]);

  // 瞬态错误行(附件拒收等):3s 自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  // objectURL 生命周期:组件级登记(发送后乐观消息仍引用),unmount 统一 revoke
  const createdUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return () => {
      for (const url of createdUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const removeAttachment = useCallback((id: number) => {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit?.previewUrl) {
        URL.revokeObjectURL(hit.previewUrl);
        createdUrlsRef.current.delete(hit.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  /** 收一批文件:逐个校验(类型/大小/数量/vision 能力),通过则读进本地草稿。 */
  const attachFiles = useCallback(
    async (rawFiles: File[]) => {
      if (rawFiles.length === 0) return;
      const room = ATTACHMENT_LIMITS.maxPerMessage - attachments.length;
      if (room <= 0) {
        setNotice(t("chat.attach.tooMany", { n: ATTACHMENT_LIMITS.maxPerMessage }));
        return;
      }
      const files = rawFiles.length > room ? rawFiles.slice(0, room) : rawFiles;
      if (rawFiles.length > room) {
        setNotice(t("chat.attach.tooMany", { n: ATTACHMENT_LIMITS.maxPerMessage }));
      }
      const next: DraftAttachment[] = [];
      const createdUrls: string[] = [];
      for (const f of files) {
        const check = checkAttachmentFile(f.name, f.type, f.size);
        if (!check.ok) {
          setNotice(
            check.reason === "unsupported"
              ? t("chat.attach.unsupported", { name: f.name })
              : check.reason === "tooLargeImage"
                ? t("chat.attach.tooLargeImage", { name: f.name })
                : t("chat.attach.tooLargeText", { name: f.name }),
          );
          continue;
        }
        if (check.kind === "image") {
          // 已知不支持看图的模型直接拒收(省一次注定失败的 API 调用)
          if (ctxInfo?.visionCapable === false) {
            setNotice(t("chat.attach.visionUnsupported"));
            continue;
          }
          const base64 = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const r = reader.result;
              resolve(typeof r === "string" ? r.slice(r.indexOf(",") + 1) : null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          });
          if (base64 === null) continue;
          const previewUrl = URL.createObjectURL(f);
          createdUrls.push(previewUrl);
          next.push({
            id: ++attachIdCounter,
            kind: "image",
            name: f.name,
            mime: f.type || "image/png",
            size: f.size,
            previewUrl,
            base64,
          });
        } else {
          try {
            const text = await f.text();
            next.push({
              id: ++attachIdCounter,
              kind: "text",
              name: f.name,
              mime: f.type || "text/plain",
              size: f.size,
              text,
            });
          } catch {
            /* 读不出正文的文件跳过 */
          }
        }
      }
      if (next.length > 0) {
        for (const u of createdUrls) createdUrlsRef.current.add(u);
        setAttachments((prev) => [...prev, ...next]);
      } else {
        // 全部被拒:刚建的预览立即回收
        for (const u of createdUrls) URL.revokeObjectURL(u);
      }
    },
    [attachments.length, ctxInfo?.visionCapable, t],
  );

  const inputRef = useRef("");
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const sendTextNow = (raw: string) => {
    const trimmed = raw.trim();
    if (streaming || !nodeId) return;
    if (!trimmed && attachments.length === 0) return;
    // 纯附件发送:补一句默认话术,LLM/气泡都有可读文本
    const text = trimmed || translate("chat.attach.imageOnlyText");
    const payload: ChatAttachmentInput[] = attachments.map((a) => ({
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      size: a.size,
      data: a.kind === "image" ? a.base64 ?? "" : a.text ?? "",
      // 乐观消息的本地预览(main 忽略此字段)
      ...(a.kind === "image" && a.previewUrl ? { previewUrl: a.previewUrl } : {}),
    }));
    onSend(text, undefined, payload.length > 0 ? payload : undefined);
    setInput("");
    // objectURL 不在此 revoke:乐观消息(AttachmentView)还在引用它,unmount 统一回收
    setAttachments([]);
  };
  const handleSend = () => sendTextNow(input);

  // starter 选择:发消息;带 frictionCategory 的("我没太懂")额外记一条 friction。
  const handleStarterPick = (p: StarterPrompt) => {
    if (streaming) return;
    onSend(p.message, p.label); // 气泡只显示按钮文字,不显示完整提示词
    if (p.frictionCategory) onLogFriction?.(p.frictionCategory, null);
  };

  /** 粘贴:剪贴板里有文件(截图/复制的图)→ 走附件;纯文本走默认粘贴。 */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      void attachFiles(files);
    }
  };

  /** 拖拽:整个输入胶囊是落点(计数器防子元素 enter/leave 抖动)。 */
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    void attachFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const draftTokens = useMemo(() => estimateTokens(input), [input]);

  if (!agentReady) {
    return (
      <div className="px-5 pb-4 shrink-0" data-testid="composer-nokey">
        <div className="flex items-center justify-center gap-3 py-3 text-body text-ink-muted">
          <span>{t("chat.no_key.short")}</span>
          <button onClick={onGotoSettings} className="text-brand hover:underline font-bold">{t("chat.no_key.cta")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-4 pt-1 shrink-0" data-testid="composer">
      {/* 巩固选择:只在对话开始后(App 传非空 starterPrompts)才出现 = 语境前零决策税。
          4 个正交的"一瞥→懂"路径(精加工/具体化/检索/困惑处置)。单行药丸排列(省空间,
          不过度遮挡对话区);hint 走 data-tooltip(GlobalTooltip),hover 才显示。 */}
      {starterPrompts.length > 0 && nodeId && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2" data-testid="starter-prompts">
          {starterPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => handleStarterPick(p)}
              disabled={streaming}
              data-testid={`starter-prompt-${i}`}
              data-tooltip={p.hint ?? p.label}
              className="shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full text-caption font-medium text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06] transition-colors disabled:opacity-30"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区:一个圆角胶囊容器(claude.ai 风)。
          内部:风格药丸行 + 附件栏 + textarea + 发送钮 + 底部工具栏。 */}
      <div
        className={`rounded-2xl transition-colors px-3 pt-2 pb-1.5 ${
          dragActive ? "bg-accent/10 ring-1 ring-accent" : "bg-ink/[0.05] focus-within:bg-ink/[0.07]"
        }`}
        onDragEnter={onDragEnter}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="composer-card"
      >
        {/* 风格药丸:"风格:" 标签 + 三个教学人设药丸(图标+名字),hover 显示完整说明 */}
        {souls.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto mb-1" data-testid="soul-picker">
            <span className="text-body text-ink-faint shrink-0">{t("chat.soul.label")}</span>
            {souls.map((s) => {
              const isActive = activeSoul === s.name;
              const Icon = SOUL_ICONS[s.name] ?? Compass;
              const fullDesc = t(SOUL_DESC_KEY[s.name] ?? "soul.direct.desc");
              return (
                <button
                  key={s.id}
                  onClick={() => onPickSoul(s.name)}
                  data-testid={`soul-pill-${s.name}`}
                  data-tooltip={fullDesc}
                  className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-body font-medium transition-colors ${
                    isActive
                      ? "bg-brand/15 text-brand"
                      : "text-ink-muted hover:text-ink-strong hover:bg-ink/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t(SOUL_LABEL_KEY[s.name] ?? "soul.direct")}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 附件栏:图片缩略图 / 文本 chip,可删(整批上限 4)。 */}
        {attachments.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-1.5" data-testid="composer-attachments">
            {/* 图像桥提示:主模型纯文本 + 配了 vision 覆盖 → 图片先由覆盖模型转译成文字 */}
            {ctxInfo?.visionBridgeModel && attachments.some((a) => a.kind === "image") && (
              <div
                className="w-full flex items-center gap-1 text-caption text-ink-muted"
                data-testid="vision-bridge-chip"
              >
                <ScanText className="w-3.5 h-3.5 shrink-0" />
                <span>{t("chat.attach.bridgeChip", { model: ctxInfo.visionBridgeModel })}</span>
              </div>
            )}
            {attachments.map((a) =>
              a.kind === "image" ? (
                <div key={a.id} className="relative w-16 h-16 shrink-0">
                  <img
                    src={a.previewUrl}
                    alt={a.name}
                    className="w-16 h-16 object-cover rounded-lg border border-[var(--border)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={t("chat.attach.remove", { name: a.name })}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink/70 hover:bg-warning text-white flex items-center justify-center transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-ink/[0.08] text-caption text-ink-strong"
                >
                  <FileText className="w-3 h-3 shrink-0 text-ink-faint" />
                  <span className="truncate max-w-[10rem]">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={t("chat.attach.remove", { name: a.name })}
                    className="w-4 h-4 rounded-full hover:bg-ink/20 flex items-center justify-center text-ink-muted hover:text-warning transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ),
            )}
          </div>
        )}

        {/* 瞬态错误行(附件拒收原因) */}
        {notice && (
          <div className="text-caption text-warning pb-1" role="status" data-testid="composer-notice">
            {notice}
          </div>
        )}

        {/* textarea + 发送钮:发送钮内嵌右下,圆形。 */}
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={onPaste}
            placeholder={nodeId ? t("chat.input.placeholder") : t("chat.input.no_node")}
            disabled={streaming || !nodeId}
            rows={2}
            data-testid="chat-input"
            className="flex-1 bg-transparent text-ink-strong text-body rounded-lg px-1 py-1 resize-none focus:outline-none disabled:opacity-40 placeholder:text-ink-faint"
          />
          {streaming ? (
            <button
              onClick={onStop}
              data-testid="chat-stop"
              className="btn-icon-3d-warning shrink-0 w-9 h-9"
              title={t("chat.stop")}
              aria-label={t("chat.stop")}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={streaming || (!input.trim() && attachments.length === 0) || !nodeId}
              data-testid="chat-send"
              className="btn-icon-3d-brand shrink-0 w-9 h-9"
              title={t("chat.send")}
              aria-label={t("chat.send")}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* v0.10 底部工具栏:左=附件入口;右=思考强度·上下文·模型(工具栏后撤,caption 调)。 */}
        <div className="flex flex-wrap items-center justify-between gap-x-0.5 gap-y-1 mt-0.5">
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); asr.press(); }}
            onPointerUp={() => asr.release()}
            onPointerLeave={() => asr.release()}
            onClick={(e) => {
              // 真鼠标点击会先走 pointerdown/up(含 PTT/点击判定),e.detail>0 直接忽略;
              // detail=0 是键盘 Enter/Space 或自动化 .click() → 走开关
              if (e.detail === 0) {
                if (asr.listening) asr.stop();
                else asr.start();
              }
            }}
            disabled={asr.transcribing}
            data-tooltip={
              asr.listening
                ? t("chat.speech.dictation_stop")
                : asr.transcribing
                  ? t("chat.speech.transcribing")
                  : t("chat.speech.dictation_ptt")
            }
            aria-label={
              asr.listening
                ? t("chat.speech.dictation_stop")
                : t("chat.speech.dictation_ptt")
            }
            data-testid={
              asr.listening
                ? "composer-mic-active"
                : asr.transcribing
                  ? "composer-mic-busy"
                  : "composer-mic"
            }
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-caption font-medium transition-colors disabled:opacity-50 ${
              asr.listening ? "text-warning" : "text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06]"
            }`}
          >
            {asr.transcribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Mic className={`w-3.5 h-3.5 ${asr.listening ? "animate-pulse" : ""}`} />
            )}
            {asr.listening && (
              <span className="w-10 h-1 rounded-full bg-ink/[0.08] overflow-hidden" data-testid="asr-level">
                <span
                  className="block h-full bg-warning transition-[width] duration-100"
                  style={{ width: `${Math.round(Math.min(1, asr.level) * 100)}%` }}
                />
              </span>
            )}
            {asr.transcribing && <span className="max-w-24 truncate">{t("chat.speech.transcribing")}</span>}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            data-tooltip={t("chat.attach.add")}
            aria-label={t("chat.attach.add")}
            data-testid="composer-attach"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-caption font-medium text-ink-muted hover:text-ink-strong hover:bg-ink/[0.06] transition-colors"
          >
            <Paperclip className="w-3 h-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void attachFiles(Array.from(e.target.files ?? []));
              e.target.value = ""; // 允许连续选同一个文件
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-0.5">
            <EffortPicker />
            <ContextMeter info={ctxInfo} historyTokens={historyTokens} draftTokens={draftTokens} />
            <ModelPicker onGotoSettings={onGotoSettings} />
          </div>
        </div>
      </div>
    </div>
  );
}
