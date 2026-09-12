import { createServer } from "node:http";
const UP = "https://api.z.ai/api/coding/paas/v4";
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  let summary = "(非JSON)";
  try {
    const j = JSON.parse(body.toString("utf8"));
    const imgLens = [];
    for (const m of j.messages ?? []) {
      if (Array.isArray(m.content)) for (const p of m.content)
        if (p.type === "image_url") imgLens.push(String(p.image_url?.url ?? "").length);
    }
    summary = JSON.stringify({
      model: j.model, max_tokens: j.max_tokens, stream: j.stream,
      thinking: j.thinking, reasoning_effort: j.reasoning_effort,
      msgCount: j.messages?.length, imageDataUrlLens: imgLens,
    });
  } catch {}
  console.log(`\n===> [${new Date().toLocaleTimeString()}] App请求 ${req.method} ${req.url}\n    ${summary}`);
  try {
    const r = await fetch(UP + req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: req.headers.authorization ?? "" },
      body: body.length ? body : undefined,
    });
    const rb = Buffer.from(await r.arrayBuffer());
    console.log(`<=== 端点响应 ${r.status}\n    ${rb.toString("utf8").slice(0, 600).replace(/\n/g, " ")}`);
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/json" });
    res.end(rb);
  } catch (e) {
    console.log(`<=== 转发失败: ${e.message}`);
    res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
  }
}).listen(9099, "127.0.0.1", () => console.log("代理就绪 :9099 -> api.z.ai/coding"));
