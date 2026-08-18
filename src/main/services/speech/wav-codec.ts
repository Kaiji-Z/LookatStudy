/**
 * WAV(RIFF)编码器 —— Float32 PCM → 16-bit LE 单声道 WAV。
 *
 * 渲染层用 AudioContext.decodeAudioData 直接可播;句级缓存也存这个格式。
 * 纯函数,verify 直测。
 */

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
