import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const __dirname = realpathSync(dirname(fileURLToPath(import.meta.url)));
// Windows 双盘 junction 修复:本机 C:\Users\kaiji 是 junction → d:\users\kaiji(真实路径)。
// vite 6.4.3 deps optimizer 在 cwd(C 盘)与 realpath(D 盘)盘符/大小写不一致时,
// esbuildOutputFromId case-sensitive 比较失败 → react 等基础 dep 预构建崩溃
// ("Cannot read properties of undefined (reading 'imports')",dev server 起不来)。
// chdir 到 realpath,让全进程路径形式统一(D 盘),消除 C/D 不一致。
// 无 junction 的机器 realpath===cwd,chdir 是 no-op,无副作用。
try { process.chdir(realpathSync(process.cwd())); } catch { /* 非 junction 或无权限,忽略 */ }

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, "src/main/index.ts"),
        // 关键：传 onstart 才能阻止 vite-plugin-electron 自动拉起 electron。
        // 否则它会自己启动一个实例，加上 dev:electron:wait 又启动一个 = 双窗口。
        // 这里我们不需要它代我们启动（启动交给 dev:electron:wait 的 `electron .`），
        // 但主进程改动后希望它重启——通过自己 spawn 实现。
        onstart() {
          // 空实现：仅用于抑制 plugin 的自动启动。
          // 主进程热重载由 dev:electron:wait 退出后 concurrently 触发，或手动重启。
        },
        vite: {
          resolve: {
            // 主进程也能 import @shared/types 的值(不只 type)。与 renderer 别名一致。
            alias: {
              "@shared": resolve(__dirname, "shared"),
            },
          },
          build: {
            outDir: resolve(__dirname, "dist-electron/main"),
            rollupOptions: {
              // sql.js 用 require.resolve 运行时定位 wasm，不能被 bundle
              // pdf-parse 内部用 require 动态加载,external 避免打包冲突
              external: ["sql.js", "drizzle-orm/sql-js", "electron", "pdf-parse"],
              output: {
                format: "cjs", // CJS 让 __dirname 天然可用，避免 ESM 路径坑
              },
              // 把内置种子课程 JSON 作为静态资源 emit 到 dist-electron/main/assets/,
              // 让运行时 readFileSync(join(__dirname, "assets", ...)) 能定位。
              // seed.ts 的 loadSeedData() 会在多个候选路径里找到它。
              plugins: [
                {
                  name: "emit-seed-course-json",
                  generateBundle() {
                    const jsonPath = resolve(__dirname, "src/main/assets/seed-course.json");
                    const fs = require("node:fs");
                    if (fs.existsSync(jsonPath)) {
                      this.emitFile({
                        type: "asset",
                        fileName: "assets/seed-course.json",
                        source: fs.readFileSync(jsonPath, "utf8"),
                      });
                    }
                  },
                },
              ],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, "src/preload/index.ts"),
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: resolve(__dirname, "dist-electron/preload"),
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
              },
            },
          },
        },
      },
    ]),
  ],
  // main/preload 走 electron 自己构建（vite-plugin-electron 在生产时帮忙），
  // 这里只配置 renderer。
  // root 必须用 __dirname 绝对路径：相对值会按 process.cwd() 解析，
  // 而 Windows 双盘映射 (C:\Users\... vs D:\users\...) 的大小写差异会让
  // Vite 6 的 case-sensitive 路径检查误报 "Failed to load /main.tsx"。
  root: resolve(__dirname, "src/renderer"),
  base: "./", // Electron file:// 加载需要相对路径
  resolve: {
    // preserveSymlinks: 本机 C:\Users\kaiji 是 junction → d:\users\kaiji(双盘映射)。
    // 默认 false 时 vite 会 realpathSync 到 D 盘,与 C 盘 cwd 大小写不一致 → vite 6.4.3
    // deps optimizer 的 esbuildOutputFromId case-sensitive 比较失败 → "Cannot read
    // properties of undefined (reading 'imports')" 崩溃(react 等基础 dep 都中招)。
    // 设 true 让 vite 保持调用路径(C 盘),不 follow junction,路径形式全局一致。
    preserveSymlinks: true,
    alias: {
      "@shared": resolve(__dirname, "shared"),
      "@renderer": resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  // mermaid v11 是大型纯 ESM 包(含 d3/cytoscape/elkjs/dagre 等子依赖)。
  // dev 模式下 dynamic import 一个未预构建的 ESM 包会因内部 bare import 解析失败 → 渲染报错。
  // 显式 include 让 vite 预转换为浏览器可用的 ESM。生产 build 不受影响(rollup 会处理)。
  // esbuildOptions.preserveSymlinks: 与上层 resolve.preserveSymlinks 同理,让 optimizer 的
  // esbuild 也保持 C 盘路径,不 follow 双盘 junction(否则 case-sensitive 比较失败崩溃)。
  optimizeDeps: {
    include: ["mermaid"],
    esbuildOptions: { preserveSymlinks: true },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
