/**
 * viseme-timeline —— 离线口型时间轴(v9 路线④,全引擎通用兜底)。
 *
 * 起播前对整句 AudioBuffer 做一次 FFT 帧分析,产出 {时刻→viseme+开口度} cue 表;
 * 播放期间用 ctx.currentTime - 起播时刻 查表——采样级对齐,没有实时分析器的
 * 平滑窗延迟与帧间抖动(这是"嘴型对不上读音"的主因)。
 *
 * 帧判类(声学事实,语言无关):
 *   元音  = F1/F2 共振峰三角(嘴形物理就是共振峰,见 companion-core.visemeFromFormants)
 *   齿擦 SS  = 高频(>3.5kHz)能量占比高(s/x/sh/z/c 家族)
 *   咔唇 FV  = 较弱的高频占比 + 中低响度(f/h 气擦)
 *   舌尖 L  = 静音后的浊音起音且 F2 落舌位区(d/t/n/l 家族的可见近似)
 *   闭   = 能量门限以下(静音与 b/p/m 闭合,声学不可分,卡通嘴型同为闭)
 *
 * Rhubarb Lip Sync 式架构(离线批处理 cue 时间轴),纯 JS 实现:1024 点
 * radix-2 FFT,512 hop(~21ms@24kHz),一句 5s ≈ 230 帧 ≈ 数毫秒,不卡 UI。
 * 舌位/咬唇等音频里不存在的特征由主进程剧本路径(shared SpeechVisemeCue,
 * edge 词边界+拼音声母)提供;本文件是它的全引擎兜底。headless 纯函数,verify 直测。
 */
import { type Viseme, visemeFromFormants, VISEME_LEVEL_GATE, FORMANT_F1_BAND, FORMANT_F2_BAND } from "./companion-core.js";
import type { SpeechVisemeCue } from "@shared/speech-types";

export interface MouthCue {
  /** 秒,相对句音频起点 */
  t: number;
  /** 秒 */
  dur: number;
  viseme: Viseme;
  /** 开口度 0..1 */
  level: number;
}

export interface VisemeTimeline {
  /** 连续无缝覆盖 [0, duration],按 t 升序 */
  cues: MouthCue[];
  /** 秒;句尾句首强制闭嘴 cue 覆盖 */
  duration: number;
}

const WIN = 1024;
const HOP = 512;
const HF_BAND_LO = 3500;
const HF_BAND_HI = 7500;
/** 擦音高频占比门限:≥SS_STRONG 判齿擦;≥SS_WEAK 且响度低判咬唇气擦。 */
export const SS_STRONG_RATIO = 0.3;
export const SS_WEAK_RATIO = 0.16;
/** L 判定的 F2 舌位区(浊音起音帧)。 */
export const L_F2_LO = 1400;
export const L_F2_HI = 2800;
/** cue 最短保持(ms):更短的 run 并进邻居,防高频闪烁。 */
export const MIN_CUE_MS = 70;

/* ---------------- FFT(radix-2 迭代,同址) ---------------- */

const HANN = new Float64Array(WIN);
for (let i = 0; i < WIN; i++) HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN - 1)));

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k]!;
        const ai = im[i + k]!;
        const br = re[i + k + half]!;
        const bi = im[i + k + half]!;
        const vr = br * cr - bi * ci;
        const vi = br * ci + bi * cr;
        re[i + k] = ar + vr;
        im[i + k] = ai + vi;
        re[i + k + half] = ar - vr;
        im[i + k + half] = ai - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* ---------------- 帧特征与判类 ---------------- */

export interface FrameFeatures {
  level: number;
  f1: number;
  f2: number;
  hfRatio: number;
}

/** 加窗帧 → (MAD 响度, F1/F2 频段质心, 高频能量占比)。纯函数,verify 直测。 */
export function frameFeatures(window: Float32Array, sampleRate: number): FrameFeatures {
  const n = window.length;
  let mad = 0;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = window[i]!;
    mad += Math.abs(v);
    re[i] = v * HANN[i]!;
  }
  fftInPlace(re, im);
  const bins = n >> 1;
  const binHz = sampleRate / n;
  const mags = new Float64Array(bins);
  let total = 0;
  let hf = 0;
  let m1 = 0;
  let w1 = 0;
  let m2 = 0;
  let w2 = 0;
  for (let i = 0; i < bins; i++) {
    const freq = i * binHz;
    if (freq >= sampleRate / 2 - binHz) break;
    const m = Math.hypot(re[i]!, im[i]!) / bins;
    mags[i] = m;
    total += m;
    if (freq >= HF_BAND_LO && freq < HF_BAND_HI) hf += m;
    if (freq >= FORMANT_F1_BAND.lo && freq < FORMANT_F1_BAND.hi) {
      m1 += m;
      w1 += m * freq;
    } else if (freq >= FORMANT_F2_BAND.lo && freq < FORMANT_F2_BAND.hi) {
      m2 += m;
      w2 += m * freq;
    }
  }
  return {
    level: n > 0 ? Math.min(1, mad / n / 0.22) : 0,
    f1: m1 > 0 ? w1 / m1 : 400,
    f2: m2 > 0 ? w2 / m2 : 800,
    hfRatio: total > 0 ? hf / total : 0,
  };
}

