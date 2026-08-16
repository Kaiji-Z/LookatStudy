/**
 * verify-import-watchdog.mjs — 导入管线 LLM 流式看门狗测试。
 *
 * 背景:旧 300s 墙钟超时误杀"活着但慢"的生成(181 文件仓库 Step 4 结构设计批
 * 在 glm-5.2 上单批 >5min 但流在动),且 Promise.race 输掉后底层请求未取消。
 * 看门狗语义:流在动就续命;只有「无输出超时」或「硬上限」才 abort。
 *
 * 用小超时值(ms 级)直接驱动 createStreamWatchdog 的确定性时序,不依赖 LLM/网络。
 *
 * 跑法: npx tsx scripts/verify-import-watchdog.mjs (也被 verify:core 调用)
 */
import assert from "node:assert/strict";
import { createStreamWatchdog } from "../src/main/services/pure/stream-watchdog.ts";
import { generateTextWithTimeout, IMPORT_MAX_OUTPUT_TOKENS } from "../src/main/services/import-llm-service.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

// T1: 持续 touch(流在动)→ 不触发 inactive;短硬上限下也只可能是 hard-cap
await test("T1 流持续输出 → 不会 inactive abort", async () => {
  const wd = createStreamWatchdog(80, 5_000); // 无输出 80ms 判死
  try {
    for (let i = 0; i < 20; i++) {
      await sleep(30); // 每 30ms 一个 chunk,始终 < 80ms
      wd.touch();
      assert.ok(!wd.signal.aborted, `第 ${i} 个 chunk 后不应 abort`);
    }
    assert.equal(wd.reason(), null, "全程活跃,不应有 reason");
  } finally {
    wd.dispose();
  }
});

// T2: 静默(连接挂起)→ inactiveMs 后 abort,reason = inactive
await test("T2 静默流 → inactive abort", async () => {
  const wd = createStreamWatchdog(60, 5_000);
  const t0 = Date.now();
  while (!wd.signal.aborted && Date.now() - t0 < 2_000) await sleep(10);
  assert.ok(wd.signal.aborted, "静默应触发 abort");
  assert.equal(wd.reason(), "inactive");
  assert.ok(Date.now() - t0 < 500, "应在 ~60ms 触发,而非等 5s 硬上限");
  wd.dispose();
});

// T3: 一直 touch(慢但活跃的长生成)→ 只被硬上限拦下,reason = hard-cap
await test("T3 永续活跃流 → hard-cap 兜底", async () => {
  const wd = createStreamWatchdog(1_000, 150); // 硬上限 150ms
  const t0 = Date.now();
  while (!wd.signal.aborted && Date.now() - t0 < 2_000) {
    await sleep(20);
    wd.touch();
  }
  assert.ok(wd.signal.aborted, "应被硬上限 abort");
  assert.equal(wd.reason(), "hard-cap", "流一直活跃,只能是 hard-cap");
  wd.dispose();
});

// T4: touch 重置 inactive 计时——先静默 40ms(<60ms 阈值)再 touch,不应 abort
await test("T4 touch 续命:间歇活跃不误杀", async () => {
  const wd = createStreamWatchdog(60, 3_000);
  try {
    for (let i = 0; i < 10; i++) {
      await sleep(40); // 40ms < 60ms,每次都赶在判死前 touch
      wd.touch();
    }
    assert.ok(!wd.signal.aborted, "间歇活跃不应 abort");
  } finally {
    wd.dispose();
  }
});

// T5: dispose 清掉所有计时器(之后既不 inactive 也不 hard-cap)
await test("T5 dispose 后不再触发", async () => {
  const wd = createStreamWatchdog(50, 200);
  wd.dispose();
  await sleep(400); // 超过两个阈值
  assert.ok(!wd.signal.aborted, "dispose 后不应再 abort");
  assert.equal(wd.reason(), null);
});

