/**
 * verify-reasoning-effort —— 思考强度方言表的回归套件。
 *
 * 覆盖 shared/reasoning-effort.ts:
 *   - supportsReasoningControl:哪些 provider 家族有开关(UI 门控)
 *   - reasoningPlanFor:自动/不支持 → none;三协议原生 options;表内家族 bodyPatch
 *   - withBodyPatch:请求体 JSON 被补丁;非 JSON 体原样放行;畸形 JSON 不抛
 *
 * 运行:tsx scripts/verify-reasoning-effort.mjs(verify:core 的一员)
 */
import {
  supportsReasoningControl,
  reasoningPlanFor,
  withBodyPatch,
  llmFamilyOf,
} from "../shared/reasoning-effort.ts";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.log(`✗ ${name}`);
    fail++;
  }
}

/* ---- T1 supportsReasoningControl(UI 门控口径) ---- */
check("T1a glm 支持", supportsReasoningControl("glm", "openai-compatible") === true);
check("T1b qwen 支持", supportsReasoningControl("qwen", "openai-compatible") === true);
check("T1c openai 官方支持", supportsReasoningControl("openai", "openai-compatible") === true);
check("T1d deepseek 不支持(靠模型切换,不硬发参数)", supportsReasoningControl("deepseek", "openai-compatible") === false);
check("T1e kimi 不支持", supportsReasoningControl("kimi", "openai-compatible") === false);
check("T1f anthropic 协议恒支持", supportsReasoningControl("anything", "anthropic") === true);
check("T1g google 协议恒支持", supportsReasoningControl("anything", "google") === true);

/* ---- T2 自动("")与不支持家族 → none ---- */
check("T2a 自动 → none", reasoningPlanFor("glm", "openai-compatible", "").kind === "none");
check("T2b 自动 anthropic → none", reasoningPlanFor("x", "anthropic", "").kind === "none");
check("T2c 不支持家族 deepseek fast → none", reasoningPlanFor("deepseek", "openai-compatible", "fast").kind === "none");
check("T2d 不支持家族 kimi deep → none", reasoningPlanFor("kimi", "openai-compatible", "deep").kind === "none");

/* ---- T3 原生 providerOptions 协议 ---- */
{
  const p = reasoningPlanFor("openai", "openai-compatible", "fast");
  check("T3a openai fast → reasoningEffort low", p.kind === "providerOptions" && p.options.openai?.reasoningEffort === "low");
}
{
  const p = reasoningPlanFor("openai", "openai-compatible", "deep");
  check("T3b openai deep → reasoningEffort high", p.kind === "providerOptions" && p.options.openai?.reasoningEffort === "high");
}
{
  const p = reasoningPlanFor("any", "anthropic", "fast");
  check("T3c anthropic fast → none(默认即不思考)", p.kind === "none");
}
{
  const p = reasoningPlanFor("any", "anthropic", "deep");
  check(
    "T3d anthropic deep → thinking enabled + 预算 ≤ 4096(防预算>默认上限的 400)",
    p.kind === "providerOptions" && p.options.anthropic?.thinking?.type === "enabled" && (p.options.anthropic?.thinking?.budgetTokens ?? 1e9) <= 4096,
  );
}
{
  const p = reasoningPlanFor("any", "google", "fast");
  check("T3e google fast → thinkingBudget 0(硬关)", p.kind === "providerOptions" && p.options.google?.thinkingConfig?.thinkingBudget === 0);
}
{
  const p = reasoningPlanFor("any", "google", "deep");
  check("T3f google deep → thinkingBudget -1(动态)", p.kind === "providerOptions" && p.options.google?.thinkingConfig?.thinkingBudget === -1);
}

