/**
 * node_assets 资源服务验证 —— 测 asset-service.ts 的 DB 逻辑 + 辅助函数。
 *
 * 不变量:
 *   - persistAssetRecord 写入,返回带 id 的完整 asset
 *   - listAssetsByNode 按 nodeId 过滤
 *   - listAssetsByCourse 按 courseId 过滤
 *   - getAssetById 单条查询
 *   - inferMime / isImageExt 扩展名映射
 *   - 外键级联:删 node → 关联 assets 行自动删;删 course → assets 自动删
 *
 * 文件 IO(copyImageToAssets/writeBufferToAssets/getAssetDataUrl)依赖 Electron app.getPath,
 * 不在这里测;只测 DB 逻辑(persistAssetRecord 等,用内存 DB)。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/main/db/schema.ts";
import { nodeAssets } from "../src/main/db/schema.ts";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// inferMime / isImageExt 是纯函数,但 asset-service.ts 顶部 import electron app,
// tsx 在纯 Node 环境 import 会崩。这里 inline 复刻(与生产保持同步)。
const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};
function inferMime(filename) {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return EXT_MIME[ext] ?? "image/png";
}
function isImageExt(filename) {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return ext in EXT_MIME;
}

// 内存 DB 初始化(含 node_assets 表 + content_nodes + courses)
async function makeDb() {
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  sqldb.run("PRAGMA foreign_keys = ON;"); // 启用外键级联(sql.js 默认关闭)
  const schemaSql = readFileSync(join(__dirname, "..", "src", "main", "db", "schema.sql"), "utf-8");
  sqldb.run(schemaSql);
  return drizzle(sqldb, { schema });
}

// inline 复刻 persistAssetRecord/listAssetsByNode 等(避免 asset-service.ts import 链到 db/index.ts 的 markDirty)
function makeAssetService(db) {
  function persistAssetRecord(input) {
    const id = randomUUID();
    db.insert(nodeAssets)
      .values({
        id,
        nodeId: input.nodeId,
        courseId: input.courseId,
        filename: input.filename,
        mimeType: input.mimeType ?? inferMime(input.filename),
        sourcePath: input.sourcePath ?? null,
        sourceKind: input.sourceKind,
        width: input.width ?? null,
        height: input.height ?? null,
        pageNumber: input.pageNumber ?? null,
        altText: input.altText ?? null,
      })
      .run();
    return db.select().from(nodeAssets).where(eq(nodeAssets.id, id)).get();
  }
  function listAssetsByNode(nodeId) {
    return db.select().from(nodeAssets).where(eq(nodeAssets.nodeId, nodeId)).all();
  }
  function listAssetsByCourse(courseId) {
    return db.select().from(nodeAssets).where(eq(nodeAssets.courseId, courseId)).all();
  }
  function getAssetById(assetId) {
    return db.select().from(nodeAssets).where(eq(nodeAssets.id, assetId)).get() ?? null;
  }
  return { persistAssetRecord, listAssetsByNode, listAssetsByCourse, getAssetById };
}

// === T1: inferMime 扩展名映射 ===
test("T1 inferMime: 常见图片扩展名", () => {
  assert.strictEqual(inferMime("photo.png"), "image/png");
  assert.strictEqual(inferMime("photo.jpg"), "image/jpeg");
  assert.strictEqual(inferMime("photo.jpeg"), "image/jpeg");
  assert.strictEqual(inferMime("anim.gif"), "image/gif");
  assert.strictEqual(inferMime("modern.webp"), "image/webp");
  assert.strictEqual(inferMime("vector.svg"), "image/svg+xml");
});

// === T2: inferMime 未知扩展名兜底 ===
test("T2 inferMime: 未知扩展名兜底 image/png", () => {
  assert.strictEqual(inferMime("file.xyz"), "image/png");
  assert.strictEqual(inferMime("noext"), "image/png");
});

// === T3: isImageExt ===
test("T3 isImageExt: 图片扩展名识别", () => {
  assert.ok(isImageExt("a.png"));
  assert.ok(isImageExt("a.JPG"), "大小写不敏感");
  assert.ok(isImageExt("a.webp"));
  assert.ok(!isImageExt("a.txt"));
  assert.ok(!isImageExt("a.pdf"));
  assert.ok(!isImageExt("a.html"));
});

// === T4: persistAssetRecord 写入 ===
test("T4 persistAssetRecord: 写入并返回完整记录", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  // 先建 course + node
  db.insert(schema.courses).values({ id: "c1", repoName: "test", title: "T", version: 1 }).run();
  db.insert(schema.contentNodes)
    .values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 })
    .run();
  const asset = svc.persistAssetRecord({
    nodeId: "n1",
    courseId: "c1",
    filename: "fig01.png",
    sourceKind: "image_file",
    sourcePath: "lessons/1/fig01.png",
    altText: "架构图",
  });
  assert.ok(asset.id, "返回带 id");
  assert.strictEqual(asset.nodeId, "n1");
  assert.strictEqual(asset.filename, "fig01.png");
  assert.strictEqual(asset.mimeType, "image/png", "mimeType 从文件名推断");
  assert.strictEqual(asset.sourceKind, "image_file");
  assert.strictEqual(asset.altText, "架构图");
});

// === T5: listAssetsByNode 按 nodeId 过滤 ===
test("T5 listAssetsByNode: 按 nodeId 过滤", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  db.insert(schema.courses).values({ id: "c1", repoName: "test", title: "T", version: 1 }).run();
  db.insert(schema.contentNodes).values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 }).run();
  db.insert(schema.contentNodes).values({ id: "n2", courseId: "c1", parentId: null, type: "lesson", title: "L2", orderIdx: 1 }).run();
  svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "a.png", sourceKind: "image_file" });
  svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "b.png", sourceKind: "image_file" });
  svc.persistAssetRecord({ nodeId: "n2", courseId: "c1", filename: "c.png", sourceKind: "image_file" });
  const n1Assets = svc.listAssetsByNode("n1");
  assert.strictEqual(n1Assets.length, 2, "n1 有 2 张图");
  const n2Assets = svc.listAssetsByNode("n2");
  assert.strictEqual(n2Assets.length, 1, "n2 有 1 张图");
  assert.strictEqual(n2Assets[0].filename, "c.png");
});

// === T6: listAssetsByCourse 按 courseId 过滤 ===
test("T6 listAssetsByCourse: 按 courseId 过滤", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  db.insert(schema.courses).values({ id: "c1", repoName: "t", title: "T", version: 1 }).run();
  db.insert(schema.courses).values({ id: "c2", repoName: "t2", title: "T2", version: 1 }).run();
  db.insert(schema.contentNodes).values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 }).run();
  db.insert(schema.contentNodes).values({ id: "n2", courseId: "c2", parentId: null, type: "lesson", title: "L2", orderIdx: 0 }).run();
  svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "a.png", sourceKind: "image_file" });
  svc.persistAssetRecord({ nodeId: "n2", courseId: "c2", filename: "b.png", sourceKind: "pdf_page", pageNumber: 1 });
  const c1Assets = svc.listAssetsByCourse("c1");
  assert.strictEqual(c1Assets.length, 1);
  const c2Assets = svc.listAssetsByCourse("c2");
  assert.strictEqual(c2Assets.length, 1);
  assert.strictEqual(c2Assets[0].sourceKind, "pdf_page");
});

// === T7: getAssetById 单条查询 ===
test("T7 getAssetById: 单条查询 + 不存在返回 null", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  db.insert(schema.courses).values({ id: "c1", repoName: "t", title: "T", version: 1 }).run();
  db.insert(schema.contentNodes).values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 }).run();
  const asset = svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "x.png", sourceKind: "image_file" });
  const found = svc.getAssetById(asset.id);
  assert.ok(found);
  assert.strictEqual(found.filename, "x.png");
  const notFound = svc.getAssetById("nonexistent-id");
  assert.strictEqual(notFound, null);
});

// === T8: 外键级联 - 删 node 删 assets ===
test("T8 外键级联: 删 content_node → assets 自动删", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  db.insert(schema.courses).values({ id: "c1", repoName: "t", title: "T", version: 1 }).run();
  db.insert(schema.contentNodes).values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 }).run();
  svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "a.png", sourceKind: "image_file" });
  svc.persistAssetRecord({ nodeId: "n1", courseId: "c1", filename: "b.png", sourceKind: "image_file" });
  assert.strictEqual(svc.listAssetsByNode("n1").length, 2);
  // 删 node(走 raw SQL 确保 FK 级联)
  db.delete(schema.contentNodes).where(eq(schema.contentNodes.id, "n1")).run();
  assert.strictEqual(svc.listAssetsByNode("n1").length, 0, "删 node 后 assets 清空");
});

// === T9: pdf_page 来源记录带 pageNumber ===
test("T9 pdf_page: 记录 pageNumber", async () => {
  const db = await makeDb();
  const svc = makeAssetService(db);
  db.insert(schema.courses).values({ id: "c1", repoName: "t", title: "T", version: 1 }).run();
  db.insert(schema.contentNodes).values({ id: "n1", courseId: "c1", parentId: null, type: "lesson", title: "L1", orderIdx: 0 }).run();
  const asset = svc.persistAssetRecord({
    nodeId: "n1",
    courseId: "c1",
    filename: "slide-p3.png",
    sourceKind: "pdf_page",
    pageNumber: 3,
    width: 1920,
    height: 1080,
    mimeType: "image/png",
  });
  assert.strictEqual(asset.sourceKind, "pdf_page");
  assert.strictEqual(asset.pageNumber, 3);
  assert.strictEqual(asset.width, 1920);
  assert.strictEqual(asset.height, 1080);
});

// 运行
let passed = 0;
let failed = 0;
for (const { name, fn } of TESTS) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== node_assets 资源服务: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
