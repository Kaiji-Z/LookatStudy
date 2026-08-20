/**
 * highlightText —— 讲解区/对话流的画线定位工具(v0.3.3 文本锚点方案)。
 *
 * 核心问题(历经多轮):DOM 字符偏移(offset)方案无法稳定 ——
 *   - save 时 DOM 已有 mark → getTextModel 跳过 mark 内文本 → model 比干净 DOM 短
 *   - apply 时清除 mark 后 DOM 是干净的 → model 比 save 时长
 *   - 两个 model 不一致 → offset 错位
 *   - 而且 ReactMarkdown 重渲染会让文本节点拆分变化 → 即使无 mark,model 也不稳定
 *
 * v0.3.3 方案:放弃绝对字符偏移,改用"选区文字 + 前后文指纹"在 model.text 上做文本搜索。
 *   - save:记录 selectedText(选区文字)+ 模糊 surroundingText(前后文)
 *   - apply:在干净 DOM 的 model.text 上搜索 selectedText,定位后画 mark
 *   - model.text 是纯文本字符串(过滤 mark 后的),indexOf 不受 DOM 节点拆分影响
 *   - 配合 fromIndex 参数处理同一文字多次出现的情况(用 surroundingText 消歧)
 *
 * 这是不依赖 DOM 结构的方案,只要 markdown 源不变,文本就稳定。
 */
export interface TextModel {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
}

export function getTextModel(container: HTMLElement, within?: string): TextModel {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      // 跳过脚本/样式
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      // 跳过已画的持久画线 mark 内的所有文本(用 closest 检查祖先链,防止嵌套结构漏过)。
      // 这是 save 时 modelTextLen 随笔记数增长的根因:mark 内文本被重复计算。
      if (parent.closest("mark.lookatstudy-underline")) {
        return NodeFilter.FILTER_REJECT;
      }
      // within(可选):只收匹配选择器子树内的文本(朗读 karaoke 在对话消息里限定
      // 正文 text part —— 思考块/工具产物也渲染文字,但朗读不读它们,搜进去必错位)。
      if (within && !parent.closest(within)) {
        return NodeFilter.FILTER_REJECT;
      }
      // 不跳过空白节点 —— 跳过会让 rangeToOffsets 的 container 找不到对应 model 节点,
      // 导致保存和应用的偏移空间不一致。空白节点让 model.text 多空格,但保持对称性。
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const content = t.textContent ?? "";
    const start = text.length;
    text += content;
    nodes.push({ node: t, start, end: text.length });
  }
  return { text, nodes };
}

/** 从选区 Range 算它在 TextModel 里的全局 [startOffset, endOffset)。
 *  直接用 Range 的 startContainer/endContainer,不依赖文本匹配(indexOf)。
 *  返回 null 如果 Range 跨出了 model 范围。 */
export function rangeToOffsets(range: Range, model: TextModel): { start: number; end: number } | null {
  const start = containerPointToOffset(range.startContainer, range.startOffset, model, "start");
  const end = containerPointToOffset(range.endContainer, range.endOffset, model, "end");
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

/** 把 (container, offset) 转成 model 里的全局偏移。
 *  container 是 Text 节点(常见;getTextModel 现在包含所有文本节点,必命中)或
 *  Element 节点(选区跨节点/落在元素边界时)。 */
function containerPointToOffset(
  container: Node,
  offset: number,
  model: TextModel,
  which: "start" | "end",
): number | null {
  // 情况1:container 是文本节点 → 在 model.nodes 里直接找(现在所有文本节点都在 model 里)
  if (container.nodeType === Node.TEXT_NODE) {
    for (const entry of model.nodes) {
      if (entry.node === container) {
        return entry.start + Math.min(offset, entry.node.textContent?.length ?? 0);
      }
    }
    // 不在 model 里(理论上不会发生,除非是 SCRIPT/STYLE/已画 mark 内的文本)→ 邻接兜底
    return which === "start" ? (model.nodes[0]?.start ?? null) : (model.nodes[model.nodes.length - 1]?.end ?? null);
  }
  // 情况2:container 是元素节点 → offset 是子节点索引,找到该位置附近的 model 文本节点
  if (container instanceof Element) {
    const children = Array.from(container.childNodes);
    if (which === "end") {
      for (let i = offset; i < children.length; i++) {
        const found = findFirstTextNodeOffsetInModel(children[i], model);
        if (found != null) return found;
      }
      const last = model.nodes[model.nodes.length - 1];
      return last ? last.end : null;
    } else {
      for (let i = offset; i >= 0; i--) {
        const found = findLastTextNodeOffsetInModel(children[i], model);
        if (found != null) return found;
      }
      const first = model.nodes[0];
      return first ? first.start : null;
    }
  }
  return null;
}

/** 在 node 子树里找第一个 model 文本节点的 start 偏移。 */
function findFirstTextNodeOffsetInModel(node: Node, model: TextModel): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    for (const entry of model.nodes) {
      if (entry.node === node) return entry.start;
    }
    return null;
  }
  if (node instanceof Element) {
    for (const child of node.childNodes) {
      const found = findFirstTextNodeOffsetInModel(child, model);
      if (found != null) return found;
    }
  }
  return null;
}

