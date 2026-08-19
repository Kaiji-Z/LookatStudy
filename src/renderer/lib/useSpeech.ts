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

import type { SpeechTtsAudioEvent } from "@shared/speech-types";

export interface SpeechSentenceInfo {
  index: number;
  total: number;
}

export function useSpeech(): {
  speakingMessageId: string | null;
  speakingSentence: SpeechSentenceInfo | null;
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
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
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
    setSpeakingMessageId(null);
    setSpeakingSentence(null);
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

  return {
    speakingMessageId,
    speakingSentence,
    failReason,
    clearFailReason: () => setFailReason(null),
    onlineNotice,
    clearOnlineNotice: () => setOnlineNotice(false),
    speak,
    stop,
  };
}
