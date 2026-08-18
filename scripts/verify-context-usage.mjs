/**
 * context-usage 窗口解析验证 —— 纯接缝:resolveModelContextWindow + modelsJson 解析。
 *
 * getContextUsage 本体(装配上下文块)在 tsx 下进不去(agent-engine → db/index →
 * schema.sql?raw 死链,仓库惯例:verify 只导纯叶子),故此处锁定它的窗口解析接缝:
 *   - resolveModelContextWindow:预设表与自定义 provider 共用(大小写不敏感/查不到 null)
 *   - listCustomProviders:modelsJson → ProviderModelInfo[](含 contextWindow 透传,
 *     modelsJson 空时单默认模型兜底条目窗口 null)
 * context-usage 的 3 行胶水(选路 preset/custom → 调这两个函数)由双 tsc + self-test 守。
 *
 * 不变量:
 *   - 条目带窗口且模型匹配 → 透传;大小写不敏感
 *   - modelsJson 空 / 条目窗口 null / 模型不在列表 / 列表 undefined → null(诚实未知,
 *     绝不做家族猜测 —— 猜错的窗口会让用量表显示假占比)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { PROVIDER_PRESETS } from "../src/main/services/agent/llm-presets.ts";
import { resolveModelContextWindow } from "../src/main/services/agent/llm-presets.ts";
import { listCustomProviders } from "../src/main/services/custom-provider-service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

// === T1: resolveModelContextWindow 基本解析 ===
{
  const models = [
    { id: "glm-5.2", contextWindow: 128000 },
    { id: "glm-5.2-air", contextWindow: 64000 },
  ];
  assert.strictEqual(resolveModelContextWindow(models, "glm-5.2"), 128000, "T1: 精确匹配透传");
  assert.strictEqual(resolveModelContextWindow(models, "GLM-5.2-AIR"), 64000, "T1: 大小写不敏感");
  assert.strictEqual(resolveModelContextWindow(models, "other"), null, "T1: 不在列表 → null");
  assert.strictEqual(resolveModelContextWindow(undefined, "x"), null, "T1: 列表 undefined → null");
  assert.strictEqual(resolveModelContextWindow(models, ""), null, "T1: 空模型名 → null");
  assert.strictEqual(
    resolveModelContextWindow([{ id: "m", contextWindow: null }], "m"),
    null,
    "T1: 条目窗口 null → null",
  );
  console.log("✓ T1 resolveModelContextWindow 匹配/大小写/未知路径");
}

// === T2: modelsJson 解析链(listCustomProviders)→ 窗口可用 ===
{
  const { sqljs, db } = await makeDb();
  const sq = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const modelsA = JSON.stringify([
    { id: "glm-5.2", label: "glm-5.2", contextWindow: 128000 },
    { id: "glm-5.2-air", label: "air", contextWindow: 64000 },
  ]);
  sqljs.run(
    `INSERT INTO custom_providers (id, label, protocol, base_url, default_model, models_json) VALUES ('custom-a','P','openai-compatible','https://example.com/v1','glm-5.2',${sq(modelsA)})`,
  );
  // modelsJson 空:单默认模型兜底条目,窗口 null(诚实未知)
  sqljs.run(
    `INSERT INTO custom_providers (id, label, protocol, base_url, default_model, models_json) VALUES ('custom-b','Q','openai-compatible','https://example.com/v1','glm-5.2',NULL)`,
  );
  // 坏 JSON → 忽略,同样兜底
  sqljs.run(
    `INSERT INTO custom_providers (id, label, protocol, base_url, default_model, models_json) VALUES ('custom-c','R','openai-compatible','https://example.com/v1','glm-5.2','not-json')`,
  );

  const list = listCustomProviders(db);
  assert.strictEqual(list.length, 3, "T2: 3 行");
  const a = list.find((p) => p.id === "custom-a");
  const b = list.find((p) => p.id === "custom-b");
  const c = list.find((p) => p.id === "custom-c");
  assert.ok(a && b && c, "T2: 三行都取出");
  assert.strictEqual(resolveModelContextWindow(a.models, "glm-5.2"), 128000, "T2: modelsJson 窗口经解析链可用");
  assert.strictEqual(resolveModelContextWindow(a.models, "glm-5.2-air"), 64000, "T2: 第二模型窗口跟随");
  assert.strictEqual(resolveModelContextWindow(b.models, "glm-5.2"), null, "T2: modelsJson 空 → 兜底条目未知");
  assert.strictEqual(resolveModelContextWindow(c.models, "glm-5.2"), null, "T2: 坏 JSON → 未知");
  assert.strictEqual(a.hasApiKey, false, "T2: apiKey 不外泄(布尔)");
  console.log("✓ T2 modelsJson → 窗口解析链(DB 真行)");
}

// === T3: 预设路径同源(回归) ===
{
  const preset = PROVIDER_PRESETS.find((p) => p.id === "glm");
  assert.ok(preset, "T3: glm 预设存在");
  const viaResolver = resolveModelContextWindow(preset.models, preset.defaultModel);
  const entry = preset.models.find((m) => m.id === preset.defaultModel);
  assert.strictEqual(viaResolver, entry?.contextWindow ?? null, "T3: 预设默认模型窗口同源");
  console.log("✓ T3 预设路径共用同一解析器不回归");
}

console.log("\n=== ALL CONTEXT USAGE TESTS PASSED ✅ ===");
