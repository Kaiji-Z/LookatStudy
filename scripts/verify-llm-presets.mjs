/**
 * LLM Provider 预设解析验证 —— 测真实 llm-presets.ts。
 *
 * 核心不变量：
 *   - 默认 provider 是 glm（智谱），默认 model 合理
 *   - 配了 key → ready=true，返回 provider/model/apiKey
 *   - 没配 key → ready=false，missing 说明缺哪个 key
 *   - 未知 provider → ready=false
 *   - 自定义 active_model 覆盖默认
 */
import assert from "node:assert";
import {
  PROVIDER_PRESETS,
  getProviderPreset,
  resolveProviderConfig,
} from "../src/main/services/agent/llm-presets.ts";

// T1: 预设里有 glm/openai/deepseek
const ids = PROVIDER_PRESETS.map((p) => p.id);
assert.ok(ids.includes("glm"), "T1: 应有 glm");
assert.ok(ids.includes("openai"), "T1: 应有 openai");
assert.ok(ids.includes("deepseek"), "T1: 应有 deepseek");
assert.ok(ids.length >= 3, `T1: 至少 3 个预设, 实际 ${ids.length}`);
console.log(`✓ T1 预设齐全：${ids.join(", ")}`);

// T2: 每个 preset 的 baseUrl 是合法 URL + 有 apiKeySetting
for (const p of PROVIDER_PRESETS) {
  assert.doesNotThrow(() => new URL(p.baseUrl), `T2: ${p.id} baseUrl 应合法`);
  assert.ok(p.apiKeySetting.endsWith("_api_key"), `T2: ${p.id} apiKeySetting 应以 _api_key 结尾`);
  assert.ok(p.defaultModel.length > 0, `T2: ${p.id} 应有 defaultModel`);
}
console.log(`✓ T2 所有预设：baseUrl 合法 + apiKeySetting 命名规范`);

// T3: 默认（不指定 active_provider）→ glm
const def = resolveProviderConfig({});
assert.strictEqual(def.ready, false, "T3: 不配 key 不该 ready");
assert.strictEqual(def.provider?.id, "glm", "T3: 默认 provider 应是 glm");
console.log(`✓ T3 默认 provider=glm（未配 key → ready=false）`);

// T4: 配了 glm key → ready + 返回 model/key
const ready = resolveProviderConfig({ glm_api_key: "sk-test-123" });
assert.strictEqual(ready.ready, true, "T4: 配 key 后应 ready");
assert.strictEqual(ready.provider?.id, "glm");
assert.strictEqual(ready.apiKey, "sk-test-123");
assert.strictEqual(ready.model, ready.provider.defaultModel, "T4: 未指定 model 用默认");
console.log(`✓ T4 配 glm key → ready=true, model=${ready.model}`);

// T5: 没配 key → missing 说明
const noKey = resolveProviderConfig({});
assert.ok(noKey.missing?.includes("glm_api_key"), `T5: missing 应说明缺 glm_api_key, 实际 ${noKey.missing}`);
console.log(`✓ T5 missing 字段说明缺哪个 key：${noKey.missing}`);

// T6: 切到 openai 但没配 openai key → ready=false, missing 指向 openai
const openaiNoKey = resolveProviderConfig({ active_provider: "openai" });
assert.strictEqual(openaiNoKey.ready, false);
assert.ok(openaiNoKey.missing?.includes("openai_api_key"));
console.log(`✓ T6 切 openai 未配 key：missing=${openaiNoKey.missing}`);

// T7: 切到 openai + 配 key → ready
const openaiReady = resolveProviderConfig({
  active_provider: "openai",
  openai_api_key: "sk-oai",
});
assert.strictEqual(openaiReady.ready, true);
assert.strictEqual(openaiReady.provider?.id, "openai");
console.log(`✓ T7 切 openai + 配 key → ready`);

// T8: 自定义 active_model 覆盖默认
const customModel = resolveProviderConfig({
  glm_api_key: "k",
  active_model: "glm-4-plus",
});
assert.strictEqual(customModel.model, "glm-4-plus", "T8: active_model 应覆盖默认");
console.log(`✓ T8 active_model=glm-4-plus 覆盖默认`);

// T9: 未知 provider → ready=false, missing 说明
const unknown = resolveProviderConfig({ active_provider: "midnight" });
assert.strictEqual(unknown.ready, false);
assert.ok(unknown.missing?.includes("midnight"), `T9: missing 应含未知 id`);
console.log(`✓ T9 未知 provider → ready=false：${unknown.missing}`);

// T10: getProviderPreset 查找
assert.ok(getProviderPreset("glm"), "T10: getProviderPreset(glm) 命中");
assert.strictEqual(getProviderPreset("nonexistent"), undefined);
console.log(`✓ T10 getProviderPreset 查找正确`);

console.log("\n=== ALL LLM PRESET TESTS PASSED ✅ ===");
