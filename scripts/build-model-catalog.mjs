#!/usr/bin/env node
/**
 * build-model-catalog.mjs — 从 models.dev api.json 生成构建期模型目录快照。
 *
 * 跑法:npx tsx scripts/build-model-catalog.mjs [--keep] [--in <api.json路径>]
 *   默认:网络拉取 https://models.dev/api.json(30s 超时),原始 JSON 缓存到
 *         scripts/fixtures/models-dev/api.json(gitignored,离线重跑用)
 *   --keep:直接用本地缓存,零网络(models.dev 被墙/代理不稳时)
 *   --in <path>:用指定文件(手动 curl 走代理下载后喂入)
 *
 * 产物:src/main/assets/model-catalog.json(提交入库,同 seed-course.json 惯例;
 * vite emit 插件 + build-server beside 让它随 Electron/手机/serve 三端走)。
 *
 * 映射与归一化复用 src/main/services/agent/modelsdev-map.ts —— 与运行时尽力刷新
 * (model-catalog-refresh.ts)同一份映射表,两条供给链永不漂移。
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS_DEV_PROVIDER_MAP, normalizeModelsDevApi } from "../src/main/services/agent/modelsdev-map.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "src", "main", "assets", "model-catalog.json");
const CACHE = resolve(__dirname, "fixtures", "models-dev", "api.json");
const API_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 30_000;

const args = process.argv.slice(2);

async function loadRawApi() {
  const inIdx = args.indexOf("--in");
  if (inIdx >= 0 && args[inIdx + 1]) {
    console.log(`[model-catalog] 读取指定文件: ${args[inIdx + 1]}`);
    return readFileSync(args[inIdx + 1], "utf8");
  }
  if (args.includes("--keep")) {
    console.log(`[model-catalog] 使用缓存(--keep,零网络): ${CACHE}`);
    return readFileSync(CACHE, "utf8");
  }
  console.log(`[model-catalog] 拉取 ${API_URL} …`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, raw);
    console.log(`[model-catalog] 已缓存到 ${CACHE}(${Math.round(raw.length / 1024)}KB)`);
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const raw = await loadRawApi();
  const catalog = normalizeModelsDevApi(JSON.parse(raw));

  const covered = Object.keys(catalog.providers);
  const nonEmpty = covered.filter((id) => Object.keys(catalog.providers[id]?.models ?? {}).length > 0);
  // 防御:models.dev 改形状/半途截断 → 产出近空快照。≥8 家非空才写盘。
  if (nonEmpty.length < 8) {
    throw new Error(`目录质量不达标:仅 ${nonEmpty.length} 家非空(${nonEmpty.join(", ") || "无"}) — 拒绝写快照`);
  }

  writeFileSync(OUTPUT, JSON.stringify(catalog, null, 2) + "\n");
  const modelCount = nonEmpty.reduce((n, id) => n + Object.keys(catalog.providers[id]?.models ?? {}).length, 0);
  console.log(`[model-catalog] 已写 ${OUTPUT}`);
  console.log(`[model-catalog] ${nonEmpty.length}/${Object.keys(MODELS_DEV_PROVIDER_MAP).length} 家映射命中,共 ${modelCount} 个模型条目,fetchedAt=${catalog.fetchedAt}`);

  const missing = Object.keys(MODELS_DEV_PROVIDER_MAP).filter((id) => !covered.includes(id));
  if (missing.length > 0) {
    console.warn(`[model-catalog] warn: 映射未命中(预设策展兜底,不影响行为): ${missing.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(`[model-catalog] 失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
