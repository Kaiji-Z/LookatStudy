/**
 * 云端听写客户端 —— OpenAI 兼容 /audio/transcriptions(Groq/自定义 provider)+ Azure Speech。
 *
 * 输入统一是渲染层录好的 WAV(16kHz 单声道 PCM);结果统一 {text}。
 * 失败抛错带状态码(调用方转结构化 reason / toast)。
 */

export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

export function groqTranscribeUrl(): string {
  return "https://api.groq.com/openai/v1/audio/transcriptions";
}

export function openaiTranscribeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

export function azureSttUrl(region: string, language: string): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`;
}

/**
 * OpenAI 兼容转写(v0.15 自定义听写 provider 主通道;Groq 是它的固定参特例)。
 * language 是 BCP-47("zh-CN");免费层限 25MB/请求,听写远够。
 */
export async function openaiTranscribe(
  opts: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    wav: ArrayBuffer;
    language: string;
  },
  timeoutMs = 30_000,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([opts.wav], { type: "audio/wav" }), "dictation.wav");
  form.append("model", opts.model);
  form.append("language", opts.language);
  form.append("response_format", "json");
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(openaiTranscribeUrl(opts.baseUrl), {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`asr HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
}

/** Groq whisper-large-v3-turbo(旧库 asr_engine="groq" 的遗留路径)。 */
export async function groqTranscribe(
  key: string,
  wav: ArrayBuffer,
  language: string,
  timeoutMs = 30_000,
): Promise<string> {
  return openaiTranscribe(
    { baseUrl: "https://api.groq.com/openai/v1", apiKey: key, model: GROQ_TRANSCRIBE_MODEL, wav, language },
    timeoutMs,
  );
}

/** Azure STT 短音频 REST 端点(整段 ≤15s 佳,听写场景匹配;F0 免费 5h/月)。 */
export async function azureSttTranscribe(
  key: string,
  region: string,
  wav: ArrayBuffer,
  language: string,
  timeoutMs = 30_000,
): Promise<string> {
  const res = await fetch(azureSttUrl(region, language), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: wav,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`azure asr HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const j = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
  if (j.RecognitionStatus && j.RecognitionStatus !== "Success" && j.RecognitionStatus !== "NoMatch") {
    throw new Error(`azure asr ${j.RecognitionStatus}`);
  }
  return (j.DisplayText ?? "").trim();
}
