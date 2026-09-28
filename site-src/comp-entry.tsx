// 落地页屏5:app 真 Mascot(伴学伙伴壳)挂载器
// esbuild → site/comp-demo.js(IIFE,挂 window.CompDemo)。
// 挂 app 原组件 src/renderer/components/companion/Mascot.tsx——表情/姿势/
// 口型/眨眼/瞳孔追踪/逐键按压全部是 app 内那套,零复刻。驱动方式与 app
// 的 Creature 相同:prop 驱动(set 面板),site 侧负责编排(进入屏=挥手、
// 说话=viseme+openScale 逐字口型、点击=惊讶+跳)。
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Mascot } from "../src/renderer/components/companion/Mascot.tsx";

interface DriverState {
  form: string;
  expression: string;
  pose: string;
  viseme: string;
  openScale: number;
  size: number;
  keySeq: number;
  keyFlash: boolean;
  keySide: -1 | 1;
  screenKey: string | null;
}

export function mountCompanion(el: HTMLElement, opts?: { size?: number }) {
  const root = createRoot(el);
  const s: DriverState = {
    form: "ember",
    expression: "base",
    pose: "float",
    viseme: "closed",
    openScale: 0,
    size: opts?.size ?? 240,
    keySeq: 0,
    keyFlash: false,
    keySide: 1,
    screenKey: null,
  };
  let onPoke: (() => void) | null = null;
  const render = () => {
    root.render(
      createElement(Mascot, {
        form: s.form,
        expression: s.expression as never,
        pose: s.pose as never,
        viseme: s.viseme as never,
        openScale: s.openScale,
        size: s.size,
        interactive: true,
        ariaLabel: "LookatStudy companion",
        onPoke: () => {
          if (onPoke) onPoke();
        },
      }),
    );
  };
  render();
  return {
    set(patch: Partial<DriverState>) {
      Object.assign(s, patch);
      render();
    },
    tapKey(ch: string | null) {
      s.keySeq += 1;
      s.keySide = s.keySeq % 2 === 0 ? 1 : -1;
      s.screenKey = ch;
      render();
    },
    onPoke(fn: () => void) {
      onPoke = fn;
    },
    el,
  };
}
