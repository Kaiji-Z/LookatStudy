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

export function getTextModel(container: HTMLElement): TextModel {
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
  // 快路径:startContainer === endContainer(单节点,不跨边界)
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    try {
      const mark = document.createElement("mark");
      mark.className = "lookatstudy-underline";
      mark.dataset.noteId = noteId;
      mark.style.cssText = markStyle;
      range.surroundContents(mark);
      return mark;
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

    let firstMark: HTMLElement | null = null;
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
      const mark = document.createElement("mark");
      mark.className = "lookatstudy-underline";
      mark.dataset.noteId = noteId;
      mark.style.cssText = markStyle;
      toWrap.parentNode?.insertBefore(mark, toWrap);
      mark.appendChild(toWrap);
      if (!firstMark) firstMark = mark;
    }
    return firstMark;
  } catch {
    return null;
  }
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
