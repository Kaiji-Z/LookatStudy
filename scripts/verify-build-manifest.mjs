/**
 * verify-build-manifest —— vite 产物清单断言(v0.21)。
 *
 * 断言的是「构建后的 dist/renderer/assets」:需要先 vite build。dist 不存在时
 * SKIP(exit 0)——verify:core 里链它防本地回归(本地常有 dist);CI 在
 * vite build 步骤之后显式再跑一次(见 ci.yml),两边都不漏。
 *
 * T1 主束零污染:index-*.js(入口 chunk)不得内联 elkjs/shiki/mermaid 代码
 *    (三者必须全是懒加载;主束咬进任何一家都是首屏回归)。
 * T2 elkjs 懒 chunk:概念图的 elk.bundled 恰好一份。注:@mermaid-js/layout-elk
 *    发布件内联自带 elkjs 0.9.3(无法去重,2026-08-22 用户知情拍板接受双份),
 *    本套不追"全 dist 只一份"——守的是主束零污染+我们自己不额外复制。
 * T3 shiki 懒 chunk:core+engine 独立 chunk 存在。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "renderer", "assets");
if (!existsSync(assetsDir)) {
  console.log("verify-build-manifest: SKIP(dist/renderer/assets 不存在,先 vite build;CI 在 build 后跑)");
  process.exit(0);
}
const files = readdirSync(assetsDir);

// ---------------------------------------------------------------- T1 主束零污染
{
  const entryChunks = files.filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
  assert.ok(entryChunks.length >= 1, "T1 找到入口 chunk");
  const markers = [
    ["elkjs", "elk.bundled"], // elkjs bundled 构建的特征串
    ["shiki", "createJavaScriptRegexEngine"],
    ["mermaid", "registerLayoutLoaders"],
  ];
  for (const f of entryChunks) {
    const src = readFileSync(join(assetsDir, f), "utf8");
    for (const [label, marker] of markers) {
      assert.ok(!src.includes(marker), `T1 主束 ${f} 不得内联 ${label}(marker: ${marker})`);
    }
  }
  console.log(`T1 主束零污染(入口 ${entryChunks.length} 个 chunk 无 elkjs/shiki/mermaid)✓`);
}

// ---------------------------------------------------------------- T2 elkjs 懒 chunk
{
  const elkChunks = files.filter((f) => /^elk\.bundled-[A-Za-z0-9_-]+\.js$/.test(f));
  assert.equal(elkChunks.length, 1, `T2 概念图 elkjs 懒 chunk 恰好一份(实得 ${elkChunks.join(", ") || "无"})`);
  console.log(`T2 elkjs 懒 chunk ×1(${elkChunks[0]})✓`);
}

// ---------------------------------------------------------------- T3 shiki 懒 chunk
{
  const hasCore = files.some((f) => /^core-[A-Za-z0-9_-]+\.js$/.test(f));
  const hasEngine = files.some((f) => /^engine-javascript-[A-Za-z0-9_-]+\.js$/.test(f));
  assert.ok(hasCore, "T3 shiki core 懒 chunk 存在");
  assert.ok(hasEngine, "T3 shiki JS 引擎懒 chunk 存在");
  console.log("T3 shiki 懒 chunk(core + engine-javascript)✓");
}

console.log("verify-build-manifest: 3 组全部通过");
