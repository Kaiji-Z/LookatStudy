/**
 * verify-serve —— 手机端/无头 serve 的端到端验证。
 *
 * 测的是**真实交付物**:esbuild 束出的 server.cjs 以子进程跑起来(不是内存里的
 * 模块直调),从 HTTP 静态、WS 协议(token 鉴权/req-res/未知通道)、到**真渲染层
 * web 传输**(src/renderer/lib/api-web.ts,浏览器 API 用 Node 全局桩替换)逐层验证,
 * 最后用 fixture 文件夹跑一次完整导入管线(E2E:invoke + event 推送 + 落库后可见)。
 *
 * 跑法: npx tsx scripts/verify-serve.mjs (也被 verify:core 调用;首次跑会 esbuild
 * 服务端束到临时目录,~2s)
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";
import { buildServerBundle } from "./lib/build-server.mjs";

const work = mkdtempSync(join(tmpdir(), "ls-verify-serve-"));
const serverCjs = join(work, "server.cjs");
const dataDir = join(work, "data");
const webDir = join(work, "web");

// ── fixture:静态目录 + 课程文件夹 ──
mkdirSync(webDir, { recursive: true });
writeFileSync(join(webDir, "index.html"), "<!doctype html><title>LookatStudy</title>", "utf8");
writeFileSync(join(webDir, "manifest.webmanifest"), '{"name":"LookatStudy"}', "utf8");
const courseDir = join(work, "course");
mkdirSync(join(courseDir, "docs"), { recursive: true });
writeFileSync(join(courseDir, "README.md"), "# 测试课程\n\n- [第一课](docs/a.md)\n- [第二课](docs/b.md)\n", "utf8");
writeFileSync(join(courseDir, "docs", "a.md"), "# 第一课\n\n正文内容足够长以便被识别为课程文件,写满一些文字确保不是噪声。\n\n## 小节\n\n内容。\n", "utf8");
writeFileSync(join(courseDir, "docs", "b.md"), "# 第二课\n\n第二课正文,同样写实质内容让扫描器认出文档。\n\n## 小节二\n\n内容二。\n", "utf8");

let passed = 0;
const ok = (name) => { console.log(`✓ ${name}`); passed++; };
const fail = (name, e) => { console.error(`✗ ${name}: ${e.message}`); process.exitCode = 1; };

/** kill 是异步信号:等子进程真正退出(带超时兜底),否则 serve 的 500ms 防抖落库会和 rmSync 竞态 */
function waitForExit(child, ms = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), ms);
    child.once("exit", () => { clearTimeout(t); resolve(); });
  });
}

