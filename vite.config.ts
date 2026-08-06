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
  // 这里只配置 renderer
  root: "src/renderer",
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
    port: 5173,
    strictPort: true,
  },
});
