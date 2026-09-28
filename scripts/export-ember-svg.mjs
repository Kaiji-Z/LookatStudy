// 把项目里默认伴学形态(小焰 Ember)的真实 SVG 渲染成静态资源,供落地页(site/)使用。
//   npx tsx scripts/export-ember-svg.mjs
// 直接复用 src/renderer/components/companion/forms/ember.tsx 的组件真身——
// 落地页上的机器人就是 app 里那只,不是重绘版。refs 用 Proxy 空实现(静态渲染无交互)。

import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createElement } from "react";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// EmberArt 直接从源文件 import(EmberArt 具名导出):
// 相对说明符交给 tsx loader 解析 .tsx;Windows 上不能用盘符绝对路径动态 import。
const { EmberArt } = await import("../src/renderer/components/companion/forms/ember.tsx");

// refs:任何 key 都给 {current:null}(renderToStaticMarkup 本就忽略 ref,防 undefined 解引用)
const refs = new Proxy({}, { get: () => ({ current: null }) });

const markup = renderToStaticMarkup(
  createElement(EmberArt, {
    uid: "hero-ember",
    refs,
    expression: "happy",
    viseme: "closed",
    openScale: 1,
    energyRatio: 0.42,
    streakLit: false,
  }),
);

// 尾焰呼吸 + 天线辉光脉冲(SVG 内部 <style>,经 <img> 引用也生效)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<style>
  .cp-thrust { animation: hero-thrust 1.5s ease-in-out infinite; transform-origin: 100px 173px; }
  @keyframes hero-thrust { 0%,100% { transform: scaleY(1); opacity: .85; } 50% { transform: scaleY(1.4); opacity: 1; } }
  .cp-ant-glow { animation: hero-ant 2.4s ease-in-out infinite; }
  @keyframes hero-ant { 0%,100% { opacity: .12; } 50% { opacity: .38; } }
</style>
${markup}
</svg>`;

const out = join(repoRoot, "site", "ember.svg");
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);
