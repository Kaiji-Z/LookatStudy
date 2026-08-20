/**
 * useSpeech —— 消息朗读的渲染层状态机(订阅 speech:* 事件 + WebAudio 顺序播放)。
 *
 * 播放策略:main 侧逐句推 WAV(合成快于收听,RTF<1);这里解码成 AudioBuffer
 * FIFO 排队,前一句 ended 再起下一句,句间零间隙拼流。done 事件与播放进度
 * 双计数收尾(received/played 对齐且 done 到达才算播完)。
 *
 * 取消:本地停 = 停排+撕源;远端也通知(api.ttsStop 让 main 停合成省 CPU)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { companionSetTalking } from "./companion/bus.ts";

import type { SpeechTtsAudioEvent } from "@shared/speech-types";
import { connectSpeechSource, getSpeechAnalyser, setActivePlayback } from "./speech-analyser.js";
import { analyzeVisemeTimeline, cuesToTimeline, type VisemeTimeline } from "./companion/viseme-timeline.js";

export interface SpeechSentenceInfo {
  index: number;
  total: number;
}

export function useSpeech(): {
  speakingMessageId: string | null;
  speakingSentence: SpeechSentenceInfo | null;
  /** v6 当前**正在播放**的句(按播放序,非到达序——合成快于收听,到达序会超前)。
   *  朗读句级跟随(讲解区 karaoke 高亮/伴学指句)用它;进度显示用 speakingSentence。 */
  playingSentence: SpeechSentenceInfo | null;
  /** 最近一次朗读失败原因("model-missing"|"engine-unavailable"|…;渲染层按类型引导) */
  failReason: string | null;
  clearFailReason: () => void;
  /** 首次用 edge 在线档(main 回执 firstUse;渲染层一次性披露后 clear) */
  onlineNotice: boolean;
  clearOnlineNotice: () => void;
  /** 点击朗读/再点同一条=停(切换语义在调用方) */
  speak: (messageId: string, text: string) => void;
  stop: () => void;
} {
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speakingSentence, setSpeakingSentence] = useState<SpeechSentenceInfo | null>(null);
  const [playingSentence, setPlayingSentence] = useState<SpeechSentenceInfo | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [onlineNotice, setOnlineNotice] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  /** 按句序排队的解码缓冲池:key = main 给的 sentenceIndex。
   *  不能用数组 FIFO:decodeAudioData 异步完成序 ≈ 句子长度(短句先解完),
   *  合成快于收听时全部到达一起竞争,数组按完成序进队 = 播放乱序
   *  (实测:课文的最后一句插在第二句后面念出来)。只按 nextSeq 顺序消费。 */
  const pendingRef = useRef<Map<number, AudioBuffer>>(new Map());
  /** v9 口型时间轴池:与音频池同键(sentenceIndex)。剧本 cue(引擎下发)优先,
   *  无 cue 的句子在解码后做离线 DSP 分析——全引擎都有嘴型可查。 */
  const timelinesRef = useRef<Map<number, VisemeTimeline>>(new Map());
  /** 下一个该播的句序(播放序权威值) */
  const nextSeqRef = useRef(0);
  const playingRef = useRef(false);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const receivedRef = useRef(0);
  const playedRef = useRef(0);
  const doneRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const totalRef = useRef(0);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctor();
    }
    void ctxRef.current.resume();
    return ctxRef.current;
  };

  const finishIfDrained = useCallback(() => {
    if (doneRef.current && playedRef.current >= receivedRef.current && !playingRef.current) {
      activeIdRef.current = null;
      setSpeakingMessageId(null);
      setSpeakingSentence(null);
      setPlayingSentence(null);
    }
  }, []);

  /** 只按句序消费:下一句已解码 → 起播;未到 → 等它自己的 ttsAudio/decode(不跳句)。 */
  const pump = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || playingRef.current) return;
    const buf = pendingRef.current.get(nextSeqRef.current);
    if (!buf) {
      finishIfDrained();
      return;
    }
    const seq = nextSeqRef.current;
    pendingRef.current.delete(seq);
    playingRef.current = true;
    // v6 播放序:正在念的句 = nextSeq(按序消费的权威值,与解码完成序解耦)
    setPlayingSentence({ index: seq, total: totalRef.current });
    nextSeqRef.current += 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 经共享 AnalyserNode 直通扬声器(口型兜底读它;异常时内部退回直连,朗读不受影响)
    connectSpeechSource(ctx, src);
    // v9 口型主路径:登记活动播放(时间轴+起播时刻),播放时钟查表零延迟
    setActivePlayback({
      ctx,
      timeline: timelinesRef.current.get(seq) ?? null,
      startedAtCtxTime: ctx.currentTime,
      analyser: getSpeechAnalyser(ctx),
    });
    src.onended = () => {
      playedRef.current += 1;
      playingRef.current = false;
      setActivePlayback(null); // 句间自然闭嘴;下一句 pump 重新登记
      pump();
    };
    sourcesRef.current.push(src);
    src.start();
  }, [finishIfDrained]);

  const stopLocal = useCallback(() => {
    for (const s of sourcesRef.current) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* 已停的源 */
      }
    }
    sourcesRef.current = [];
    pendingRef.current.clear();
    timelinesRef.current.clear();
    setActivePlayback(null);
    playingRef.current = false;
    receivedRef.current = 0;
    playedRef.current = 0;
    doneRef.current = false;
    activeIdRef.current = null;
    nextSeqRef.current = 0;
    totalRef.current = 0;
    setSpeakingMessageId(null);
    setSpeakingSentence(null);
    setPlayingSentence(null);
  }, []);

  const stop = useCallback(() => {
    stopLocal();
    void window.api.ttsStop().catch(() => {});
  }, [stopLocal]);

  const speak = useCallback(
    (messageId: string, text: string) => {
      if (activeIdRef.current === messageId) {
        stop();
        return;
      }
      stopLocal();
      // 跨实例互停:讲解区/对话流各持一个 useSpeech,后开的不通知先停的话,
      // 旧实例的 speakingMessageId 残留 → karaoke 高亮残留 + talking 信号吊死。
      // window 事件广播(与 companion 总线同款模式),别的实例听见就自行 stopLocal。
      window.dispatchEvent(new CustomEvent("lookatstudy-speech-start", { detail: messageId }));
      setFailReason(null);
      activeIdRef.current = messageId;
      receivedRef.current = 0;
      playedRef.current = 0;
      doneRef.current = false;
      nextSeqRef.current = 0;
      totalRef.current = 0;
      setSpeakingMessageId(messageId);
      setSpeakingSentence({ index: 0, total: 0 });
      ensureCtx();
      void window.api
        .ttsSpeak(text, messageId)
        .then((r) => {
          if (r.ok) {
            if (r.firstUse) setOnlineNotice(true);
            return;
          }
          stopLocal();
          if (r.reason !== "empty-text") setFailReason(r.reason);
        })
        .catch(() => stopLocal());
    },
    [stop, stopLocal],
  );

  useEffect(() => {
    const offAudio = window.api.on("speech:ttsAudio", (e: SpeechTtsAudioEvent) => {
      if (e.messageId !== activeIdRef.current) return;
      const ctx = ensureCtx();
      receivedRef.current += 1;
      totalRef.current = e.sentenceTotal;
      setSpeakingSentence({ index: e.sentenceIndex, total: e.sentenceTotal });
      // 解码完成序 ≠ 句序(短句先解完):按 sentenceIndex 入池,消费端只按序取。
      // 坏块(解码失败)计收一个但永不入池 → 该句静默跳过,不卡死排空判定。
      void ctx.decodeAudioData(e.wavBytes).then(
        (buf) => {
          if (e.messageId !== activeIdRef.current) return; // 停了:丢弃迟到块
          pendingRef.current.set(e.sentenceIndex, buf);
          // v9 口型时间轴:引擎剧本 cue 优先(edge 档词边界+拼音声母,main 下发);
          // 无 cue(本地/自定义档)→ 对解码出的 PCM 做离线 FFT 分析(~几毫秒/句)。
          try {
            const tl = e.visemeCues?.length
              ? cuesToTimeline(e.visemeCues)
              : analyzeVisemeTimeline(mixdownMono(buf), buf.sampleRate);
            if (tl) timelinesRef.current.set(e.sentenceIndex, tl);
          } catch {
            /* 分析失败只是没时间轴,播放与兜底口型不受影响 */
          }
          pump();
        },
        () => {
          if (e.messageId !== activeIdRef.current) return;
          receivedRef.current -= 1;
          pump();
        },
      );
    });
    const offDone = window.api.on("speech:ttsDone", (e: { messageId: string }) => {
      if (e.messageId !== activeIdRef.current) return;
      doneRef.current = true;
      finishIfDrained();
    });
    const offError = window.api.on("speech:ttsError", () => stopLocal());
    return () => {
      offAudio();
      offDone();
      offError();
    };
  }, [finishIfDrained, pump, stopLocal]);

  useEffect(() => stopLocal, [stopLocal]); // 卸载兜底

  // 跨实例互停(接收侧):别的 useSpeech 实例开了新朗读 → 本实例若还在"读"状态就自行停
  useEffect(() => {
    const onOtherStart = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (activeIdRef.current && id !== activeIdRef.current) stopLocal();
    };
    window.addEventListener("lookatstudy-speech-start", onOtherStart);
    return () => window.removeEventListener("lookatstudy-speech-start", onOtherStart);
  }, [stopLocal]);

  // 伴学 talking 信号(v3 下沉到引擎层):speakingMessageId 即朗读事实——
  // 谁在放谁发事件,同一次渲染必达(旧法在组件层按节点 id 对比,曾静默失效)。
  useEffect(() => {
    companionSetTalking(speakingMessageId !== null);
  }, [speakingMessageId]);

  return {
    speakingMessageId,
    speakingSentence,
    playingSentence,
    failReason,
    clearFailReason: () => setFailReason(null),
    onlineNotice,
    clearOnlineNotice: () => setOnlineNotice(false),
    speak,
    stop,
  };
}

/** 多声道 → 单声道混合(DSP 口型分析只看混合能量,立体声无额外信息)。 */
function mixdownMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const a = buf.getChannelData(0);
  const b = buf.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i]! + b[i]!) / 2;
  return out;
}
