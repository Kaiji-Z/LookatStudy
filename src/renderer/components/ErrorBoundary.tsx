/**
 * ErrorBoundary —— 捕获子树渲染异常,防止单个组件崩溃卸载整个 root(黑屏)。
 *
 * 用途:包裹 ReactMarkdown 等可能因畸形内容(未闭合代码围栏、坏 GFM 表格)
 * 抛同步异常的渲染区。崩溃时显示 fallback 而非白屏。
 *
 * React 19 仍需 class 组件实现 ErrorBoundary(function 组件无生命周期 API)。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 自定义 fallback;不传用默认提示 */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary caught]", error, info.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.retry);
      return (
        <div className="text-body text-warning p-4">
          ⚠️ 这部分内容渲染失败(可能格式有问题)。
          <button className="underline ml-1" onClick={this.retry}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