// T6: wrapper 语义联动——用看门狗驱动一个模拟流:慢流(50ms/chunk)在旧 300s 墙钟下
//     若总时长超阈会被杀,这里证明只要间歇 < inactive 就能跑完任意长(用硬上限 1.2s 模拟"远期")
await test("T6 模拟慢流完整跑完(总时长可超单阈值)", async () => {
  const wd = createStreamWatchdog(100, 2_000);
  try {
    let received = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 600) {
      // 模拟 50ms 一个 chunk 的慢生成,总时长 600ms > inactive 阈值 100ms
      await sleep(50);
      wd.touch();
      received++;
    }
    assert.ok(received >= 10, "慢流应能持续产出");
    assert.ok(!wd.signal.aborted, "活跃慢流不应被杀");
  } finally {
    wd.dispose();
  }
});

// T4: generateTextWithTimeout 必须显式传 maxOutputTokens —— thinking 家族的思考与
// 正文共享输出额度,吃 provider 默认(4096)时 40 文件批的结构 JSON 会被掐成半个
// (实测:GLM 66s 流正常结束 + "Unexpected end of JSON input" 触发二分连锁)。
// 用手搓的假模型(LanguageModelV2 形状)捕获 doStream 收到的参数。
await test("T7 generateTextWithTimeout 显式传 maxOutputTokens=8192,文本往返完整", async () => {
  let capturedMax = -1;
  let capturedPrompt = "";
  const fakeModel = {
    specificationVersion: "v2",
    provider: "verify-fake",
    modelId: "fake-model",
    doStream: async (opts) => {
      capturedMax = opts.maxOutputTokens;
      const firstMsg = opts.prompt?.[0];
      const firstPart = firstMsg && Array.isArray(firstMsg.content) ? firstMsg.content[0] : undefined;
      capturedPrompt = String(firstPart?.text ?? "");
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-start", id: "t0" });
            c.enqueue({ type: "text-delta", id: "t0", delta: "hello " });
            c.enqueue({ type: "text-delta", id: "t0", delta: "world" });
            c.enqueue({ type: "text-end", id: "t0" });
            c.enqueue({ type: "finish", finishReason: "stop", usage: { input: 5, output: 2, total: 7 } });
            c.close();
          },
        }),
      };
    },
  };
  const text = await generateTextWithTimeout(fakeModel, "ping");
  assert.equal(text, "hello world", `文本应往返完整: ${JSON.stringify(text)}`);
  assert.equal(capturedPrompt, "ping", "prompt 透传");
  assert.equal(capturedMax, IMPORT_MAX_OUTPUT_TOKENS, `maxOutputTokens 应显式传 ${IMPORT_MAX_OUTPUT_TOKENS}: ${capturedMax}`);
  assert.equal(IMPORT_MAX_OUTPUT_TOKENS, 8192, "上限值被改动时同步更新本断言与注释(DeepSeek 上限)");
});


// T8: 外部取消信号 —— 预先 abort 的 signal 直接拒绝"导入已取消",不进流;
// providerOptions 透传到 doStream(导入禁思考的方言经此下发)
await test("T8 外部取消信号立即拒绝 + providerOptions 透传", async () => {
  let capturedOpts = null;
  const fakeModel = {
    specificationVersion: "v2",
    provider: "verify-fake",
    modelId: "fake-model",
    doStream: async (opts) => {
      capturedOpts = { maxOutputTokens: opts.maxOutputTokens, providerOptions: opts.providerOptions };
      return { stream: new ReadableStream({ start(c) { c.close(); } }) };
    },
  };
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(
    generateTextWithTimeout(fakeModel, "ping", { signal: ctl.signal }),
    /导入已取消/,
    "预取消信号应立即抛 导入已取消",
  );
  const ok = await generateTextWithTimeout(fakeModel, "ping", {
    providerOptions: { openai: { reasoningEffort: "low" } },
  });
  assert.equal(typeof ok, "string", "无信号正常返回");
  assert.deepEqual(
    capturedOpts?.providerOptions,
    { openai: { reasoningEffort: "low" } },
    "providerOptions 应透传到 doStream",
  );
});


console.log(`\n${passed} passed`);
