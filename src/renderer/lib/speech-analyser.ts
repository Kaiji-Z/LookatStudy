/**
 * speech-analyser —— 朗读链的共享分析节点 + 活动播放登记(v9)。
 *
 * useSpeech 的每个 AudioBufferSourceNode 都先过这个 AnalyserNode 再进扬声器:
 *   src → analyser → destination
 * AnalyserNode 音频直通(不改变听感)。v9 口型主路径改为离线时间轴
 * (起播前已分析好的 cue 表,播放时钟查表),AnalyserNode 退居兜底
 * (拿不到时间轴的环境);两者都从这里的"活动播放"登记取。
 * 失败安全:任何异常都直接连 destination,朗读永不因分析器断链。
 */
import type { VisemeTimeline } from "./companion/viseme-timeline.js";

const cache = new WeakMap<AudioContext, AnalyserNode>();

/** v9 活动播放:正在响的那一句(时间轴 + 起播时刻 + 兜底分析器)。 */
export interface ActiveSpeechPlayback {
  ctx: AudioContext;
  /** 离线分析好/剧本下发的口型时间轴;null=只有兜底分析器可读 */
  timeline: VisemeTimeline | null;
  /** ctx.currentTime 域的起播时刻;playhead = ctx.currentTime - startedAtCtxTime */
  startedAtCtxTime: number;
  analyser: AnalyserNode | null;
}

let activePlayback: ActiveSpeechPlayback | null = null;

/** useSpeech 起播/切句/停止时维护(谁在播就指向谁)。 */
export function setActivePlayback(p: ActiveSpeechPlayback | null): void {
  activePlayback = p;
}

/** 口型驱动用:当前活动播放(无播放时 null)。 */
export function getActivePlayback(): ActiveSpeechPlayback | null {
  return activePlayback;
}

export const SPEECH_FFT_SIZE = 1024;

/** 取共享 AnalyserNode(每个 AudioContext 懒建一个,重复 connect 同一目标 WebAudio 自动去重)。 */
export function getSpeechAnalyser(ctx: AudioContext): AnalyserNode {
  let a = cache.get(ctx);
  if (!a) {
    a = ctx.createAnalyser();
    a.fftSize = SPEECH_FFT_SIZE;
    // 轻平滑:频谱帧间稳一点,口型不闪烁( viseme 本身还有量化档,双保险)
    a.smoothingTimeConstant = 0.55;
    cache.set(ctx, a);
  }
  return a;
}

/** 兜底口型驱动用:当前活动播放自带的 AnalyserNode(无播放时 null)。 */
export function getActiveSpeechAnalyser(): AnalyserNode | null {
  return activePlayback?.analyser ?? null;
}

/** 源节点安全接出:优先走分析器,任何异常退回直连(朗读可用性 > 口型)。 */
export function connectSpeechSource(ctx: AudioContext, src: AudioBufferSourceNode): void {
  try {
    const analyser = getSpeechAnalyser(ctx);
    src.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    try {
      src.connect(ctx.destination);
    } catch {
      /* give up:播放链自身异常交给 onended */
    }
  }
}
