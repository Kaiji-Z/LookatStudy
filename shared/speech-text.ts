/**
 * speech-text —— TTS 朗读文本处理(纯函数,渲染层/主进程共用)。
 *
 * normalizeSpeechText: markdown → 可朗读纯文本。代码不读(围栏/行内整体移除),
 * 链接留文字,强调/标题/列表/引用/表格标记剥离 —— 导师"念的是话,不是版面"。
 *
 * splitSentences: 流式友好的切句。每次喂"累积文本"返回完整句 + 余量(幂等,StrictMode 安全);
 * flush=true 时尾句强制吐出。终止标点:中英句号/叹/问/分号 + 省略号;ASCII '.' 要求后跟
 * 空白且前字符非数字(3.14 不切)。超过 maxBuffer 仍无终止标点 → 在最后的软标点(、,;: 空白)
 * 处断开,再无则硬断 —— 保证"导师边生成边念"的流式管线永远不会饿死。
 */

/** 终止标点(出现即成句,连续终止/右引号并吞进句尾) */
const HARD = new Set(["。", "!", "?", "!", "?", ";", ";", "…"]);
/** 软标点(超长兜底断句位) */
const SOFT = new Set([",", ",", "、", ":", ":", ";", " ", "\n", "\t"]);
/** 句尾可并吞的右闭合符 */
const CLOSERS = new Set(["”", '"', "」", "』", "》", ")", "】", "])".slice(0, 1)]);

export function normalizeSpeechText(md: string): string {
  let s = md;
  // 围栏代码块(``` / ~~~):整个移除,不朗读
  s = s.replace(/(?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[^\n]*|\n?$)/g, "\n");
  // 行内代码
  s = s.replace(/`[^`\n]*`/g, "");
  // 图片整体移除,链接留文字
  s = s.replace(/!\[[^\]]*\]\([^)\n]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)\n]*\)/g, "$1");
  // 标题 / 列表 / 引用标记
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  s = s.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "");
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");
  // 表格:竖线换空格,对齐行(---)整行移除
  s = s.replace(/\|/g, " ");
  s = s.replace(/^[ \t]*[-: ]{3,}[ \t]*$/gm, "");
  // 强调 / 删除线
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
  s = s.replace(/(?<![*\w])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*\w])/g, "$2");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export interface SplitOptions {
  /** 流结束:余量作为尾句吐出 */
  flush?: boolean;
  /** 无终止标点时的强制断句阈值(字符数) */
  maxBuffer?: number;
}

export function splitSentences(
  text: string,
  opts: SplitOptions = {},
): { sentences: string[]; rest: string } {
  const maxBuffer = Math.max(8, opts.maxBuffer ?? 120);
  const flush = opts.flush ?? false;
  const out: string[] = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  let lastSoft = -1;

  const emit = (end: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
    lastSoft = -1;
  };

  while (i < n) {
    const ch = text[i]!;
    if (HARD.has(ch)) {
      let j = i + 1;
      while (j < n && (HARD.has(text[j]!) || CLOSERS.has(text[j]!))) j++;
      emit(j);
      i = j;
      continue;
    }
    if (ch === ".") {
      const prev = i > 0 ? text[i - 1]! : "";
      const next = i + 1 < n ? text[i + 1]! : "";
      // ASCII 句点:后跟空白/结尾,且前一字符不是数字(小数点不切)
      if ((next === "" || /\s/.test(next)) && !/\d/.test(prev)) {
        let j = i + 1;
        while (j < n && (CLOSERS.has(text[j]!) || HARD.has(text[j]!))) j++;
        emit(j);
        i = j;
        continue;
      }
    }
    if (SOFT.has(ch)) lastSoft = i;
    if (i - start + 1 > maxBuffer) {
      if (lastSoft > start) {
        // 在最后的软标点处断(软标点本身不进上一句)。先存切割点 ——
        // emit 内部会重置 lastSoft,重置后再读就回卷到 0 造成重复段(实测踩过)
        const cut = lastSoft;
        emit(cut);
        start = cut + 1;
      } else {
        emit(i + 1);
        i++;
        continue;
      }
    }
    i++;
  }

  const rest = text.slice(start).trim();
  if (flush && rest) out.push(rest);
  return { sentences: out, rest: flush ? "" : rest };
}
