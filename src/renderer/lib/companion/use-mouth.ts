/**
 * useSpeechMouth —— 朗读口型状态(v9 双路径)。
 *
 * 主路径:离线时间轴查表——useSpeech 起播前已备好每句 cue 表(引擎剧本 cue
 * 优先/句音频 FFT 分析兜底),rAF 用 ctx.currentTime - 起播时刻 查当前帧:
 * 采样级对齐、无平滑窗延迟、无帧间抖动(实时分析器的三个老大难)。
 * 兜底路径:时间轴缺失时读活动 AnalyserNode(实时频谱,带 2 帧确认)。
 * active=false 立即闭嘴。量化档变化才 setState——渲染零风暴。
 */
import { useEffect, useState } from "react";

import {
  SPEECH_FFT_SIZE,
  getActivePlayback,
} from "../speech-analyser.js";
import {
  type Viseme,
  audioToMouth,
  mouthOpenScale,
} from "./companion-core.ts";
import { visemeAt } from "./viseme-timeline.js";

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
    // 兜底路径专用:共振峰判位灵敏,相邻元音可能逐帧抖动,候选 viseme 须连续
    // 2 帧确认才切换(闭嘴立即切)。时间轴路径不需要——离线帧已做最短保持。
    let cand: Viseme | null = null;
    let candStreak = 0;
    const loop = () => {
      const p = getActivePlayback();
      if (p) {
        let vis: Viseme;
        let level: number;
        if (p.timeline && p.timeline.cues.length > 0) {
          const t = Math.max(0, p.ctx.currentTime - p.startedAtCtxTime);
          const cue = visemeAt(p.timeline, t);
          vis = cue?.viseme ?? "closed";
          level = cue?.level ?? 0;
        } else if (p.analyser) {
          const an = p.analyser;
          an.getByteTimeDomainData(td);
          an.getByteFrequencyData(fd);
          const r = audioToMouth(td, fd, an.context.sampleRate, an.fftSize);
          vis = r.viseme;
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
          level = r.level;
        } else {
          vis = "closed";
          level = 0;
        }
        const open = mouthOpenScale(vis, level);
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
