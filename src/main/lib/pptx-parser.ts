/**
 * PPTX 解析器 —— .pptx → markdown(每张 slide 一个 ##) + 内嵌图片字节。
 *
 * 设计:
 *   - 走 officeparser AST(纯 JS, 无原生依赖)。extractAttachments:true 拿图片字节。
 *   - markdown 每张 slide 写成 `## Slide N: <标题>`, 这样现有导入管线
 *     (extractHeadings 匹配 ##/### → designCourseStructure 按 H2 切 → getLessonContent
 *     按 anchor 切片)会**自动把每张 slide 变成一节课**, 无需新分块代码。
 *   - 讲者备注用 `**讲者备注:** ...`(非标题), 随 slide 走, 不会被当 H3 拆成独立课。
 *   - 图片作为独立 {buffer, mimeType, slideNumber} 返回, 由上游写进 node_assets
 *     (对齐 PDF 图片处理; 不内联 base64 进 markdown, 避免 DB 膨胀)。
 *
 * 职责边界: 只做 .pptx(OOXML)。.ppt(2007 前二进制 OLE)不支持, 上游按扩展名过滤。
 * SmartArt/图表等复杂视觉只取其文本, 渲染留给未来 vision 路径。
 *
 * AST 形态(officeparser 实测):
 *   ast.content:   [{type:"slide", children:[{type:"paragraph"|"image",...}], notes:[{children:[{type:"paragraph",text}]}], metadata:{slideNumber}}]
 *   ast.attachments:[{type:"image", mimeType, data(base64), name, extension}]
 *   image node → metadata.attachmentName 对应 attachments[].name
 */
import { OfficeParser } from "officeparser";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PptxImage {
  buffer: Buffer;
  mimeType: string;
  slideNumber: number;
}

export interface PptxProcessResult {
  markdown: string;
  images: PptxImage[];
}

/**
 * officeparser 的 table 节点(table → row → cell,cell.text + metadata.{row,col})
 * → GFM markdown 表格。2026-08-23 真实样本驱动修复:此前 table 节点被整层
 * 忽略,表格文字全军覆没(真实课件表格极常见)。竖线转义防破表;行按 row
 * 排序、格按 col 排序,缺格补空(合并单元格容错)。
 */
function tableToMarkdown(node: any): string {
  const rows = new Map<number, { col: number; text: string }[]>();
  const walk = (n: any): void => {
    if (n?.type === "cell") {
      const r = Number(n.metadata?.row ?? 0);
      const c = Number(n.metadata?.col ?? 0);
      const text = String(n.text ?? "").trim().replace(/\|/g, "\\|").replace(/\s+/g, " ");
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r)!.push({ col: c, text });
      return;
    }
    for (const ch of n?.children ?? []) walk(ch);
  };
  walk(node);
  if (rows.size === 0) return "";
  // 全空表格(占位符未填的空表)整张跳过,不产出噪声行
  if ([...rows.values()].every((cells) => cells.every((c) => !c.text))) return "";
  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells.sort((a, b) => a.col - b.col));
  const width = Math.max(...sorted.map((cs) => cs.length));
  const line = (texts: string[]) => `| ${Array.from({ length: width }, (_, i) => texts[i] ?? "").join(" | ")} |`;
  const header = line(sorted[0]!.map((c) => c.text));
  const sep = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [header, sep, ...sorted.slice(1).map((cs) => line(cs.map((c) => c.text)))].join("\n");
}

/**
 * 把 .pptx buffer 解析成 { markdown, images }。
 * 失败抛出(上游 try/catch 兜底, 当"无内容"处理, 不崩导入)。
 */
export async function parsePptx(buf: Buffer): Promise<PptxProcessResult> {
  const ast = await OfficeParser.parseOffice(buf, {
    extractAttachments: true,
    ignoreSlideMasters: true, // 跳过母版装饰图(模板底图), 只要正文图
    ignoreHeadersAndFooters: true,
  });

  // 1. 附件字节 map: name → {buffer, mimeType}。过滤空 data / 占位 octet-stream。
  const attMap = new Map<string, { buffer: Buffer; mimeType: string }>();
  for (const a of ast.attachments ?? []) {
    if (
      a?.type === "image" &&
      a.data &&
      a.mimeType &&
      (a.mimeType as string) !== "application/octet-stream"
    ) {
      attMap.set(a.name, { buffer: Buffer.from(a.data, "base64"), mimeType: a.mimeType });
    }
  }

  // 2. 走 slides
  const slides = (ast.content ?? []).filter((n: any) => n?.type === "slide");
  const images: PptxImage[] = [];
  const seenImg = new Set<string>();
  const lines: string[] = [];

  const deckTitle = (ast.metadata as any)?.title || "PPTX";
  lines.push(`# ${deckTitle}`);

  for (const slide of slides) {
    const slideNo = (slide.metadata as any)?.slideNumber ?? 0;
    const children: any[] = slide.children ?? [];
    let title = "";
    const bodyTexts: string[] = [];

    for (const child of children) {
      if (child.type === "paragraph" && child.text) {
        if (!title) title = child.text;
        else bodyTexts.push(child.text);
      } else if (child.type === "table") {
        // 表格进正文(GFM markdown 表格);标题仍只取段落,表不当标题
        const md = tableToMarkdown(child);
        if (md) bodyTexts.push(md);
      } else if (child.type === "image") {
        const name = child.metadata?.attachmentName;
        if (name && attMap.has(name) && !seenImg.has(name)) {
          seenImg.add(name);
          const att = attMap.get(name)!;
          images.push({ buffer: att.buffer, mimeType: att.mimeType, slideNumber: slideNo });
        }
      }
    }

    lines.push(`\n## Slide ${slideNo}: ${title || "(无标题)"}\n`);
    if (bodyTexts.length) lines.push(bodyTexts.join("\n\n"));

    // 讲者备注(非标题, 随 slide 走)
    const noteTexts: string[] = [];
    for (const note of slide.notes ?? []) {
      for (const p of note.children ?? []) {
        if (p.type === "paragraph" && p.text) noteTexts.push(p.text);
      }
    }
    if (noteTexts.length) lines.push(`\n**讲者备注:** ${noteTexts.join(" ")}`);
  }

  return { markdown: lines.join("\n"), images };
}
