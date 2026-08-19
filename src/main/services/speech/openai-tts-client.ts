/**
 * OpenAI 兼容 TTS 客户端(v0.15)—— 自定义朗读 provider 的合成通道。
 *
 * POST {baseUrl}/audio/speech,body {model, input, voice?, response_format:"mp3"},
 * Bearer 鉴权,返回 mp3 字节。OpenAI / Groq(playai)/ SiliconFlow / 阿里百炼兼容
 * 模式等都暴露这个端点形状。失败抛错带状态码(调用方转 toast/文案)。
 */

/** baseUrl + 相对路径,容忍用户填带/不带尾斜杠 */
export function openaiTtsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/speech`;
}

export async function synthesizeOpenaiTts(
  opts: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    /** 可空 = 端点默认音色(部分实现必填,交给服务端报错引导) */
    voice: string | null;
    text: string;
    speed?: "slow" | "normal" | "fast";
  },
  timeoutMs = 30_000,
): Promise<Buffer> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const body: Record<string, unknown> = {
    model: opts.model,
    input: opts.text,
    response_format: "mp3",
  };
  if (opts.voice) body.voice = opts.voice;
  if (opts.speed && opts.speed !== "normal") body.speed = opts.speed;
  const res = await fetch(openaiTtsUrl(opts.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`tts HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("tts empty response");
  return buf;
}
