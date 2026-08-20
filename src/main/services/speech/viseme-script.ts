/**
 * viseme-script —— 剧本口型(v9 路线③,"动画公司路线")。
 *
 * 输入 = 朗读文本(我们本来就知道)+ TTS 引擎逐词时间戳(edge 档 WordBoundary),
 * 输出 = 逐 viseme cue 表。辅音嘴型(SS 齿擦/L 舌尖/FV 咬唇/闭唇)来自**剧本**
 * 而不是声波——舌位/咬唇这些特征音频里根本不存在,这正是纯音频方案
 * (Rhubarb/我们的 DSP 兜底)做不到、而剧本+词时序能做到的部分。
 *
 * zh:pinyin-pro 逐字拼音 → 声母查表 + 韵母首元音;en:词首字母组合规则。
 * 词内时间按"辅音 1 : 元音 2.5"权重分配,词间间隙补闭嘴 cue。
 * 纯函数(pinyin-pro 也是纯 JS),verify 直测;失败安全:任何解析异常都
 * 返回空数组(渲染层自动落 DSP 兜底,不阻塞朗读)。
 */
import { pinyin } from "pinyin-pro";

import type { SpeechViseme, SpeechVisemeCue } from "@shared/speech-types";

export interface ScriptWordCue {
  text: string;
  /** 毫秒,相对句音频起点 */
  start: number;
  end: number;
}

/** 普通话声母(长者优先);y/w 按半元音交给韵母。 */
const ZH_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "z", "c", "s", "r"];

/** 声母 → 辅音 viseme(卡通嘴型表的可见近似)。 */
const INITIAL_TO_VISEME: Record<string, SpeechViseme> = {
  b: "closed", p: "closed", m: "closed",
  f: "FV", v: "FV", h: "FV", w: "FV",
  d: "L", t: "L", n: "L", l: "L", r: "L",
  s: "SS", z: "SS", c: "SS", x: "SS", sh: "SS", zh: "SS", ch: "SS", j: "SS", q: "SS",
  g: "closed", k: "closed", y: "I",
};

/** 韵母首元音字母 → 母音 viseme(圆唇/展唇由物理决定,与共振峰路径同向)。 */
const VOWEL_TO_VISEME: Record<string, SpeechViseme> = {
  a: "A", e: "E", i: "I", o: "U", u: "U", v: "U",
};

const CONSONANT_WEIGHT = 1;
const VOWEL_WEIGHT = 2.5;
const CONSONANT_LEVEL = 0.32;
const VOWEL_LEVEL = 0.72;

/** 单个拼音音节(zh)→ [辅音?, 母音]。空安全。 */
function zhSyllableVisemes(syl: string): [SpeechViseme | null, SpeechViseme] {
  let initial: string | null = null;
  for (const cand of ZH_INITIALS) {
    if (syl.startsWith(cand)) {
      initial = cand;
      break;
    }
  }
  const final = initial ? syl.slice(initial.length) : syl;
  let vowel: SpeechViseme = "A";
  for (const ch of final) {
    if (VOWEL_TO_VISEME[ch]) {
      vowel = VOWEL_TO_VISEME[ch]!;
      break;
    }
  }
  const cons = initial ? (INITIAL_TO_VISEME[initial] ?? null) : null;
  // 零声母(y/w/纯韵母):y→I 起音的展唇,w→U 起音的圆唇
  if (!cons && !initial) {
    if (syl.startsWith("y")) return ["I", vowel];
    if (syl.startsWith("w")) return ["U", vowel];
  }
  return [cons, vowel];
}

/** 拉丁字母词首辅音簇 → viseme(en 词;th→L 舌穿齿,w/y 交给元音)。 */
function latinWordVisemes(word: string): [SpeechViseme | null, SpeechViseme] {
  const w = word.toLowerCase();
  const head2 = w.slice(0, 2);
  let cons: SpeechViseme | null = null;
  let consumed = 0;
  if (head2 === "th") { cons = "L"; consumed = 2; }
  else if (["sh", "ch", "ph"].includes(head2)) { cons = "SS"; consumed = 2; }
  else if (["wh"].includes(head2)) { cons = "U"; consumed = 2; }
  else {
    const c = w[0] ?? "";
    if (INITIAL_TO_VISEME[c] && !VOWEL_TO_VISEME[c]) {
      cons = INITIAL_TO_VISEME[c]!;
      consumed = 1;
    }
  }
  const rest = w.slice(consumed);
  let vowel: SpeechViseme = "A";
  for (const ch of rest) {
    if (VOWEL_TO_VISEME[ch]) { vowel = VOWEL_TO_VISEME[ch]!; break; }
  }
  return [cons, vowel];
}

/** 词 cue 文本 → 归一化字符单元 + 每单元 [辅音?, 母音]。解析不了返回 null。 */
function wordUnits(text: string): Array<[SpeechViseme | null, SpeechViseme]> | null {
  const units = [...text.replace(/[^\p{L}\p{N}]/gu, "")];
  if (units.length === 0) return null;
  const hasZh = units.some((u) => /[\u4E00-\u9FFF]/.test(u));
  if (hasZh) {
    const syls = pinyin(units.join(""), { type: "array", toneType: "none", nonZh: "spaced" });
    if (syls.length !== units.length) {
      // 长度发散(emoji/罕见字符):整词退化为宽口母音,别让一个词毁掉整句
      return [[null, "A"]];
    }
    return syls.map((s) => zhSyllableVisemes(String(s)));
  }
  return [latinWordVisemes(units.join(""))];
}

/**
 * 文本 + 引擎词时序 → 逐 viseme cue(毫秒)。wordCues 为空/异常 → [](调用方落 DSP)。
 * 输出特性:cue 时序连续覆盖词 cue 区间、按 t 升序、相邻同 viseme 合并、
 * 词间间隙补闭嘴;纯函数,verify 直测。
 */
export function buildVisemeCues(wordCues: ScriptWordCue[]): SpeechVisemeCue[] {
  const valid = wordCues
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  if (valid.length === 0) return [];

  const out: SpeechVisemeCue[] = [];
  const push = (t: number, dur: number, viseme: SpeechViseme, level: number) => {
    if (dur <= 0.5) return; // 亚毫秒丢弃
    const last = out[out.length - 1];
    if (last && last.viseme === viseme && Math.abs(last.t + last.dur - t) < 0.5) {
      last.dur += dur;
      return;
    }
    out.push({ t: Math.round(t), dur: Math.round(dur), viseme, level });
  };

  let prevEnd = 0;
  for (const cue of valid) {
    if (cue.start > prevEnd + 0.5) push(prevEnd, cue.start - prevEnd, "closed", 0); // 词间/标点间隙
    const units = wordUnits(cue.text);
    const dur = cue.end - cue.start;
    if (!units) {
      push(cue.start, dur, "closed", 0); // 纯标点 cue
      prevEnd = cue.end;
      continue;
    }
    const weights = units.map(([c]) => (c ? CONSONANT_WEIGHT + VOWEL_WEIGHT : VOWEL_WEIGHT));
    const totalW = weights.reduce((s, w) => s + w, 0);
    let t = cue.start;
    units.forEach(([cons, vowel], i) => {
      const span = (dur * weights[i]!) / totalW;
      const consShare = cons ? (span * CONSONANT_WEIGHT) / weights[i]! : 0;
      if (cons) push(t, consShare, cons, CONSONANT_LEVEL);
      push(t + consShare, span - consShare, vowel, VOWEL_LEVEL);
      t += span;
    });
    prevEnd = cue.end;
  }
  return out;
}
