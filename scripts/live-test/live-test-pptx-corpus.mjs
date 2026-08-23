/**
 * live: PPTX 解析语料核查(2026-08-23,多样本采样驱动)。
 *
 * 真实样本缓存 scripts/fixtures/pptx-corpus/(gitignored,缺则从 PyPI 下载
 * python-pptx sdist 解出 fixtures——这些是真实 PowerPoint 制作的 .pptx 二进制,
 * 含病理真样本:missing_rels_item 断关系项 / no-slides 零页 / no-core-props
 * 无元数据)。断言五类硬指标:
 *   1. 全样本零抛错(病理件也不崩,上游 try/catch 是最后防线不是常态路径);
 *   2. 表格文字找回:tbl-cell 三页的真实表格文字进正文成 GFM markdown 表
 *      (2026-08-23 修复:此前 officeparser table 节点被整层忽略);
 *   3. 讲者备注随 slide:sld-notes 的 "Notes 1" 进正文;
 *   4. 图片提取:shp-picture 2 张 / jpg-mime 样本 mime=image/jpeg 且字节非空;
 *   5. 诚实空:no-slides/minimal 零页不产假内容,只落 `# 标题` 一行。
 * 已知局限(诚实记录):图表页(cht-charts)图表文字不提取——SmartArt/图表
 * 只取文本层的既有边界,vision 路径未来补;占位符未填的空表整张跳过。
 * 跑法: npx tsx scripts/live-test/live-test-pptx-corpus.mjs(需网络首次)
 */
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试不需要 key —— no key ok,纯下载+解析)
let failed = 0, skipped = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const skip = (m) => { console.log(`  ⏭️  SKIP ${m}`); skipped++; };
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

const DIR = "scripts/fixtures/pptx-corpus";
const SDIST = `${DIR}/python_pptx_sdist.tar.gz`;
const SDIST_URL = "https://files.pythonhosted.org/packages/52/a9/0c0db8d37b2b8a645666f7fd8accea4c6224e013c42b1d5c17c93590cd06/python_pptx-1.0.2.tar.gz";
/** [缓存名, sdist 内路径, 说明] */
const WANTED = [
  ["tbl-cell.pptx", "features/steps/test_files/tbl-cell.pptx", "真实表格(3页)"],
  ["sld-notes.pptx", "features/steps/test_files/sld-notes.pptx", "讲者备注"],
  ["shp-picture.pptx", "features/steps/test_files/shp-picture.pptx", "图片形状"],
  ["test-image-jpg-mime.pptx", "features/steps/test_files/test-image-jpg-mime.pptx", "JPEG mime"],
  ["test_slides.pptx", "tests/test_files/test_slides.pptx", "组合形状+图片"],
  ["test.pptx", "tests/test_files/test.pptx", "常规页"],
  ["missing_rels_item.pptx", "tests/test_files/missing_rels_item.pptx", "病理:断关系项"],
  ["no-slides.pptx", "tests/test_files/no-slides.pptx", "病理:零页"],
  ["no-core-props.pptx", "tests/test_files/no-core-props.pptx", "病理:无元数据"],
  ["minimal.pptx", "tests/test_files/minimal.pptx", "病理:极简"],
  ["ph-populated-placeholders.pptx", "features/steps/test_files/ph-populated-placeholders.pptx", "占位符(含空表)"],
  ["cht-charts.pptx", "features/steps/test_files/cht-charts.pptx", "图表页(已知局限)"],
];