/** 在 node 子树里找最后一个 model 文本节点的 end 偏移。 */
function findLastTextNodeOffsetInModel(node: Node, model: TextModel): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    for (const entry of model.nodes) {
      if (entry.node === node) return entry.end;
    }
    return null;
  }
  if (node instanceof Element) {
    let result: number | null = null;
    for (const child of node.childNodes) {
      const found = findLastTextNodeOffsetInModel(child, model);
      if (found != null) result = found;
    }
    return result;
  }
  return null;
}

/** 从全局偏移 [start, end) 还原 Range(用于画线)。基于 model.nodes。 */
export function offsetsToRange(model: TextModel, start: number, end: number): Range | null {
  if (end <= start) return null;
  let startNode: Text | null = null;
  let startLocal = 0;
  let endNode: Text | null = null;
  let endLocal = 0;
  for (const entry of model.nodes) {
    // 起点:落在 [entry.start, entry.end) 内
    if (!startNode && start >= entry.start && start < entry.end) {
      startNode = entry.node;
      startLocal = start - entry.start;
    }
    // 终点:end 可能等于某节点 end(落在边界),用 end <= entry.end 包含
    if (!endNode && end > entry.start && end <= entry.end) {
      endNode = entry.node;
      endLocal = end - entry.start;
    }
    if (startNode && endNode) break;
  }
  // 边界:start 可能等于最后一个节点的 end(空选区末尾)→ clamp 到最后节点末尾
  if (!startNode && model.nodes.length > 0) {
    const last = model.nodes[model.nodes.length - 1];
    startNode = last.node;
    startLocal = last.node.textContent?.length ?? 0;
  }
  if (!endNode && model.nodes.length > 0) {
    const last = model.nodes[model.nodes.length - 1];
    endNode = last.node;
    endLocal = last.node.textContent?.length ?? 0;
  }
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startLocal, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(endLocal, endNode.textContent?.length ?? 0));
    return range;
  } catch {
    return null;
  }
}

/* ============================================================
 * 持久画线(基于字符偏移的稳定通道)
 * ============================================================ */

/** 按文本搜索在容器内包裹持久 <mark>(v0.3.3 文本锚点方案,替代 offset)。
 *  每个 note 存 text(选区文字)+ 前后文(消歧)。
 *  apply 时:清除旧 mark → 算干净 model → 在 model.text 上搜索 text → 画 mark。
 *  这样不依赖 DOM 结构稳定性,只要文本内容不变就能定位。
 *  返回每个 noteId 对应的 mark 元素(供溯源跳转)。 */
