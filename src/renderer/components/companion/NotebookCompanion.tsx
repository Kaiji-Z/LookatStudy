/**
 * NotebookCompanion —— 右栏(NotebookPanel)的导师/桌宠形态。
 *
 * 选中节点(学习中)时栖在右下角:比左栏更大(导师在场感),朗读时母音口型
 * 同步(用户看课文跟读时,导师在同一栏开口);戳一下冒一句问候气泡(i18n 轮换)。
 * pointer-events 限自身——右栏正文选区/画线笔记完全不受干扰。
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import {
  companionPoke,
  getCompanionSnapshot,
  subscribeCompanion,
} from "../../lib/companion/bus.ts";
import { useSpeechMouth } from "../../lib/companion/use-mouth.ts";
import { useLang } from "../../lib/i18n.js";

import { Mascot } from "./Mascot.tsx";

const GREET_KEYS = ["companion.greet.1", "companion.greet.2", "companion.greet.3", "companion.greet.4"] as const;

export function NotebookCompanion({ nodeId }: { nodeId: string | null }) {
  const t = useLang();
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);

  const [bubble, setBubble] = useState<string | null>(null);
  const greetIdx = useRef(0);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePoke = useCallback(() => {
    companionPoke();
    const key = GREET_KEYS[greetIdx.current % GREET_KEYS.length]!;
    greetIdx.current += 1;
    setBubble(t(key));
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 2400);
  }, [t]);

  if (!nodeId || !snap.enabledLoaded || !snap.enabled) return null;

  return (
    <div
      className="absolute bottom-2 right-2 z-30"
      data-testid="notebook-companion"
    >
      {bubble && (
        <div
          className="cp-bubble absolute bottom-14 right-0 max-w-[220px] px-3 py-1.5 rounded-xl rounded-br-sm
            bg-surface-0 border border-[var(--border-faint)] shadow-elevated
            text-label text-ink-strong leading-relaxed"
          role="status"
        >
          {bubble}
        </div>
      )}
      <Mascot
        expression={snap.state.expression}
        pose={snap.state.pose}
        viseme={mouth.viseme}
        openScale={mouth.open}
        energyRatio={snap.energyRatio}
        streakLit={snap.streakLit}
        size={108}
        interactive
        ariaLabel={t("companion.name")}
        onPoke={handlePoke}
        testid="notebook-companion-mascot"
      />
    </div>
  );
}
