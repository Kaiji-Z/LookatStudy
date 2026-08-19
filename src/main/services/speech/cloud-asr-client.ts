/**
 * 云端听写客户端(v0.13)—— Groq / Azure Speech 两家批式转写。
 *
 * 输入统一是渲染层录好的 WAV(16kHz 单声道 PCM);结果统一 {text}。
 * 失败抛错带状态码(调用方转结构化 reason / toast)。
 */

export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

export function groqTranscribeUrl(): string {
  return "https://api.groq.com/openai/v1/audio/transcriptions";
}

export function azureSttUrl(region: string, language: string): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`;
}

/** Groq whisper-large-v3-turbo。language 是 BCP-47("zh-CN");免费层限 25MB/请求,听写远够。 */
export async function groqTranscribe(
  key: string,
  wav: ArrayBuffer,
  language: string,
  timeoutMs = 30_000,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "dictation.wav");
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("language", language);
  form.append("response_format", "json");
  const res = await fetch(groqTranscribeUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`groq asr HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
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
