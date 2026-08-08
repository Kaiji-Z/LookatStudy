/**
 * live-test 共享:把项目根的 .env 加载进 process.env(供 readApiKey 读到)。
 *
 * 为什么需要这个:live-test 是独立 tsx 脚本,不走 Electron 主进程,
 * 所以 index.ts 里的 loadEnv() 对它们不生效。本文件复刻最小 .env 解析逻辑,
 * 让 .env 里的 Z_AI_API_KEY 能被 live-test 的 readApiKey() 读到。
 *
 * 不覆盖已存在的 process.env(环境变量优先级更高)。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const envPath = join(ROOT, ".env");

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
