/**
 * DOCX 解析器验证 —— 测试内用 fflate 现场构造最小 docx(不提交二进制 fixture),
 * 断言 Heading 级别保真(管线按 ## 拆课的依赖)。跑法: npx tsx scripts/verify-docx-parser.mjs
 */
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseDocx } from "../src/main/lib/docx-parser.ts";

function buildDocx(paras) {
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.map(([style, text]) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`,
    ).join("") + "</w:body></w:document>";
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(docXml),
  }));
}

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

await test("T1 Heading 级别保真:H1/H2 → #/##(拆课依赖)", async () => {
  const md = await parseDocx(buildDocx([
    ["Heading1", "第一章 引言"],
    [null, "这是第一章的正文段落,讲述基本概念与动机。"],
    ["Heading2", "1.1 背景"],
    [null, "背景说明文字。"],
  ]));
  assert.ok(md.startsWith("# 第一章 引言"), `H1 开头: ${md.slice(0, 20)}`);
  assert.ok(md.includes("## 1.1 背景"), "H2 保留");
  assert.ok(md.includes("这是第一章的正文段落"), "段落正文保留");
});

await test("T2 无样式文档:纯段落,无标题行(走 text-chunk 分段)", async () => {
  const md = await parseDocx(buildDocx([[null, "第一段内容。"], [null, "第二段内容。"]]));
  assert.ok(!/^#{1,6} /m.test(md), "无伪标题");
  assert.ok(md.includes("第一段内容。"));
});

await test("T3 坏内容(非 zip)诚实报错", async () => {
  await assert.rejects(() => parseDocx(Buffer.from("not a zip")), /officeparser|格式|zip|Error|corrupt/i);
});

console.log(`\n${passed} passed`);
