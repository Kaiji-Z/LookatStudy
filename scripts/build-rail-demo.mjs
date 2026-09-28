// 打包落地页左栏物理桥接:site-src/rail-entry.ts → site/rail-demo.js
// (IIFE,挂 window.RailDemo;内联 matter-js + mapPhysics + mapLayout + skyCanvas 真身)
//   node scripts/build-rail-demo.mjs

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(repoRoot, "site-src", "rail-entry.ts")],
  outfile: join(repoRoot, "site", "rail-demo.js"),
  bundle: true,
  format: "iife",
  target: "es2019",
  minify: true,
  globalName: "RailDemo",
  logLevel: "info",
});
