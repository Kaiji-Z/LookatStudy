/**
 * Live test: T1 识图定位切分(真实 VLM,GETM/GLM 兼容端点)。
 *
 * 跑法: npx tsx scripts/live-test/live-test-companion-cut.mjs
 *
 * 流程: 读 .goal/fixtures/apose-bear.png(本地 fixture,git 排除;缺失自动 SKIP)
 *   → raw chat/completions 带图请求锚点 JSON → parseAnchorsJson → routeCut
 *   → 断言 route=vision 且 ≥3 部件。
 * 无 API key → 自动 SKIP(退出 0)。
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

const fixture = path.join(__dirname, "../../.goal/fixtures/apose-bear.png");
if (!existsSync(fixture)) {
  console.log("skip: fixture 缺失(.goal/fixtures/apose-bear.png)——先跑 cut-figure 冒烟或手动放置");
  process.exit(0);
}

const base64 = readFileSync(fixture).toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;
const prompt = [
  "你是图像部件定位器。图中是一个Q版角色的站姿立绘。",
  '只输出一个 JSON 对象,格式:',
  '{"headY": <头与身体分界的y像素>, "boxes": {"head": [x,y,w,h], "armL": [x,y,w,h], "armR": [x,y,w,h]}}',
  "headY=头部最底端与身体交界处的 y 坐标;armL=画面左侧手臂(肩到指尖)最小外接矩形;armR=右侧手臂;head=头部最小外接矩形。",
  "坐标用整数像素。armL/armR 不得包含躯干。不要输出其他文字。",
].join("\n");

console.log("请求 VLM 定位...");
const resp = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({
    model: "glm-4.5v",
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
if (!resp.ok) {
  console.log(`FAIL: VLM HTTP ${resp.status}`);
  process.exit(1);
}
const data = await resp.json();
const raw = data.choices?.[0]?.message?.content ?? "";
console.log("VLM 原文(前 300 字):", String(raw).slice(0, 300));

const img = await loadImage(fixture);
const cv = createCanvas(img.width, img.height);
cv.getContext("2d").drawImage(img, 0, 0);
const rgba = {
  width: img.width,
  height: img.height,
  data: cv.getContext("2d").getImageData(0, 0, img.width, img.height).data,
};

const anchors = parseAnchorsJson(String(raw), img.width, img.height);
if (!anchors) {
  console.log("FAIL: VLM 输出无法解析为锚点");
  process.exit(1);
}
console.log("锚点:", JSON.stringify(anchors));

const r = routeCut(rgba, { anchors });
console.log(`route=${r.route} parts=${r.parts.map((p) => `${p.name}(${p.box.w}x${p.box.h})`).join(", ")}`);
if (r.route === "vision" && r.parts.length >= 3) {
  console.log("PASS: T1 识图定位切分成立");
  process.exit(0);
}
console.log("FAIL: 未达到 vision ≥3 件");
process.exit(1);
