/**
 * serve-dev —— 桌面上的无头 serve 开发入口。
 * 只 esbuild 服务端束(~1s,不重跑 vite build;渲染层用现有 dist/,没有则先建),
 * 然后 spawn node dist/.serve-dev/server.cjs。Ctrl+C 透传。
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServerBundle } from "./lib/build-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "dist/.serve-dev");

if (!existsSync(join(ROOT, "dist/renderer/index.html"))) {
  console.log("[serve-dev] dist/renderer/ missing → vite build first");
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });
}

mkdirSync(OUT, { recursive: true });
await buildServerBundle(join(OUT, "server.cjs"), { quiet: true });


// --data 必须始终注入默认 .serve-data(一次性目录)——曾因"传了任意参数就整体换掉默认 argv"
// 使 --port 一带就静默落回 server 自身的持久默认 ~/.lookatstudy,测试数据污染真实目录
const passthrough = process.argv.slice(2);
const hasData = passthrough.some((a, i) => a === "--data" || passthrough[i - 1] === "--data");
const argv = hasData ? passthrough : ["--data", join(ROOT, ".serve-data"), ...passthrough];
const r = spawnSync(process.execPath, [join(OUT, "server.cjs"), "--web", join(ROOT, "dist/renderer"), ...argv.filter((a, i, arr) => !(a === "--web" || arr[i - 1] === "--web"))], { stdio: "inherit" });
process.exit(r.status ?? 0);
