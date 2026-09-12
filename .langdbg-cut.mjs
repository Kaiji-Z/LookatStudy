import { readFileSync } from "node:fs";
const token = readFileSync(".langdbg-data/serve-token", "utf8").trim();
const png = readFileSync("D:/QQfile/MobileFile/1789128776044.png");
console.log("图:", png.length, "bytes");
const ws = new WebSocket(`ws://127.0.0.1:17891/?token=${token}`);
const t0 = Date.now();
ws.onopen = () => {
  ws.send(JSON.stringify({ v: 1, type: "req", id: "c1", channel: "companionPack:cutFromImage", args: [{ pngBase64: png.toString("base64") }] }));
  console.log("已发 cutFromImage,等待…");
};
ws.onmessage = (ev) => {
  const f = JSON.parse(ev.data);
  if (f.type !== "res" || f.id !== "c1") return;
  const s = Date.now() - t0;
  if (f.ok) {
    const r = f.result;
    console.log(`✓ ${s}ms route=${r.route} parts=${r.parts?.length} visionError=${r.visionError ?? "(无)"}`);
    if (r.manifest) console.log("manifest.parts:", Object.keys(r.manifest.parts ?? r.manifest).slice(0, 8).join(","));
  } else console.log(`✗ ${s}ms error:`, f.error);
  process.exit(0);
};
ws.onerror = (e) => { console.log("WS错误:", e.message ?? e); process.exit(1); };
setTimeout(() => { console.log(`超时(${Date.now() - t0}ms)未收到响应`); process.exit(2); }, 240000);
