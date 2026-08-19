/**
 * speech-wav —— WAV(RIFF)编解码 + 重采样(纯函数,主进程/渲染层/verify 共用)。
 *
 * v0.13 起语音输入是"渲染层录完整段 → 编 WAV → 一次 IPC 交主进程转录",
 * 编码端在渲染层、解码端在主进程,所以下沉 shared 单一实现。
 */

/** Float32 PCM → 16-bit LE 单声道 WAV。decodeAudioData 直接可播;句级缓存也存这个格式。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk 大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * 2
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < numSamples; i++) {
    // clamp 后量化;Int16 边界用全幅替代避免 Math.round 溢出回绕
    const s = samples[i]! <= -1 ? -1 : samples[i]! >= 1 ? 1 : samples[i]!;
    view.setInt16(o, Math.round(s * 32767), true);
    o += 2;
  }
  return buf;
}

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * 16-bit LE 单声道 PCM WAV → Float32 samples。非 PCM/非单声道/非 16bit 拒收
 * (听写链路上唯一的 WAV 生产者就是 encodeWavPcm16,守门即可)。
 */
export function decodeWavPcm16(bytes: ArrayBuffer | Uint8Array): DecodedWav {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (o: number, n: number) =>
    Array.from(u8.subarray(o, o + n), (c) => String.fromCharCode(c)).join("");
  if (u8.byteLength < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE buffer");
  }
  // 遍历 chunk 找 fmt 与 data(容错 LIST 等中间块)
  let fmt: { fmt: number; ch: number; rate: number; bits: number } | null = null;
  let dataStart = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= u8.byteLength) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmt = {
        fmt: view.getUint16(off + 8, true),
        ch: view.getUint16(off + 10, true),
        rate: view.getUint32(off + 12, true),
        bits: view.getUint16(off + 22, true),
      };
    } else if (id === "data") {
      dataStart = off + 8;
      dataLen = Math.min(size, u8.byteLength - dataStart);
      break; // data 之后不需要再找
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataStart < 0) throw new Error("missing fmt/data chunk");
  if (fmt.fmt !== 1 || fmt.ch !== 1 || fmt.bits !== 16) {
    throw new Error(`unsupported wav layout: fmt=${fmt.fmt} ch=${fmt.ch} bits=${fmt.bits}`);
  }
  const n = Math.floor(dataLen / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getInt16(dataStart + i * 2, true) / 32768;
  return { samples, sampleRate: fmt.rate };
}

/** 线性插值降采样(input@srcRate → dstRate)。ratio = srcRate/dstRate > 1。 */
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
