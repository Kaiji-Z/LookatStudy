/**
 * live: EPUB 拆分健壮性语料核查(2026-08-23,多样本采样驱动开发的方法沉淀)。
 *
 * 8 本结构各异的 Gutenberg 真书(多章一文件/heading 章/罗马数字/序号装饰/
 * license 尾块/译者元数据页),下载一次缓存 scripts/fixtures/epub-corpus/
 * (gitignored),断言拆分质量三硬指标:
 *   1. 标题-内容对齐:H1 与 title 零错位(旧 bug:标题取末章号内容从首章开始);
 *   2. license 零残留(标题或正文开头都不再出现 FULL PROJECT GUTENBERG 成课);
 *   3. 章数落在采样带宽内(Ulysses 文艺标记放宽)。
 * 跑法: npx tsx scripts/live-test/live-test-epub-corpus.mjs(需网络;缓存后离线可跑)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readApiKey } from "./_load-env.mjs";

readApiKey(); // 烟雾协议要求(本测试不需要 key —— no key ok,纯下载+解析)
import { parseEpub } from "../../src/main/lib/epub-parser.ts";

const BOOKS = [
  // [gutenbergId, 名称, 采样章数, 容差比]
  ["1342", "Pride and Prejudice", 61, 0.35],
  ["84", "Frankenstein", 24, 0.35],
  ["2701", "Moby Dick", 137, 0.1],
  ["1661", "Sherlock Holmes", 12, 0.35],
  ["98", "A Tale of Two Cities", 45, 0.15],
  ["5200", "Metamorphosis", 3, 0.35],
  ["11", "Alice in Wonderland", 12, 0.15],
  ["4300", "Ulysses", 18, 0.6], // 文艺标记形态多样(— I — / [ 2 ] 混排),放宽
];
let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.error(`  ❌ ${m}`); failed++; };

// ── 本地真书(出版社形态,2026-08-23 沉思录驱动):缓存-only——无网络来源可重下,
//    缓存缺失时 SKIP(诚实;样本随开发者机器携带,不入库)。 ──
{
  const cache = "scripts/fixtures/epub-corpus/meditations-zh.epub";
  if (!existsSync(cache)) {
    console.log("  SKIP 沉思录(出版社形态): 本地缓存缺失且无下载源");
  } else {
    try {
      const book = await parseEpub(new Uint8Array(readFileSync(cache)));
      const chs = book.chapters;
      const juan = chs.filter((c) => /^第[一二三四五六七八九十]+卷$/.test(c.title)).length;
      const fabricated = chs.filter((c) => /^第\s*\d+\s*章$/.test(c.title)).length;
      const frontJunk = chs.filter((c) => /^(版权信息|目\s*录)/.test(c.title)).length;
      if (juan === 12 && fabricated === 0 && frontJunk === 0 && chs.length <= 14) {
        ok(`沉思录(上海译文): ${chs.length} 章,12 卷扉页配对成功,零编造标题,零前置件`);
      } else {
        bad(`沉思录: 卷 ${juan}/12,编造标题 ${fabricated},前置件 ${frontJunk},共 ${chs.length} 章(>14=扉页未配对)`);
      }
    } catch (e) { bad(`沉思录: 解析抛错 ${e.message}`); }
  }
}


for (const [id, name, expectCh, tol] of BOOKS) {
  const cache = `scripts/fixtures/epub-corpus/${id}.epub`;
  let bytes = null;
  if (existsSync(cache)) {
    bytes = new Uint8Array(readFileSync(cache));
  } else {
    for (let a = 1; a <= 3 && !bytes; a++) {
      try {
        const r = await fetch(`https://www.gutenberg.org/ebooks/${id}.epub.noimages`, { redirect: "follow" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const b = Buffer.from(await r.arrayBuffer());
        if (b.subarray(0, 2).toString("latin1") !== "PK") throw new Error("非 zip");
        bytes = new Uint8Array(b);
      } catch { await new Promise((r2) => setTimeout(r2, 2500 * a)); }
    }
  }
  if (!bytes) { bad(`${id} ${name}: 下载失败(重试后仍不可达)`); continue; }
  try {
    if (!existsSync(cache)) { mkdirSync("scripts/fixtures/epub-corpus", { recursive: true }); writeFileSync(cache, bytes); }
    const book = await parseEpub(bytes);
    const chs = book.chapters;
    const misaligned = chs.filter((c) => !c.markdown.startsWith(`# ${c.title}`)).length;
    const licenseCh = chs.filter((c) => /FULL PROJECT GUTENBERG/i.test(c.title) || /FULL PROJECT GUTENBERG/i.test(c.markdown.slice(0, 200))).length;
    const inBand = Math.abs(chs.length - expectCh) <= Math.ceil(expectCh * tol);
    if (misaligned === 0 && licenseCh === 0 && inBand) {
      ok(`${name}: ${chs.length} 章(带宽 ${expectCh}±${Math.round(tol * 100)}%),对齐/无license`);
    } else {
      bad(`${name}: ${chs.length} 章(预期带宽 ${expectCh}±${Math.round(tol * 100)}%),H1错位 ${misaligned},license ${licenseCh}`);
    }
  } catch (e) { bad(`${id} ${name}: ${e.message}`); }
}
console.log(`
=== EPUB 语料核查: ${failed === 0 ? "✅ 全部通过" : "❌"} ===`);
process.exit(failed === 0 ? 0 : 1);