export function applyPersistentMarksByText(
  container: HTMLElement,
  notes: { noteId: string; text: string; surrounding?: string }[],
): Map<string, HTMLElement> {
  // 清除旧画线
  container.querySelectorAll("mark.lookatstudy-underline").forEach((m) => {
    const parent = m.parentNode;
    if (parent) {
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
  container.normalize();

  const result = new Map<string, HTMLElement>();
  if (notes.length === 0) return result;

  // 干净 DOM 的 model(所有 mark 已清除)
  const model = getTextModel(container);

  // 从后往前画(按在 model.text 里找到的位置排序,避免 DOM 改动影响后面)
  const located: { noteId: string; start: number; end: number }[] = [];
  for (const note of notes) {
    const pos = findTextWithDisambig(model.text, note.text, note.surrounding);
    if (pos >= 0) {
      located.push({ noteId: note.noteId, start: pos, end: pos + note.text.length });
    }
  }
  located.sort((a, b) => b.start - a.start);
  for (const loc of located) {
    const range = offsetsToRange(model, loc.start, loc.end);
    if (!range) continue;
    const mark = wrapRangeWithMark(range, loc.noteId);
    if (mark) result.set(loc.noteId, mark);
  }
  return result;
}

/** 在 text 里搜索 searchText,用 surroundingText 消歧(选最近的出现)。
 *  返回起始 offset,找不到返回 -1。 */
function findTextWithDisambig(text: string, searchText: string, surrounding?: string): number {
  if (!searchText) return -1;
  // 直接找
  let idx = text.indexOf(searchText);
  if (idx < 0) {
    // 宽松:归一化空白后找(应对 markdown 渲染的空白差异)
    const normText = searchText.replace(/\s+/g, " ").trim();
    const normHaystack = text.replace(/\s+/g, " ");
    idx = normHaystack.indexOf(normText);
    if (idx < 0) return -1;
    // 归一化后的 idx 不精确,回退用前 15 字前缀在原文里找
    const prefix = searchText.slice(0, Math.min(15, searchText.length));
    return text.indexOf(prefix);
  }
  // 如果有多次出现,用 surroundingText 消歧:找离 surrounding 最接近的那次
  if (surrounding && surrounding.length > 5) {
    const surrIdx = text.indexOf(surrounding.slice(0, 20));
    if (surrIdx >= 0) {
      // 找所有出现,选离 surrIdx 最近的
      let best = idx;
      let bestDist = Math.abs(idx - surrIdx);
      let from = idx + 1;
      while (true) {
        const next = text.indexOf(searchText, from);
        if (next < 0) break;
        const dist = Math.abs(next - surrIdx);
        if (dist < bestDist) { best = next; bestDist = dist; }
        from = next + 1;
      }
      return best;
    }
  }
  return idx;
}

/** 按字符偏移在容器内包裹持久 <mark>(旧 offset 方案,保留向后兼容)。
 *  幂等:先清除旧 mark,再按 notes 画。 */
export function applyPersistentMarks(
  container: HTMLElement,
  notes: { noteId: string; startOffset: number; endOffset: number }[],
): Map<string, HTMLElement> {
  // 清除旧画线 + normalize(合并被拆分的文本节点,恢复原始 DOM 结构)
  container.querySelectorAll("mark.lookatstudy-underline").forEach((m) => {
    const parent = m.parentNode;
    if (parent) {
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
  container.normalize();

  const result = new Map<string, HTMLElement>();
  if (notes.length === 0) return result;

  // 只算一次 model(此时 DOM 是干净的,无 lookatstudy-underline mark)
  const model = getTextModel(container);

  // 从后往前画:已画 mark 在当前 note offset 之后,splitText 不影响前面节点引用
  const sorted = [...notes].sort((a, b) => b.startOffset - a.startOffset);
  for (const note of sorted) {
    // 用循环外算好的 model(不重算!)。从后往前保证前面的 Text 节点引用仍有效
    const range = offsetsToRange(model, note.startOffset, note.endOffset);
    if (!range) continue;
    const mark = wrapRangeWithMark(range, note.noteId);
    if (mark) result.set(note.noteId, mark);
  }
  return result;
}

/**
 * 把一个 Range(可能跨多个文本节点)用 <mark> 包裹。
 * 不能用 range.surroundContents(跨元素边界会抛错),改用"拆分文本节点 + 逐节点包裹"。
 *
 * 算法:
 *   1. 在 range 起点拆分 startContainer(得到起点之后的部分)
 *   2. 在 range 终点拆分 endContainer(得到终点之前的部分)
 *   3. range 内的所有文本节点用 mark 包起来
 *   4. 如果只有一个节点 → 直接 surroundContents(快路径)
 */
function wrapRangeWithMark(range: Range, noteId: string): HTMLElement | null {
  // 持久画线:彩色下划线(无背景色,不遮挡文字)。用 border-bottom 实现下划线。
  // color: inherit + background: transparent 覆盖 <mark> 浏览器默认样式(默认黄底黑字),
  // 确保文字颜色继承父元素,不变成不可见。
  const markStyle =
    "color: inherit; background: transparent; border-bottom: 2px solid rgb(34, 197, 94); padding-bottom: 1px;";
  const mark = document.createElement("mark");
  mark.className = "lookatstudy-underline";
  mark.dataset.noteId = noteId;
  mark.style.cssText = markStyle;
  return wrapRangeWithElement(range, mark);
}

/**
 * 把一个 Range(可能跨多个文本节点)用指定元素包裹。
 * 不能用 range.surroundContents(跨元素边界会抛错),改用"拆分文本节点 + 逐节点包裹";
 * 跨节点时逐节点克隆空壳元素包裹(样式类保留),返回首个包裹元素。
 * 持久画线(mark)与朗读句高亮(span)共用本算法。
 */
function wrapRangeWithElement(range: Range, el: HTMLElement): HTMLElement | null {
  // 快路径:startContainer === endContainer(单节点,不跨边界)
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    try {
      range.surroundContents(el);
      return el;
    } catch {
      /* fall through to slow path */
    }
  }
  // 慢路径:跨节点。收集 range 内所有文本节点,逐个包裹。
  try {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // 选区相交的文本节点
        if (range.intersectsNode(node)) {
          // 进一步:节点必须和 range 有实质重叠(不是只碰到边界)
          if (node === range.startContainer || node === range.endContainer) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_REJECT;
      },
    });
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);
    if (textNodes.length === 0) return null;

    let firstWrap: HTMLElement | null = null;
    for (const textNode of textNodes) {
      let toWrap = textNode;
      // 起点节点:把 range 起点之前的部分切掉
      if (textNode === range.startContainer && range.startOffset > 0) {
        toWrap = textNode.splitText(range.startOffset);
      }
      // 终点节点:把 range 终点之后的部分切掉(splitText 返回后半段,toWrap 保留前半段)
      if (textNode === range.endContainer || toWrap === range.endContainer) {
        const endOff = toWrap === range.endContainer ? range.endOffset : range.endOffset - (textNode === range.startContainer ? range.startOffset : 0);
        if (endOff < toWrap.textContent!.length) {
          toWrap.splitText(endOff);
        }
      }
      if (!toWrap.textContent) continue;
      const wrap: HTMLElement = firstWrap ? (el.cloneNode(false) as HTMLElement) : el;
      toWrap.parentNode?.insertBefore(wrap, toWrap);
      wrap.appendChild(toWrap);
      if (!firstWrap) firstWrap = wrap;
    }
    return firstWrap;
  } catch {
    return null;
  }
}

/* ============================================================
 * 朗读句高亮(v6 karaoke)
 * ============================================================ */

export const READING_MARK_CLASS = "cp-reading-mark";

/** 清除朗读句高亮(unwrap + normalize 恢复 DOM;句切换/停止/卸载时调)。 */
export const READING_HIGHLIGHT_NAME = "cp-reading";

export function clearReadingMark(container: HTMLElement): void {
  const cssLike = CSS as unknown as { highlights?: Map<string, unknown> };
  try {
    cssLike.highlights?.delete(READING_HIGHLIGHT_NAME);
  } catch {
    /* 无 Highlight API 的环境 */
  }
  readingRange = null;
  container.querySelectorAll(`.${READING_MARK_CLASS}`).forEach((m) => {
    const parent = m.parentNode;
    if (parent) {
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
  container.normalize();
}

/**
 * 朗读句对齐匹配(v9 整句边界,纯函数,verify 直测)。
 *
 * v8 及以前按"原句 token 逐一 indexOf"匹配,两类根因让高亮经常落在句子中间:
 *   ①标点/全半角差异(朗读文本半角逗号 vs DOM 全角、「」引号 markdown 转写)让
 *     句首 token 匹配失败,起点绑到句中后继 token 上;
 *   ②游标漂移(前一句匹配终点越过真实句界)直接把当前句起点推到句中。
 *
 * v9 方案 = canonical 全文对齐 + 句界扩展:
 *   ①把 DOM 文本与句子都规范化(只留文字字符,全角→半角,小写,去空白/标点),
 *     建规范串→原文下标映射,标点差异全部消失;
 *   ②先整句 indexOf(常态命中,句首必然对齐),失败再 token 间隔匹配
 *     (间隔吸收行内代码/表格竖线等读显差异);
 *   ③匹配到的原文区间向前吃开引号(「『(等)、向后吃句末标点加闭引号
 *     (。!?"』 等)——高亮总是覆盖完整可见句子,不再停在句中。
 */
const WORD_CHAR_RE = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
const OPEN_EDGE = "\u300c\u300e(\uff08[\u3010<\u300a\"'\u201c\u2018";
const CLOSE_EDGE = "\u3002\u300f\u300d)\uff09]\u3011>\u300b\"'\u201d\u2019!\uff01?\uff1f\u2026,\uff0c\u3001;\uff1b:\uff1a";

/** 单字符规范化:全角→半角、小写;非文字字符返回 null(标点/空白/符号全滤)。 */
function canonChar(ch: string): string | null {
  const c = ch.codePointAt(0)!;
  let s = ch;
  if (c >= 0xff01 && c <= 0xff5e) s = String.fromCharCode(c - 0xfee0);
  return WORD_CHAR_RE.test(s) ? s.toLowerCase() : null;
}

/** 文本 → 规范串 + 规范位→原文本标映射(升序,可二分)。 */
export function canonicalSpeechIndex(text: string): { canon: string; map: number[] } {
  let canon = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = canonChar(text[i]!);
    if (c !== null) {
      canon += c;
      map.push(i);
    }
  }
  return { canon, map };
}

/** 原文下标 from → 规范串起点(map 中第一个 ≥ from 的位置)。 */
function canonLowerBound(map: number[], from: number): number {
  if (from <= 0) return 0;
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid]! < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 在 domText 的 from 起对齐整句(规范化 + 句界扩展)。纯函数。
 * 返回原文区间;对不上返回 null。跨度 sanity 防误命中早期重复文本。
 */
export function matchSentenceAligned(
  domText: string,
  sentence: string,
  from: number,
): { start: number; end: number } | null {
  const { canon, map } = canonicalSpeechIndex(domText);
  const toks = sentence
    .trim()
    .split(/\s+/)
    .map((t) => [...t].map(canonChar).filter(Boolean).join(""))
    .filter((t) => t.length > 0);
  if (toks.length === 0 || canon.length === 0) return null;

  const ci = canonLowerBound(map, Math.max(0, from));
  const full = toks.join("");
  let s = -1;
  let e = -1;
  const hit = canon.indexOf(full, ci);
  if (hit >= 0) {
    s = hit;
    e = hit + full.length - 1;
  } else {
    // token 间隔匹配:间隔 = 行内代码/围栏代码(读时剥掉,DOM 里还在)等读显差异
    let searchFrom = ci;
    for (const tok of toks) {
      const idx = canon.indexOf(tok, searchFrom);
      if (idx < 0) return null;
      if (s < 0) s = idx;
      e = idx + tok.length - 1;
      searchFrom = e + 1;
    }
    if (s < 0 || e - s + 1 > full.length * 3 + 40) return null;
  }
  if (e >= map.length || s < 0) return null;
  let start = map[s]!;
  let end = map[e]! + 1;

  // 句界扩展:向前吃开引号(不越过上一句终点),向后吃句末标点+闭引号
  const floor = from > 0 ? from : 0;
  for (let k = 0; k < 3 && start - 1 >= floor && OPEN_EDGE.includes(domText[start - 1]!); k++) start--;
  for (let k = 0; k < 4 && end < domText.length && CLOSE_EDGE.includes(domText[end]!); k++) end++;
  return { start, end };
}

/** 各容器的朗读匹配游标(句 N 的终点 = 句 N+1 的搜索起点;单调防重复文本回跳)。 */
const readingCursors = new WeakMap<HTMLElement, number>();

/** 新一轮朗读从第 0 句开始前重置游标(讲解/对话两处调用方在 readingIdx===0 时调)。 */
export function resetReadingCursor(container: HTMLElement): void {
  readingCursors.delete(container);
}

/**
 * 在讲解正文/对话消息里定位并高亮**当前正在朗读**的句子,返回高亮元素(未找到返回 null)。
 *
 * 句子文本来自 splitSentences(normalizeSpeechText(content)) —— 与 main 合成侧
 * 同一真源(shared/speech-text 纯函数),句子序=缓冲播放序。匹配 = matchSentenceAligned
 * 规范化整句对齐(标点/全半角差异归零)+ 句界扩展(吃开引号/句末标点)+ 单调游标(重复文本不回跳;失败回卷重找一次
 * 自愈内容重挂)。opts.within 限定搜索子树(对话消息限定正文 text part,思考块/
 * 工具产物的文字不参与匹配 —— 它们显示但不朗读)。
 */
export function markReadingSentence(
  container: HTMLElement,
  sentence: string,
  opts?: { within?: string },
): Range | null {
  clearReadingMark(container);
  const trimmed = sentence.trim();
  if (!trimmed) return null;
  const model = getTextModel(container, opts?.within);
  const from = readingCursors.get(container) ?? 0;
  let m = matchSentenceAligned(model.text, trimmed, from);
  if (!m && from > 0) {
    // 游标漂移自愈(ReactMarkdown 重挂后 DOM 变了):从头重找一次
    m = matchSentenceAligned(model.text, trimmed, 0);
  }
  if (!m) return null;
  readingCursors.set(container, m.end);
  const range = offsetsToRange(model, m.start, m.end);
  if (!range) return null;
  // v8:CSS Custom Highlight API 注册式高亮(零 DOM 改动)。
  // 旧 span 包裹会改写 React 管理的 DOM,朗读逐句 setState → ReactMarkdown
  // 重渲染 reconcile 撞上外来节点 → ErrorBoundary"渲染失败"(重试又好,下一句再炸)。
  // ::highlight() 伪元素直接给 Range 上色,React 完全无感;不支持的环境回退 span。
  const cssLike = CSS as unknown as { highlights?: Map<string, unknown> };
  if (typeof Highlight !== "undefined" && cssLike.highlights) {
    try {
      cssLike.highlights.set(READING_HIGHLIGHT_NAME, new Highlight(range));
      readingRange = range;
      return range;
    } catch {
      /* fall through to span fallback */
    }
  }
  const span = document.createElement("span");
  span.className = READING_MARK_CLASS;
  return wrapRangeWithElement(range, span) ? range : null;
}

/** v8 当前朗读句的 Range(伴学 rAF 逐帧取 rect 跟句;Range 随 DOM/滚动自动更新)。 */
let readingRange: Range | null = null;
export function getReadingRange(): Range | null {
  return readingRange;
}

/** 闪烁某个持久画线 mark(溯源跳转时用):加粗下划线 + 淡黄背景高亮,1.5s 后恢复。 */
export function flashMark(mark: HTMLElement): void {
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  mark.style.transition = "background 0.3s, border-bottom-color 0.3s, border-bottom-width 0.3s";
  mark.style.background = "rgba(250, 204, 21, 0.35)";
  mark.style.borderBottom = "4px solid rgb(34, 197, 94)";
  setTimeout(() => {
    mark.style.color = "inherit";
    mark.style.background = "transparent";
    mark.style.borderBottom = "2px solid rgb(34, 197, 94)";
  }, 1500);
}
