/**
 * build-mobile —— 产出手机/无头部署的便携束到 dist/mobile/:
 *
 *   server.cjs        无头服务端(esbuild 单文件束,零 npm install 即可 `node server.cjs`)
 *   sql-wasm.wasm     sql.js 的 WASM(server.cjs 同目录运行时加载)
 *   web/              渲染层静态产物(复用 vite build 的 dist/)
 *   install-termux.sh Termux 一键安装/启动脚本
 *
 * 跑法: npm run build:mobile (内部先跑 vite build 保证 dist/ 新鲜)
 */
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServerBundle } from "./lib/build-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TERMUX_SCRIPT = `#!/data/data/com.termux/files/usr/bin/bash
# LookatStudy Termux 引导脚本 —— 在 Termux 里直接运行:
#   bash install-termux.sh          # 首次安装 + 启动
#   bash install-termux.sh --start  # 之后启动(跳过依赖检查)
set -e

PORT="\${LOOKATSTUDY_PORT:-17890}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$1" != "--start" ]; then
  echo "==> 安装 Node.js(如未装)"
  command -v node >/dev/null 2>&1 || pkg install -y nodejs

  echo "==> Termux 保活(通知栏出现锁图标;电池优化里给 Termux 放行更稳)"
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
fi

echo "==> 启动 LookatStudy (端口 $PORT)"
cd "$HERE"
exec node server.cjs --port "$PORT" --web "$HERE/web" --data "$HOME/.lookatstudy"
`;

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

// ── 6. Termux 安装脚本 ──
writeFileSync(join(OUT, "install-termux.sh"), TERMUX_SCRIPT, "utf8");

// ── 7. 便携束说明 ──
writeFileSync(
  join(OUT, "README.txt"),
  [
    "LookatStudy mobile bundle",
    "",
    "Requirements: Node.js >= 18 (Termux: pkg install nodejs)",
    "",
    "Start:  node server.cjs",
    `        (defaults: port 17890, data ~/.lookatstudy, web ./web)`,
    "Open:   the URL printed on startup (contains the auth token)",
    "",
    "Files:",
    "  server.cjs        headless server (bundled, zero npm install)",
    "  sql-wasm.wasm     SQLite WASM",
    "  web/              renderer static build",
    "  install-termux.sh Termux bootstrap helper",
    "",
  ].join("\n"),
  "utf8",
);

if (!existsSync(join(OUT, "server.cjs"))) throw new Error("server.cjs missing after build");
if (!existsSync(join(OUT, "web/index.html"))) throw new Error("web/index.html missing after build");
console.log(`\n[mobile] bundle ready: dist/mobile (${(readFileSync(join(OUT, "server.cjs")).length / 1024).toFixed(0)} KB server)`);
