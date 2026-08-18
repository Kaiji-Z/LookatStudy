/**
 * verify-speech-models —— 语音模型 manifest + 下载计划纯函数 + 本地状态判定。
 * 离线确定性:不触网(真实下载链路由 live-test-speech-models 覆盖)。
 *
 * 运行:tsx scripts/verify-speech-models.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SPEECH_MODELS_MANIFEST } from "../src/main/services/speech/speech-model-manifest";
import {
  archiveCandidateUrls,
  computeOverallProgress,
  filterMissingFiles,
  modelscopeFileUrl,
  pickVariant,
  planModelscopeFiles,
  tarEntryDest,
  validateSpeechManifest,
} from "../src/main/services/pure/speech-plan";
import {
  ensureSpeechModel,
  listModelFiles,
  readSpeechModelStatus,
  speechModelDir,
  deleteSpeechModel,
} from "../src/main/services/speech/speech-model-service";

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

// ---------------------------------------------------------------------------
console.log("T1 manifest 结构校验");
{
  const errs = validateSpeechManifest(SPEECH_MODELS_MANIFEST);
  assert.deepEqual(errs, [], `manifest 应合法,实际错误: ${JSON.stringify(errs)}`);

  // 闭环:破坏各字段必须被抓住
  const clone = (m) => JSON.parse(JSON.stringify(m));
  const bad1 = clone(SPEECH_MODELS_MANIFEST);
  bad1.models[0].sources[1].proxies = ["http://no-slash"];
  assert.ok(validateSpeechManifest(bad1).some((e) => e.includes("proxies")), "http/无尾斜杠代理要被抓");

  const bad2 = clone(SPEECH_MODELS_MANIFEST);
  bad2.models[1].variants.int8.files.push("../evil.onnx");
  assert.ok(validateSpeechManifest(bad2).some((e) => e.includes("不安全")), "路径穿越要被抓");

  const bad3 = clone(SPEECH_MODELS_MANIFEST);
  bad3.formatVersion = 2;
  assert.ok(validateSpeechManifest(bad3).some((e) => e.includes("formatVersion")), "版本号要被抓");

  const bad4 = clone(SPEECH_MODELS_MANIFEST);
  bad4.models[0].sources[0].repo = "not-a-repo";
  assert.ok(validateSpeechManifest(bad4).some((e) => e.includes("repo")), "repo 形状要被抓");
  ok("manifest 合法 + 4 类破坏全被抓");
}

// ---------------------------------------------------------------------------
console.log("T2 ModelScope 计划:include/exclude/点文件/排序");
{
  const listing = [
    { Path: ".gitattributes", Size: 100 },
    { Path: "README.md", Size: 200 },
    { Path: "configuration.json", Size: 50 },
    { Path: "model.onnx", Size: 325_631_727 },
    { Path: "espeak-ng-data", Size: 0, Type: "tree" },
    { Path: "espeak-ng-data/phondata", Size: 1_600_000 },
    { Path: "dict/jieba.dict.utf8", Size: 5_400_000 },
  ];
  const plan = planModelscopeFiles(listing, {
    kind: "modelscope-files", repo: "a/b", revision: "master",
    exclude: [".gitattributes", "README.md", "configuration.json"],
  });
  assert.deepEqual(
    plan.map((p) => p.path),
    ["dict/jieba.dict.utf8", "espeak-ng-data/phondata", "model.onnx"], // 排序稳定
    "exclude 过滤 + 排序",
  );

  const planInc = planModelscopeFiles(listing, {
    kind: "modelscope-files", repo: "a/b", revision: "master",
    include: ["model.onnx", "tokens.txt"],
  });
  assert.deepEqual(planInc.map((p) => p.path), ["model.onnx"], "include 白名单只留交集");
  assert.equal(planInc[0].bytes, 325_631_727, "字节数直传");
  ok("计划函数行为正确");
}

// ---------------------------------------------------------------------------
console.log("T3 ModelScope 文件 URL 编码");
{
  const u = modelscopeFileUrl("ns/repo", "master", "dict/sub dir/文件 名.txt");
  assert.ok(u.startsWith("https://modelscope.cn/models/ns/repo/resolve/master/"), "前缀");
  assert.ok(u.includes(encodeURIComponent("文件 名.txt")), "非 ASCII 编码");
  assert.ok(!u.includes(" "), "无裸空格");
  ok("URL 拼接与编码");
}

// ---------------------------------------------------------------------------
console.log("T4 tar 条目路径安全");
{
  const strip = true;
  assert.equal(tarEntryDest("kokoro-multi-lang-v1_1/model.onnx", strip), "model.onnx", "剥顶层");
  assert.equal(tarEntryDest("kokoro-multi-lang-v1_1/espeak-ng-data/phondata", strip), "espeak-ng-data/phondata", "嵌套保留");
  assert.equal(tarEntryDest("kokoro-multi-lang-v1_1/", strip), null, "顶层目录跳过");
  assert.equal(tarEntryDest("model.onnx", strip), null, "strip 模式下顶层散文件跳过");
  assert.equal(tarEntryDest("dir/../../evil", strip), null, "穿越拒绝");
  assert.equal(tarEntryDest("/abs/path", false), null, "绝对路径拒绝");
  assert.equal(tarEntryDest("dir/", false), null, "目录条目跳过");
  assert.equal(tarEntryDest("./PaxHeaders.0/x", false), null, "pax 头跳过");
  assert.equal(tarEntryDest("normal.txt", false), "normal.txt", "非 strip 模式原样");
  ok("路径安全全绿");
}

// ---------------------------------------------------------------------------
console.log("T5 归档候选 URL:直连先行 + 代理链拼接序");
{
  const urls = archiveCandidateUrls({
    kind: "github-archive", url: "https://github.com/k2-fsa/x.tar.bz2",
    sizeBytes: 1, stripTopDir: true, proxies: ["https://gh-proxy.com/", "https://ghfast.top/"],
  });
  assert.deepEqual(urls, [
    "https://github.com/k2-fsa/x.tar.bz2",
    "https://gh-proxy.com/https://github.com/k2-fsa/x.tar.bz2",
    "https://ghfast.top/https://github.com/k2-fsa/x.tar.bz2",
  ]);
  ok("候选序确定");
}

// ---------------------------------------------------------------------------
console.log("T6 变体挑选:int8 偏好优先");
{
  const asr = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-zipformer");
  const files = new Set([
    ...asr.variants.int8.files,
    ...asr.variants.fp32.files,
  ]);
  assert.equal(pickVariant(asr, files), "int8", "双全 → int8");
  const fp32Only = new Set(asr.variants.fp32.files);
  assert.equal(pickVariant(asr, fp32Only), "fp32", "仅 fp32 → fp32");
  const partial = new Set(asr.variants.int8.files.slice(0, 3));
  assert.equal(pickVariant(asr, partial), null, "残缺 → 未就绪");
  const empty = new Set();
  assert.equal(pickVariant(asr, empty), null, "空 → 未就绪");
  ok("变体偏好与就绪判定");
}

// ---------------------------------------------------------------------------
console.log("T7 断点续跑:同尺寸跳过 / 异尺寸重下");
{
  const plan = [
    { path: "a.onnx", bytes: 100 },
    { path: "b.onnx", bytes: 200 },
  ];
  assert.deepEqual(filterMissingFiles(plan, new Map()), plan, "无存量全下");
  assert.deepEqual(filterMissingFiles(plan, new Map([["a.onnx", 100]])), [{ path: "b.onnx", bytes: 200 }], "同尺寸跳过");
  assert.deepEqual(filterMissingFiles(plan, new Map([["a.onnx", 99]])), plan, "尺寸不符重下");
  ok("续跑过滤正确");
}

// ---------------------------------------------------------------------------
console.log("T8 总进度加权");
{
  const p = computeOverallProgress([
    { progress: 1, approxBytes: 300 },
    { progress: 0, approxBytes: 100 },
  ]);
  assert.equal(p, 0.75, "按字节加权");
  const clamped = computeOverallProgress([{ progress: 5, approxBytes: 1 }]);
  assert.equal(clamped, 1, "进度截断到 1");
  const zero = computeOverallProgress([]);
  assert.equal(zero, 0, "空列表为 0");
  ok("进度聚合正确");
}

// ---------------------------------------------------------------------------
console.log("T9 本地状态:就绪/缺席 + ensure 幂等(离线路径)");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-speech-models-"));
  try {
    const tts = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "tts-kokoro");
    const st0 = readSpeechModelStatus(tmp, tts);
    assert.equal(st0.state, "absent", "初始缺席");

    const dir = speechModelDir(tmp, tts.id);
    for (const f of tts.variants.default.files) {
      const dest = path.join(dir, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, "x");
    }
    // 点文件不影响判定
    fs.writeFileSync(path.join(dir, ".download.tar.bz2"), "junk");
    const files = listModelFiles(dir);
    assert.ok(!files.has(".download.tar.bz2"), "点文件不入清单");
    assert.ok(files.has("model.onnx"), "内容文件入清单");

    const st1 = readSpeechModelStatus(tmp, tts);
    assert.equal(st1.state, "ready", "文件齐 → ready");
    assert.equal(st1.progress, 1);

    // ensure 幂等:文件已齐时零网络返回 alreadyReady
    const r = await ensureSpeechModel(tmp, tts);
    assert.equal(r.alreadyReady, true, "幂等直返");
    assert.equal(r.variant, "default");

    await deleteSpeechModel(tmp, tts.id);
    assert.equal(readSpeechModelStatus(tmp, tts).state, "absent", "删除后回到缺席");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok("状态机 + 幂等 + 删除");
}

// ---------------------------------------------------------------------------
console.log("T10 模型目录路径形状");
{
  const dir = speechModelDir("C:/userData", "tts-kokoro");
  assert.ok(dir.replaceAll("\\", "/").endsWith("speech-models/tts-kokoro"), "标准布局");
  ok("路径形状");
}

console.log(`\nverify-speech-models: ${passed} 组全绿 ✓`);
