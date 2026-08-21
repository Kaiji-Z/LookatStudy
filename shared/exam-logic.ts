/**
 * 章节考试纯逻辑 —— 题量规划 / 限时规则 / 重考重排。
 *
 * main(出题配额)与 renderer(计时/重排映射)共用,零依赖可单测(verify-exam.mjs)。
 * 从 shared 导入时注意:本文件是运行时代码(非 type-only),保持纯函数。
 */

/** 每场考试的题量上限/下限。 */
export const EXAM_MIN_QUESTIONS = 5;
export const EXAM_MAX_QUESTIONS = 15;

/**
 * 题量规划:目标题数 = clamp(ceil(KC数 × 1.5), 5, 15),round-robin 分配到各 KC。
 * 返回与 kcTitles 等长的数组,每项 = 该 KC 出几题。
 * 例:4 KC → 6 题 [2,2,1,1];8 KC → 12 题 [2,2,2,2,1,1,1,1];12 KC → 15 题。
 */
export function planExamQuota(kcTitles: string[]): number[] {
  const n = kcTitles.length;
  if (n === 0) return [];
  const target = Math.min(
    EXAM_MAX_QUESTIONS,
    Math.max(EXAM_MIN_QUESTIONS, Math.ceil((n * 3) / 2)),
  );
  const quotas = new Array<number>(n).fill(0);
  for (let i = 0; i < target; i++) {
    quotas[i % n]++;
  }
  return quotas;
}

/**
 * 每题答题限时(秒,v0.19 动态宽松):45 基础 + 中文/全角字数÷5 + 英文词数÷3
 * + 选项数×8 + 围栏代码块 25 + 行内/行间公式 25,clamp(60, 300)。
 * 旧版 60/90 二档对长题干/公式题太紧;新公式按宽松阅读速度估读题时间,
 * 短题不至于拖沓(地板 60),长题/公式题给足(天花板 5 分钟)。
 * 历史兼容:限时只在答题时实时计算,历史 attempt 回顾不重计时,无需迁移。
 */
export function questionTimeLimitSec(prompt: string, optionCount = 4): number {
  const cjk = (prompt.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) ?? []).length;
  const words = (prompt.match(/[A-Za-z]+/g) ?? []).length;
  let s = 45 + Math.ceil(cjk / 5) + Math.ceil(words / 3) + Math.max(0, optionCount) * 8;
  if (prompt.includes("```")) s += 25;
  if (/\$\$?[^$\n]+\$\$?/.test(prompt)) s += 25;
  return Math.max(60, Math.min(300, Math.round(s)));
}

/** 一次考试的重排:题序 + 每题选项序(重新考试时两者都变)。 */
export interface AttemptShuffle {
  /** 题目显示顺序:显示位置 i → 原 items 数组下标 */
  questionOrder: number[];
  /** 每题选项排列:显示选项位 j → 原选项下标 */
  optionPerms: Record<string, number[]>;
}

/** FNV-1a 字符串哈希 → 32 位种子(与 mapLayout.hashStr 同族,独立实现避免跨层 import)。 */
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32:小而稳的可种子 PRNG(重排可复现,测试可断言)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗 [0, n) 的排列。 */
function shuffledIndices(n: number, rand: () => number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 用 attemptId 作种子构建一次考试的重排。同一种子结果确定(可测);
 * 不同 attempt(重新考试)→ 题序与选项序都不同。
 *
 * items: 题目数组(只需 id + 选项数)。seed: attemptId。
 */
export function buildAttemptShuffle(
  items: Array<{ id: string; optionCount: number }>,
  seed: string,
): AttemptShuffle {
  const rand = mulberry32(hashSeed(seed));
  const questionOrder = shuffledIndices(items.length, rand);
  const optionPerms: Record<string, number[]> = {};
  for (const it of items) {
    optionPerms[it.id] = shuffledIndices(Math.max(1, it.optionCount), rand);
  }
  return { questionOrder, optionPerms };
}

/**
 * 显示选项位 → 原始选项下标(字符串,可直接被 gradeAnswer 按 MCQ 下标判分)。
 * 渲染端把 options[perm[j]] 显示在第 j 位;用户选第 j 位 → 原始下标 = perm[j]。
 */
export function displayAnswerToOriginal(perm: number[], displayIdx: number): string {
  const orig = perm[displayIdx];
  return String(orig ?? displayIdx);
}
