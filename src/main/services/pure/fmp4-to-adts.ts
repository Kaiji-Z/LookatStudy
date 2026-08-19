/**
 * fMP4 → ADTS 转封装(纯函数)——B站等 DASH 源的 .m4s 是 fragmented MP4
 * (moof/trun 分片,无传统样本表),audio-decode 的 AAC 解码器只认传统 mp4 或
 * 原始 ADTS 流。这里拆 fMP4:moov 里取 AudioSpecificConfig(esds),moof/trun
 * 里取每帧大小与偏移,逐帧包 7 字节 ADTS 头,拼成裸 AAC 流交给解码器。
 */
export function fmp4ToAdts(bytes: Uint8Array): Uint8Array {
  // ── box 遍历,收集 moov(init) 与 moof/mdat(分片) ──
  const boxes: { type: string; start: number; body: number; end: number }[] = [];
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, Math.min(16, bytes.length - pos));
    let size = view.getUint32(0);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    let hdr = 8;
    if (size === 1) {
      if (pos + 16 > bytes.length) break;
      size = Number(new DataView(bytes.buffer, bytes.byteOffset + pos + 8, 8).getBigUint64(0));
      hdr = 16;
    } else if (size === 0) size = bytes.length - pos;
    if (size < hdr || pos + size > bytes.length) break;
    boxes.push({ type, start: pos, body: pos + hdr, end: pos + size });
    pos += size;
  }

  const find = (type: string) => boxes.filter((b) => b.type === type);
  const sub = (b: { body: number; end: number }): { type: string; body: number; end: number }[] => {
    const out: { type: string; body: number; end: number }[] = [];
    let p = b.body;
    while (p + 8 <= b.end) {
      const v = new DataView(bytes.buffer, bytes.byteOffset + p, 8);
      let sz = v.getUint32(0);
      const t = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
      let h = 8;
      if (sz === 1) {
        if (p + 16 > b.end) break;
        sz = Number(new DataView(bytes.buffer, bytes.byteOffset + p + 8, 8).getBigUint64(0));
        h = 16;
      } else if (sz === 0) sz = b.end - p;
      if (sz < h || p + sz > b.end) break;
      out.push({ type: t, body: p + h, end: p + sz });
      p += sz;
    }
    return out;
  };

  // ── moov → esds → ASC ──
  // 不精确走 trak/mdia/minf/stbl/stsd/mp4a 嵌套(AudioSampleEntry 有 28 字节
  // 固定头,v1/v2 还有扩展,偏移易踩错):esds fourcc 全局扫描再按 box 边界解析。
  // esds 只出现在 AAC 音轨(视频轨是 avcC/hevcC),muxed 文件也不会误中。
  let asc: Uint8Array | null = null;
  {
    const sig = [0x65, 0x73, 0x64, 0x73]; // "esds"
    outer: for (let i = 4; i + 8 <= bytes.length; i++) {
      if (bytes[i] !== sig[0] || bytes[i + 1] !== sig[1] || bytes[i + 2] !== sig[2] || bytes[i + 3] !== sig[3]) continue;
      const boxStart = i - 4;
      const size = new DataView(bytes.buffer, bytes.byteOffset + boxStart, 4).getUint32(0);
      if (size < 8 || boxStart + size > bytes.length) continue;
      const found = extractAscFromEsds(bytes.subarray(i + 4, boxStart + size));
      if (found && found.length >= 2) { asc = found; break outer; }
    }
  }
  if (!asc || asc.length < 2) throw new Error("fMP4 里找不到音频 AudioSpecificConfig(非 AAC 音轨?)");

  const { audioObjectType, samplingFreqIndex, channelConfig } = parseAsc(asc);
  const adtsFrames: Uint8Array[] = [];
  for (const moof of find("moof")) {
    // ISO 14496-12:tfhd/trun 都是 fullbox(body = version(1)+flags(3))。
    // tfhd: trackId → [baseDataOffset(绝对)|sampleDescIdx|defaultDur|defaultSize|defaultFlags]
    // trun: [dataOffset(相对base)|firstSampleFlags] → 每样本 [duration|size|flags|cts]
    // base = tfhd.baseDataOffset(若有)否则 moof 起点(default-base-is-moof)。
    const sizes: number[] = [];
    let base = moof.start;
    let dataOffset = 0;
    let tfhdDefaultSize = 0;
    for (const traf of sub(moof).filter((b) => b.type === "traf")) {
      for (const tfhd of sub(traf).filter((b) => b.type === "tfhd")) {
        const v = new DataView(bytes.buffer, bytes.byteOffset + tfhd.body, tfhd.end - tfhd.body);
        const flags = (v.getUint8(1) << 16) | (v.getUint8(2) << 8) | v.getUint8(3);
        let p = 4 + 4; // version/flags + trackId
        if (flags & 0x000001) { // base-data-offset(64 位绝对偏移)
          if (p + 8 <= v.byteLength) base = Number(v.getBigUint64(p));
          p += 8;
        }
        if (flags & 0x000002) p += 4; // sampleDescriptionIndex
        let defaultSize = 0;
        if (flags & 0x000008) p += 4; // defaultSampleDuration
        if (flags & 0x000010 && p + 4 <= v.byteLength) defaultSize = v.getUint32(p); // defaultSampleSize
        tfhdDefaultSize = defaultSize;
      }
      for (const trun of sub(traf).filter((b) => b.type === "trun")) {
        const v = new DataView(bytes.buffer, bytes.byteOffset + trun.body, trun.end - trun.body);
        const flags = (v.getUint8(1) << 16) | (v.getUint8(2) << 8) | v.getUint8(3);
        const count = v.getUint32(4);
        let p = 8;
        if (flags & 0x000001) { // data-offset(相对 base,声明首样本位置)
          if (p + 4 <= v.byteLength && sizes.length === 0) dataOffset = v.getInt32(p);
          p += 4;
        }
        if (flags & 0x000004) p += 4; // first-sample-flags
        for (let i = 0; i < count; i++) {
          if (flags & 0x000100) p += 4; // sample_duration
          if (flags & 0x000200) { // sample_size
            if (p + 4 <= v.byteLength) sizes.push(v.getUint32(p));
            p += 4;
          } else sizes.push(tfhdDefaultSize);
          if (flags & 0x000400) p += 4; // sample_flags
          if (flags & 0x000800) p += 4; // sample_composition_time_offset
          if (p + 4 > v.byteLength && i + 1 < count) break;
        }
      }
    }
    let off = base + dataOffset;
    for (const sz of sizes) {
      if (sz <= 0 || off + sz > bytes.length) break;
      adtsFrames.push(makeAdts(bytes.subarray(off, off + sz), audioObjectType, samplingFreqIndex, channelConfig));
      off += sz;
    }
  }
  if (adtsFrames.length === 0) throw new Error("fMP4 里没有可提取的音频帧(无 moof/trun)");
  const total = adtsFrames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of adtsFrames) { out.set(f, o); o += f.length; }
  return out;
}

