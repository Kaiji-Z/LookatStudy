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
    const loop = () => {
      const an = getActiveSpeechAnalyser();
      if (an) {
        an.getByteTimeDomainData(td);
        an.getByteFrequencyData(fd);
        const r = audioToMouth(td, fd, an.context.sampleRate, an.fftSize);
        const open = mouthOpenScale(r.viseme, r.level);
        const key = r.viseme + ":" + open;
        if (key !== lastKey) {
          lastKey = key;
          setFrame({ viseme: r.viseme, open });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return frame;
}
