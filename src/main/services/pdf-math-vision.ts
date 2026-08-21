/**
 * pdf-math-vision —— PDF 公式密集页的 vision 转写(v0.20 P6,BYOK)。
 *
 * 文本层解不了公式是赛道本质;这里走 vision LLM 路线:整页渲染成图
 * (pdf-page-image)→ 转成 LaTeX Markdown → 替换该页文本层。非密集页保持
 * 文本层(省钱省时),合并后整本 Markdown 进既有导入管线(快照/断点/取消
 * 全部免费继承)。
 *
 * 门控三层:flag_math_vision(默认 off)→ 视觉覆盖已配置(getVisionOverride)
 * → 密集页检测命中。任一不满足都诚实走文本层并留进度消息,不静默降级。
 * LLM 调用与导入同源:buildImportModel + generateTextWithTimeout(看门狗/取消/
 * token 上限全套继承)。转写结果按 sha256(pdf+页+模型) 进程内缓存(重导零调用)。
 */
import { createHash } from "node:crypto";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { resolveVisionLlm } from "./agent/llm-client.js";
import { getVisionOverride } from "./agent/vision-bridge.js";
import { buildImportModel, generateTextWithTimeout } from "./import-llm-service.js";
import { mathDensePageIndexes } from "./pure/math-dense.js";
import { openPdfPages } from "./pdf-page-image.js";
import { parsePdfText } from "../lib/pdf-text.js";

/** 与 job-service/vision-bridge 同款本地 Db 类型(schema.ts 无 ?raw 链,tsx verify 可进)。 */
type Db = SQLJsDatabase<typeof schema>;

export interface MathVisionCtx {
  db: Db;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
}

/** BYOK 前提:设置里显式配置了视觉覆盖(主模型碰运气吃图会 400,不赌)。 */
export function visionPdfReady(db: Db): boolean {
  return getVisionOverride(db) !== null;
}

/** 单页转写提示:整页 → Markdown,公式一律 LaTeX;认不清照抄不编造。(导出供 live-test 复用) */
export const PAGE_PROMPT =
  "你是 PDF 数学页转写器。把这一页教材/论文的内容完整转成 Markdown:正文保留结构(标题/段落/列表),所有数学公式一律用 LaTeX,行内 $..$、独立公式 $$..$$。直接输出这一页的 Markdown,不要解释,不要用代码块包裹全文。某处无法辨认时用原文符号照抄,不要编造。";

/* 进程内页级缓存(FIFO 120):同一 PDF 重导/断点续跑零二次调用 */
const pageCache = new Map<string, string>();
const pageCacheOrder: string[] = [];
function cachePut(key: string, val: string): void {
  pageCache.set(key, val);
  pageCacheOrder.push(key);
  while (pageCacheOrder.length > 120) {
    const old = pageCacheOrder.shift();
    if (old !== undefined) pageCache.delete(old);
  }
}

function sha256(s: string | Uint8Array): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * PDF → Markdown 的智能入口(flag_math_vision 门控)。
 * 未开 flag / 未配视觉 / 无密集页 / 全程失败 → 一律回退 parsePdfText,
 * 并把原因说进进度(绝不静默)。
 */
export async function parsePdfTextSmart(
  buf: Uint8Array,
  ctx?: { db?: Db; flagOn?: boolean; onProgress?: (m: string) => void; signal?: AbortSignal },
): Promise<string> {
  if (!ctx?.db || ctx.flagOn !== true) return parsePdfText(Buffer.from(buf));
  if (!visionPdfReady(ctx.db)) {
    ctx.onProgress?.("公式视觉转写需先在设置里配置视觉模型(看图),本次按文本层解析");
    return parsePdfText(Buffer.from(buf));
  }
  try {
    const out = await transcribeMathDensePages(buf, { db: ctx.db, onProgress: ctx.onProgress, signal: ctx.signal });
    if (out) return out;
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    ctx.onProgress?.(`公式视觉转写失败,回退文本层: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parsePdfText(Buffer.from(buf));
}

async function transcribeMathDensePages(buf: Uint8Array, ctx: MathVisionCtx): Promise<string | null> {
  const pages = await openPdfPages(buf);
  try {
    const n = Math.min(pages.pageCount, 400);
    if (n === 0) return null;
    const texts: string[] = [];
    for (let i = 0; i < n; i++) texts.push(await pages.pageText(i));
    const dense = mathDensePageIndexes(texts);
    if (dense.length === 0) {
      ctx.onProgress?.("未检测到公式密集页,文本层足够");
      return null;
    }
    const vision = resolveVisionLlm(ctx.db);
    const bm = buildImportModel(vision);
    const pdfSha = sha256(buf);
    ctx.onProgress?.(`检测到 ${dense.length}/${n} 页公式密集,视觉转写中(${vision.model})…`);
    const outPages = texts.slice();
    let done = 0;
    for (const i of dense) {
      if (ctx.signal?.aborted) throw new Error("导入已取消");
      const key = sha256(`${pdfSha}:${i}:${vision.model}`);
      const cached = pageCache.get(key);
      if (cached !== undefined) {
        outPages[i] = cached;
        done++;
        continue;
      }
      const png = await pages.renderPage(i, 2);
      if (!png) {
        done++; // 单页渲染失败:留文本层,不炸整本
        continue;
      }
      const md = await transcribePage(png, bm, ctx.signal);
      if (md.length > 40) {
        outPages[i] = md;
        cachePut(key, md);
      }
      done++;
      ctx.onProgress?.(`公式页转写 ${done}/${dense.length}…`);
    }
    return outPages.map((t) => t.trim()).filter((t) => t.length > 0).join("\n\n");
  } finally {
    await pages.dispose();
  }
}

async function transcribePage(
  png: Uint8Array,
  bm: ReturnType<typeof buildImportModel>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const b64 = Buffer.from(png).toString("base64");
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "image" as const, image: `data:image/png;base64,${b64}` },
        { type: "text" as const, text: PAGE_PROMPT },
      ],
    },
  ];
  const out = await generateTextWithTimeout(bm.model, messages, {
    maxOutputTokens: bm.maxOutputTokens,
    ...(bm.providerOptions ? { providerOptions: bm.providerOptions } : {}),
    signal,
  });
  return out.trim();
}
