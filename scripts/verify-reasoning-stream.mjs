/**
 * verify-reasoning-stream —— 第三方 openai-compatible 端点的思考流解析(回归守卫)。
 *
 * 背景(2026-08-17 实测):z.ai CodingPlan + glm-5.3 在 chat/completions SSE 里全程
 * 流式发 delta.reasoning_content,但 @ai-sdk/openai 的 chunk schema 只认
 * role/content/tool_calls,reasoning_content 被 zod 静默剥掉 —— 端点在发、SDK 在丢,
 * UI 只剩三个点。修法:非官方 OpenAI 的兼容端点改用 @ai-sdk/openai-compatible
 * (解析 reasoning_content → reasoning-delta)。
 *
 * 本套件用桩 fetch 返回 GLM 形状的假 SSE,不碰网络:
 *   T1 官方端点判定(isOfficialOpenAiBase 分类)
 *   T2 思考流穿通:reasoning-delta 带原文、text-delta 正常、无 error、usage 解析
 *   T3 请求形状:URL 打到 {baseUrl}/chat/completions、include_usage 在场
 *   T4 思考强度 bodyPatch(fetch 包装)在新路径下仍注入请求体
 *
 * 闭环:把 buildLanguageModel 的第三方分支改回 createOpenAI → T2 的
 * reasoning-delta 断言即红(实测已证)。
 */
import assert from "node:assert/strict";
import { streamText } from "ai";
import { buildLanguageModel, isOfficialOpenAiBase } from "../src/main/services/agent/llm-client.ts";
import { withBodyPatch } from "../shared/reasoning-effort.ts";

/** 把若干 SSE data 行封装成 Response(200, event-stream)。 */
function sseResponse(lines) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(`data: ${l}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** GLM/z.ai 实测形状:首块 role → 若干 reasoning_content 块 → content 块 → finish+usage → DONE。 */
const GLM_SSE = [
  JSON.stringify({ id: "c1", created: 1, model: "glm-5.3", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }),
  JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { reasoning_content: "先想一下" }, finish_reason: null }] }),
  JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { reasoning_content: "再想想" }, finish_reason: null }] }),
  JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { content: "答案是" }, finish_reason: null }] }),
  JSON.stringify({ id: "c1", choices: [{ index: 0, delta: { content: "42" }, finish_reason: null }] }),
  JSON.stringify({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }),
  "[DONE]",
];

const BASE = "https://api.z.ai/api/coding/paas/v4";

async function runWithFetch(fetchStub) {
  const model = buildLanguageModel("openai-compatible", BASE, "test-key", "glm-5.3", fetchStub);
  const result = streamText({ model, prompt: "ping" });
  const parts = [];
  for await (const p of result.fullStream) parts.push(p);
  const usage = await result.usage;
  const finishReason = await result.finishReason;
  return { parts, usage, finishReason };
}

const join = (parts, type) =>
  parts
    .filter((p) => p.type === type)
    .map((p) => p.text)
    .join("");

// ---------------------------------------------------------------- T1 官方端点判定
assert.equal(isOfficialOpenAiBase("https://api.openai.com/v1"), true, "T1 官方 host 应判 true");
assert.equal(isOfficialOpenAiBase("https://API.OPENAI.COM/v1/"), true, "T1 大小写不敏感");
assert.equal(isOfficialOpenAiBase(BASE), false, "T1 z.ai 应判 false(走 openai-compatible 包)");
assert.equal(isOfficialOpenAiBase("https://open.bigmodel.cn/api/caas/v4"), false, "T1 bigmodel 应判 false");
assert.equal(isOfficialOpenAiBase("https://api.openai.com.evil.example/v1"), false, "T1 后缀伪装域名必须 false");
assert.equal(isOfficialOpenAiBase("not a url"), false, "T1 畸形 URL 保守 false");
console.log("T1 isOfficialOpenAiBase 分类 ✓");

// ---------------------------------------------------------------- T2 思考流穿通
{
  const { parts, usage, finishReason } = await runWithFetch(() => Promise.resolve(sseResponse(GLM_SSE)));
  const reasoning = join(parts, "reasoning-delta");
  assert.equal(reasoning, "先想一下再想想", "T2 reasoning-delta 必须带思考原文(被 createOpenAI 剥掉时这里为空)");
  assert.equal(join(parts, "text-delta"), "答案是42", "T2 正文不受影响");
  assert.ok(!parts.some((p) => p.type === "error"), `T2 不应出现 error part:${JSON.stringify(parts.filter((p) => p.type === "error"))}`);
  assert.equal(finishReason, "stop", "T2 finishReason=stop");
  assert.equal(usage.outputTokens, 5, `T2 usage 解析(completion_tokens→outputTokens),实际:${usage.outputTokens}`);
  assert.equal(usage.inputTokens, 3, "T2 usage 解析(prompt_tokens→inputTokens)");
  console.log("T2 思考流穿通 buildLanguageModel→streamText ✓");
}

// ---------------------------------------------------------------- T3 请求形状
{
  let hitUrl = "";
  let body = null;
  const { parts } = await runWithFetch(async (input, init) => {
    hitUrl = String(input);
    body = init?.body ? JSON.parse(init.body) : null;
    return sseResponse(GLM_SSE);
  });
  assert.ok(hitUrl.startsWith(`${BASE}/chat/completions`), `T3 URL 应打 {baseUrl}/chat/completions,实际:${hitUrl}`);
  assert.equal(body?.stream, true, "T3 流式开关");
  assert.equal(body?.stream_options?.include_usage, true, "T3 include_usage 在场(与 createOpenAI 行为对齐)");
  assert.equal(body?.model, "glm-5.3", "T3 model 字段");
  assert.ok(join(parts, "text-delta").length > 0, "T3 桩流正常消费");
  console.log("T3 请求形状(URL/stream/include_usage/model)✓");
}

// ---------------------------------------------------------------- T4 bodyPatch 仍生效
{
  let captured = null;
  const baseFetch = () => {
    return Promise.resolve(sseResponse(GLM_SSE));
  };
  // withBodyPatch 会在调 baseFetch 前改写 body —— 桩里抓改写后的
  const patchedFetch = withBodyPatch(async (input, init) => {
    captured = init?.body ? JSON.parse(init.body) : null;
    return sseResponse(GLM_SSE);
  }, (b) => {
    b.thinking = { type: "disabled" };
    b.reasoning_effort = "low";
  });
  const { parts } = await runWithFetch(patchedFetch);
  assert.equal(captured?.thinking?.type, "disabled", `T4 GLM fast 的 thinking.disabled 应注入请求体,实际:${JSON.stringify(captured)}`);
  assert.equal(captured?.reasoning_effort, "low", "T4 GLM fast 的 reasoning_effort=low 应注入请求体");
  assert.equal(join(parts, "reasoning-delta"), "先想一下再想想", "T4 fetch 包装不影响思考流解析");
  void baseFetch;
  console.log("T4 思考强度 bodyPatch 在新路径下仍生效 ✓");
}

console.log("verify-reasoning-stream: 4 组全部通过");
