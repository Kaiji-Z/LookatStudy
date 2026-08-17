/**
 * DiagramViewerModal —— 图表产物全屏查看器(v0.11)。
 *
 * 手势分界:手机端主界面不做双指缩放(viewport user-scalable=no 已禁浏览器页面缩放,
 * 内联产物区只保留普通滚动),mermaid 图/概念图的**手势操作全部收进本弹窗**:
 * 单指拖动平移、双指捏合缩放、桌面鼠标拖动 + Ctrl+滚轮缩放。概念图与 mermaid 共用。
 *
 * 点产物的图面或「放大查看」按钮打开;Esc / 点背景 / 右上 X 关闭。
 * 根节点 data-noswipe:T3 切栏滑动手势不穿透弹窗。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { useFocusTrap } from "../../lib/useFocusTrap.js";

export function DiagramViewerModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 弹窗舞台内容(交互式视口,由调用方填充) */
  children: React.ReactNode;
}) {
  const t = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      data-testid="diagram-viewer-modal"
      data-noswipe="" /* T3 切栏滑动手势不接管弹窗 */
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 头部:标题 + 关闭。背景点击关闭(头部的 stopPropagation 防误触) */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-body font-bold text-white truncate">{title}</h3>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-caption text-white/50 hidden sm:inline">{t("artifact.viewer.hint")}</span>
          <button
            onClick={onClose}
            data-testid="diagram-viewer-close"
            aria-label={t("action.close")}
            data-tooltip={t("action.close")}
            className="text-white/70 hover:text-white w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {/* 手势舞台:调用方的交互式视口(pan/pinch),背景点击关闭 */}
      <div className="flex-1 min-h-0 px-2 pb-2" onClick={onClose}>
        <div ref={panelRef} className="h-full w-full" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
