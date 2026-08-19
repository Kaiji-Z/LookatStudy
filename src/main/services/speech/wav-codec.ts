/**
 * 兼容门面 —— v0.13 起 WAV 编解码实现下沉 shared/speech-wav.ts
 * (渲染层听写链路要编码,主进程要解码,单一实现防漂移)。此文件保留 re-export。
 */

export { encodeWavPcm16 } from "@shared/speech-wav";
