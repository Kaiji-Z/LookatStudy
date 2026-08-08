import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
          build: {
            outDir: resolve(__dirname, "dist-electron/main"),
            rollupOptions: {
              // sql.js 用 require.resolve 运行时定位 wasm，不能被 bundle
              external: ["sql.js", "drizzle-orm/sql-js", "electron"],
              output: {
                format: "cjs", // CJS 让 __dirname 天然可用，避免 ESM 路径坑
              },
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
    alias: {
      "@shared": resolve(__dirname, "shared"),
      "@renderer": resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
