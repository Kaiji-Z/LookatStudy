/**
 * 多模态资源服务 —— 导入课程时收集的图片/PDF 页面渲染图的存储与读取。
 *
 * 设计原则(见 schema.sql node_assets 注释):
 *   - 图片二进制不入 DB(sql.js 内存型,塞图会爆),只存元数据
 *   - 实际文件存 userData/assets/{courseId}/{filename}
 *   - agent-engine 在"用户问图相关问题时"按需读 data-url 喂给多模态 LLM
 *
 * 路径约定:
 *   userData/assets/{courseId}/{filename}
 *   filename = {nodeId 的短前缀}-{原始文件名 或 fig-N}
 *
 * DB 注入式,便于 verify 脚本用内存 DB 测(文件读写用注入的 fsOps,默认绑真实 fs)。
 */
import { app } from "electron";
import { join } from "node:path";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { nodeAssets } from "../db/schema.js";
import { randomUUID } from "node:crypto";
import { markDirty } from "../db/index.js";

type Db = SQLJsDatabase<typeof schema>;

/** node_assets 行的渲染层友好类型(IPC 返回用) */
export interface NodeAsset {
  id: string;
  nodeId: string;
  courseId: string;
  filename: string;
  mimeType: string;
  sourcePath: string | null;
  sourceKind: "image_file" | "markdown_ref" | "pdf_page";
  width: number | null;
  height: number | null;
  pageNumber: number | null;
  altText: string | null;
}

/** 把 DB 行转成 IPC 友好类型 */
function rowToAsset(r: typeof nodeAssets.$inferSelect): NodeAsset {
  return {
    id: r.id,
    nodeId: r.nodeId,
    courseId: r.courseId,
    filename: r.filename,
    mimeType: r.mimeType,
    sourcePath: r.sourcePath,
    sourceKind: r.sourceKind,
    width: r.width,
    height: r.height,
    pageNumber: r.pageNumber,
    altText: r.altText,
  };
}

/** 扩展名 → MIME 映射(覆盖常见图片格式) */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** 从文件名推断 MIME;未知返回 image/png(宽容兜底) */
export function inferMime(filename: string): string {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return EXT_MIME[ext] ?? "image/png";
}

/** 是否是支持的图片扩展名 */
export function isImageExt(filename: string): boolean {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  return ext in EXT_MIME;
}

/**
 * 定位 assets 根目录:userData/assets。
 * 用 app.getPath('userData') 同 db/index.ts 的 DB 文件位置。
 */
export function getAssetsRoot(): string {
  return join(app.getPath("userData"), "assets");
}

/** 某课程的 assets 目录:userData/assets/{courseId} */
export function getCourseAssetsDir(courseId: string): string {
  return join(getAssetsRoot(), courseId);
}

/** 某 asset 的完整文件路径 */
export function getAssetFilePath(courseId: string, filename: string): string {
  return join(getCourseAssetsDir(courseId), filename);
}

/**
 * 把一张图片文件写入 assets 目录(从源绝对路径复制)。
 * 不写 DB(落库由 persistAssetRecord 负责,分离 IO 与 DB 便于测试)。
 *
 * @returns 写入后的 assets 目录内文件名
 */
export async function copyImageToAssets(
  sourceAbsPath: string,
  courseId: string,
  destFilename: string,
): Promise<string> {
  const dir = getCourseAssetsDir(courseId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const destPath = getAssetFilePath(courseId, destFilename);
  await copyFile(sourceAbsPath, destPath);
  return destFilename;
}

/**
 * 把二进制 buffer 写入 assets(用于 PDF 渲染的 PNG,无源文件)。
 * @returns 写入后的文件名
 */
export async function writeBufferToAssets(
  buffer: Buffer,
  courseId: string,
  destFilename: string,
): Promise<string> {
  const dir = getCourseAssetsDir(courseId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const destPath = getAssetFilePath(courseId, destFilename);
  await writeFile(destPath, buffer);
  return destFilename;
}

/**
 * 写一条 node_assets 记录(DB 操作,纯逻辑,可注入 DB 测)。
 */
export function persistAssetRecord(
  db: Db,
  input: {
    nodeId: string;
    courseId: string;
    filename: string;
    mimeType?: string;
    sourcePath?: string | null;
    sourceKind: "image_file" | "markdown_ref" | "pdf_page";
    width?: number | null;
    height?: number | null;
    pageNumber?: number | null;
    altText?: string | null;
  },
): NodeAsset {
  const id = randomUUID();
  const mimeType = input.mimeType ?? inferMime(input.filename);
  db.insert(nodeAssets)
    .values({
      id,
      nodeId: input.nodeId,
      courseId: input.courseId,
      filename: input.filename,
      mimeType,
      sourcePath: input.sourcePath ?? null,
      sourceKind: input.sourceKind,
      width: input.width ?? null,
      height: input.height ?? null,
      pageNumber: input.pageNumber ?? null,
      altText: input.altText ?? null,
    })
    .run();
  markDirty();
  const row = db.select().from(nodeAssets).where(eq(nodeAssets.id, id)).get();
  if (!row) throw new Error("persistAssetRecord: 插入后读不回");
  return rowToAsset(row);
}

/** 查某节点的全部 assets */
export function listAssetsByNode(db: Db, nodeId: string): NodeAsset[] {
  const rows = db.select().from(nodeAssets).where(eq(nodeAssets.nodeId, nodeId)).all();
  return rows.map(rowToAsset);
}

/** 查某课程的全部 assets(集中区展示用) */
export function listAssetsByCourse(db: Db, courseId: string): NodeAsset[] {
  const rows = db.select().from(nodeAssets).where(eq(nodeAssets.courseId, courseId)).all();
  return rows.map(rowToAsset);
}

/** 查单条 asset(读 data-url 用) */
export function getAssetById(db: Db, assetId: string): NodeAsset | null {
  const row = db.select().from(nodeAssets).where(eq(nodeAssets.id, assetId)).get();
  return row ? rowToAsset(row) : null;
}

/**
 * 读 asset 的 data-url(base64)。给渲染层 <img> src 用。
 * 格式:data:{mime};base64,{data}
 */
export async function getAssetDataUrl(db: Db, assetId: string): Promise<string | null> {
  const asset = getAssetById(db, assetId);
  if (!asset) return null;
  const filePath = getAssetFilePath(asset.courseId, asset.filename);
  if (!existsSync(filePath)) return null;
  const buf = await readFile(filePath);
  const base64 = buf.toString("base64");
  return `data:${asset.mimeType};base64,${base64}`;
}

/** 删某课程的所有 assets(删课程时级联清理文件,DB 行由 FK ON DELETE CASCADE 自动删) */
export async function deleteCourseAssetsFiles(courseId: string): Promise<void> {
  const dir = getCourseAssetsDir(courseId);
  if (!existsSync(dir)) return;
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}
