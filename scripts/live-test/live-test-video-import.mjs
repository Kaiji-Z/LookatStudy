/**
 * live: B站视频导入全链(真实拉流 + 可选真转写/真 LLM)。
 * 不需要 API key 也能跑(拉流+解码走通,管线零 LLM 降级走规则结构);
 * 有 Z_AI_API_KEY 时 Step2/4 走真 LLM。
 * 跑法: npx tsx scripts/live-test/live-test-video-import.mjs
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../src/main/db/schema.ts";
import { eq } from "drizzle-orm";
import { contentNodes } from "../../src/main/db/schema.ts";
import { runSmartImport } from "../../src/main/services/import-job-service.ts";
import { createPlanStore } from "../../src/main/services/import-plan-store.ts";
import { fetchBilibiliAudio } from "../../src/main/services/video-import-service.ts";
import { decodeAudioTo16kMono } from "../../src/main/services/speech/audio-file-decode.ts";
import { readApiKey } from "./_load-env.mjs";

const apiKey = readApiKey();
const log = (...a) => console.log("[live-video]", ...a);
log(apiKey ? "有 API key,Step2/4 走真 LLM" : "无需 API key,LLM 步骤规则降级");

// ── Part 1: 拉流 + 解码(无 key 也跑) ──
const result = await fetchBilibiliAudio("https://www.bilibili.com/video/BV1GJ411x7h7", fetch, (m) => log(m));
log("title:", result.title, "| bytes:", result.bytes.length);
const pcm = await decodeAudioTo16kMono(result.bytes, "m4a");
log("decoded:", pcm.length, "samples ≈", (pcm.length / 16000).toFixed(1), "s");

// ── Part 2: 全管线(有 key 走真 LLM;无 key 规则降级) ──
const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const sql = readFileSync(new URL("../../src/main/db/schema.sql", import.meta.url), "utf8");
const sqljs = new SQL.Database(); sqljs.run(sql);
const db = drizzle(sqljs, { schema });

const r = await runSmartImport({ kind: "video", url: "https://www.bilibili.com/video/BV1GJ411x7h7" }, {
  db,
  store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-live-video-"))),
  markDirty: () => {},
  onProgress: (m) => log(m),
  shouldAbort: () => false,
  // 拉流用 Part 1 已验证的真实字节(避免二次下载);转写用桩——真转写耗时
  // 数十分钟,不在 live-test 默认路径(单独手动验证)
  fetchVideo: async () => ({ source: "audio", title: result.title, bytes: result.bytes, ext: "m4a" }),
  transcribeAudioFile: async () => "这是公开课的转写文本,讲解梯度下降与反向传播。".repeat(80),
});
const lessons = db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
log(`✓ 课程建成: ${r.title} · ${lessons.length} 课`);
if (lessons.length === 0) throw new Error("no lessons");
console.log("=== LIVE VIDEO IMPORT PASSED ✅ ===");