/** 单帧判类(v9 九形)。prev 用于浊音起音(L)检测;纯函数。 */
export function classifyVisemeFrame(f: FrameFeatures, prev: Viseme): Viseme {
  if (f.level <= VISEME_LEVEL_GATE) return "closed";
  if (f.hfRatio >= SS_STRONG_RATIO) return "SS";
  if (f.hfRatio >= SS_WEAK_RATIO && f.level < 0.45) return "FV";
  if (prev === "closed" && f.f2 >= L_F2_LO && f.f2 <= L_F2_HI) return "L";
  return visemeFromFormants(f.f1, f.f2, f.level);
}

/* ---------------- 时间轴构建 ---------------- */

/** 单声道 PCM(多声道由调用方混合)→ 连续 cue 时间轴。 */
export function analyzeVisemeTimeline(pcm: Float32Array, sampleRate: number): VisemeTimeline {
  const cues: MouthCue[] = [];
  const push = (t: number, dur: number, viseme: Viseme, level: number) => {
    if (dur <= 0) return;
    const last = cues[cues.length - 1];
    if (last && last.viseme === viseme && Math.abs(last.t + last.dur - t) < 1e-9) {
      last.dur += dur;
      last.level = Math.max(last.level, level);
      return;
    }
    cues.push({ t, dur, viseme, level });
  };

  if (pcm.length < WIN) {
    return { cues: [{ t: 0, dur: Math.max(0, pcm.length / sampleRate), viseme: "closed", level: 0 }], duration: Math.max(0, pcm.length / sampleRate) };
  }

  let prev: Viseme = "closed";
  const frameDur = HOP / sampleRate;
  for (let off = 0; off + WIN <= pcm.length; off += HOP) {
    const win = pcm.subarray(off, off + WIN);
    const feat = frameFeatures(win as Float32Array, sampleRate);
    const vis = classifyVisemeFrame(feat, prev);
    push(off / sampleRate, frameDur, vis, feat.level);
    prev = vis;
  }

  // 句尾余量 → 闭嘴
  const total = pcm.length / sampleRate;
  const analyzedEnd = cues.length > 0 ? cues[cues.length - 1]!.t + cues[cues.length - 1]!.dur : 0;
  if (analyzedEnd < total - 1e-9) push(analyzedEnd, total - analyzedEnd, "closed", 0);

  // 句首/句尾强制闭(发音准备与收口,卡通惯例)
  const first = cues[0];
  if (first && first.viseme !== "closed") {
    if (first.dur <= MIN_CUE_MS / 1000) first.viseme = "closed";
    else {
      const head = Math.min(first.dur * 0.5, MIN_CUE_MS / 1000);
      first.dur -= head;
      first.t += head;
      cues.unshift({ t: 0, dur: head, viseme: "closed", level: 0 });
    }
  }
  const last = cues[cues.length - 1];
  if (last && last.viseme !== "closed") {
    const tail = Math.min(last.dur * 0.5, MIN_CUE_MS / 1000);
    last.dur -= tail;
    cues.push({ t: last.t + last.dur, dur: tail, viseme: "closed", level: 0 });
  }

  // 最短保持:更短的 run 并进前邻(闭嘴不受限——爆破音闭合本来就短)
  for (let i = cues.length - 1; i >= 1; i--) {
    const c = cues[i]!;
    if (c.viseme !== "closed" && c.dur < MIN_CUE_MS / 1000) {
      const p = cues[i - 1]!;
      p.dur += c.dur;
      cues.splice(i, 1);
    }
  }
  return { cues, duration: total };
}

/** 主进程剧本 cue(毫秒)→ 渲染层时间轴(秒)。与 DSP 时间轴同构,查表同一套。 */
export function cuesToTimeline(cues: SpeechVisemeCue[]): VisemeTimeline {
  const sorted = [...cues].filter((c) => c.dur > 0 && Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
  const out: MouthCue[] = [];
  let cursor = 0;
  for (const c of sorted) {
    const t = Math.max(0, c.t / 1000);
    const dur = c.dur / 1000;
    if (t > cursor + 1e-9) out.push({ t: cursor, dur: t - cursor, viseme: "closed", level: 0 });
    const last = out[out.length - 1];
    if (last && last.viseme === c.viseme && Math.abs(last.t + last.dur - t) < 1e-9) {
      last.dur += dur;
      last.level = Math.max(last.level, Math.min(1, Math.max(0, c.level)));
    } else {
      out.push({ t, dur, viseme: c.viseme as Viseme, level: Math.min(1, Math.max(0, c.level)) });
    }
    cursor = t + dur;
  }
  return { cues: out, duration: cursor };
}

/** 播放时钟查表:t 秒处的 cue;超界返回 null(调用方按闭嘴处理)。 */
export function visemeAt(tl: VisemeTimeline, t: number): MouthCue | null {
  const cues = tl.cues;
  if (cues.length === 0 || t < 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  const c = cues[lo]!;
  return t <= c.t + c.dur + 1e-9 ? c : null;
}
