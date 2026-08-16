/**
 * build-mobile —— 产出手机/无头部署的便携束到 dist/mobile/:
 *
 *   server.cjs        无头服务端(esbuild 单文件束,零 npm install 即可 `node server.cjs`)
 *   sql-wasm.wasm     sql.js 的 WASM(server.cjs 同目录运行时加载)
 *   web/              渲染层静态产物(复用 vite build 的 dist/)
 *   install-termux.sh Termux 一键安装脚本(源文件 scripts/install-termux.sh,含镜像/依赖/保活优化)
 *
 * 跑法: npm run build:mobile (内部先跑 vite build 保证 dist/ 新鲜)
 */
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServerBundle } from "./lib/build-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "dist/mobile");

// ── 1. 渲染层(先进 vite build 保证新鲜) ──
execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });

// ── 2. 清空输出目录 ──
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── 3. 无头服务端束 ──
// electron 全部经惰性 require 分支(serve 路径不执行);标记 external 后
// 束里只留 require("electron") 字面量,Termux 下永不被调用。
// @firecrawl/pdf-inspector 是 napi 预编译包,Android 加载不了 —— external 掉,
// 运行时 require 失败由 lib/pdf-text.ts 的既有 fallback(pdf-parse)接管。
await buildServerBundle(join(OUT, "server.cjs"));


// ── 5. 渲染层静态产物 ──
// dist/mobile 在 dist/ 内,不能整目录自嵌套复制 —— 逐条目(排除 mobile/)
mkdirSync(join(OUT, "web"), { recursive: true });
for (const entry of readdirSync(join(ROOT, "dist", "renderer"))) {
  if (entry === "mobile") continue;
  cpSync(join(ROOT, "dist", "renderer", entry), join(OUT, "web", entry), { recursive: true });
}

// ── 6. Termux 安装脚本(源文件即真身:GitHub Release 还会单独发布它,
//       引导器的一行安装命令 curl 它执行;zip 里再带一份保持自包含) ──
cpSync(join(__dirname, "install-termux.sh"), join(OUT, "install-termux.sh"));

// ── 7. 便携束说明 ──
writeFileSync(
  join(OUT, "README.txt"),
  [
    "LookatStudy mobile bundle",
    "",
    "Requirements: Node.js >= 20 (Termux: bash install-termux.sh does everything)",
    "",
    "Termux one-shot install (China-mirror aware, autostart + battery setup):",
    "  bash install-termux.sh",
    "",
    "After install, helper scripts live in ~/lookatstudy:",
    "  start.sh / stop.sh / status.sh / update.sh",
    "",
    "Manual start (any platform):  node server.cjs",
    `        (defaults: port 17890, data ~/.lookatstudy, web ./web)`,
    "Open:   the URL printed on startup (contains the auth token)",
    "",
    "Files:",
    "  server.cjs        headless server (bundled, zero npm install)",
    "  sql-wasm.wasm     SQLite WASM",
    "  web/              renderer static build",
    "  install-termux.sh Termux installer (mirror/dep/keepalive optimizations)",
    "",
  ].join("\n"),
  "utf8",
);

if (!existsSync(join(OUT, "server.cjs"))) throw new Error("server.cjs missing after build");
if (!existsSync(join(OUT, "web/index.html"))) throw new Error("web/index.html missing after build");
console.log(`\n[mobile] bundle ready: dist/mobile (${(readFileSync(join(OUT, "server.cjs")).length / 1024).toFixed(0)} KB server)`);