/** rmSync 带重试:文件系统竞态(进程刚退出句柄未放)偶发 ENOTEMPTY/EBUSY */
async function rmRetry(dir, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

try {
  // ── 0. 构建真实交付物(与 build:mobile 同一配置) ──
  await buildServerBundle(serverCjs, { quiet: true });
  assert.ok(existsSync(serverCjs), "server.cjs 应产出");


  // ── 1. 子进程起服务,解析端口与 token ──
  const child = spawn(process.execPath, [serverCjs, "--port", "0", "--data", dataDir, "--web", webDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  child.stdout.on("data", (d) => stdoutChunks.push(d));
  child.stderr.on("data", (d) => stdoutChunks.push(d));

  let boot = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    boot = Buffer.concat(stdoutChunks).toString();
    if (boot.includes("listening on")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(boot.includes("listening on"), `serve 应打印 listening: ${boot.slice(-400)}`);
  const port = Number(/listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(boot)?.[1]);
  const token = /token=([0-9a-f]+)/.exec(boot)?.[1];
  assert.ok(port > 0 && token, `端口与 token 应可解析: ${boot.slice(-200)}`);

  const httpGet = (path) => fetch(`http://127.0.0.1:${port}${path}`).then((r) => r.status);

  // ── T1 静态伺服 + SPA 回退 ──
  try {
    assert.equal(await httpGet("/"), 200, "根路径 200");
    assert.equal(await httpGet("/manifest.webmanifest"), 200, "manifest 200");
    assert.equal(await httpGet("/deep/unknown/route"), 200, "SPA 回退 200");
    ok("T1 HTTP 静态 + SPA 回退");
  } catch (e) { fail("T1 HTTP 静态", e); }

  // ── T2 WS 无 token → 4001 拒绝 ──
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const code = await Promise.race([
      once(ws, "close").then(([c]) => c),
      new Promise((_, rej) => setTimeout(() => rej(new Error("无 token 连接 5s 未被关闭(鉴权回归?)")), 5000)),
    ]);
    assert.equal(code, 4001, `无 token 应被 4001 关闭,实际 ${code}`);
    ws.terminate();
    ok("T2 WS token 鉴权拒绝(4001)");
  } catch (e) { fail("T2 WS token", e); }

  // ── T3 WS req/res:种子课程 + 未知通道 ──
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
    await once(ws, "open");
    const invoke = (id, channel, ...args) => ws.send(JSON.stringify({ v: 1, type: "req", id, channel, args }));
    const waitRes = (wantId) => new Promise((resolve) => {
      const on = (d) => {
        const f = JSON.parse(d.toString());
        if (f.type === "res" && f.id === wantId) { ws.off("message", on); resolve(f); }
      };
      ws.on("message", on);
    });
    invoke("1", "course:list");
    const r1 = await waitRes("1");
    assert.ok(r1.ok && Array.isArray(r1.result) && r1.result.length >= 1, "种子课程应在列表里");
    assert.match(r1.result[0].title, /指南|Guide/, `标题应为使用指南: ${r1.result[0].title}`);
    invoke("2", "nope:nope");
    const r2 = await waitRes("2");
    assert.equal(r2.ok, false, "未知通道应 ok=false");
    assert.match(r2.error, /未知通道/, `错误信息应点名通道: ${r2.error}`);
    ws.close();
    ok("T3 WS req/res(course:list 种子课 + 未知通道报错)");
  } catch (e) { fail("T3 WS req/res", e); }

  // ── T4 真渲染层 web 传输(E2E):invoke + 事件订阅 + 完整导入管线 ──
  try {
    // 浏览器全局桩:api-web.ts 只依赖 window.location/localStorage/setTimeout/WebSocket
    const store = new Map();
    globalThis.window = {
      location: { protocol: "http:", host: `127.0.0.1:${port}`, search: `?token=${token}` },
      localStorage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
      },
      setTimeout,
      clearTimeout,
    };
    globalThis.WebSocket = WebSocket;
    const { installWebApi } = await import("../src/renderer/lib/api-web.ts");
    await installWebApi();
    const api = globalThis.window.api;
    assert.ok(api, "installWebApi 应挂载 window.api");
    assert.equal(typeof api.listCourses, "function", "方法面来自 API_CHANNELS(listCourses)");

    const before = await api.listCourses();
    assert.ok(Array.isArray(before) && before.length >= 1, "web api invoke 可用");

    // 事件订阅:导入管线会连续推 import:progress + import:done
    const events = [];
    const off = api.on("import:progress", (msg) => events.push(String(msg)));
    const doneP = new Promise((resolve) => {
      const offDone = api.on("import:done", (r) => { offDone(); resolve(r); });
    });
    const job = await api.importLocalFolder(courseDir.replace(/\\/g, "/"));
    assert.ok(job?.jobId, "import:localFolder(显式路径) 应返回 job");
    const done = await Promise.race([doneP, new Promise((_, rej) => setTimeout(() => rej(new Error("import:done 超时(60s)")), 60_000))]);
    assert.equal(done.ok, true, `导入应成功: ${done.error ?? ""}`);
    off();

    const after = await api.listCourses();
    assert.equal(after.length, before.length + 1, `导入后课程 +1: ${before.length} → ${after.length}`);
    assert.ok(events.length >= 2, `应收到 ≥2 条 import:progress 事件,实际 ${events.length}`);
    ok(`T4 web 传输 E2E:导入管线(${events.length} 事件) + 课程落库可见`);
  } catch (e) { fail("T4 web 传输 E2E", e); }

  // ── T5 漂移守卫:preload 的 method→channel 与 API_CHANNELS 逐对一致 ──
  // preload 保持手写(桌面零风险),表由它生成;新增/改名通道时两处必须同步,此测试守门。
  try {
    const { readFileSync: rf } = await import("node:fs");
    const { API_CHANNELS } = await import("@shared/api-channels");
    const preloadSrc = rf(join(process.cwd(), "src/preload/index.ts"), "utf8");
    const re = /(\w+):\s*\(\(.*?\)\s*=>\s*ipcRenderer\.invoke\(\s*"([^"]+)"/gs;
    const preloadPairs = new Map();
    for (const m of preloadSrc.matchAll(re)) preloadPairs.set(m[1], m[2]);
    assert.ok(preloadPairs.size >= 90, `preload 应解析出 ≥90 对,实际 ${preloadPairs.size}`);
    const tablePairs = Object.entries(API_CHANNELS);
    assert.equal(tablePairs.length, preloadPairs.size, `表 ${tablePairs.length} 对 vs preload ${preloadPairs.size} 对,数量不一致`);
    for (const [method, channel] of tablePairs) {
      assert.equal(preloadPairs.get(method), channel, `方法 ${method} 映射漂移: 表=${channel} preload=${preloadPairs.get(method)}`);
    }
    ok("T5 漂移守卫:preload ↔ API_CHANNELS 逐对一致");
  } catch (e) { fail("T5 漂移守卫", e); }

  child.kill();
  await waitForExit(child);
  if (process.env.KEEP_SERVE_WORK) console.error("[debug] work dir kept:", work);
  else await rmRetry(work);
} catch (e) {
  fail("setup", e);
  await rmRetry(work).catch(() => {});
}

console.log(`\n${passed} passed`);
if (process.exitCode) console.error("=== serve 验证: 失败 ❌ ===");
else console.log("=== serve 验证: 通过 ✅ ===");
