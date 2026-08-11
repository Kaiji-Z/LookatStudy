import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { ToastProvider } from "./components/Toast.js";
import "./index.css";

// 全局错误捕获：renderer 崩溃时把错误打到 stderr（通过 IPC 传给 main 进程输出）
// 这样后台日志能看到 renderer 的 unhandled exception，而不是静默黑屏。
window.addEventListener("error", (e) => {
  console.error("[FATAL renderer error]", e.error?.stack || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[FATAL unhandled rejection]", e.reason?.stack || e.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
