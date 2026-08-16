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

/**
 * 令牌门 —— web(serve)模式下没有/失去 token 时的自救屏。
 * 手机引导器打开的 URL 不带 token(令牌在 Termux 里打印),用户手输一次即存。
 * Electron 模式永远不渲染这个(App 直接起)。
 */
function TokenGate({ rejected }: { rejected: boolean }) {
  const zh = navigator.language.startsWith("zh");
  const [value, setValue] = React.useState("");
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    import("./lib/api-web.js").then(({ setWebToken }) => setWebToken(token));
  };
  return (
    <div className="min-h-screen bg-[#0e2a12] flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm text-center">
        <div className="text-4xl mb-3">🎈</div>
        <h1 className="text-title font-bold text-white mb-1">LookatStudy</h1>
        <p className="text-label text-white/55 leading-relaxed mb-5">
          {zh ? "连接本机学习服务，请输入启动时打印的访问令牌" : "Connect to your study server — enter the access token printed at startup"}
        </p>
        {rejected && (
          <p className="text-label text-warning-light mb-3">
            {zh ? "上次的令牌被拒绝了，请重新输入" : "Previous token was rejected, please re-enter"}
          </p>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={zh ? "访问令牌" : "access token"}
          autoFocus
          className="w-full bg-black/30 text-white placeholder:text-white/30 text-body font-mono rounded-lg px-3 py-2.5 border border-white/20 focus:border-brand focus:outline-none transition-colors mb-3"
        />
        <button type="submit" disabled={!value.trim()} className="btn-3d-brand w-full px-3 py-2.5 text-body disabled:opacity-40">
          {zh ? "连接" : "Connect"}
        </button>
        <p className="text-caption text-white/40 leading-relaxed mt-5">
          {zh
            ? "令牌在服务启动日志里，形如 http://127.0.0.1:17890/?token=…，也可以直接打开那个链接。"
            : "The token is in the server startup log, like http://127.0.0.1:17890/?token=… — opening that link directly works too."}
        </p>
      </form>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );
}

function renderGate(rejected: boolean) {
  root.render(
    <React.StrictMode>
      <TokenGate rejected={rejected} />
    </React.StrictMode>,
  );
}

// 启动分叉:浏览器(serve)模式没有 preload 注入的 window.api —— 动态挂 web 传输
// (WS + shared/api-channels 方法面)。Electron 模式 window.api 已在,此 import 不发生。
async function boot(): Promise<void> {
  if (!(window as { api?: unknown }).api) {
    const web = await import("./lib/api-web.js");
    // 令牌门:没 token 先别连(连了也是 4001),让用户输入;
    // 连上之后 token 失效(轮换/手清)→ 事件切回令牌门重输。
    window.addEventListener(web.TOKEN_REJECTED_EVENT, () => renderGate(true));
    if (!web.hasWebToken()) {
      renderGate(false);
      return;
    }
    try {
      await web.installWebApi();
    } catch (e) {
      console.error("[boot] web api 安装失败:", e);
    }
  }
  renderApp();
}

void boot();
