/**
 * Live test: 切分线协议识图切分(真实 VLM,glm-5.3-flash,SPEC §17)。
 *
 * 跑法: npx tsx scripts/live-test/live-test-companion-cut.mjs
 *
 * 链路与生产一致:键控 → 键控预览(深灰底)→ VLM 声明切分线(背景到背景的
 * 折线,粘连臂给 null)→ parseCutsJson → routeCut(栅栏 BFS 划分)。
 *
 * 两个场景:
 *   1. apose-bear.png(有颈人形熊)→ route=vision 且 头+身+至少一臂;
 *   2. tpose-bear.png(无脖子非人形熊)→ route=vision 且 独立头件在场(弧线切头)。
 * fixture 或 API key 缺失 → 自动 SKIP(退出 0)。
 */
import { readApiKey } from "./_load-env.mjs";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadImage, createCanvas, ImageData } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { keyFigure, composeKeyedPreview, parseCutsJson, routeCut } = await import("../../shared/companion-cut.ts");

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("skip: no API key configured");
  process.exit(0);
}

function loadImageRgba(p) {
  return (async () => {
    const img = await loadImage(p);
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  })();
}

/** 生产同款键控预览 data URL:深灰底上的角色,与机器掩码逐像素同源。 */
async function keyedPreviewDataUrl(img) {
  const fm = keyFigure(img);
  const prev = composeKeyedPreview(img, fm);
  const cv = createCanvas(prev.width, prev.height);
  cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(prev.data), prev.width, prev.height), 0, 0);
  const png = new Uint8Array(await cv.encode("png"));
  return { fm, dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}` };
}

function locatePrompt(W, H) {
  return [
    `你是纸偶动画的部件切分师。深灰色背景上是刚抠好的Q版角色立绘(画布 ${W}x${H} 像素)。`,
    `请在角色身上画出把身体分开的切分线。只输出一个 JSON 对象,格式:`,
    `{"cuts": {"headBody": [[x,y],...], "armLeft": [[x,y],...] 或 null, "armRight": [[x,y],...] 或 null}}`,
    `headBody:沿头部最底缘(兜帽/下巴的弧线,不是衣领口)从角色左侧的灰色背景出发,`,
    `  经过头与身体的分界,到达右侧背景结束,取 8~16 个点。头部含头发/耳朵/头饰/兜帽。`,
    `armLeft/armRight:沿手臂与躯干之间的缝隙走线——从手臂上方(肩外侧)的背景出发,`,
    `  贴着手臂与躯干的分界向下,到手臂下方(手外侧)的背景结束,把整条手臂(含袖子)从躯干分开。`,
    `  手臂与躯干完全粘连、找不到这样的缝时,该臂给 null。armLeft=画面左侧的手臂(观察者视角)。`,
    `所有坐标用 0~1 小数(相对原图宽高),点按线的走向顺序排列。`,
    `每条线的起点和终点都必须在没有像素的灰色背景上。不要输出其他文字。`,
  ].join("\n");
}

async function askVlm(prompt, dataUrl) {
  // 到 api.z.ai 的链路抖动(实测同一 key 分钟级间歇 fetch failed),三次退避重试
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: "glm-5.3-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
      const data = await resp.json();
      return String(data.choices?.[0]?.message?.content ?? "");
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw lastErr;
}

let failed = 0;

async function runScenario(name, fixture, expect) {
  if (!existsSync(fixture)) {
    console.log(`skip: fixture 缺失(${fixture})`);
    return;
  }
  console.log(`\n[${name}] ${path.basename(fixture)} ...`);
  try {
    const img = await loadImageRgba(fixture);
    const { fm, dataUrl } = await keyedPreviewDataUrl(img);
    const raw = await askVlm(locatePrompt(img.width, img.height), dataUrl);
    console.log("VLM 原文(前 400 字):", raw.slice(0, 400));
    const cuts = parseCutsJson(raw, img.width, img.height);
    if (!cuts) throw new Error("切分线解析失败(输出不含 cuts JSON)");
    if (!cuts.headBody) throw new Error("VLM 未给出 headBody 切分线");
    console.log(
      `cuts: headBody=${cuts.headBody.length}点 armLeft=${cuts.armLeft?.length ?? "null"} armRight=${cuts.armRight?.length ?? "null"}`,
    );
    const r = routeCut(img, { cuts });
    console.log(`route=${r.route} accepted=${JSON.stringify(r.debug.accepted)} parts=${r.parts.map((p) => `${p.name}(${p.box.w}x${p.box.h})`).join(", ")}`);
    expect(r, cuts);
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log("FAIL:", String(e.message ?? e));
  }
}

await runScenario("1 A-pose 熊:头+身+至少一臂", path.join(__dirname, "../../.goal/fixtures/apose-bear.png"), (r) => {
  if (r.route !== "vision") throw new Error(`route=${r.route}`);
  const names = r.parts.map((p) => p.name);
  if (!names.includes("head") || !names.includes("body")) throw new Error(`缺头/身: ${names.join(",")}`);
  if (!names.includes("armL") && !names.includes("armR")) throw new Error(`双臂全缺席: ${names.join(",")}`);
});

await runScenario("2 无颈 T-pose 熊:弧线切头独立头件", path.join(__dirname, "../../.goal/fixtures/tpose-bear.png"), (r) => {
  if (r.route !== "vision") throw new Error(`route=${r.route}`);
  const head = r.parts.find((p) => p.name === "head");
  const body = r.parts.find((p) => p.name === "body");
  if (!head || !body) throw new Error(`缺头/身: ${r.parts.map((p) => p.name).join(",")}`);
  if (head.box.y >= body.box.y) throw new Error("头应在身体上方");
});

if (failed > 0) {
  console.log(`\nFAIL: ${failed} 个场景未过`);
  process.exit(1);
}
console.log("\nPASS: 全部场景通过");
process.exit(0);
