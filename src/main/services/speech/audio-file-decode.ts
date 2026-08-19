/**
 * 本地音频文件解码 —— 任意格式 → 16kHz 单声道 Float32 PCM(喂 Whisper)。
 *
 * wav 走自家纯函数 decodeWavPcm16(快,听写链路同源);其余格式走 audio-decode
 * (纯 JS/WASM:mp3/m4a/aac/flac/ogg/opus,spike 实测 Node CJS 可用,返回
 * {channelData: Float32Array[], sampleRate})。多声道混单声道 + 任意方向线性
 * 重采样(shared/resampleLinear 只会降采样,这里双向)。
 */
import { decodeWavPcm16 } from "@shared/speech-wav";

export const AUDIO_IMPORT_EXTS = ["wav", "mp3", "m4a", "flac", "aac", "ogg", "opus"] as const;
/** 视频容器(只取音轨):AAC 家族先直解,fragmented MP4(B站 DASH 等)走
 *  fMP4→ADTS 转封装(pure/fmp4-to-adts)再解。mkv/webm 是 matroska 容器,
 *  纯 JS 不解,指引外部转封装。 */
export const VIDEO_IMPORT_EXTS = ["mp4", "m4v", "mov"] as const;

/** 任意方向线性重采样(降采样与 @shared/resampleLinear 同式,升采样补插值)。 */
function resampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === 16000) return input;
  const ratio = srcRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0]! + (input[i1]! - input[i0]!) * t;
  }
  return out;
}

/** 多声道 → 单声道(平均)。 */
function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i]!;
    out[i] = sum / channels.length;
  }
  return out;
}

export async function decodeAudioTo16kMono(bytes: Uint8Array, ext: string): Promise<Float32Array> {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (!(AUDIO_IMPORT_EXTS as readonly string[]).includes(e)) {
    throw new Error(`暂不支持 .${e} 音视频(音频支持 ${AUDIO_IMPORT_EXTS.join("/")};视频支持 ${VIDEO_IMPORT_EXTS.join("/")};mkv/webm 请先转成 mp4)`);
  }

  // AAC 家族(m4a/aac + mp4 系视频容器):先按传统 mp4 直解;
  // B站等 DASH 源是 fragmented MP4(moof 分片,无样本表),直解必空
  // → 失败时 fMP4→ADTS 转封装(pure/fmp4-to-adts)再走裸 AAC 流解码。
  const asM4a = e === "mp4" || e === "m4v" || e === "mov" || e === "m4a" || e === "aac";
  if (asM4a) {
    let r: { channelData: Float32Array[]; sampleRate: number };
    try {
      r = await decodeWithAudioDecode(bytes);
    } catch (directErr) {
      try {
        const { fmp4ToAdts } = await import("../pure/fmp4-to-adts.js");
        const adts = fmp4ToAdts(bytes);
        r = await decodeWithAudioDecode(adts);
      } catch {
        throw directErr;
      }
    }
    return resampleTo16k(mixToMono(r.channelData), r.sampleRate);
  }

  let channelData: Float32Array[];
  let sampleRate: number;
  if (e === "wav") {
    try {
      const d = decodeWavPcm16(bytes);
      channelData = [d.samples];
      sampleRate = d.sampleRate;
    } catch {
      // 多声道/浮点 WAV 等自家解码器不收的 → 交给 audio-decode
      const r = await decodeWithAudioDecode(bytes);
      channelData = r.channelData;
      sampleRate = r.sampleRate;
    }
  } else {
    const r = await decodeWithAudioDecode(bytes);
    channelData = r.channelData;
    sampleRate = r.sampleRate;
  }

  const mono = mixToMono(channelData);
  if (mono.length === 0) throw new Error("音频内容为空");
  return resampleTo16k(mono, sampleRate);
}

async function decodeWithAudioDecode(bytes: Uint8Array): Promise<{ channelData: Float32Array[]; sampleRate: number }> {
  try {
    const mod = await import("audio-decode");
    const decode = (mod.default ?? mod) as (b: Buffer) => Promise<{ channelData: Float32Array[]; sampleRate: number }>;
    const buf = await decode(Buffer.from(bytes));
    if (!buf?.channelData?.length || !buf.sampleRate) throw new Error("empty decode result");
    return { channelData: buf.channelData, sampleRate: buf.sampleRate };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`音频解码失败(文件可能损坏或格式不符):${msg}`);
  }
}
