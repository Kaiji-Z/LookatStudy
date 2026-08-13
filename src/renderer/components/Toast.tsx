/**
 * Toast —— v0.6 反馈层重构。
 *
 * 解决 P0/P1:
 *  - 严重度变体(success/error/warning/info/default),各一语义色左条 + 浅 tint,
 *    反馈与状态对应(成功≠错误≠警告),不再是"所有反馈看起来一样"。
 *  - 退场动画(toast-exit):淡出 + 微下沉,避免硬消失 glitch 感。
 *  - 关闭按钮换 lucide-react X(全应用 icon 词汇统一,lucide-only for utility)。
 *  - 修复历史 dark class 重复 bug(现在统一用 bg-surface-0 token)。
 *
 * 用法:
 *   const { show } = useToast();
 *   show("已归档会话", { severity: "info", action: { label: "撤销", onClick: undo }, duration: 5000 });
 *   show("保存失败", { severity: "error" });
 *   show("答对了!", { severity: "success" });
 *
 * 默认 duration 4000ms(undo 类 5000ms);error 类默认 6000ms(用户要时间看清)。
 * reduced-motion 全局降级(见 index.css @media block)。
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useLang } from "../lib/i18n.js";

export type ToastSeverity = "default" | "success" | "error" | "warning" | "info";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  duration: number;
  severity: ToastSeverity;
  exiting: boolean; // 退场动画播放中
}

interface ShowOpts {
  action?: ToastAction;
  duration?: number;
  severity?: ToastSeverity;
}

interface ToastContextValue {
  show: (message: string, opts?: ShowOpts) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

// severity → 默认 duration(error 给更长时间) + 视觉 token class + icon
const SEVERITY_DEFAULT_DURATION: Record<ToastSeverity, number> = {
  default: 4000,
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};
const SEVERITY_CLASS: Record<ToastSeverity, string> = {
  default: "toast-default",
  success: "toast-success",
  info: "toast-info",
  warning: "toast-warning",
  error: "toast-error",
};
const SEVERITY_ICON: Record<ToastSeverity, ReactNode> = {
  default: null,
  success: <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />,
  error: <AlertCircle className="w-4 h-4 text-warning shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-review shrink-0" />,
  info: <Info className="w-4 h-4 text-accent shrink-0" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // 真正从 state 移除(退场动画结束后调)
  const removeItem = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 启动退场:打 exiting 标记 → CSS 播放 toast-exit → 动画结束真正移除
  const startExit = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
  }, []);

  const show = useCallback((message: string, opts?: ShowOpts) => {
    const id = ++toastIdCounter;
    const severity = opts?.severity ?? "default";
    const duration = opts?.duration ?? SEVERITY_DEFAULT_DURATION[severity];
    const item: ToastItem = { id, message, action: opts?.action, duration, severity, exiting: false };
    setToasts((prev) => [...prev, item]);
    // 定时器:到点先播退场动画,再移除
    window.setTimeout(() => startExit(id), duration);
  }, [startExit]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Toast 容器:底部居中,pointer-events-none 让容器不挡交互,子项 auto。
          aria-live=polite:新 toast 到达时屏幕阅读器播报(不打断当前任务)。 */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastRow
            key={t.id}
            item={t}
            onAction={() => {
              t.action!.onClick();
              startExit(t.id);
            }}
            onDismiss={() => startExit(t.id)}
            onExitDone={() => removeItem(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 单条 Toast。退场动画 onAnimationEnd 触发 onExitDone 真正移除。 */
function ToastRow({
  item,
  onAction,
  onDismiss,
  onExitDone,
}: {
  item: ToastItem;
  onAction: () => void;
  onDismiss: () => void;
  onExitDone: () => void;
}) {
  const t = useLang();
  const icon = SEVERITY_ICON[item.severity];
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-xl bg-surface-0 text-ink-strong text-body shadow-elevated max-w-md ${SEVERITY_CLASS[item.severity]} ${item.exiting ? "toast-exit" : "toast-enter"}`}
      data-testid={`toast-${item.id}`}
      data-severity={item.severity}
      onAnimationEnd={item.exiting ? onExitDone : undefined}
    >
      {icon}
      <span className="flex-1">{item.message}</span>
      {item.action && (
        <button
          onClick={onAction}
          className="text-brand font-bold text-body hover:underline shrink-0 px-1.5 py-1 rounded transition-colors hover:bg-brand/10"
          data-testid={`toast-action-${item.id}`}
        >
          {item.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="text-ink-muted hover:text-ink-strong shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-surface-3"
        aria-label={t("action.close")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 容错:无 Provider 时返回 no-op(不阻塞渲染)
    return { show: () => {} };
  }
  return ctx;
}
