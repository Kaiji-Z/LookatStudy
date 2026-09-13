/**
 * verify-secret-handling —— 密钥与网络面纪律套件(2026-09-13 安全审计 · WP4)。
 *
 *   T1  settings:get 对 *_api_key 恒 null(源级)+ settings:has 协议三件套
 *       (shared/types ApiExpose / api-channels / preload)同步 + 渲染层两处改用 hasSetting
 *   T2  customProvider 改向防偷 key(行为,真 drizzle+sql.js):baseUrl 变更未带新 key →
 *       旧 key 清空;同 baseUrl 重存 → key 保留;baseUrl+key 同改 → 新 key
 *   T3  TLS 恒严格:speech-model-service 与 repo-fetcher 零 rejectUnauthorized:false;
 *       CERT_RETRY_CODES 自动降级已删
 *   T4  planModelscopeFiles 穿越守卫(行为):../、绝对路径、盘符条目被滤除
 *   T5  serve 静态加固:decodeURIComponent 包 try、路径包含校验带 sep、Origin 校验、
 *       token chmod 600(行为测试在 verify-serve T2b/T2c)
 *   T6  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-secret-handling.mjs(真 sql.js,不依赖 Electron)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

async function makeDb() {
  const sql = await initSqlJs();
  const sqldb = new sql.Database();
  sqldb.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return drizzle(sqldb, { schema });
}

// ── T1 settings 密钥闸 + 协议三件套 ──
{
  const ipc = read("src/main/ipc/index.ts");
  check("T1 settings:get 对 secret 键恒 null", ipc.includes("if (isSecretKey(key)) return null;") && ipc.includes('/_api_key$/'));
  check("T1 settings:has 布尔通道注册", ipc.includes('handle("settings:has"'));
  const types = read("shared/types.ts");
  check("T1 ApiExpose 有 hasSetting", types.includes("hasSetting(key: SettingKey): Promise<boolean>;"));
  const channels = read("shared/api-channels.ts");
  check("T1 api-channels 映射 hasSetting", channels.includes('hasSetting: "settings:has"'));
  const preload = read("src/preload/index.ts");
  check("T1 preload 暴露 hasSetting", preload.includes('invoke("settings:has", key)'));
  const settingsView = read("src/renderer/components/SettingsView.tsx");
  check("T1 SettingsView 已配置态走 hasSetting(不再从 DB 读 key 明文)", settingsView.includes("api.hasSetting(") && !settingsView.includes("getSetting(preset.apiKeySetting"));
  const modelPicker = read("src/renderer/components/ModelPicker.tsx");
  check("T1 ModelPicker 密钥探测走 hasSetting", modelPicker.includes("api.hasSetting(") && !modelPicker.includes("getSetting(p.apiKeySetting"));
}

// ── T2 customProvider 改向防偷 key(行为) ──
{
  const { createCustomProvider, updateCustomProvider } = await import("../src/main/services/custom-provider-service.ts");
  const db = await makeDb();
  const created = createCustomProvider(db, {
    label: "t",
    kind: "llm",
    protocol: "openai-compatible",
    baseUrl: "https://good.example/v1",
    apiKey: "sk-real-key",
    defaultModel: "m",
  });
  // ① baseUrl 变更 + 未带新 key → 清空(防 Bearer 外泄到新地址)
  const redirected = updateCustomProvider(db, created.id, { baseUrl: "https://evil.example/v1" });
  check("T2 改 baseUrl 未带 key → 旧 key 清空", redirected.hasApiKey === false);
  // ② 同 baseUrl 重存其他字段 → 已存的 key 保留
  updateCustomProvider(db, created.id, { baseUrl: "https://good2.example/v1", apiKey: "sk-second" });
  const sameUrl = updateCustomProvider(db, created.id, { baseUrl: "https://good2.example/v1", label: "t2" });
  check("T2 同 baseUrl 重存 → key 保留", sameUrl.hasApiKey === true);
  // ③ baseUrl+key 同改 → 新 key 生效
  const both = updateCustomProvider(db, created.id, { baseUrl: "https://good3.example/v1", apiKey: "sk-third" });
  check("T2 baseUrl+key 同改 → 新 key 生效", both.hasApiKey === true);
}

// ── T3 TLS 恒严格 ──
{
  const speech = read("src/main/services/speech/speech-model-service.ts");
  check("T3 speech-model-service 零证书降级", !speech.includes("rejectUnauthorized: false") && !/CERT_RETRY_CODES\.has/.test(speech));
  const repo = read("src/main/services/pure/repo-fetcher.ts");
  check("T3 repo-fetcher 调用点零降级", !repo.includes("rejectUnauthorized: false"));
}

// ── T4 planModelscopeFiles 穿越守卫(行为) ──
{
  const { planModelscopeFiles } = await import("../src/main/services/pure/speech-plan.ts");
  const listing = [
    { Path: "model.onnx", Size: 10, Type: "blob" },
    { Path: "../evil.txt", Size: 10, Type: "blob" },
    { Path: "/abs/evil.txt", Size: 10, Type: "blob" },
    { Path: "C:/evil.txt", Size: 10, Type: "blob" },
    { Path: "sub/../../evil.txt", Size: 10, Type: "blob" },
    { Path: "sub/ok.onnx", Size: 10, Type: "blob" },
  ];
  const plan = planModelscopeFiles(listing, { repo: "a/b", revision: "master" });
  const paths = plan.map((p) => p.path);
  check("T4 穿越条目被滤除", !paths.includes("../evil.txt") && !paths.includes("/abs/evil.txt") && !paths.includes("C:/evil.txt") && !paths.includes("sub/../../evil.txt"));
  check("T4 正常条目保留", paths.includes("model.onnx") && paths.includes("sub/ok.onnx"));
}

// ── T5 serve 静态加固 ──
{
  const serve = read("src/main/serve/server.ts");
  check("T5 decodeURIComponent 包 try", /try \{\s*\n\s*urlPath = decodeURIComponent/.test(serve) && serve.includes("畸形百分号编码"));
  check("T5 路径包含校验带分隔符", serve.includes("startsWith(webRoot + sep)"));
  check("T5 WS Origin 校验(CSWSH)", serve.includes("invalid origin") && serve.includes("sameOrigin"));
  check("T5 token 文件 chmod 600", serve.includes("chmodSync(tokenPath, 0o600)"));
}

// ── T6 注册 ──
{
  const pkg = JSON.parse(read("package.json"));
  check("T6 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-secret-handling"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