/* ---- T4 bodyPatch 家族(GLM/Qwen/SiliconCloud) ---- */
{
  const p = reasoningPlanFor("glm", "openai-compatible", "fast");
  const body = { model: "glm-4.6", messages: [] };
  if (p.kind === "bodyPatch") p.patch(body);
  check("T4a glm fast → thinking disabled", body.thinking?.type === "disabled");
}
{
  const p = reasoningPlanFor("glm", "openai-compatible", "deep");
  const body = {};
  if (p.kind === "bodyPatch") p.patch(body);
  check("T4b glm deep → thinking enabled", body.thinking?.type === "enabled");
  check("T4c glm 是 bodyPatch 而非 options", p.kind === "bodyPatch");
}
{
  const p = reasoningPlanFor("qwen", "openai-compatible", "fast");
  const body = {};
  if (p.kind === "bodyPatch") p.patch(body);
  check("T4d qwen fast → enable_thinking false", body.enable_thinking === false);
}
{
  const p = reasoningPlanFor("siliconcloud", "openai-compatible", "deep");
  const body = {};
  if (p.kind === "bodyPatch") p.patch(body);
  check("T4e siliconcloud deep → enable_thinking true", body.enable_thinking === true);
}
// patch 不覆盖用户/上层已有的其他字段
{
  const p = reasoningPlanFor("glm", "openai-compatible", "deep");
  const body = { model: "glm-4.6", temperature: 0.3 };
  if (p.kind === "bodyPatch") p.patch(body);
  check("T4f patch 保留原有字段", body.model === "glm-4.6" && body.temperature === 0.3);
}

/* ---- T5 withBodyPatch(fetch 包装) ---- */
{
  // 正常 JSON body:被补丁后转发
  let seen = null;
  const fake = async (_u, init) => {
    seen = init?.body;
    return new Response("{}");
  };
  const wrapped = withBodyPatch(fake, (b) => {
    b.thinking = { type: "enabled" };
  });
  await wrapped("https://x", { method: "POST", body: JSON.stringify({ model: "m" }) });
  const parsed = JSON.parse(String(seen));
  check("T5a JSON body 补丁生效", parsed.thinking?.type === "enabled" && parsed.model === "m");
}
{
  // 非 JSON body(如 multipart)原样放行
  let seen = "untouched";
  const fake = async (_u, init) => {
    seen = init?.body;
    return new Response("{}");
  };
  const wrapped = withBodyPatch(fake, (b) => {
    b.x = 1;
  });
  await wrapped("https://x", { method: "POST", body: "not-json" });
  check("T5b 非 JSON body 原样放行", seen === "not-json");
}
{
  // 畸形 JSON(以 { 开头但解析失败)不抛、原样发送
  let seen = null;
  const fake = async (_u, init) => {
    seen = init?.body;
    return new Response("{}");
  };
  const wrapped = withBodyPatch(fake, () => {
    throw new Error("should not run");
  });
  await wrapped("https://x", { method: "POST", body: "{broken" });
  check("T5c 畸形 JSON 不抛且原样发送", seen === "{broken");
}
{
  // 无 init/body:照常调用
  const fake = async () => new Response("ok");
  const wrapped = withBodyPatch(fake, () => undefined);
  const res = await wrapped("https://x");
  check("T5d 无 body 请求照常", (await res.text()) === "ok");
}

// ── 家族嗅探:自定义 provider(custom-*)按 baseUrl/模型名认家族 ──
check("T? llmFamilyOf: 预设 id 直通", llmFamilyOf("glm") === "glm" && llmFamilyOf("qwen") === "qwen");
check("T? llmFamilyOf: custom + z.ai 端点 → glm", llmFamilyOf("custom-x", "https://api.z.ai/api/coding/paas/v4", "glm-5.2") === "glm");
check("T? llmFamilyOf: custom + bigmodel 端点 → glm", llmFamilyOf("custom-y", "https://open.bigmodel.cn/api/paas/v4", "任意") === "glm");
check("T? llmFamilyOf: custom + glm 模型名 → glm", llmFamilyOf("custom-z", "https://proxy.example.com/v1", "GLM-4.6") === "glm");
check("T? llmFamilyOf: custom + qwen 模型名 → qwen", llmFamilyOf("custom-w", "https://x.example/v1", "qwen3-max") === "qwen");
check("T? llmFamilyOf: 认不出 → 原 id(降级 none)", llmFamilyOf("custom-?", "https://unknown.example/v1", "mystery-model") === "custom-?");
{
  const plan = reasoningPlanFor("custom-live", "openai-compatible", "fast", {
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-5.2",
  });
  check("T? custom ZAI + fast → bodyPatch(此前永远 none,思考关不掉)", plan.kind === "bodyPatch");
  if (plan.kind === "bodyPatch") {
    const body = { model: "glm-5.2" };
    plan.patch(body);
    check("T? patch 写入 thinking.type=disabled", JSON.stringify(body.thinking) === JSON.stringify({ type: "disabled" }));
  }
  check("T? 无 hints 的 custom 仍 none(保守)", reasoningPlanFor("custom-live", "openai-compatible", "fast").kind === "none");
}

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\nFAIL (${fail}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
