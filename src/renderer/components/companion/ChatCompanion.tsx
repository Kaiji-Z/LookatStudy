/**
 * ChatCompanion —— 中栏(对话)的小伙伴形态,第三栖息地。
 *
 * 只在右栏笔记本不可见时现身(T1 手动收起右栏 / T2 显示了左栏 / T3 对话单栏):
 * 导师总得在场——屏幕换到哪栏,伙伴就跟到哪栏。悬浮在对话流右上角的留白区
 * (气泡左对齐、右侧多为空白),64px 小号 + pointer-events 限涂色区,不挡消息。
 * 未选课程 / 考试关底时不出现(考试界面零干扰是完整性的红线)。
 */
import { useSyncExternalStore } from "react";

import {
  companionPoke,
  getCompanionSnapshot,
  subscribeCompanion,
} from "../../lib/companion/bus.ts";
import { useSpeechMouth } from "../../lib/companion/use-mouth.ts";
import { useLang } from "../../lib/i18n.js";

import { Mascot } from "./Mascot.tsx";

export function ChatCompanion() {
  const t = useLang();
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);

  if (!snap.enabledLoaded || !snap.enabled) return null;

  return (
    <div
      className="absolute right-1.5 top-14 z-20"
      data-testid="chat-companion"
    >
      <Mascot
        form={snap.form}
        expression={snap.state.expression}
        pose={snap.state.pose}
        viseme={mouth.viseme}
        openScale={mouth.open}
        energyRatio={snap.energyRatio}
        streakLit={snap.streakLit}
        size={64}
        interactive
        ariaLabel={t("companion.name")}
        onPoke={companionPoke}
        keySeq={snap.state.keySeq}
        keySide={snap.state.keySide}
        testid="chat-companion-mascot"
      />
    </div>
  );
}
