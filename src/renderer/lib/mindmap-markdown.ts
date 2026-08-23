/**
 * mindmap-markdown —— 讲解 markdown → 思维导图源文本的纯函数预处理(v0.21,v13 重设计)。
 *
 * 思维导图是**结构概览**:代码块整段进脑图节点只是噪声(markmap-lib 还会为它
 * 内嵌 hljs 高亮 HTML),图片也无处安放。喂给 markmap 前剥离:
 *   - 围栏代码块(``` 或 ~~~,含缩进围栏)→ 单行「代码块」占位(保住结构位置)
 *   - 图片 ![alt](url) → alt 文字
 *   - HTML 注释整段剥除
 *
 * v13 结构保真:markmap 只认标题+列表,裸段落会被并进上一列表项的懒延续或整段
 * 丢弃——导入切片的课时正文常是"一个标题下全是段落"(无小节标题),旧预处理
 * 下整篇缩成一个节点,脑图完全失去结构。现在**段落降为列表项节点**:每个段落块
 * 取首句(粗体引导段取粗体内容)做节点文案,悬在最近标题之下。标题/列表原样
 * 保留,层级仍是脑图骨架;表格/分隔线跳过(噪声)。
 */

/** 段落节点文案上限(字符;超出截断加省略号——节点是概览不是全文) */
const TOPIC_MAX = 40;

/** 行分类(预处理之后,line 级) */
type LineKind = "heading" | "list" | "para" | "skip";

function classifyLine(line: string): LineKind {
  const t = line.trim();
  if (!t) return "skip";
  if (/^#{1,6}\s/.test(t)) return "heading";
  if (/^([-*+]|\d{1,3}[.)])\s/.test(t)) return "list";
  if (/^(---+|\*\*\*+|___+)\s*$/.test(t)) return "skip"; // 分隔线
  if (t.startsWith("|") && t.endsWith("|")) return "skip"; // 表格行
  return "para";
}

/**
 * 段落 → 节点文案(纯):
 * - HTML 标签剥除、行内链接取文字、引语标记剥除
 * - 粗体引导段(`**X**…`)→ X(用户手写的小节主题,最真实的结构信号)
 * - 否则取首句(到首个句终标点,含标点)
 * - 超 TOPIC_MAX 字符截断加省略号;空段返回 null(不产节点)
 */
export function paragraphTopic(raw: string): string | null {
  let text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?/, "")
    .replace(/\s+/g, " ")
    .trim();
  const bold = /^\*\*(.+?)\*\*/.exec(text);
  if (bold) text = bold[1]!.trim();
  else {
    const m = /^[^。！？!?…;;]*/.exec(text);
    text = (m?.[0] ?? text).trim();
  }
  text = text.replace(/\*\*/g, "").trim();
  if (!text) return null;
  if (text.length > TOPIC_MAX) text = text.slice(0, TOPIC_MAX) + "…";
  return text;
}

/** 围栏/图片/注释剥离(v0.21 原逻辑,段落降节点的前置)。 */
function stripNoise(md: string): string[] {
  const out: string[] = [];
  let fence: string | null = null; // 在围栏内 = 围栏标记(``` 或 ~~~)
  let fenceLen = 0;
  for (const line of md.split("\n")) {
    const open = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence == null) {
      if (open) {
        // 开围栏:长度 ≥3 的 ` 或 ~;占位用列表项语法(markmap 只认标题/列表为节点,
        // 裸段落会被并进上一项的懒延续或整段丢弃)且保留缩进不破嵌套
        fence = (open[2] ?? "")[0] ?? "`";
        fenceLen = (open[2] ?? "").length;
        out.push(`${open[1] ?? ""}- 代码块`);
        continue;
      }
      out.push(line);
    } else {
      const close = new RegExp(`^\\s*\\${fence === "~" ? "~" : "`"}{${fenceLen},}\\s*$`).test(line);
      if (close) {
        fence = null;
      }
      // 围栏内其余行丢弃(含围栏首行后的语言标注已在开行吞掉)
    }
  }
  return (
    out
      .join("\n")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
  );
}

/**
 * 预处理主入口:剥噪声 → 段落块降为 `- 首句` 列表项节点(标题/列表原样)。
 * 连续的 para 行合成一个段落块(空行/标题/列表/跳过行断开)。
 */
export function mindmapMarkdown(md: string): string {
  const lines = stripNoise(md);
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const topic = paragraphTopic(para.join(" "));
    if (topic) out.push(`- ${topic}`);
    para = [];
  };
  for (const line of lines) {
    const kind = classifyLine(line);
    if (kind === "para") {
      para.push(line);
      continue;
    }
    flushPara();
    if (kind === "heading" || kind === "list") out.push(line);
    // skip(空行/表格/分隔线):段落断行,自身不产出
  }
  flushPara();
  return out.join("\n");
}
