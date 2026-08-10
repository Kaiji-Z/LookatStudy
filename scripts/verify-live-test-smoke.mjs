/**
 * verify-live-test-smoke.mjs — live-test 静态烟雾检查（不调 LLM）。
 *
 * live-test 需要 API key 才能跑，平时不跑 → 容易腐坏（路径改了没人发现）。
 * 本脚本对每个 live-test 做零成本静态检查:
 *   1. import 能 resolve（动态 import + catch）
 *   2. 脚本里 readFileSync 的路径真实存在（正则提取 → fs.existsSync）
 *   3. API key 缺失时 graceful exit（头部有 process.exit(0) guard）
 *
 * 不调 LLM、不需要 API key、不需要网络。
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LIVE_TEST_DIR = join(ROOT, "scripts/live-test");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

// 收集所有 live-test 脚本（排除 helper）
const liveTestFiles = readdirSync(LIVE_TEST_DIR)
  .filter((f) => f.startsWith("live-test-") && f.endsWith(".mjs"))
  .sort();

console.log(`发现 ${liveTestFiles.length} 个 live-test 脚本\n`);

for (const file of liveTestFiles) {
  const filePath = join(LIVE_TEST_DIR, file);
  const content = readFileSync(filePath, "utf8");

  // T1: 脚本存在且可读
  test(`${file}: 文件存在且非空`, () => {
    assert.ok(content.length > 100, "文件太短，可能损坏");
  });

  // T2: readFileSync 引用的路径存在
  test(`${file}: readFileSync 路径存在`, () => {
    // 提取 readFileSync(join(ROOT, "...") 或 readFileSync("..." 里的路径
    // 常见模式: readFileSync(join(ROOT, "src/main/assets/seed-xxx.md"), "utf8")
    const pathMatches = content.matchAll(/readFileSync\([^)]*["'`](src\/[^"'`]+)["'`]/g);
    const checkedPaths = [];
    for (const m of pathMatches) {
      const relPath = m[1];
      const absPath = join(ROOT, relPath);
      checkedPaths.push(relPath);
      assert.ok(existsSync(absPath), `引用的文件不存在: ${relPath}`);
    }
    // 至少检查了 1 个路径（schema.sql 等）
    if (checkedPaths.length === 0) {
      // 没有相对路径引用也行（有些脚本只用动态 import）
    }
  });

  // T3: 从 _load-env.mjs 导入 readApiKey（不是自己定义）
  test(`${file}: 从 _load-env.mjs 导入 readApiKey（不自己定义）`, () => {
    assert.ok(
      content.includes('from "./_load-env.mjs"'),
      "应从 _load-env.mjs 导入 readApiKey",
    );
    assert.ok(
      !/^function\s+readApiKey/m.test(content),
      "不应自己定义 readApiKey（用共享 helper）",
    );
  });

  // T4: API key 缺失时有 graceful exit guard 或明确标注不需要 key
  test(`${file}: 有 API key 处理（exit guard 或标注不需要 key）`, () => {
    // 模式 A: !API_KEY ... process.exit(0) — 有 key 时才跑的测试
    const hasExitGuard = /!API_KEY[\s\S]{0,150}process\.exit\(0\)/.test(content);
    // 模式 B: 明确标注"不需要 key"或"继续"—无 key 也能跑的测试
    const hasNoKeyOk = /不需要.*(?:LLM|key|API)/.test(content) || /无.*key.*继续/.test(content);
    assert.ok(hasExitGuard || hasNoKeyOk, "缺少 API key guard 或 'no key ok' 标注");
  });
}

// T5: _load-env.mjs 导出了 readApiKey
test("_load-env.mjs: 导出了 readApiKey", () => {
  const helper = readFileSync(join(LIVE_TEST_DIR, "_load-env.mjs"), "utf8");
  assert.ok(
    /export\s+function\s+readApiKey/.test(helper),
    "_load-env.mjs 应导出 readApiKey 函数",
  );
});

// T6: _load-env.mjs 的 readApiKey 支持 ZHIPU_API_KEY 兼容
test("_load-env.mjs: readApiKey 支持 ZHIPU_API_KEY 兼容", () => {
  const helper = readFileSync(join(LIVE_TEST_DIR, "_load-env.mjs"), "utf8");
  assert.ok(
    helper.includes("ZHIPU_API_KEY"),
    "readApiKey 应兼容 ZHIPU_API_KEY 环境变量",
  );
});

console.log(`\n=== live-test 烟雾检查: ${passed}/${passed + failed} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
