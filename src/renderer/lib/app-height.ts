/**
 * --app-height:Custom Tab/手机浏览器的真实可视高度。
 *
 * 100vh 在 Chrome Custom Tabs 里 = 布局视口(含工具栏区域),工具栏动画期间两者还不一致,
 * 表现为内容底部被推出屏幕、要滚动才能看全。dvh 和 position:fixed 都救不了工具栏
 * 动画时序(KaijiBot 三次迭代实测),唯一可靠源是 visualViewport.height。
 *
 * 用法:App 外壳用 `h-[var(--app-height,100vh)]`;本模块在渲染前安装。
 * 桌面 Electron 不受影响——visualViewport.height === innerHeight。
 */
export function installAppHeight(): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const apply = () => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    root.style.setProperty("--app-height", `${h}px`);
  };

  apply();
  // CCT 工具栏收合是动画,视口在几百 ms 内连跳几次 —— 延迟复测接住稳态
  for (const delay of [100, 300, 800]) window.setTimeout(apply, delay);

  window.visualViewport?.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply, { passive: true });
  window.addEventListener("resize", apply, { passive: true });
}
