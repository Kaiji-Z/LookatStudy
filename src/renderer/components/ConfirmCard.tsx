/**
 * ConfirmCard —— v0.6 内联确认浮层,替代 native confirm()。
 *
 * 为什么不用 native confirm():
 *  - 风格断裂:OS 原生弹窗与 Duolingo 式深色产品基调完全不符,打断任务流沉浸感。
 *  - 不可定制:无法用语义色(warning/exam)传达动作的危险级别。
 *  - 同步阻塞:confirm() 冻结整个渲染进程,流式输出中触发会卡住。
 *
 * 设计:
 *  - 内联嵌入(absolute 浮在触发元素原位附近),不是全屏 modal — 轻量、不抢焦。
 *  - 危险动作(删除)= warning 红;中性确认 = brand 绿。语气匹配动作语义。
 *  - 两按钮:取消(中性) / 确认(语义色 btn-3d)。
 *  - 160ms 入场(confirm-enter),Esc 取消,点外部取消。
 *
 * 用法:
 *   const [confirming, setConfirming] = useState<string | null>(null);
 *   <button onClick={() => setConfirming(id)}>删除</button>
 *   {confirming === id && (
 *     <ConfirmCard
 *       anchorRect={rect}
 *       message="删除这条会话?消息也会删除。"
 *       danger
 *       confirmLabel="删除"
 *       onConfirm={() => { onDelete(id); setConfirming(null); }}
 *       onCancel={() => setConfirming(null)}
 *     />
 *   )}
 *
 * anchorRect:触发按钮的 getBoundingClientRect(),卡片右对齐到按钮右侧。
 * 若空间不够会自动翻到左侧(简单 clamp)。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ConfirmCardProps {
  /** 触发元素的视口坐标(getBoundingClientRect)。卡片定位的锚点。 */
  anchorRect: DOMRect;
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险动作(删除/销毁):确认按钮用 warning 红;否则用 brand 绿。 */
  danger?: boolean;
  testid?: string;
}

const CARD_WIDTH = 220;

export function ConfirmCard({
  anchorRect,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  testid = "confirm-card",
}: ConfirmCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // 点外部 / Esc → 取消
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel, onConfirm]);

  // 定位:默认右对齐到 anchor 右侧、下方;左侧空间不够则翻左;底部不够则翻上
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const rightAlignedLeft = anchorRect.right - CARD_WIDTH;
  const left = Math.max(8, Math.min(rightAlignedLeft, viewportW - CARD_WIDTH - 8));
  const top = anchorRect.bottom + 4 + CARD_WIDTH > viewportH
    ? Math.max(8, anchorRect.top - 4 - CARD_WIDTH) // 翻上
    : anchorRect.bottom + 4;

  return createPortal(
    <div
      ref={cardRef}
      className={`confirm-card fixed z-[60] w-[220px] bg-neutral-900 rounded-xl shadow-elevated border border-neutral-700 p-3 ${danger ? "border-l-2 border-l-warning" : "border-l-2 border-l-brand"}`}
      style={{ left, top }}
      role="alertdialog"
      aria-modal="false"
      data-testid={testid}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs text-neutral-200 leading-relaxed mb-3">{message}</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          data-testid={`${testid}-cancel`}
          className="px-2.5 py-1 rounded-md text-[11px] font-bold text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          data-testid={`${testid}-confirm`}
          className={danger ? "btn-3d-brand px-2.5 py-1 text-[11px]" : "btn-3d-brand px-2.5 py-1 text-[11px]"}
          style={danger
            ? { background: "var(--warning)", boxShadow: "0 3px 0 0 var(--warning-dark)" }
            : undefined}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
