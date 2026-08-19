/**
 * Azure 语音 TTS 客户端(BYO key)—— 官方 REST 短文本端点。
 *
 * POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 * SSML 体 + `X-Microsoft-OutputFormat: riff-24khz-16bit-mono-pcm` → 直接回 WAV bytes,
 * 与 local 档同格式(渲染层 decodeAudioData 通吃,FIFO 播放队列零改动)。
 * F0 免费层每月 50 万字符,个人听读绰绰有余。
 *
 * SSML 里的用户文本走 escapeXml;voice 名限定 ^[\w-]+$ 白名单防注入。
 */

import { AZURE_TTS_OUTPUT_FORMAT } from "./tts-tiers";

export interface AzureSynthOptions {
  key: string;
  region: string;
  voice: string;
  /** SSML rate 百分比("+10%"/"-5%"),见 speedToRatePercent */
  rate?: string;
  timeoutMs?: number;
}

export function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 纯函数:请求体构造(verify 直测) */
export function buildAzureSsml(text: string, voice: string, rate?: string): string {
  const prosody = rate && rate !== "+0%" ? `<prosody rate="${rate}">` : "";
  const inner = `${prosody}${escapeXml(text)}${prosody ? "</prosody>" : ""}`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voice}">${inner}</voice></speak>`;
}

export function azureTtsUrl(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

const VOICE_RE = /^[\w.-]+$/;
const REGION_RE = /^[a-z0-9-]+$/i;

/** 合成一段文本 → WAV Buffer。失败抛错(带 HTTP 状态便于上层分类)。 */
export async function synthesizeAzureWav(text: string, opts: AzureSynthOptions): Promise<Buffer> {
  if (!VOICE_RE.test(opts.voice)) throw new Error("invalid azure voice");
  if (!REGION_RE.test(opts.region)) throw new Error("invalid azure region");
  const res = await fetch(azureTtsUrl(opts.region), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": opts.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_TTS_OUTPUT_FORMAT,
      "User-Agent": "LookatStudy",
    },
    body: buildAzureSsml(text, opts.voice, opts.rate),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`azure tts HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("azure tts produced empty audio");
  return buf;
}
