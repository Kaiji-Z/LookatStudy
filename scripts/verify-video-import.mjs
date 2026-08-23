/**
 * 视频导入验证 —— 路由(B站/YouTube)/wbi 签名回归向量(真 API POC 定标)/
 * 字幕解析/管线编排(subtitle 零转写 + audio 走转写桩)。真实拉流在
 * live-test-video-import(网络级)。跑法: npx tsx scripts/verify-video-import.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { eq } from "drizzle-orm";
import { contentNodes } from "../src/main/db/schema.ts";
import { routeImportUrl } from "../src/main/services/pure/url-route.ts";
import { encWbi, getMixinKey, extractKeysFromNavUrl } from "../src/main/services/pure/bilibili-wbi.ts";
import { parseSubtitleToText, pickSubtitleFile } from "../src/main/services/pure/subtitle-parse.ts";
import { parseBilibiliId } from "../src/main/services/video-import-service.ts";
import { fmp4ToAdts } from "../src/main/services/pure/fmp4-to-adts.ts";
import { runSmartImport } from "../src/main/services/import-job-service.ts";
import { createPlanStore } from "../src/main/services/import-plan-store.ts";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; }
};

test("T1 视频路由:B站(BV/av/分P)/YouTube(watch/shorts/youtu.be)", () => {
  const b1 = routeImportUrl("https://www.bilibili.com/video/BV1GJ411x7h7?p=2");
  assert.equal(b1?.kind, "video");
  assert.equal(b1.source, "bilibili");
  assert.equal(routeImportUrl("https://www.bilibili.com/video/av170001")?.source, "bilibili");
  assert.equal(routeImportUrl("https://b23.tv/abc123")?.source, "bilibili", "短链全走B站路径(重定向展开)");
  const y1 = routeImportUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(y1?.kind, "video");
  assert.equal(y1.source, "ytdlp");
  assert.equal(routeImportUrl("https://youtu.be/dQw4w9WgXcQ")?.source, "ytdlp");
  assert.equal(routeImportUrl("https://www.youtube.com/shorts/xyz")?.source, "ytdlp");
  // 非视频页仍是 article
  assert.equal(routeImportUrl("https://example.com/post")?.kind, "url");
});

test("T2 parseBilibiliId:BV/av/?p= 提取(无 ?p= → page=undefined=整季)", () => {
  assert.deepEqual(parseBilibiliId("https://www.bilibili.com/video/BV1GJ411x7h7?p=3"), { bvid: "BV1GJ411x7h7", aid: undefined, page: 3 });
  assert.deepEqual(parseBilibiliId("https://www.bilibili.com/video/BV1GJ411x7h7"), { bvid: "BV1GJ411x7h7", aid: undefined, page: undefined }, "不带 ?p= 导整季");
  assert.deepEqual(parseBilibiliId("https://www.bilibili.com/video/av170001"), { bvid: undefined, aid: 170001, page: undefined });
  assert.equal(parseBilibiliId("https://example.com/x"), null);
});

test("T3 wbi 签名回归向量(POC 真 API 定标,表漂移即红)", () => {
  const mixin = getMixinKey("abcd1234efgh5678", "ijkl9012mnop3456");
  assert.equal(mixin, "kce28g6dp2fl437564imojab511n03h9");
  const q = encWbi({ foo: "_bar", baz: 12, zz: "hello世界" }, mixin, 1700000000);
  assert.equal(q, "baz=12&foo=_bar&wts=1700000000&zz=hello%E4%B8%96%E7%95%8C&w_rid=8240ea72c4ef615717fb788b1eeab49e");
  const { imgKey, subKey } = extractKeysFromNavUrl("https://i0.hdslb.com/bfs/wbi/abcd1234.png", "https://i0.hdslb.com/bfs/wbi/efgh5678.png");
  assert.equal(imgKey, "abcd1234");
  assert.equal(subKey, "efgh5678");
});

test("T4 字幕解析:vtt/srt 时间轴剥除 + 滚动重复行去重 + 标签清理 + CJK 感知接行", () => {
  const vtt = [
    "WEBVTT", "Kind: captions", "",
    "00:00:01.000 --> 00:00:03.000", "大家好今天讲<c>梯度</c>下降", "",
    "00:00:03.000 --> 00:00:05.000", "大家好今天讲梯度下降", // 滚动重复
    "",
    "00:00:05.000 --> 00:00:07.000", "梯度下降是优化算法&nbsp;的核心", "",
  ].join("\n");
  const text = parseSubtitleToText(vtt);
  assert.equal(text, "大家好今天讲梯度下降梯度下降是优化算法 的核心");
  const srt = "1\n00:00:01,000 --> 00:00:02,000\n第一句。\n\n2\n00:00:02,000 --> 00:00:03,000\n第二句。\n";
  // CJK 感知接行:句号(中文标点)与下句首字之间不加空格(2026-08-23 修)
  assert.equal(parseSubtitleToText(srt), "第一句。第二句。");
});

test("T4b YouTube 自动字幕滚动窗:cue N+1 首行复述 cue N 尾行(隔行重复)也去重", () => {
  // 结构复刻 yt-dlp issue #1734 文档化的滚动窗(本网不可达 YouTube,按公开格式构造):
  // cueA=[A,B] cueB=[B,C] cueC=[C,D] → 行序 A,B,B,C,C,D,旧"相邻去重"会漏 B/C 首次重放
  const vtt = [
    "WEBVTT", "Kind: captions", "Language: en", "",
    "00:00:00.719 --> 00:00:03.829 align:start position:0%",
    "hello world",
    "this is<00:00:01.099><c> a</c><00:00:01.259><c> test</c>",
    "",
    "00:00:03.829 --> 00:00:05.340 align:start position:0%",
    "hello world",
    "this is a test",
    "",
    "00:00:05.340 --> 00:00:07.000 align:start position:0%",
    "this is a test",
    "now the next sentence",
    "",
    "00:00:07.000 --> 00:00:08.000 align:start position:0%",
    "[Music]",
    ">> now the next sentence",
    "",
  ].join("\n");
  const text = parseSubtitleToText(vtt);
  assert.equal(text, "hello world this is a test now the next sentence now the next sentence");
});

test("T4c 字幕实体解码 + 整行自动标记 + 换说话人标记(原则:行内方括号/对话破折号是正文,不删)", () => {
  const vtt = [
    "WEBVTT", "",
    "00:00:01.000 --> 00:00:02.000", "Tom &amp; Jerry &lt;_best&gt; &#39;friends&#39;", "",
    "00:00:02.000 --> 00:00:03.000", "[Applause]", "",
    "00:00:03.000 --> 00:00:04.000", ">>第二位讲者开口", "",
    "00:00:04.000 --> 00:00:05.000", "音符 [C4] 是正文里的方括号", "",
    "00:00:05.000 --> 00:00:06.000", "- 对话破折号保留", "",
  ].join("\n");
  const text = parseSubtitleToText(vtt);
  assert.ok(text.includes("Tom & Jerry <_best> 'friends'"), `实体应解码,实际: ${text}`);
  assert.ok(!text.includes("[Applause]"), "整行自动标记应删");
  assert.ok(text.includes("第二位讲者开口") && !text.includes(">>"), "行首换说话人标记应剥");
  assert.ok(text.includes("[C4]"), "行内方括号是正文,不删");
  assert.ok(text.includes("- 对话破折号保留"), "对话破折号是正文,不删");
});

test("T4d pickSubtitleFile 语言优先级:zh-Hans/zh-CN > 其他 zh > en(readdir 字母序 en 会压过 zh)", () => {
  assert.equal(pickSubtitleFile(["sub.en.vtt", "sub.zh-Hans.vtt"]), "sub.zh-Hans.vtt");
  assert.equal(pickSubtitleFile(["sub.en.vtt", "sub.zh.vtt"]), "sub.zh.vtt");
  assert.equal(pickSubtitleFile(["sub.zh-Hant.vtt", "sub.en.vtt"]), "sub.zh-Hant.vtt");
  assert.equal(pickSubtitleFile(["sub.en.srt", "sub.ja.vtt"]), "sub.en.srt");
  assert.equal(pickSubtitleFile(["audio.m4a", "sub.info.json"]), null, "无字幕文件 → null");
});

const SQL = await initSqlJs({ locateFile: (f) => join(process.cwd(), "node_modules/sql.js/dist", f) });
const schemaSql = readFileSync(new URL("../src/main/db/schema.sql", import.meta.url), "utf8");

await test("T5 视频管线(字幕路径):零转写零模型,直接分段成课 + docCache 复用", async () => {
  const sqljs = new SQL.Database(); sqljs.run(schemaSql);
  const store = createPlanStore(mkdtempSync(join(tmpdir(), "ls-video-")));
  const sub = Array.from({ length: 400 }, (_, i) => `字幕第${i}句,内容完整。`).join("");
  const deps = {
    db: drizzle(sqljs, { schema }), store, markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
    fetchVideo: async () => ({ source: "subtitle", title: "机器学习入门讲座", text: sub }),
  };
  const r = await runSmartImport({ kind: "video", url: "https://www.bilibili.com/video/BV1test" }, deps);
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 2, `字幕分段成多课,实际 ${lessons.length}`);
  const plan = store.load(r.planId);
  assert.equal(plan.kind, "video");
  assert.ok(plan.video?.url.includes("BV1test"), "video 身份落盘");
  assert.ok(plan.docCache, "docCache 落盘(断点续跑零二次拉流)");
  // 同 URL 再导 → 复用
  const sqljs2 = new SQL.Database(); sqljs2.run(schemaSql);
  const r2 = await runSmartImport({ kind: "video", url: "https://www.bilibili.com/video/BV1test" }, { ...deps, db: drizzle(sqljs2, { schema }) });
  assert.equal(r2.reused, true, "同视频复用(身份=归一化URL)");
});

await test("T6 视频管线(音频路径):走转写桩(生产=Whisper),标题成 stem", async () => {
  const sqljs = new SQL.Database(); sqljs.run(schemaSql);
  let transcribed = 0;
  const deps = {
    db: drizzle(sqljs, { schema }),
    store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-video2-"))),
    markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
    fetchVideo: async () => ({ source: "audio", title: "深度学习公开课", bytes: new Uint8Array(10), ext: "m4a" }),
    transcribeAudioFile: async (_b, fileName) => { transcribed++; return `${fileName} 的转写文本。`.repeat(300); },
  };
  const r = await runSmartImport({ kind: "video", url: "https://www.youtube.com/watch?v=abc" }, deps);
  assert.equal(transcribed, 1, "音轨走转写");
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 2);
  assert.ok((lessons[0]?.sourcePath ?? "").startsWith("深度学习公开课"), `stem 来自标题: ${lessons[0]?.sourcePath}`);
});

await test("T8 多分P整季:audio-multi 逐段转写,每P独立虚拟文档,docCache 复用零二次转写", async () => {
  const sqljs = new SQL.Database(); sqljs.run(schemaSql);
  let transcribed = 0;
  const seenFiles = [];
  const deps = {
    db: drizzle(sqljs, { schema }),
    store: createPlanStore(mkdtempSync(join(tmpdir(), "ls-video3-"))),
    markDirty: () => {}, onProgress: () => {}, shouldAbort: () => false,
    fetchVideo: async () => ({ source: "audio-multi", title: "机器学习课程", parts: [
      { title: "P1 梯度下降", bytes: new Uint8Array(10), ext: "m4a" },
      { title: "P2 反向传播", bytes: new Uint8Array(10), ext: "m4a" },
    ] }),
    transcribeAudioFile: async (_b, fileName) => { transcribed++; seenFiles.push(fileName); return `${fileName} 的整季转写文本。`.repeat(400); },
  };
  const url = "https://www.bilibili.com/video/BV1multiP";
  const r = await runSmartImport({ kind: "video", url }, deps);
  assert.equal(transcribed, 2, "两个分P各转写一次");
  assert.ok(seenFiles[0]?.startsWith("P1-梯度下降"), `分P标题成转写文件名: ${seenFiles[0]}`);
  assert.ok(seenFiles[1]?.startsWith("P2-反向传播"), `分P标题成转写文件名: ${seenFiles[1]}`);
  const lessons = deps.db.select().from(contentNodes).where(eq(contentNodes.courseId, r.courseId)).all().filter((n) => n.type === "lesson");
  assert.ok(lessons.length >= 2, `每P至少一课,实际 ${lessons.length}`);
  const plan = deps.store.load(r.planId);
  const paths = Object.keys(plan.docCache ?? {});
  assert.ok(paths.some((p) => p.startsWith("P1-")) && paths.some((p) => p.startsWith("P2-")), `docCache 按分P落盘: ${paths.join(",")}`);
  // 同 URL 再导:docCache 命中,零拉流零转写,全复用
  const sqljs2 = new SQL.Database(); sqljs2.run(schemaSql);
  const r2 = await runSmartImport({ kind: "video", url }, { ...deps, db: drizzle(sqljs2, { schema }) });
  assert.equal(r2.reused, true, "整季课程同 URL 复用");
  assert.equal(transcribed, 2, "复用不触发二次转写");
});

await test("T7 fMP4→ADTS 转封装:esds 提 ASC/trun 样本表/多 moof/头字段向量", () => {
  // ── box 构造器 ──
  const box = (type, ...payloads) => {
    const body = Buffer.concat(payloads.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, body]);
  };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
  const full = (version, flags) => Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);
  const desc = (tag, payload) => Buffer.concat([Buffer.from([tag, payload.length]), payload]); // 长度 <128 单字节 varint

  // esds 描述符链:ES(0x03, 负载头 ES_ID+flags=0) > DecoderConfig(0x04, 13 字节头) > ASC(0x05)
  const asc = Buffer.from([0x12, 0x10]); // AAC-LC(objType=2) 44.1kHz(idx=4) 立体声(ch=2)
  const esds = box("esds", full(0, 0), desc(0x03, Buffer.concat([
    Buffer.from([0, 0, 0]), // ES_ID(2) + streamFlags(1)=0
    desc(0x04, Buffer.concat([Buffer.alloc(13), desc(0x05, asc)])),
  ])));
  const mp4a = Buffer.concat([Buffer.alloc(6), u32(1) /* dataRefIdx */, Buffer.alloc(8), u32(2) /* ch */, u32(16), Buffer.alloc(8), u32(44100 << 16), esds]);
  const moov = box("moov", box("trak", box("mdia",
    box("hdlr", full(0, 0), u32(0), Buffer.from("soun"), Buffer.alloc(12)),
    box("minf", box("stbl", box("stsd", full(0, 0), u32(1), mp4a))),
  )));
  const ftyp = box("ftyp", Buffer.from("isom"), u32(1));

  // moof(traf: tfhd default-base-is-moof + trun dataOffset/dur/size) + mdat
  const mkFragment = (seq, rows, payload) => {
    const moof = box("moof",
      box("mfhd", full(0, 0), u32(seq)),
      box("traf",
        box("tfhd", full(0, 0x020000), u32(1)),
        box("trun", full(0, 0x000301), u32(rows.length), u32(0) /* dataOffset 占位 */, Buffer.concat(rows.map(([d, s]) => Buffer.concat([u32(d), u32(s)])))),
      ),
    );
    const trunBoxAt = moof.indexOf(Buffer.from("trun", "ascii")) - 4;
    moof.writeUInt32BE(moof.length + 8, trunBoxAt + 8 + 8); // fullbox(4)+count(4) 后即 dataOffset
    return Buffer.concat([moof, box("mdat", payload)]);
  };

  // 单 moof:3 帧 10/20/30 字节,载荷 0xaa/0xbb/0xcc
  const sizes = [10, 20, 30];
  const marks = [0xaa, 0xbb, 0xcc];
  const adts = fmp4ToAdts(Buffer.concat([ftyp, moov, mkFragment(1, sizes.map((s) => [1024, s]), Buffer.concat(sizes.map((s, i) => Buffer.alloc(s, marks[i]))))]));
  assert.equal(adts.length, sizes.reduce((n, s) => n + 7 + s, 0), "总长 = Σ(7+帧长)");
  const readLen = (o) => ((adts[o + 3] & 0x03) << 11) | (adts[o + 4] << 3) | ((adts[o + 5] >> 5) & 0x07);
  let o = 0;
  for (let i = 0; i < sizes.length; i++) {
    assert.equal(adts[o], 0xff, `帧${i} syncword 高字节`);
    assert.equal(adts[o + 1], 0xf1, `帧${i} MPEG-4 无 CRC`);
    assert.equal(adts[o + 2], (1 << 6) | (4 << 2) | (2 >> 2), `帧${i} profile=LC/freq=44.1k/ch=2: 0x${adts[o + 2].toString(16)}`);
    assert.equal(readLen(o), 7 + sizes[i], `帧${i} 长度字段`);
    for (let k = 0; k < sizes[i]; k++) assert.equal(adts[o + 7 + k], marks[i], `帧${i} 载荷原样`);
    o += readLen(o);
  }
  // 多 moof:两个分片连续排,各自独立提取
  const adts2 = fmp4ToAdts(Buffer.concat([
    ftyp, moov,
    mkFragment(1, [[1024, 15]], Buffer.alloc(15, 0xdd)),
    mkFragment(2, [[1024, 25]], Buffer.alloc(25, 0xee)),
  ]));
  assert.equal(adts2.length, (7 + 15) + (7 + 25), "双 moof 各自提取");
  assert.equal(adts2[9], 0xdd, "首 moof 载荷");
  assert.equal(adts2[7 + 15 + 9], 0xee, "次 moof 载荷");
  // tfhd defaultSampleSize 路径:trun 无 size 列(flags 0x000101)时取默认
  const adts3 = fmp4ToAdts(Buffer.concat([ftyp, moov, (() => {
    const moof = box("moof", box("mfhd", full(0, 0), u32(1)), box("traf",
      box("tfhd", full(0, 0x020010), u32(1), u32(15)), // default-base-is-moof + defaultSampleSize=15
      box("trun", full(0, 0x000101), u32(2), u32(0), Buffer.concat([u32(1024), u32(1024)])),
    ));
    const trunAt = moof.indexOf(Buffer.from("trun", "ascii")) - 4;
    moof.writeUInt32BE(moof.length + 8, trunAt + 8 + 8);
    return Buffer.concat([moof, box("mdat", Buffer.alloc(2 * 15, 0x99))]);
  })()]));
  assert.equal(adts3.length, 2 * (7 + 15), "defaultSampleSize=15 生效");
  // 退化:无 moof(传统 mp4)→ 抛"没有可提取的音频帧";垃圾字节 → 抛 ASC 缺失
  assert.throws(() => fmp4ToAdts(Buffer.concat([ftyp, moov])), /没有可提取的音频帧/);
  assert.throws(() => fmp4ToAdts(Buffer.alloc(64, 0xff)), /AudioSpecificConfig/);
});

console.log(`\n${passed} passed`);