/** esds 描述符流里找 tag 0x05 的负载(ASC)。长度是每字节 7bit 的 varint。 */
function extractAscFromEsds(buf: Uint8Array): Uint8Array | null {
  let p = 0;
  const readLen = () => {
    let len = 0;
    for (;;) {
      const b = buf[p++]!;
      len = (len << 7) | (b & 0x7f);
      if (!(b & 0x80)) return len;
    }
  };
  while (p < buf.length) {
    const tag = buf[p++]!;
    const len = readLen();
    if (tag === 0x05) return buf.subarray(p, p + len);
    if (tag === 0x03) {
      // ES_Descriptor 负载头:ES_ID(2) + flags(1)(+依赖/URL/OCR 可选字段),跳过再找子描述符
      const flags = buf[p + 2] ?? 0;
      let skip = 3;
      if (flags & 0x80) skip += 2; // streamDependenceFlag: ES_ID 依赖
      if (flags & 0x40) skip += 1 + (buf[p + 3] ?? 0); // URL_Flag: 长度前缀 + URL
      if (flags & 0x20) skip += 2; // OCRstreamFlag
      p += skip;
      continue;
    }
    if (tag === 0x04) { p += 13; continue; } // DecoderConfigHeader 13 字节固定头后是子描述符
    p += len;
  }
  return null;
}

function parseAsc(asc: Uint8Array) {
  const b0 = asc[0]!, b1 = asc[1]!;
  const audioObjectType = (b0 >> 3) & 0x1f;
  const samplingFreqIndex = ((b0 & 0x07) << 1) | (b1 >> 7);
  const channelConfig = (b1 >> 3) & 0x0f;
  return { audioObjectType, samplingFreqIndex, channelConfig };
}

function makeAdts(frame: Uint8Array, objType: number, freqIdx: number, ch: number): Uint8Array {
  const profile = Math.max(1, Math.min(4, objType - 1)); // AAC Main=0 LC=1 SSR=2 LTP=3
  const len = frame.length + 7;
  const h = new Uint8Array(7);
  h[0] = 0xff;
  h[1] = 0xf1; // MPEG-4, no CRC
  h[2] = (profile << 6) | (freqIdx << 2) | (ch >> 2);
  h[3] = ((ch & 0x03) << 6) | ((len >> 11) & 0x03);
  h[4] = (len >> 3) & 0xff;
  h[5] = ((len & 0x07) << 5) | 0x1f;
  h[6] = 0xfc; // buffer fullness 0x7ff → 1 帧
  const out = new Uint8Array(len);
  out.set(h, 0);
  out.set(frame, 7);
  return out;
}
