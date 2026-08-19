/**
 * useAsrInput —— 语音输入(质量优先管线,v0.13)的渲染层状态机。
 *
 * 采集链:getUserMedia → AudioContext(优先请求 16kHz;不支持时线性降采样)
 * → ScriptProcessor(4096 帧)→ 全量缓冲 + RMS 静音检测。停录(点击/松开 PTT/
 * 静音自动停)后整段编 WAV(shared/speech-wav)→ 一次 api.asrTranscribe → 全文
 * 经 onFinal 交调用方(写入输入框)。main 侧按 asr_engine 路由 local Whisper /
 * groq / azure —— partial 实时字幕已随流式会话退役(质量换流式,用户拍板)。
 *
 * PTT:press() 按下 400ms 即录、release() 松开即停;快点击(<400ms)仍走
 * click-toggle。ScriptProcessor 是 deprecated API 但零构建复杂度,v1 务实选择。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { encodeWavPcm16, resampleLinear } from "@shared/speech-wav";

import { createSilenceDetector, type SilenceDetector } from "./silence-detector";

const TARGET_RATE = 16000;
/** PTT 判定阈值:按住超过此时长 = 按住说话;更短 = 点击切换 */
export const PTT_HOLD_MS = 400;

export function useAsrInput(
  onFinal: (text: string) => void,
  opts: { locale?: string; autoStop?: boolean; onAutoStopped?: () => void } = {},
): {
  listening: boolean;
  /** 停录后等转录(本地 Whisper 数秒 / 云端 <1s) */
  transcribing: boolean;
  /** 0..1 近似音量(录音动画) */
  level: number;
  /** 启动失败原因(model-missing/mic-unavailable 时调用方引导) */
  startError: string | null;
  /** 转录失败原因(main 侧结构化 reason;调用方 toast 引导) */
  transcribeError: string | null;
  clearTranscribeError: () => void;
  /** 点击切换:开始录音 */
  start: () => void;
  /** 停录并转录(finalize) */
  stop: () => void;
  /** PTT:按下(400ms 后起录);与 start/stop 互斥使用由内部状态保证 */
  press: () => void;
  /** PTT:松开(在录则停;未到 400ms 视为点击 → toggle) */
  release: () => void;
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
  const chunksLenRef = useRef(0);
  const aliveRef = useRef(false);
  const detectorRef = useRef<SilenceDetector | null>(null);
  const levelSmoothRef = useRef(0);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // PTT 状态
  const pttArmedRef = useRef(false);
  const pttTimerRef = useRef<number | null>(null);
  /** start() 的异步段在飞(getUserMedia/AudioContext 未落定) */
  const startInFlightRef = useRef(false);
  /** PTT 起录在飞时松开 → 起录完成立即停 */
  const pttStopWhenLiveRef = useRef(false);

  const teardown = useCallback(() => {
    aliveRef.current = false;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    chunksRef.current = [];
    chunksLenRef.current = 0;
    detectorRef.current = null;
    setLevel(0);
  }, []);

  const finalize = useCallback(() => {
    // 先取音频再 teardown(teardown 会清缓冲)
    const chunks = chunksRef.current;
    chunksRef.current = [];
    let n = 0;
    for (const c of chunks) n += c.length;
    teardown();
    setListening(false);
    if (n === 0) return;
    const merged = new Float32Array(n);
    let o = 0;
    for (const c of chunks) {
      merged.set(c, o);
      o += c.length;
    }
    const wav = encodeWavPcm16(merged, TARGET_RATE);
    setTranscribing(true);
    setTranscribeError(null);
    void window.api
      .asrTranscribe(wav, optsRef.current.locale)
      .then((r) => {
        if (r.ok) {
          if (r.text) finalRef.current(r.text);
        } else {
          setTranscribeError(r.reason);
        }
      })
      .catch(() => setTranscribeError("asr-failed"))
      .finally(() => setTranscribing(false));
  }, [teardown]);

  const stop = useCallback(() => {
    if (!aliveRef.current) return;
    finalize();
  }, [finalize]);

  const start = useCallback(() => {
    if (aliveRef.current) {
      stop();
      return;
    }
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
          chunksLenRef.current += out.length;
          // RMS 音量(平滑,驱动动画)+ 静音检测
          let sum = 0;
          for (let i = 0; i < out.length; i++) sum += out[i]! * out[i]!;
          const rms = Math.sqrt(sum / out.length);
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
        if (pttStopWhenLiveRef.current) {
          // PTT 松开发生在起录在飞期间:立即收尾
          pttStopWhenLiveRef.current = false;
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
  }, [stop, teardown, finalize]);

  const press = useCallback(() => {
    if (pttArmedRef.current) return;
    pttArmedRef.current = true;
    pttTimerRef.current = window.setTimeout(() => {
      pttTimerRef.current = null;
      if (!aliveRef.current) start();
    }, PTT_HOLD_MS);
  }, [start]);

  const release = useCallback(() => {
    if (!pttArmedRef.current) return;
    pttArmedRef.current = false;
    if (pttTimerRef.current != null) {
      // 未到 400ms:点击语义 → toggle
      window.clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
      if (aliveRef.current) stop();
      else start();
      return;
    }
    // 按住说话:在录则停(转录);起录在飞则标记到点即停
    if (aliveRef.current) stop();
    else if (startInFlightRef.current) pttStopWhenLiveRef.current = true;
  }, [start, stop]);

  useEffect(
    () => () => {
      if (pttTimerRef.current != null) window.clearTimeout(pttTimerRef.current);
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
    start,
    stop,
    press,
    release,
  };
}
