/**
 * 无头服务端 esbuild 束的统一构建入口 —— build-mobile / serve-dev / verify-serve 共用,
 * 保证三处产物的 esbuild 配置(external/raw 插件/target)永不漂移。
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..", "..");

/** vite ?raw 语义(schema.sql 内容内联) */
const rawQueryPlugin = {
  name: "raw-query",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.replace("?raw", "")),
      namespace: "raw-file",
    }));
    b.onLoad({ filter: /.*/, namespace: "raw-file" }, (args) => ({
      contents: readFileSync(args.path, "utf8"),
      loader: "text",
    }));
  },
};

/**
 * @param {string} outfile 输出的 server.cjs 绝对路径
 * @param {{ quiet?: boolean }} opts
 */
export async function buildServerBundle(outfile, opts = {}) {
  await build({
    entryPoints: [join(ROOT, "src/main/serve/index.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile,
    // electron 只剩惰性 require 分支(serve 路径不执行);pdf-inspector 是 napi
    // 预编译(Android bionic 加载不了),运行时 require 失败走 pdf-parse fallback
    external: ["electron", "@firecrawl/pdf-inspector", "sherpa-onnx-node"],
    loader: { ".wasm": "file" },
    plugins: [rawQueryPlugin],
    logLevel: opts.quiet ? "silent" : "info",
  });
  // 便携束运行时伴生文件:sql.js WASM(db 初始化读)+ 种子课程(seed.ts 读取)
  const { copyFileSync } = await import("node:fs");
  const beside = (src) => copyFileSync(join(ROOT, src), join(dirname(outfile), src.split("/").pop()));
  beside("node_modules/sql.js/dist/sql-wasm.wasm");
  beside("src/main/assets/seed-course.json");
}
