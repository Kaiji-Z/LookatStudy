/**
 * 长音频分段编排的纯函数层 —— verify 直测,transcribePcmChunked 消费。
 *
 * 为什么分段:① 进度可见(一小时播客按 60s 一段滚动报进度);② 段与段之间
 * 释放本地解码队列,用户此刻的听写请求只需等一段,不被整小时转录饿死;
 * ③ 单段 decodeAsync 失败可定位到具体时间段。
 */

/** 切段边界(样本数下标,含头不含尾)。chunkSeconds 一段,最后一段可短;零样本零段。 */
export function planAudioChunks(totalSamples: number, sampleRate: number, chunkSeconds = 60): number[] {
  if (totalSamples <= 0) return [0];
  const size = Math.max(1, Math.round(sampleRate * chunkSeconds));
  const bounds: number[] = [0];
  for (let s = size; s < totalSamples; s += size) bounds.push(s);
  bounds.push(totalSamples);
  return bounds;
}

/** 转写段拼接:段间用段落分隔(下游 text-chunk 按段落/句子聚合,自然吸收)。 */
export function joinTranscriptChunks(chunks: string[]): string {
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join("\n\n");
}
