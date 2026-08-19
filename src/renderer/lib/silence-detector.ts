/**
 * silence-detector —— 听写静音自动停的状态机(纯逻辑,verify 直测)。
 *
 * 决策:说话(累计 ≥ minSpeechMs 的有声)后连续静音 ≥ silenceMs → "auto-stop"。
 * 硬上限 maxMs 兜底(防对着麦克风不放词,整段越录越长)。
 * autoStop=false 时恒 "listening"(设置里可关),但语音统计照常累计 ——
 * hadSpeech() 供"无入声守卫"用(整段没说过话就不送转录,治 Whisper 静音幻觉)。
 */

export interface SilenceDetectorOptions {
  /** RMS 有声阈值(回声消除后的语音通常 >0.02;环境底噪 <0.01) */
  rmsThreshold?: number;
  /** 判"说过话"所需累计有声时长(ms) —— 防一声碰撞触发 */
  minSpeechMs?: number;
  /** 说话后的连续静音时长触发自动停(ms) */
  silenceMs?: number;
  /** 整段录音硬上限(ms) */
  maxMs?: number;
  autoStop?: boolean;
}

export type SilenceDecision = "listening" | "auto-stop";

export interface SilenceDetector {
  feed(rms: number, nowMs: number): SilenceDecision;
  /** 整段是否检出过有效语音(≥ minSpeechMs 累计有声;autoStop 关闭时同样有效) */
  hadSpeech(): boolean;
}

export function createSilenceDetector(opts: SilenceDetectorOptions = {}): SilenceDetector {
  const rmsThreshold = opts.rmsThreshold ?? 0.015;
  const minSpeechMs = opts.minSpeechMs ?? 300;
  const silenceMs = opts.silenceMs ?? 1200;
  const maxMs = opts.maxMs ?? 60_000;
  const autoStop = opts.autoStop !== false;

  let startedAt: number | null = null;
  let speechMs = 0;
  let lastVocalAt: number | null = null;
  let lastTs: number | null = null;
  let spoke = false;

  return {
    feed(rms, nowMs) {
      if (startedAt == null) startedAt = nowMs;
      const dt = lastTs == null ? 0 : Math.max(0, nowMs - lastTs);
      lastTs = nowMs;
      const vocal = rms >= rmsThreshold;
      if (vocal) {
        speechMs += dt;
        if (speechMs >= minSpeechMs) {
          spoke = true;
          lastVocalAt = nowMs;
        }
      } else if (autoStop && spoke && lastVocalAt != null && nowMs - lastVocalAt >= silenceMs) {
        return "auto-stop";
      }
      if (autoStop && nowMs - startedAt >= maxMs) return "auto-stop";
      return "listening";
    },
    hadSpeech() {
      return spoke;
    },
  };
}
