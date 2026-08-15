/**
 * 种子课程加载器 —— 从内置静态 JSON 加载 LookatStudy 使用指南(中英双语)。
 *
 * 不联网、不调 LLM、不跑翻译管线 —— 课程定义内联在 `scripts/build-guide-seed.mjs`,
 * 构建期导出为 `src/main/assets/seed-course.json`,启动时直接 insert,瞬时完成,离线可用。
 * v11 起双语:原文 zh-CN + 内置 en 翻译(→ 地图标题卡 🌐 切换器开箱即可演示)。
 *
 * 灌入逻辑在 seed-apply.ts(db 注入式,verify 可直测);本文件只负责定位 JSON + 委托。
 *
 * 幂等:已存在且版本号匹配 → 跳过。版本号 bump 触发重建(删旧 + 重灌)。
 *
 * 为什么用 readFileSync 而非 ?raw:JSON 文件较大,且 vite-plugin-electron
 * 的 rollup 子构建对 .json?raw 解析不稳定(schema.sql?raw 能解析是因为 sql 后缀
 * 被当 unknown asset,而 .json 被 json 插件拦截)。运行时读文件最稳,dev 和打包
 * 后路径都可靠(主进程 CJS 的 __dirname 在两种场景都指向 dist-electron/main/)。
 */
import { getDb, markDirty } from "../db/index.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applySeedData, type SeedData } from "./seed-apply.js";

/**
 * 解析内置 JSON 路径。
 *
 * - dev:__dirname = <projectRoot>/dist-electron/main 或 src/main(取决于 vite 缓存)
 * - prod(打包):__dirname = <app>/resources/app/dist-electron/main
 * - tsx 脚本(verify/self-test 走 tsx):__dirname = src/main/services
 *
 * JSON 源文件在 src/main/assets/,无论从哪个 __dirname 出发,
 * 都向上找直到定位 src/main/assets/seed-course.json。
 */
function loadSeedData(): SeedData {
  const fileName = "seed-course.json";
  const candidates = [
    // tsx 直跑(verify 脚本):__dirname = .../src/main/services
    join(__dirname, "..", "assets", fileName),
    // dev/prod vite 构建:__dirname = .../dist-electron/main → 项目根 → src/main/assets
    join(__dirname, "..", "..", "src", "main", "assets", fileName),
    // 打包后:__dirname 在 resources/app/dist-electron/main → 需把 assets 复制到 dist
    join(__dirname, "assets", fileName),
  ];
  // ESM __dirname 兜底(主进程是 CJS,但有 tsx 直跑场景)
  let lastErr: unknown = null;
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      lastErr = e;
    }
  }
  // 最后兜底:用 import.meta.url(ESM 路径)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "assets", fileName), "utf8"));
  } catch {
    // fallthrough
  }
  throw new Error(
    `seed-course.json 未找到,试过: ${candidates.join(", ")} — 请运行 npx tsx scripts/build-guide-seed.mjs 重新生成。lastErr=${String(lastErr)}`,
  );
}

const SEED_DATA: SeedData = loadSeedData();
// 种子版本号:bump 触发重建(删旧课程 + 重新灌入)。
// 改这里的同时应重新跑 build-guide-seed.mjs 更新 JSON 内容。
// v11:课程双语化(原文 zh-CN + 内置 en 翻译,🌐 切换器随之出现)。
const SEED_VERSION = 11;

/**
 * 幂等灌入内置种子课程。同步、离线、瞬时。
 * 已存在且 version 匹配 → 跳过。
 */
export function ensureSeedCourse(): void {
  const result = applySeedData(getDb(), SEED_DATA, SEED_VERSION);
  if (!result.skipped) markDirty();
}
