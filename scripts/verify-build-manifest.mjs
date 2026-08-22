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

// 急载边界 = HTML 显式引用的资产(script src / modulepreload / css link)。
// 不能按文件名猜入口:index-*.js 也可能是懒 chunk(实测 markmap 的 globalCSS
// 落在名为 index-*.js 的懒 chunk 里),猜错会把懒 chunk 当主束误报。
function eagerAssets() {
  const names = new Set();
  const rendererDir = join(assetsDir, "..");
  for (const html of readdirSync(rendererDir).filter((f) => f.endsWith(".html"))) {
    const src = readFileSync(join(rendererDir, html), "utf8");
    for (const m of src.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)) {
      names.add((m[1] ?? "").replace(/^assets\//, ""));
    }
  }
  return [...names];
}

// ---------------------------------------------------------------- T1 主束零污染
{
  const eager = eagerAssets().filter((f) => f.endsWith(".js"));
  assert.ok(eager.length >= 1, "T1 从 HTML 解析到急载 JS");
  // 库级特征串(只在该库的代码里出现;不能用文件名/函数名字符串——懒 import 的
  // 路径引用与调用点胶水代码本来就在主束里,是合法的)
  const markers = [
    ["elkjs", "org.eclipse.elk"],
    ["shiki", "ShikiError"],
    ["mermaid", "DOMPurify"],
    ["markmap", "markmap-foreign"],
  ];
  for (const f of eager) {
    const src = readFileSync(join(assetsDir, f), "utf8");
    for (const [label, marker] of markers) {
      assert.ok(!src.includes(marker), `T1 急载 ${f} 不得内联 ${label}(marker: ${marker})`);
    }
  }
  console.log(`T1 主束零污染(急载 ${eager.length} 个 JS 无 elkjs/shiki/mermaid/markmap)✓`);
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

// ---------------------------------------------------------------- T4 markmap 懒 chunk
{
  // markmap-view 的 globalCSS 特征串必须存在(懒加载接线活着),且不在急载集里(T1 已断言)
  const lazyHit = files.some(
    (f) => f.endsWith(".js") && readFileSync(join(assetsDir, f), "utf8").includes("markmap-foreign"),
  );
  assert.ok(lazyHit, "T4 markmap 懒 chunk 在场(globalCSS 特征串)");
  console.log("T4 markmap 懒 chunk 在场✓");
}

console.log("verify-build-manifest: 4 组全部通过");
