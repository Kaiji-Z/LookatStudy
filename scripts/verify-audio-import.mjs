/**
 * 音频导入验证 —— 解码(wav 往返/升采样/不支持格式) + 分段纯函数 + 管线编排
 * (transcribeAudioFile 注入桩:本地 Whisper 引擎不进 verify)。mp3/m4a/flac 的
 * 真解码依赖 audio-decode(spike 已实测 Node CJS 可用/格式表覆盖),此处不造假
 * fixture,只测路由与错误路径。
 * 跑法: npx tsx scripts/verify-audio-import.mjs (verify:core 调用)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { eq } from "drizzle-orm";
import { contentNodes } from "../src/main/db/schema.ts";
import { encodeWavPcm16 } from "../shared/speech-wav.ts";
import { planAudioChunks, joinTranscriptChunks } from "../src/main/services/speech/pure/audio-segments.ts";
import { decodeAudioTo16kMono } from "../src/main/services/speech/audio-file-decode.ts";
import { runSmartImport } from "../src/main/services/import-job-service.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

test("T1 planAudioChunks:60s 一段,最后一段可短,零样本不出段", () => {
  const sr = 16000;
  assert.deepEqual(planAudioChunks(sr * 150, sr, 60), [0, sr * 60, sr * 120, sr * 150], "150s → 3 段");
  assert.deepEqual(planAudioChunks(100, sr, 60), [0, 100], "短音频 1 段");
  assert.deepEqual(planAudioChunks(0, sr, 60), [0], "零样本零段");
});

test("T2 joinTranscriptChunks:空段过滤 + 段落分隔", () => {
  assert.equal(joinTranscriptChunks(["你好。", "", "  ", "第二段。"]), "你好。\n\n第二段。");
  assert.equal(joinTranscriptChunks([]), "");
});

await test("T3 WAV 解码往返:44.1k → 16k 单声道,长度按比例", async () => {
  const sr = 44100;
  const samples = new Float32Array(sr); // 1 秒正弦
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  const wav = new Uint8Array(encodeWavPcm16(samples, sr));
  const out = await decodeAudioTo16kMono(wav, "wav");
  assert.ok(Math.abs(out.length - 16000) <= 40, `16k 长度 ≈16000,实际 ${out.length}`);
});

await test("T4 升采样:8k WAV → 16k(长度翻倍,不炸)", async () => {
  const sr = 8000;
  const samples = new Float32Array(sr);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 300 * i) / sr) * 0.4;
  const wav = new Uint8Array(encodeWavPcm16(samples, sr));
  const out = await decodeAudioTo16kMono(wav, "wav");
  assert.ok(Math.abs(out.length - 16000) <= 40, `升采样后 ≈16000,实际 ${out.length}`);
});

await test("T5 不支持格式与坏内容诚实报错", async () => {
  await assert.rejects(() => decodeAudioTo16kMono(new Uint8Array([1, 2, 3]), "wma"), /暂不支持/);
  await assert.rejects(() => decodeAudioTo16kMono(new Uint8Array([1, 2, 3, 4]), "mp3"), /解码失败|损坏/);
});

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");

await test("T6 音频导入管线(转写桩):多文件=多集,虚拟目录分组,docCache 落盘", async () => {
  const sqljs = new SQL.Database();
  sqljs.run(schemaSql);
  const db = drizzle(sqljs, { schema });
  const store = createPlanStore(mkdtempSync(join(tmpdir(), "ls-audio-store-")));
  let calls = 0;
  const fakeWav = new Uint8Array(encodeWavPcm16(new Float32Array(1600), 16000));
  const deps = {
    db, store, markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
    dataDir: "/tmp/unused-with-stub",
    transcribeAudioFile: async (_bytes, fileName) => {
      calls++;
      return Array.from({ length: 400 }, (_, i) => `这是${fileName}第${i}句转写文本,内容完整。`).join("");
    },
  };
  const r = await runSmartImport({ kind: "audio", files: [{ fileName: "ep01 播客.wav", bytes: fakeWav }, { fileName: "ep02.wav", bytes: fakeWav }] }, deps);
  assert.equal(calls, 2, "每个文件转录一次");
  const lessons = db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 4, `两集各分段成多课,实际 ${lessons.length}`);
  const paths = lessons.map((l) => l.sourcePath ?? "");
  assert.ok(paths.some((p) => p.startsWith("ep01-播客/")), `第一集虚拟目录: ${paths[0]}`);
  assert.ok(paths.some((p) => p.startsWith("ep02/")), "第二集虚拟目录");
  const plan = store.load(r.planId);
  assert.equal(plan.kind, "audio");
  assert.ok(plan.docCache && Object.keys(plan.docCache).length >= 4, "docCache 随快照落盘");
});

await test("T7 同批音频再导 → 复用(字节哈希身份,与顺序无关)", async () => {
  const mk = () => {
    const sqljs = new SQL.Database();
    sqljs.run(schemaSql);
    return {
      db: drizzle(sqljs, { schema }),
      store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-audio-store-"))),
      markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
      dataDir: "x",
      transcribeAudioFile: async (_b, f) => `${f} 的转写内容。`.repeat(200),
    };
  };
  const wavA = new Uint8Array(encodeWavPcm16(new Float32Array(1600), 16000));
  const wavB = new Uint8Array(encodeWavPcm16(new Float32Array(3200), 16000));
  const d1 = mk();
  await runSmartImport({ kind: "audio", files: [{ fileName: "a.wav", bytes: wavA }, { fileName: "b.wav", bytes: wavB }] }, d1);
  // 同内容反序 → 身份是排序后的哈希聚合,应命中同一 plan
  const d2 = { ...mk(), store: d1.store };
  const r2 = await runSmartImport({ kind: "audio", files: [{ fileName: "b.wav", bytes: wavB }, { fileName: "a.wav", bytes: wavA }] }, d2);
  assert.equal(r2.reused, true, "字节级身份与文件顺序无关");
});

console.log(`\n${passed} passed`);
