/**
 * DOCX 解析器 —— officeparser AST → markdown(spike 实测:heading 带 level,
 * Heading1/2 样式保真;与 pptx/epub 的"AST→markdown 标题"同构)。
 * 管线按 ## 标题拆课,Word 的 Heading 结构自动映射为课时边界。
 * 纯 JS(officeparser 已 external),无原生编译。
 */
import { parseOffice } from "officeparser";

interface DocxNode {
  type: string;
  text?: string;
  metadata?: { level?: number };
}

export async function parseDocx(buf: Buffer): Promise<string> {
  const ast = await parseOffice(buf);
  const lines: string[] = [];
  for (const node of (ast.content ?? []) as DocxNode[]) {
    if (node.type === "heading") {
      const lvl = Math.min(6, Math.max(1, Number(node.metadata?.level) || 1));
      const t = (node.text ?? "").trim();
      if (t) lines.push("", "#".repeat(lvl) + " " + t, "");
    } else if (node.type === "paragraph") {
      const t = (node.text ?? "").trim();
      if (t) lines.push(t, "");
    } else if (node.type === "code") {
      lines.push("```", (node.text ?? "").trim(), "```", "");
    }
    // 表格/列表等其余节点:officeparser 会给 text 汇总,paragraph 已覆盖主体;
    // 遇到 text 非空的未知类型保守保留文本
    else if ((node.text ?? "").trim()) {
      lines.push((node.text ?? "").trim(), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
