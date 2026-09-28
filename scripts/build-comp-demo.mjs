// 打包落地页屏5伴学:site-src/comp-entry.tsx → site/comp-demo.js
// (IIFE,挂 window.CompDemo;内联 react + app 真 Mascot 组件树)
//   node scripts/build-comp-demo.mjs

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(repoRoot, "site-src", "comp-entry.tsx")],
  outfile: join(repoRoot, "site", "comp-demo.js"),
  bundle: true,
  format: "iife",
  target: "es2019",
  minify: true,
  globalName: "CompDemoMount",
  jsx: "automatic",
  alias: { "@shared": join(repoRoot, "shared") },
  logLevel: "info",
});
