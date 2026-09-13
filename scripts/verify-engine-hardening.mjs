/**
 * verify-engine-hardening —— 引擎并发/中止/看门狗纪律套件(2026-09-13 安全审计 · WP5)。
 *
 *   T1  agent-engine:引擎级并发闸(双路径)/中止半截消息落库标记/主聊天流看门狗
 *       (fullStream 消费 + AbortSignal.any + 看门狗断开按错误而非"已停止"收尾)
 *   T2  vision-bridge:看门狗改喂 fullStream(思考型视觉模型 >120s 误杀根修)
 *   T3  memory:merge/consolidate 看门狗化(动态 import)/JSON 失败留日志/
 *       consolidate 进程内防双跑(行为:并发双调只跑一次 LLM)
 *   T4  导入:5c 落库即盖章 onCoursePersisted + resume 凭 courseId 跳过重建(F18 重复课程)
 *   T5  speech-engine:原生引擎 per-key Promise 去重 + 代际守卫(重下不缓存陈旧实例)
 *   T6  tts:edge 连续失败熔断(5 连败本进程直接 local)
 *   T7  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-engine-hardening.mjs(真 sql.js,不依赖 Electron)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

// ── T1 agent-engine ──
{
  const src = read("src/main/services/agent/agent-engine.ts");
  const gateHits = src.split("abortControllers.has(").length - 1;
  check("T1 引擎级并发闸(thread + legacy 双路径)", gateHits >= 2, `实际 ${gateHits} 处`);
  check("T1 并发闸报可读错误", src.includes("该对话正在回复中"));
  const abortHits = src.split("本轮已被用户中止，内容可能不完整").length - 1;
  check("T1 中止半截消息落库标记(双路径)", abortHits >= 2, `实际 ${abortHits} 处`);
  check("T1 主聊天流看门狗接线", src.includes("createStreamWatchdog(CHAT_WD_INACTIVE_MS") && src.includes("AbortSignal.any([abortSignal, chatWd.signal])"));
  check("T1 看门狗喂狗在 fullStream 消费内", /chatWd\.touch\(\); \/\/ 任何 part 都算活性/.test(src));
  check("T1 看门狗断开按错误收尾(不再伪装用户停止)", src.includes("wdWhy") && src.includes("已自动断开"));
  check("T1 thread 回合 try/finally 释放登记", /finally \{\s*\n\s*abortControllers\.delete\(ctrlKey\);/.test(src));
}

// ── T2 vision-bridge ──
{
  const src = read("src/main/services/agent/vision-bridge.ts");
  check("T2 桥看门狗消费 fullStream", src.includes("result.fullStream") && /part\.type === "text-delta"/.test(src));
  check("T2 桥不再消费 textStream", !/for await \(const delta of textStream\)/.test(src));
}

// ── T3 memory ──
{
  const src = read("src/main/services/memory-service.ts");
  check("T3 merge/consolidate 看门狗化(动态 import)", src.split('await import("./import-llm-service.js")').length - 1 === 2);
  check("T3 JSON 解析失败留主进程日志", src.includes("consolidate 返回非合法 JSON"));
  check("T3 consolidate 进程内防双跑声明", src.includes("consolidateInFlight"));

  // 行为:并发双调只跑一次 LLM(watermark/同槽双行竞态的根)
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  sqldb.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  const db = drizzle(sqldb, { schema });
  const { consolidate } = await import("../src/main/services/memory-service.ts");
  let calls = 0;
  const fn = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 60));
    return { global: "并发去重验证" };
  };
  const win = { courseId: null, nodeId: null, conversation: [], frictionEntries: [], answers: [] };
  const [a, b] = await Promise.all([consolidate(db, win, fn), consolidate(db, win, fn)]);
  check("T3 并发 consolidate 只跑一次(行为)", calls === 1, `实际 ${calls} 次`);
  check("T3 双调结果一致(共享同一 Promise)", a?.global === b?.global && a?.global === "并发去重验证");
}

// ── T4 导入 F18 ──
{
  const pipeline = read("src/main/services/import-pipeline.ts");
  check("T4 executeImport 5c 落库即回调盖章", pipeline.includes("onCoursePersisted?: (courseId: string) => void") && pipeline.includes("opts.onCoursePersisted?.(courseId)"));
  const job = read("src/main/services/import-job-service.ts");
  check("T4 调用方盖章(courseId/title 落 plan 快照)", job.includes("onCoursePersisted: (courseId) =>"));
  check("T4 resume 凭 courseId 跳过重建", job.includes("断点续跑跳过重建") && job.includes("eq(schema.courses.id, plan.courseId)"));
}

// ── T5 speech-engine ──
{
  const src = read("src/main/services/speech/speech-engine.ts");
  check("T5 原生引擎 per-key Promise 去重", src.includes("ttsCreating") && src.includes("whisperCreating"));
  check("T5 代际守卫(重下后不缓存陈旧实例)", src.includes("engineGeneration") && src.includes("不缓存陈旧引擎"));
}

// ── T6 tts edge 熔断 ──
{
  const src = read("src/main/services/speech/tts-service.ts");
  check("T6 edge 熔断计数与开门判定", src.includes("edgeCircuitOpen()") && src.includes("noteEdgeFailure()") && src.includes("noteEdgeSuccess()"));
}

// ── T7 注册 ──
{
  const pkg = JSON.parse(read("package.json"));
  check("T7 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-engine-hardening"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
