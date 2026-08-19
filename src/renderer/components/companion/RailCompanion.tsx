/**
 * RailCompanion —— 左栏(MapRail)天空里的守望形态。
 *
 * 常驻课程地图右上方天空:注视指针、全事件表情反应(庆祝/连击/入睡)、
 * 朗读时同步口型(读共享分析节点)。pointer-events 只落在角色涂色区,
 * 不挡地图球的点击(角色是天空居民,不是路障)。
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

export function RailCompanion() {
  const t = useLang();
  const snap = useSyncExternalStore(subscribeCompanion, getCompanionSnapshot);
  const mouth = useSpeechMouth(snap.state.talking);

  if (!snap.enabledLoaded || !snap.enabled) return null;

  return (
    <div
      className="absolute right-1 top-[200px] z-20"
      data-testid="rail-companion"
    >
      <Mascot
        expression={snap.state.expression}
        pose={snap.state.pose}
        viseme={mouth.viseme}
        openScale={mouth.open}
        energyRatio={snap.energyRatio}
        streakLit={snap.streakLit}
        size={84}
        interactive
        ariaLabel={t("companion.name")}
        onPoke={companionPoke}
        testid="rail-companion-mascot"
      />
    </div>
  );
}