mkdirSync(DIR, { recursive: true });
if (WANTED.some(([n]) => !existsSync(`${DIR}/${n}`))) {
  try {
    if (!existsSync(SDIST)) {
      const res = await fetch(SDIST_URL, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(String(res.status));
      // 流式落盘(10MB)
      const { createWriteStream } = await import("node:fs");
      const { Readable } = await import("node:stream");
      const { pipeline } = await import("node:stream/promises");
      await pipeline(Readable.fromWeb(res.body), createWriteStream(SDIST));
    }
    const { execFileSync } = await import("node:child_process");
    const tmp = `${DIR}/.extract`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const [, path] of WANTED) {
      execFileSync("tar", ["-xzf", SDIST, "-C", tmp, `python_pptx-1.0.2/${path}`], { stdio: "ignore" });
    }
    const { copyFileSync } = await import("node:fs");
    for (const [name, path] of WANTED) {
      const src = `${tmp}/python_pptx-1.0.2/${path}`;
      if (existsSync(src) && !existsSync(`${DIR}/${name}`)) copyFileSync(src, `${DIR}/${name}`);
    }
    rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    skip(`语料下载/解包失败(${e.message});已有缓存则继续`);
  }
}

const { parsePptx } = await import("../../src/main/lib/pptx-parser.ts");

// 1. 全样本零抛错
let allOk = true;
for (const [name, , note] of WANTED) {
  const f = `${DIR}/${name}`;
  if (!existsSync(f)) { skip(`${note}: 缺语料 ${name}`); allOk = false; continue; }
  try {
    const r = await parsePptx(readFileSync(f));
    if (typeof r.markdown !== "string" || !Array.isArray(r.images)) throw new Error("返回形状不对");
  } catch (e) {
    bad(`${note}(${name}): 抛错 ${e.message}`);
    allOk = false;
  }
}
if (allOk && failed === 0) ok(`全 ${WANTED.length} 真样本(含 4 病理件)零抛错`);

// 2. 表格文字找回
if (existsSync(`${DIR}/tbl-cell.pptx`)) {
  const { markdown } = await parsePptx(readFileSync(`${DIR}/tbl-cell.pptx`));
  const has = ["having custom margins", "vert anchor is inherited", "vert anchor is top"].every((s) => markdown.includes(s));
  const gfm = /\|\s*---/.test(markdown);
  if (has && gfm) ok(`表格文字找回: 3 页真实表格全进正文(${markdown.length} 字符)`);
  else bad(`表格文字丢失: has=${has} gfm=${gfm}`);
}

// 3. 讲者备注
if (existsSync(`${DIR}/sld-notes.pptx`)) {
  const { markdown } = await parsePptx(readFileSync(`${DIR}/sld-notes.pptx`));
  if (markdown.includes("讲者备注") && markdown.includes("Notes 1")) ok("讲者备注随 slide 进正文");
  else bad(`讲者备注丢失: ${JSON.stringify(markdown)}`);
}

// 4. 图片提取
if (existsSync(`${DIR}/shp-picture.pptx`)) {
  const { images } = await parsePptx(readFileSync(`${DIR}/shp-picture.pptx`));
  if (images.length === 2) ok("shp-picture 提取 2 张图");
  else bad(`shp-picture 图片数 ${images.length} ≠ 2`);
}
if (existsSync(`${DIR}/test-image-jpg-mime.pptx`)) {
  const { images } = await parsePptx(readFileSync(`${DIR}/test-image-jpg-mime.pptx`));
  const jpg = images.find((i) => i.mimeType === "image/jpeg" && i.buffer.length > 0);
  if (jpg) ok(`JPEG mime 正确(${jpg.buffer.length} 字节)`);
  else bad(`JPEG 图片缺失或 mime 错: ${JSON.stringify(images.map((i) => i.mimeType))}`);
}

// 5. 诚实空
for (const [name, , note] of [["no-slides.pptx", "", "零页"], ["minimal.pptx", "", "极简"]]) {
  if (existsSync(`${DIR}/${name}`)) {
    const { markdown } = await parsePptx(readFileSync(`${DIR}/${name}`));
    if (markdown.startsWith("# ") && !markdown.includes("## Slide")) ok(`${note}: 只落标题行, 不产假内容`);
    else bad(`${note}: 产出了假内容 ${JSON.stringify(markdown.slice(0, 80))}`);
  }
}

console.log(`\n${failed === 0 ? "ALL GREEN" : "FAILURES"}: fail=${failed} skip=${skipped}`);
process.exit(failed === 0 ? 0 : 1);
