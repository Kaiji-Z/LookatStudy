/**
 * useAsrInput —— 语音输入(质量优先管线,v0.13)的渲染层状态机。
 *
 * 采集链:getUserMedia → AudioContext(优先请求 16kHz;不支持时线性降采样)
 * → ScriptProcessor(4096 帧)→ 全量缓冲 + 逐块 RMS。停录(松开「按住说话」/
 * 静音自动停)后:无入声守卫(整段没说过话 → no-speech,不喂模型,治 Whisper
 * 静音幻觉)→ 首尾静音裁剪(audio-trim)→ 整段编 WAV(shared/speech-wav)
 * → 一次 api.asrTranscribe → 全文经 onFinal 交调用方(v0.14 飞书式:进复查
 * 浮层,不直接落输入框)。main 侧按 asr_engine 路由 local Whisper / groq /
 * azure —— partial 实时字幕已随流式会话退役(质量换流式,用户拍板)。
 *
 * v0.14 交互(飞书式):大按钮 pointerdown → beginHold(立即起录,不再有
 * 400ms 点击判定);pointerup/leave/cancel → endHold。起录在飞(getUserMedia
 * 未落定)时松开,起录完成即收尾。ScriptProcessor 是 deprecated API 但零构建
 * 复杂度,v1 务实选择。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { encodeWavPcm16, resampleLinear } from "@shared/speech-wav";

import { trimSilenceEdges } from "./audio-trim";
import { createSilenceDetector, type SilenceDetector } from "./silence-detector";

const TARGET_RATE = 16000;

export function useAsrInput(
  onFinal: (text: string) => void,
  opts: { locale?: string; autoStop?: boolean } = {},
): {
  listening: boolean;
  /** 停录后等转录(本地 Whisper 数秒 / 云端 <1s) */
  transcribing: boolean;
  /** 0..1 近似音量(录音动画) */
  level: number;
  /** 启动失败原因(mic-unavailable 等;调用方引导) */
  startError: string | null;
  /** 转录失败原因(main 侧结构化 reason 或渲染层 no-speech;调用方引导) */
  transcribeError: string | null;
  clearTranscribeError: () => void;
  /** 按住说话:按下即起录 */
  beginHold: () => void;
  /** 按住说话:松开收尾(在录则停录转录;起录在飞则到点即停;未在录空转) */
  endHold: () => void;
} {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  /** 与 chunksRef 同步推进的逐块 RMS(首尾裁剪用) */
  const chunkRmsRef = useRef<number[]>([]);
  const aliveRef = useRef(false);
  const detectorRef = useRef<SilenceDetector | null>(null);
  const levelSmoothRef = useRef(0);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** beginHold 的异步段在飞(getUserMedia/AudioContext 未落定) */
  const startInFlightRef = useRef(false);
  /** 起录在飞时松开 → 起录完成立即停 */
  const stopWhenLiveRef = useRef(false);

  const teardown = useCallback(() => {
    aliveRef.current = false;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    chunksRef.current = [];
    chunkRmsRef.current = [];
    detectorRef.current = null;
    setLevel(0);
  }, []);

  const finalize = useCallback(() => {
    // 先取音频与语音统计再 teardown(teardown 会清缓冲)
    const chunks = chunksRef.current;
    const rmsList = chunkRmsRef.current;
    const hadSpeech = detectorRef.current?.hadSpeech() ?? false;
    chunksRef.current = [];
    chunkRmsRef.current = [];
    let n = 0;
    for (const c of chunks) n += c.length;
    teardown();
    setListening(false);
    if (n === 0) return;
    // 无入声守卫:整段没检出有效语音就不喂模型(静音段是 Whisper 幻觉的经典诱因)
    if (!hadSpeech) {
      setTranscribeError("no-speech");
      return;
    }
    const kept = trimSilenceEdges(chunks, rmsList);
    let m = 0;
    for (const c of kept) m += c.length;
    const merged = new Float32Array(m);
    let o = 0;
    for (const c of kept) {
      merged.set(c, o);
      o += c.length;
    }
    const wav = encodeWavPcm16(merged, TARGET_RATE);
    setTranscribing(true);
    setTranscribeError(null);
    void window.api
      .asrTranscribe(wav, optsRef.current.locale)
      .then((r) => {
        if (r.ok) finalRef.current(r.text);
        else setTranscribeError(r.reason);
      })
      .catch(() => setTranscribeError("asr-failed"))
      .finally(() => setTranscribing(false));
  }, [teardown]);

  const stop = useCallback(() => {
    if (!aliveRef.current) return;
    finalize();
  }, [finalize]);

  const beginHold = useCallback(() => {
    if (aliveRef.current || startInFlightRef.current) return;
    setStartError(null);
    startInFlightRef.current = true;
    void (async () => {
      try {
        // 不安全上下文(LAN http 等)getUserMedia 不可用 —— 按启动失败处理
        if (navigator.mediaDevices?.getUserMedia == null) {
          setStartError("mic-unavailable");
          return;
        }
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        let ctx: AudioContext;
        try {
          ctx = new Ctor({ sampleRate: TARGET_RATE });
        } catch {
          ctx = new Ctor();
        }
        ctxRef.current = ctx;
        streamRef.current = media;
        aliveRef.current = true;
        detectorRef.current = createSilenceDetector({ autoStop: optsRef.current.autoStop !== false });
        const src = ctx.createMediaStreamSource(media);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        nodeRef.current = proc;
        const ratio = ctx.sampleRate / TARGET_RATE;
        proc.onaudioprocess = (ev) => {
          if (!aliveRef.current) return;
          const input = ev.inputBuffer.getChannelData(0);
          // 线性降采样到 16k(设备上下文不是 16k 时)
          const out = ratio === 1 ? new Float32Array(input) : resampleLinear(input, ratio);
          chunksRef.current.push(out);
          // RMS 音量(平滑,驱动动画)+ 静音检测 + 逐块统计(首尾裁剪用)
          let sum = 0;
          for (let i = 0; i < out.length; i++) sum += out[i]! * out[i]!;
          const rms = Math.sqrt(sum / out.length);
          chunkRmsRef.current.push(rms);
          levelSmoothRef.current = levelSmoothRef.current * 0.7 + rms * 0.3;
          setLevel(Math.min(1, levelSmoothRef.current * 8));
          const decision = detectorRef.current?.feed(rms, performance.now());
          if (decision === "auto-stop" && aliveRef.current) finalize();
        };
        src.connect(proc);
        // ScriptProcessor 需要接 destination 才跑(onaudioprocess 驱动);
        // 静音环防止采集外放(回声消除开着,再垫 0 增益双保险)
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);
        setListening(true);
        if (stopWhenLiveRef.current) {
          // 松开发生在起录在飞期间:立即收尾
          stopWhenLiveRef.current = false;
          finalize();
        }
      } catch (e) {
        teardown();
        setListening(false);
        setStartError(e instanceof Error ? e.message : String(e));
      } finally {
        startInFlightRef.current = false;
      }
    })();
  }, [teardown, finalize]);

  const endHold = useCallback(() => {
    if (aliveRef.current) stop();
    else if (startInFlightRef.current) stopWhenLiveRef.current = true;
  }, [stop]);

  useEffect(
    () => () => {
      if (aliveRef.current) teardown();
    },
    [teardown],
  );

  return {
    listening,
    transcribing,
    level,
    startError,
    transcribeError,
    clearTranscribeError: () => setTranscribeError(null),
    beginHold,
    endHold,
  };
}
