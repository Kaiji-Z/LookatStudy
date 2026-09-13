// 防主题闪烁(FOUC):在 React mount 前就读 localStorage 设 <html> class。
// useTheme hook mount 时会再同步一次,这里只是消除首帧的默认(无 class)闪烁。
// 外联化以配合 CSP 去掉 script-src 'unsafe-inline'(2026-09-13 审计):
// head 内同步经典脚本,首帧前执行,'self' 放行。
(function () {
  try {
    var mode = localStorage.getItem("lookatstudy-theme") || "auto";
    var resolved =
      mode === "auto"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : mode;
    document.documentElement.classList.add(resolved);
  } catch (e) {
    document.documentElement.classList.add("dark"); // 兜底:无法读 localStorage 时用深色
  }
})();
