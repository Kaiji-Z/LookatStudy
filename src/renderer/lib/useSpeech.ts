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
import { connectSpeechSource } from "./speech-analyser.js";

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
  const buffersRef = useRef<AudioBuffer[]>([]);
  const playingRef = useRef(false);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const receivedRef = useRef(0);
  const playedRef = useRef(0);
  const doneRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  /** 已起播的缓冲条数(播放序);总句数随 ttsAudio 到达刷新 */
  const startedRef = useRef(0);
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

  const playNext = useCallback(() => {
    const ctx = ctxRef.current;
    const buf = buffersRef.current.shift();
    if (!ctx || !buf) {
      playingRef.current = false;
      finishIfDrained();
      return;
    }
    playingRef.current = true;
    // v6 播放序:第 startedRef 条缓冲开始起播 → 它就是"正在念"的句子。
    // 缓冲 FIFO 顺序 = main 侧合成顺序 = 句序,与到达序解耦(合成超前不超前都准)。
    setPlayingSentence({ index: startedRef.current, total: totalRef.current });
    startedRef.current += 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 经共享 AnalyserNode 直通扬声器(伴学伙伴口型读它;异常时内部退回直连,朗读不受影响)
    connectSpeechSource(ctx, src);
    src.onended = () => {
      playedRef.current += 1;
      playNext();
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
    buffersRef.current = [];
    playingRef.current = false;
    receivedRef.current = 0;
    playedRef.current = 0;
    doneRef.current = false;
    activeIdRef.current = null;
    startedRef.current = 0;
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
      setFailReason(null);
      activeIdRef.current = messageId;
      receivedRef.current = 0;
      playedRef.current = 0;
      doneRef.current = false;
      startedRef.current = 0;
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
      void ctx.decodeAudioData(e.wavBytes).then((buf) => {
        if (e.messageId !== activeIdRef.current) return; // 停了:丢弃迟到块
        buffersRef.current.push(buf);
        if (!playingRef.current) playNext();
      });
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
  }, [finishIfDrained, playNext, stopLocal]);

  useEffect(() => stopLocal, [stopLocal]); // 卸载兜底

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
