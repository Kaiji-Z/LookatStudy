/**
 * verify-pptx-parser.mjs — parsePptx 路由 + 提取的确定性测试。
 *
 * 跑法: npx tsx scripts/verify-pptx-parser.mjs(也被 verify:core 调)
 *
 * 测什么(自包含, 测试内用 pptxgenjs 造 deck, 不依赖外部 fixture 文件):
 *   T1 markdown 含每张 slide 的 H2(`## Slide N:`)+ 标题文本 + 讲者备注
 *   T2 图片提取: 每张 slide 的内嵌图 → {buffer, mimeType, slideNumber}, PNG 合法
 *   T3 损坏输入抛出(上游 local-folder-scanner 的 try/catch 兜底)
 *
 * pptxgenjs 是 devDep, 仅本测试用于造已知 deck。
 */
import { strict as assert } from "node:assert";
import pptxgen from "pptxgenjs";
import { parsePptx } from "../src/main/lib/pptx-parser.ts";

// 1x1 红 PNG(已知合法最小 PNG)
const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQz4AEgD9QAQ8DBbsAAAAASUVORK5CYII=";

// 测试内造一个 2-slide deck: 标题 + 正文 + 讲者备注 + 内嵌图
const p = new pptxgen();
p.title = "Verify Deck";
const s1 = p.addSlide();
s1.addText("第一张标题", { x: 0.5, y: 0.3, w: 9, h: 1, bold: true });
s1.addText("第一张正文内容", { x: 0.5, y: 1.5, w: 9, h: 1 });
s1.addNotes("备注一:解释第一张。");
s1.addImage({ data: RED_PNG, x: 6, y: 1.5, w: 2, h: 1.5 });
const s2 = p.addSlide();
s2.addText("第二张标题", { x: 0.5, y: 0.3, w: 9, h: 1, bold: true });
s2.addText("第二张正文", { x: 0.5, y: 1.5, w: 9, h: 1 });
s2.addNotes("备注二:解释第二张。");
s2.addImage({ data: RED_PNG, x: 6, y: 1.5, w: 2, h: 1.5 });
const buf = await p.write("nodebuffer");

let passed = 0;

// T1: markdown 结构
{
  const { markdown } = await parsePptx(buf);
  assert.ok(markdown.includes("## Slide 1:"), "T1 应含 ## Slide 1");
  assert.ok(markdown.includes("## Slide 2:"), "T1 应含 ## Slide 2");
  assert.ok(markdown.includes("第一张标题"), "T1 应含 slide 1 标题文本");
  assert.ok(markdown.includes("第二张标题"), "T1 应含 slide 2 标题文本");
  assert.ok(markdown.includes("备注一"), "T1 应含讲者备注一");
  assert.ok(markdown.includes("备注二"), "T1 应含讲者备注二");
  console.log("  ✓ T1 markdown 含两 slide H2 + 标题 + 讲者备注, len=%d", markdown.length);
  passed++;
}

// T2: 图片提取
{
  const { images } = await parsePptx(buf);
  assert.ok(images.length === 2, `T2 应提 2 张图(每 slide 一张), 实际 ${images.length}`);
  assert.ok(images.every((i) => i.slideNumber === 1 || i.slideNumber === 2), "T2 slideNumber ∈ {1,2}");
  assert.ok(images.every((i) => i.mimeType === "image/png"), "T2 mime=image/png");
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
  assert.ok(
    images.every((i) => PNG_MAGIC.every((b, idx) => i.buffer[idx] === b)),
    "T2 buffer 合法 PNG 头",
  );
  console.log("  ✓ T2 提取 %d 张图, 均 PNG + 带 slideNumber", images.length);
  passed++;
}

// T3: 损坏输入抛出(上游 scanner try/catch 兜底)
{
  let threw = false;
  try {
    await parsePptx(Buffer.from("not a pptx at all"));
  } catch {
    threw = true;
  }
  assert.ok(threw, "T3 损坏输入应抛(上游 local-folder-scanner try/catch 接)");
  console.log("  ✓ T3 损坏输入抛出, 上游兜底");
  passed++;
}

// 测试内再造一个带表格的 deck(pptxgenjs addTable → 真实 OOXML table 部件)
const p2 = new pptxgen();
p2.title = "Table Deck";
const t1 = p2.addSlide();
t1.addText("表格页标题", { x: 0.5, y: 0.3, w: 9, h: 1 });
t1.addTable(
  [
    [{ text: "算法" }, { text: "复杂度" }],
    [{ text: "快排" }, { text: "O(n log n)" }],
    [{ text: "冒泡" }, { text: "O(n^2)" }],
  ],
  { x: 0.5, y: 1.5, w: 9 },
);
const t2 = p2.addSlide(); // 空表(pptxgenjs 最小 1x1)→ 应整张跳过不产噪声
t2.addTable([[{ text: "" }]], { x: 0.5, y: 1.5, w: 2 });
const buf2 = await p2.write("nodebuffer");

// T4: 表格 → GFM markdown 表格进正文(2026-08-23 真实样本驱动修复:
// 此前 officeparser 的 table 节点被整层忽略, 表格文字全军覆没)
{
  const { markdown } = await parsePptx(buf2);
  assert.ok(markdown.includes("## Slide 1: 表格页标题"), "T4 表格页标题");
  assert.ok(/\| *算法 *\|/.test(markdown), `T4 表头行, 实际: ${markdown.slice(0, 200)}`);
  assert.ok(markdown.includes("O(n log n)") && markdown.includes("冒泡"), "T4 单元格文字进正文");
  assert.ok(/\|\s*---/.test(markdown), "T4 GFM 分隔行");
  const emptySlides = (markdown.match(/^## Slide 2:[^\n]*\n+(\|)/gm) ?? []).length;
  assert.ok(emptySlides === 0, `T4 空表格整张跳过(Slide 2 无表格噪声), 实际出现 ${emptySlides} 处`);
  console.log("  ✓ T4 表格文字成 GFM markdown 表格 + 空表整张跳过");
  passed++;
}

// T5: 竖线转义防破表(单元格含 | 时不炸 markdown 表结构)
{
  const p3 = new pptxgen();
  const s = p3.addSlide();
  s.addText("管道符页", { x: 0.5, y: 0.3, w: 9, h: 1 });
  s.addTable([[{ text: "a|b" }, { text: "c" }]], { x: 0.5, y: 1.5, w: 6 });
  const { markdown } = await parsePptx(await p3.write("nodebuffer"));
  assert.ok(markdown.includes("a\\|b"), `T5 竖线应转义, 实际: ${JSON.stringify(markdown.slice(-80))}`);
  console.log("  ✓ T5 单元格竖线转义");
  passed++;
}

console.log(`\nverify-pptx-parser: ${passed}/5 通过`);
if (passed < 5) process.exitCode = 1;
