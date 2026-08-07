/**
 * Toast —— v0.5 轻量操作反馈系统。
 *
 * 解决 critique P2:thread 新建/归档/置顶/删除全无反馈,用户不知发生了什么。
 *
 * 用法:
 *   const { show } = useToast();
 *   show("已归档会话", { action: { label: "撤销", onClick: undo }, duration: 5000 });
 *
 * 设计:底部居中浮层,4 秒自动消失(undo 类 5 秒),respect reduced-motion。
 * 不引依赖,纯 React state + CSS 动画。
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  duration: number;
}

interface ToastContextValue {
  show: (message: string, opts?: { action?: ToastAction; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, opts?: { action?: ToastAction; duration?: number }) => {
    const id = ++toastIdCounter;
    const duration = opts?.duration ?? 4000;
    const item: ToastItem = { id, message, action: opts?.action, duration };
    setToasts((prev) => [...prev, item]);
    // 自动消失
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Toast 容器:底部居中 */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-neutral-800 text-neutral-100 text-sm shadow-elevated msg-enter max-w-md"
            data-testid={`toast-${t.id}`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="text-brand font-bold text-xs hover:underline shrink-0"
                data-testid={`toast-action-${t.id}`}
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              className="text-neutral-500 hover:text-neutral-300 shrink-0 ml-1"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
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
