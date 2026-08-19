/**
 * 新导入来源端到端验证 —— runSmartImport 的 url/text/epub 分支(无 LLM 降级路径):
 * 课程落库 / 身份与内容哈希漂移 / 同源复用(零 AI) / docCache 断点续跑。
 * 跑法: npx tsx scripts/verify-import-sources.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { eq } from "drizzle-orm";
import { contentNodes } from "../src/main/db/schema.ts";
import { runSmartImport } from "../src/main/services/import-job-service.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";
import { computeContentHash } from "../src/main/services/pure/import-plan.ts";
import { zipSync, strToU8 } from "fflate";

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");

function freshDb() {
  const sqljs = new SQL.Database();
  sqljs.run(schemaSql);
  return drizzle(sqljs, { schema });
}

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

const mkDeps = () => ({
  db: freshDb(),
  store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-src-store-"))),
  markDirty: () => {},
  onProgress: () => {},
  shouldAbort: () => false,
});

/** 一篇有 3+ H2 的文章 → prepareSingleDoc 走单文件路径 */
const ARTICLE_HTML = `<!doctype html><html><head><title>梯度下降详解</title></head><body>
<nav><a href="/">首页</a></nav>
<article><h1>梯度下降详解</h1>
<p>梯度下降是机器学习中最基础的优化算法,理解它就理解了训练的骨架。</p>
<h2>算法直觉</h2><p>沿着 loss 下降最快的方向走一步,步子大小由学习率决定。</p>
<h2>学习率的影响</h2><p>太大震荡发散,太小收敛缓慢,实践里常用衰减调度。</p>
<h2>常见变体</h2><p>SGD、动量、Adam 各有取舍,Adam 自适应步长最常用。</p>
</article><footer>© x</footer></body></html>`;

const fetchArticleStub = (html) => async (url) => {
  if (String(url).includes("example.com")) {
    return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => html };
  }
  return { ok: false, status: 404, headers: { get: () => "" }, text: async () => "" };
};

await test("T1 url 文章导入:抽取→分段→落库,repoUrl 记录来源", async () => {
  const deps = mkDeps();
  const r = await runSmartImport({ kind: "url", url: "https://example.com/dl-guide" }, { ...deps, fetchFn: fetchArticleStub(ARTICLE_HTML) });
  assert.ok(r.courseId);
  const course = deps.db.select().from(schema.courses).where(eq(schema.courses.id, r.courseId)).get();
  assert.equal(course.repoUrl, "https://example.com/dl-guide");
  assert.equal(course.title, "梯度下降详解");
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 1, "至少一课");
});

await test("T2 同一 url 再导入:内容一致 → 复用方案(reused,零 AI)", async () => {
  const deps = mkDeps();
  await runSmartImport({ kind: "url", url: "https://example.com/dl-guide" }, { ...deps, fetchFn: fetchArticleStub(ARTICLE_HTML) });
  const r2 = await runSmartImport({ kind: "url", url: "https://example.com/dl-guide" }, { ...deps, fetchFn: fetchArticleStub(ARTICLE_HTML) });
  assert.equal(r2.reused, true, "第二次应复用结构");
  assert.notEqual(r2.courseId, "", "仍产出课程");
});

await test("T3 url 内容变化 → 漂移检测(内容哈希)不复用旧结构", async () => {
  const deps = mkDeps();
  await runSmartImport({ kind: "url", url: "https://example.com/dl-guide" }, { ...deps, fetchFn: fetchArticleStub(ARTICLE_HTML) });
  const changed = ARTICLE_HTML.replace("梯度下降是机器学习中最基础的优化算法", "梯度下降是深度学习时代最重要的优化算法之一,历史深远");
  const r2 = await runSmartImport({ kind: "url", url: "https://example.com/dl-guide" }, { ...deps, fetchFn: fetchArticleStub(changed) });
  assert.equal(r2.reused, false, "内容变了不能复用(路径集合相同,靠内容哈希识别漂移)");
});

await test("T4 粘贴文本导入:无标题长文自动分段,同名同文再导复用", async () => {
  const deps = mkDeps();
  const longText = Array.from({ length: 700 }, (_, i) => `第${i}个知识点讲得很清楚,值得反复体会。`).join("\n\n");
  const r = await runSmartImport({ kind: "text", name: "我的学习笔记", text: longText }, deps);
  assert.ok(r.courseId);
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 2, `长文应分段成多课,实际 ${lessons.length}`);
  const r2 = await runSmartImport({ kind: "text", name: "我的学习笔记", text: longText }, mkDeps2SameStore(deps));
  assert.equal(r2.reused, true, "同文本再导 → 复用(text 身份=原文 sha1)");
});

/** T4 用:同 store 不同 db(复用判定在 store 层,db 只是落库目标) */
function mkDeps2SameStore(prev) {
  return { ...prev, db: freshDb() };
}

await test("T5 epub 导入:每章一虚拟文件落库,docCache 支持断点续跑", async () => {
  const deps = mkDeps();
  const buf = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="b.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "b.opf": strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>小书</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    "c1.xhtml": strToU8(`<html><body><h1>第一章</h1><p>第一章的正文内容,足够被识别。</p></body></html>`),
    "c2.xhtml": strToU8(`<html><body><h1>第二章</h1><p>第二章的正文内容,足够被识别。</p></body></html>`),
  });
  const r = await runSmartImport({ kind: "epub", fileName: "小书.epub", bytes: new Uint8Array(buf) }, deps);
  assert.ok(r.courseId);
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.equal(lessons.length, 2, "每章一课");
  // 断点续跑:{kind:"plan"} 只有快照(docCache 在里面),不再需要原文件
  const plan = deps.store.load(r.planId);
  assert.ok(plan.docCache && Object.keys(plan.docCache).length === 2, "docCache 随快照落盘");
  const deps3 = { ...mkDeps(), store: deps.store };
  const r3 = await runSmartImport({ kind: "plan", plan: deps3.store.load(r.planId) }, deps3);
  assert.equal(r3.reused, true, "plan 续跑命中复用");
});

await test("T6 computeContentHash:内容相同 → 同哈希;改一个字 → 异", async () => {
  const docs = [["a.md", "内容一"], ["b.md", "内容二"]];
  assert.equal(computeContentHash(docs), computeContentHash([["b.md", "内容二"], ["a.md", "内容一"]]), "与顺序无关");
  assert.notEqual(computeContentHash(docs), computeContentHash([["a.md", "内容一"], ["b.md", "内容三"]]));
});

await test("T7 坏链接诚实报错(非 http/抓取失败)", async () => {
  const deps = mkDeps();
  await assert.rejects(() => runSmartImport({ kind: "url", url: "not a url at all" }, deps), /无法识别的链接/);
  const failing = async () => ({ ok: false, status: 500, headers: { get: () => "" }, text: async () => "" });
  await assert.rejects(() => runSmartImport({ kind: "url", url: "https://example.com/x" }, { ...deps, fetchFn: failing }), /抓取失败|HTTP/);
});

// 清理临时 plan 目录留给系统 tmp 回收;不主动 rm(Windows 上偶发 EBUSY)

console.log(`\n${passed} passed`);
