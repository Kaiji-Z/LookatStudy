/**
 * useAsrInput —— 语音输入(麦克风水 → 16kHz PCM 批 → asrFeed)的渲染层状态机。
 *
 * 采集链:getUserMedia → AudioContext(优先请求 16kHz;设备不支持时线性降采样)
 * → ScriptProcessor(4096 帧)→ 攒 ~250ms 批 → api.asrFeed。
 * ScriptProcessor 是 deprecated API 但零构建复杂度(AudioWorklet 需要独立文件 +
 * CSP blob: 许可),v1 务实选择;采集是轻操作(拷贝+降采样),主线程可承受。
 *
 * 实时性:partial 经 speech:asrPartial 事件回流(与 feed 往返同拍);
 * 结束:asrStop 收尾返回全文,通过 onFinal 交给调用方(写入输入框)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_RATE = 16000;
const BATCH_SECONDS = 0.25;

export function useAsrInput(onFinal: (text: string) => void): {
  listening: boolean;
  partial: string;
  /** 启动失败原因(model-missing 时调用方引导去设置页) */
  startError: string | null;
  start: () => void;
  stop: () => void;
} {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [startError, setStartError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const pendingRef = useRef<Float32Array[]>([]);
  const pendingLenRef = useRef(0);
  const aliveRef = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const teardown = useCallback(() => {
    aliveRef.current = false;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    pendingRef.current = [];
    pendingLenRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    if (!aliveRef.current) return;
    teardown();
    setListening(false);
    void window.api
      .asrStop()
      .then((r) => {
        if (r.text) finalRef.current(r.text);
      })
      .catch(() => {});
    setPartial("");
  }, [teardown]);

  const start = useCallback(() => {
    if (aliveRef.current) {
      stop();
      return;
    }
    setStartError(null);
    setPartial("");
    void (async () => {
      try {
        const st = await window.api.asrStart();
        if (!st.ok) {
          setStartError(st.reason);
          return;
        }
        // 不安全上下文(LAN http 等)getUserMedia 不可用 —— 按启动失败处理
        if (navigator.mediaDevices?.getUserMedia == null) {
          await window.api.asrCancel().catch(() => {});
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
        const src = ctx.createMediaStreamSource(media);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        nodeRef.current = proc;
        const ratio = ctx.sampleRate / TARGET_RATE;
        proc.onaudioprocess = (ev) => {
          if (!aliveRef.current) return;
          const input = ev.inputBuffer.getChannelData(0);
          // 线性降采样到 16k(设备上下文不是 16k 时)
          const out =
            ratio === 1 ? new Float32Array(input) : resampleLinear(input, ratio);
          pendingRef.current.push(out);
          pendingLenRef.current += out.length;
          if (pendingLenRef.current >= TARGET_RATE * BATCH_SECONDS) {
            const merged = mergeChunks(pendingRef.current);
            pendingRef.current = [];
            pendingLenRef.current = 0;
            void window.api.asrFeed(merged).catch(() => {});
          }
        };
        src.connect(proc);
        // ScriptProcessor 需要接 destination 才跑(onaudioprocess 驱动);
        // 静音环防止采集外放(回声消除开着,再垫 0 增益双保险)
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);
        setListening(true);
      } catch (e) {
        teardown();
        await window.api.asrCancel().catch(() => {});
        setListening(false);
        setStartError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [stop, teardown]);

  useEffect(() => {
    const off = window.api.on("speech:asrPartial", (e: { text: string }) => {
      setPartial(e.text);
    });
    return () => {
      off();
    };
  }, []);

  useEffect(() => () => {
    if (aliveRef.current) {
      teardown();
      void window.api.asrCancel().catch(() => {});
    }
  }, [teardown]);

  return { listening, partial, startError, start, stop };
}

/** 线性插值降采样(input@ctxRate → 16k)。ratio = ctxRate/targetRate > 1。 */
export function resampleLinear(input: Float32Array, ratio: number): Float32Array {
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
