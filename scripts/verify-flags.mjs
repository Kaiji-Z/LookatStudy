/**
 * Feature-flag 不变量验证。
 *
 * VERIFICATION §4 红线：每个 flag 默认 off。这个测试 import 真实 FLAG_DEFAULTS，
 * 任何把某 flag 默认改成 true 的提交都会被立刻拦下。
 *
 * 同时验证 isFlagName 类型守卫的正确性（合法名 → true，乱写 → false）。
 */
import assert from "node:assert";
import { FLAG_DEFAULTS, isFlagName } from "../src/main/services/pure/flag-defaults.ts";

// T1: 所有 flag 默认必须是 false（off）
const offending = Object.entries(FLAG_DEFAULTS)
  .filter(([, v]) => v === true)
  .map(([k]) => k);
assert.strictEqual(
  offending.length,
  0,
  `以下 flag 默认值被改成了 true，违反"默认 off"红线: ${offending.join(", ")}`,
);
console.log(`✓ T1 全部 ${Object.keys(FLAG_DEFAULTS).length} 个 flag 默认 off: ${Object.keys(FLAG_DEFAULTS).join(", ")}`);

// T2: isFlagName 守卫 —— 合法名返回 true
for (const name of Object.keys(FLAG_DEFAULTS)) {
  assert.ok(isFlagName(name), `T2: "${name}" 应被识别为合法 FlagName`);
}
console.log(`✓ T2 isFlagName: 所有已登记名识别为 true`);

// T3: isFlagName 守卫 —— 未登记/乱写返回 false
const invalid = ["skill", "flags", "", "skill_system_evil", "__proto__", "constructor"];
for (const name of invalid) {
  assert.ok(!isFlagName(name), `T3: "${name}" 不应被识别为合法 FlagName`);
}
console.log(`✓ T3 isFlagName: 未登记名 / 原型链攻击串均识别为 false`);

// T4: FLAG_DEFAULTS 是 plain object（防原型污染）
assert.strictEqual(Object.getPrototypeOf(FLAG_DEFAULTS), Object.prototype, "T4: FLAG_DEFAULTS 应是 plain object");
console.log(`✓ T4 原型干净: FLAG_DEFAULTS 是 plain object`);

console.log("\n=== ALL FLAG TESTS PASSED ✅ ===");
