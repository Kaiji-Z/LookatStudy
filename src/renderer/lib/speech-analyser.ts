/**
 * speech-analyser —— 朗读链的共享分析节点。
 *
 * useSpeech 的每个 AudioBufferSourceNode 都先过这个 AnalyserNode 再进扬声器:
 *   src → analyser → destination
 * AnalyserNode 音频直通(不改变听感),伙伴的口型驱动从它读实时频谱。
 * 这是最小侵入:朗读链零协议改动;伙伴不渲染时节点仍在链上,开销可忽略。
 * 失败安全:任何异常都直接连 destination,朗读永不因分析器断链。
 */
const cache = new WeakMap<AudioContext, AnalyserNode>();

/** 最近一次接线的分析节点——口型驱动读它(谁在播就跟随谁)。 */
let active: AnalyserNode | null = null;

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
  active = a;
  return a;
}

/** 口型驱动用:当前活动分析节点(无播放时 null)。 */
export function getActiveSpeechAnalyser(): AnalyserNode | null {
  return active;
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
