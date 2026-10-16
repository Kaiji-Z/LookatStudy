/**
 * VoicePanel —— 飞书式语音输入浮层(v0.14)。
 *
 * 一个面板四个视图,锚在 composer 上方:
 *   recording    按住说话中:脉冲 mic + 音量条 + 计时 + 「松开结束」
 *   transcribing 松开后等转录:spinner
 *   review       待发送:识别全文进可编辑 textarea,改完点发送(飞书「语音+文字」);
 *                v0.20(issue #20)加「继续说」:按住追录,转录追加到已有文本后
 *   error        引导文案(模型缺失/密钥缺失/没听到声音…),重试=关错误保留已
 *                有文本(有积累回复查浮层,空则回大按钮)
 *
 * 纯展示组件:状态与文本归 ChatComposer,计时器自持(录音视图挂载起算)。
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Loader2, Send, RotateCcw } from "lucide-react";
import { useLang } from "../lib/i18n.js";

export type VoicePanelView = "recording" | "transcribing" | "review" | "error";

interface VoicePanelProps {
  view: VoicePanelView;
  /** 0..1 近似音量(recording 视图的音量条) */
  level: number;
  /** review 视图的识别文本(受控) */
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  /** 复查「取消重录」:丢弃全部识别文本,回「按住说话」大按钮 */
  onRerecord: () => void;
  /** review「继续说」按下(按住追录):释放监听在 ChatComposer 挂 window——
   *  按下后浮层立即切 recording 视图,本按钮随之卸载,元素级 pointerup 收不到 */
  onContinueHoldStart?: () => void;
  /** error「重试」:关错误不吞文本——有积累文本则回复查浮层,空则回大按钮 */
  onDismissError?: () => void;
  /** error 视图的引导文案(调用方已翻译) */
  errorMessage: string | null;
  sendDisabled: boolean;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function VoicePanel({
  view,
  level,
  text,
  onTextChange,
  onSend,
  onRerecord,
  onContinueHoldStart,
  onDismissError,
  errorMessage,
  sendDisabled,
}: VoicePanelProps) {
  const t = useLang();
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(performance.now());

  // 计时器随视图切换重置(recording 挂载即起算)
  useEffect(() => {
    startRef.current = performance.now();
    setElapsed(0);
  }, [view]);

  useEffect(() => {
    if (view !== "recording") return;
    const timer = window.setInterval(() => setElapsed(performance.now() - startRef.current), 250);
    return () => window.clearInterval(timer);
  }, [view]);

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 z-20 rounded-2xl bg-surface-0 shadow-elevated p-4 flex flex-col gap-3"
      role="status"
      aria-live="polite"
      data-testid={
        view === "recording"
          ? "voice-panel-recording"
          : view === "transcribing"
            ? "voice-panel-transcribing"
            : view === "review"
              ? "voice-panel-review"
              : "voice-panel-error"
      }
    >
      {view === "recording" && (
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 shrink-0 rounded-full bg-warning/15 text-warning flex items-center justify-center">
            <Mic className="w-5 h-5 animate-pulse" />
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-label text-ink-muted">
              <span>{t("chat.speech.recording_hint")}</span>
              <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            </div>
            <span className="block h-2 rounded-full bg-ink/[0.08] overflow-hidden" data-testid="voice-level">
              <span
                className="block h-full bg-warning transition-[width] duration-100"
                style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }}
              />
            </span>
          </div>
        </div>
      )}

      {view === "transcribing" && (
        <div className="flex items-center justify-center gap-2 py-2 text-body text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t("chat.speech.transcribing")}</span>
        </div>
      )}

      {view === "review" && (
        <>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            // 挂载即聚焦:改一两个字就发是常态
            autoFocus
            rows={4}
            data-testid="voice-result-text"
            className="w-full bg-ink/[0.05] text-body text-ink-strong rounded-xl px-3 py-2 resize-none focus:outline-none focus:bg-ink/[0.08]"
          />
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {/* 继续说(飞书式续说,issue #20):按住追录,松开转录追加到已有文本后面 */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onContinueHoldStart?.();
              }}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="voice-continue-btn"
              className="btn-3d-neutral px-4 py-1.5 text-body flex items-center gap-1.5 touch-none select-none"
            >
              <Mic className="w-3.5 h-3.5" />
              {t("chat.speech.continue_say")}
            </button>
            <button type="button" onClick={onRerecord} data-testid="voice-rerecord" className="btn-3d-neutral px-4 py-1.5 text-body">
              {t("chat.speech.rerecord")}
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={sendDisabled}
              data-testid="voice-send"
              className="btn-3d-brand px-4 py-1.5 text-body flex items-center gap-1.5 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              {t("chat.send")}
            </button>
          </div>
        </>
      )}

      {view === "error" && (
        <>
          <div className="text-body text-warning py-1">{errorMessage ?? t("chat.speech.asr_failed")}</div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onDismissError ?? onRerecord}
              data-testid="voice-error-retry"
              className="btn-3d-neutral px-4 py-1.5 text-body flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("chat.speech.retry")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
