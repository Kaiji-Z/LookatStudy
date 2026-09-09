/**
 * Live test: T1 识图定位切分(真实 VLM,GETM/GLM 兼容端点,glm-5.3-flash)。
 *
 * 跑法: npx tsx scripts/live-test/live-test-companion-cut.mjs
 *
 * 两个场景(SPEC §16.6):
 *   1. apose-bear.png(有颈人形熊)+ bbox 锚点 prompt → route=vision ≥3 件;
 *   2. tpose-bear.png(无脖子非人形熊)+ headBoundary 折线 prompt → route=vision
 *      且独立头件在场(弧线切头,M2 判据 5)。
 * fixture 或 API key 缺失 → 自动 SKIP(退出 0)。
 */
import { readApiKey } from "./_load-env.mjs";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadImage, createCanvas } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parseAnchorsJson, routeCut } = await import("../../shared/companion-cut.ts");

const API_KEY = readApiKey();
if (!API_KEY) {
  console.log("skip: no API key configured");
  process.exit(0);
}

const base64Of = (p) => readFileSync(p).toString("base64");

function loadImageRgba(p) {
  return (async () => {
    const img = await loadImage(p);
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  })();
}

async function askVlm(prompt, dataUrl) {
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
}

const boxPrompt = [
  "你是图像部件定位器。图中是一个Q版角色的站姿立绘。",
  '只输出一个 JSON 对象,格式:',
  '{"headY": <头与身体分界的y像素>, "boxes": {"head": [x,y,w,h], "armL": [x,y,w,h], "armR": [x,y,w,h]}}',
  "headY=头部最底端与身体交界处的 y 坐标;armL=画面左侧手臂(肩到指尖)最小外接矩形;armR=右侧手臂;head=头部最小外接矩形。",
  "坐标用整数像素。armL/armR 不得包含躯干。不要输出其他文字。",
].join("\n");

const boundaryPrompt = [
  "你是图像部件定位器。图中是一个Q版角色的站姿立绘。",
  '只输出一个 JSON 对象,格式:',
  '{"headY": <y像素>, "boxes": {"head": [x,y,w,h], "armL": [x,y,w,h], "armR": [x,y,w,h]}, "headBoundary": [[x,y],...]}',
  "headY=头部最底端与身体交界处的 y;armL/armR=左右手臂(肩到指尖)最小外接矩形;head=头部最小外接矩形。",
  "headBoundary=仅当角色没有明显脖子(头直接坐在身体上,如熊/团子)时给出:沿头身交界线从左到右",
  "均匀取 8~16 个 [x,y] 点,坐标用 0~1 小数(相对原图宽高),首尾点到达头部左右边缘;有脖子则省略。",
  "armL/armR 不得包含躯干。不要输出其他文字。",
].join("\n");

let failed = 0;

/* ---- 场景 1:A-pose 熊,bbox 锚点(M1 回归) ---- */
{
  const fixture = path.join(__dirname, "../../.goal/fixtures/apose-bear.png");
  if (!existsSync(fixture)) {
    console.log("skip: fixture 缺失(.goal/fixtures/apose-bear.png)");
  } else {
    console.log("\n[1] A-pose 熊 bbox 锚点...");
    try {
      const raw = await askVlm(boxPrompt, `data:image/png;base64,${base64Of(fixture)}`);
      console.log("VLM 原文(前 300 字):", raw.slice(0, 300));
      const img = await loadImageRgba(fixture);
      const anchors = parseAnchorsJson(raw, img.width, img.height);
      if (!anchors) throw new Error("锚点解析失败");
      const r = routeCut(img, { anchors });
      console.log(`route=${r.route} parts=${r.parts.map((p) => `${p.name}(${p.box.w}x${p.box.h})`).join(", ")}`);
      if (r.route === "vision" && r.parts.length >= 3) console.log("PASS: 场景1 bbox 识图切分成立");
      else throw new Error(`route=${r.route} parts=${r.parts.length}`);
    } catch (e) {
      failed++;
      console.log("FAIL:", String(e.message ?? e));
    }
  }
}

/* ---- 场景 2(M2 判据 5):无颈 T-pose 熊,headBoundary 折线 → 独立头件 ---- */
{
  const fixture = path.join(__dirname, "../../.goal/fixtures/tpose-bear.png");
  if (!existsSync(fixture)) {
    console.log("skip: fixture 缺失(.goal/fixtures/tpose-bear.png)");
  } else {
    console.log("\n[2] 无颈 T-pose 熊 折线切头...");
    try {
      const raw = await askVlm(boundaryPrompt, `data:image/png;base64,${base64Of(fixture)}`);
      console.log("VLM 原文(前 300 字):", raw.slice(0, 300));
      const img = await loadImageRgba(fixture);
      const anchors = parseAnchorsJson(raw, img.width, img.height);
      if (!anchors) throw new Error("锚点解析失败");
      if (!anchors.headBoundary || anchors.headBoundary.length < 4) {
        throw new Error(`VLM 未给出可用折线(points=${anchors.headBoundary?.length ?? 0})`);
      }
      const r = routeCut(img, { anchors });
      const head = r.parts.find((p) => p.name === "head");
      console.log(
        `折线 ${anchors.headBoundary.length} 点;route=${r.route} parts=${r.parts.map((p) => `${p.name}(${p.box.w}x${p.box.h})`).join(", ")}`,
      );
      if (r.route === "vision" && r.parts.length >= 4 && head) {
        console.log("PASS: 场景2 折线弧线切头成立(独立头件在场)");
      } else {
        throw new Error(`route=${r.route} parts=${r.parts.length} head=${!!head}`);
      }
    } catch (e) {
      failed++;
      console.log("FAIL:", String(e.message ?? e));
    }
  }
}

if (failed > 0) {
  console.log(`\nFAIL: ${failed} 个场景未过`);
  process.exit(1);
}
console.log("\nPASS: 全部场景通过");
process.exit(0);
