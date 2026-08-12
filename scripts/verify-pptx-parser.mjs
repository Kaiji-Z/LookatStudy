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

console.log(`\nverify-pptx-parser: ${passed}/3 通过`);
if (passed < 3) process.exitCode = 1;
