/**
 * audio-trim —— 录音首尾静音裁剪(纯函数,verify 直测)。
 *
 * 静音段喂给 Whisper 是"字幕::::"式幻觉的经典诱因(训练语料来自带字幕视频,
 * 无有效语音时模型倾向编造字幕标记)。编码 WAV 前把首尾低于阈值的块裁掉:
 * 减幻觉诱因,顺带缩短本地 turbo 的解码时长。只裁首尾(中间停顿保留,
 * 是正常语流;整块裁会让上下文断裂更难转写)。
 *
 * 输入是逐块 RMS(与采集循环同步记录),粒度即块长(4096 样本 ≈ 256ms @16k),
 * 对听写场景足够精细。守卫:至少保留 1 块,防返回空音频。
 */

export interface TrimOptions {
  /** 块级静音判定阈值(RMS;略低于 silence-detector,保守少裁) */
  threshold?: number;
}

/**
 * 返回裁剪后的块序列(原数组不动)。rmsPerChunk 与 chunks 等长;不等长时原样返回
 * (防御:统计与缓冲理论上同源同长,失配说明状态已脏,宁可多喂不丢音频)。
 */
export function trimSilenceEdges(
  chunks: Float32Array[],
  rmsPerChunk: number[],
  opts: TrimOptions = {},
): Float32Array[] {
  if (chunks.length === 0 || chunks.length !== rmsPerChunk.length) return chunks;
  const threshold = opts.threshold ?? 0.012;
  let start = 0;
  while (start < chunks.length - 1 && rmsPerChunk[start]! < threshold) start += 1;
  let end = chunks.length;
  while (end > start + 1 && rmsPerChunk[end - 1]! < threshold) end -= 1;
  return chunks.slice(start, end);
}
