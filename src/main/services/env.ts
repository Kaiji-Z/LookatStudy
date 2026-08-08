/**
 * 轻量 .env 加载器(零依赖)。
 *
 * 为什么不用 dotenv:主进程是 CJS + vite-plugin-electron 打包,引入 dotenv 会增加
 * 一个不必要的依赖。手写一个最小解析器(KEY=VALUE,忽略 # 注释和空行)即可。
 *
 * 用法:在主进程启动时调 loadEnv(),它会读项目根的 .env 并把变量挂到 process.env
 * (不覆盖已存在的 process.env 值——已设置的环境变量优先级更高)。
 *
 * 文件不存在时静默跳过(.env 是可选的开发环境文件,已 gitignore)。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

/** 解析 .env 文本为 key-value 对象。纯函数,便于测试。 */
export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue; // 没等号 或 key 为空
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // 去掉两端引号(支持 KEY="value" 和 KEY='value')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * 读项目根的 .env 并挂到 process.env。幂等(只加载一次)。
 * 不覆盖已存在的 process.env 值(环境变量优先)。
 * @param root 项目根目录(默认用调用方上溯找 package.json)
 */
export function loadEnv(root?: string): void {
  if (loaded) return;
  loaded = true;

  const envPath = root ? join(root, ".env") : findProjectRoot() + "/.env";
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  const parsed = parseEnvText(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 从本文件位置上溯找项目根(含 package.json 的目录)。 */
function findProjectRoot(): string {
  // 主进程编译后位于 dist-electron/main/,项目根在 ../../.. 处。
  // 用 __dirname(CJS)上溯找 package.json。
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = join(dir, "..");
  }
  return process.cwd();
}

/** 便捷读取:拿 ZAI 配置(供 ui-test seed / live-test 用)。读不到返回 null。
 * 变量名 Z_AI_API_KEY 与 live-test 既有约定对齐。 */
export function getZaiConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.Z_AI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.Z_AI_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4",
    model: process.env.Z_AI_MODEL ?? "glm-4.5",
  };
}
