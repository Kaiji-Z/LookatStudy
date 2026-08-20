/**
 * useSpeechMouth —— 从朗读分析节点实时读母音口型。
 *
 * active=true 时 rAF 循环读共享 AnalyserNode(时域响度+频域质心 → 六档 viseme +
 * 开口度 5 档量化),量化档变化才 setState——渲染零风暴。active=false 立即闭嘴。
 * 这是「AI 软件式口型」的信号端;渲染端在 Mascot 的 cp-mouth。
 */
import { useEffect, useState } from "react";

import {
  SPEECH_FFT_SIZE,
  getActiveSpeechAnalyser,
} from "../speech-analyser.js";
import {
  type Viseme,
  audioToMouth,
  mouthOpenScale,
} from "./companion-core.ts";

export interface MouthFrame {
  viseme: Viseme;
  open: number;
}

const CLOSED: MouthFrame = { viseme: "closed", open: 0 };

export function useSpeechMouth(active: boolean): MouthFrame {
  const [frame, setFrame] = useState<MouthFrame>(CLOSED);

  useEffect(() => {
    if (!active) {
      setFrame(CLOSED);
      return;
    }
    const td = new Uint8Array(256);
    const fd = new Uint8Array(SPEECH_FFT_SIZE / 2);
    let raf = 0;
    let lastKey = "";
    // 共振峰判位灵敏,相邻元音可能逐帧抖动:候选 viseme 须连续 2 帧确认才切换
    // (闭嘴立即切,张嘴要稳)。coarticulation 的廉价近似。
    let cand: Viseme | null = null;
    let candStreak = 0;
    const loop = () => {
      const an = getActiveSpeechAnalyser();
      if (an) {
        an.getByteTimeDomainData(td);
        an.getByteFrequencyData(fd);
        const r = audioToMouth(td, fd, an.context.sampleRate, an.fftSize);
        let vis = r.viseme;
        if (vis !== lastKey.split(":")[0]) {
          if (vis === "closed" || vis === cand) {
            if (vis === cand) candStreak++;
          } else {
            cand = vis;
            candStreak = 1;
          }
          if (!(vis === "closed") && !(vis === cand && candStreak >= 2)) {
            vis = (lastKey.split(":")[0] as Viseme) || "closed";
          }
        } else {
          cand = null;
          candStreak = 0;
        }
        const open = mouthOpenScale(vis, r.level);
        const key = vis + ":" + open;
        if (key !== lastKey) {
          lastKey = key;
          setFrame({ viseme: vis, open });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return frame;
}
