/**
 * math-dense —— PDF 文本层"公式密集页"启发式检测(纯函数,verify 直测)。
 *
 * 文本层赛道解不了公式(pdf-inspector/pdf-parse 都一样):公式排版的字形在文本层
 * 变成符号汤。本检测器从**单页文本**判断这一页是否公式密集,密集页才值得花
 * vision 转写(flag_math_vision 门控,BYOK 视觉模型)。
 *
 * 两个信号(实测手感阈值):
 *   ① 数学字形密度:Σ∫√≤≥±≠∂∇∈∀∃∞∝⊗⊕· 等每千字出现次数;
 *   ② 符号汤行占比:≤4 个词但含 ≥3 个非 ASCII 数学字形的行 / 总行数。
 * 任一超阈即判密集。宁漏勿滥:误报的代价是多花一次 vision 调用,漏报的代价
 * 是公式继续乱 —— 所以阈值偏松。
 */

// × ÷ 一并计入:WinAnsi 基础字体里它们是唯二能活着穿过 pdfjs 文本提取的
// "真数学运算符"(实测 ± 会被替换成 –),真实教材文本层也常见 ×。
const MATH_GLYPH_RE = /[∑∫√≤≥±≠∂∇∈∀∃∞∝⊗⊕⨯∂∆∇∏≅≈≡⊥∥∠→←↔⇒⇔ℝℕℤℚ×÷]/g;
/** 行内"词"的粗定义:连续的 ASCII 字母数字串。 */
const WORD_RE = /[A-Za-z0-9]+/g;

export function mathGlyphsPerKiloChars(text: string): number {
  if (!text) return 0;
  const hits = text.match(MATH_GLYPH_RE)?.length ?? 0;
  return (hits * 1000) / Math.max(1, text.length);
}

export function symbolSoupLineRatio(text: string): number {
  if (!text) return 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  let soup = 0;
  for (const line of lines) {
    const words = line.match(WORD_RE)?.length ?? 0;
    const glyphs = line.match(MATH_GLYPH_RE)?.length ?? 0;
    if (words <= 4 && glyphs >= 3) soup++;
  }
  return soup / lines.length;
}

/** 单页是否公式密集(阈值可调,默认:密度 ≥6/千字 或 符号汤行 ≥20%)。 */
export function isMathDensePage(text: string, threshold?: { glyphsPerKilo?: number; soupRatio?: number }): boolean {
  const g = threshold?.glyphsPerKilo ?? 6;
  const s = threshold?.soupRatio ?? 0.2;
  if (!text || text.length < 40) return false;
  return mathGlyphsPerKiloChars(text) >= g || symbolSoupLineRatio(text) >= s;
}

/** 整本 PDF 的密集页下标列表(页文本数组 → 需要 vision 的页)。 */
export function mathDensePageIndexes(pageTexts: string[], threshold?: Parameters<typeof isMathDensePage>[1]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    if (isMathDensePage(pageTexts[i]!, threshold)) out.push(i);
  }
  return out;
}
