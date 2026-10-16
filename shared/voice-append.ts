/**
 * voice-append —— 语音续录的识别文本拼接(纯函数,issue #20)。
 *
 * 飞书式续说:复查浮层「继续说」追录下一段,转录结果追加到已有文本后面,
 * 而不是整段替换。拼接规则 CJK 感知:
 * - 任一侧为空 → 返回另一侧原样(空段不吞已有文本);
 * - 前段已以空白/换行结尾 → 直接拼接;
 * - 后段以标点开头(逗号接续前句)→ 直接拼接;
 * - 前段结尾或后段开头是 CJK 字符/全角标点 → 直接拼接(中文词间无空格);
 * - 两侧都是拉丁词 → 中间补一个空格。
 *
 * 拼错的分隔用户可在复查 textarea 手改——这里只求"最常见的对"。
 */

/** CJK 统一表意 + 扩展A + CJK 标点 + 全角形式。 */
const CJK_RE = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** 后段以这些开头 = 接续前句的标点,直接贴上。 */
const LEADING_PUNCT_RE = /^[，。、；：？！,.!?;:…—）)」』》〉]/;

export function appendTranscript(prev: string, next: string): string {
  if (!next) return prev;
  if (!prev) return next;
  if (/\s$/.test(prev)) return prev + next;
  if (LEADING_PUNCT_RE.test(next)) return prev + next;
  const prevLast = prev[prev.length - 1]!;
  if (CJK_RE.test(prevLast) || CJK_RE.test(next[0]!)) return prev + next;
  return `${prev} ${next}`;
}
