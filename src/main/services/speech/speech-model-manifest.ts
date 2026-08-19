/**
 * 语音模型清单 —— 单一事实源(数据即代码:tsx verify 与 vite 主进程打包都能直接 import)。
 *
 * 全部 URL 于 2026-08-17/18 实测:
 * - ModelScope 逐文件 resolve(直 200,免解压,CN 快):pengzhendong 镜像文件与
 *   官方归档同源(whisper int8 布局 turbo-encoder.int8.onnx 等,列表 API 核对)。
 * - GitHub Release 归档(资产名与字节数经 gh api 确认)只作兜底:代理链下载 tar.bz2 流式解压。
 *
 * 许可:kokoro 权重 Apache-2.0;whisper(OpenAI,经 sherpa-onnx 转换)MIT。
 * 无 NC/ND 条款(选型红线见 dev-docs/DESIGN-PLAN-voice-v1.md)。
 *
 * v0.13:ASR 从 zipformer 流式换 Whisper 离线(质量优先,自带标点);旧
 * asr-zipformer 条目退役 —— 已下载的目录留在盘上不删,清单不再列出。
 */

import type { SpeechModelsManifest } from "@shared/speech-types";

export const SPEECH_MODELS_MANIFEST: SpeechModelsManifest = {
  formatVersion: 1,
  models: [
    {
      id: "tts-kokoro",
      scope: "tts",
      engine: "kokoro",
      label: "Kokoro 82M v1.1(中英多语朗读)",
      license: "Apache-2.0",
      licenseUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2",
      sampleRate: 24000,
      approxBytes: 430_000_000,
      sources: [
        {
          kind: "modelscope-files",
          repo: "journey0ad/kokoro-multi-lang-v1_1",
          revision: "master",
          exclude: [".gitattributes", "README.md", "configuration.json"],
        },
        {
          kind: "github-archive",
          url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2",
          sizeBytes: 364_816_464,
          stripTopDir: true,
          proxies: ["https://gh-proxy.com/", "https://ghproxy.net/", "https://ghfast.top/"],
        },
      ],
      variants: {
        default: {
          files: [
            "model.onnx",
            "voices.bin",
            "tokens.txt",
            "espeak-ng-data/phondata",
            "dict/jieba.dict.utf8",
            "lexicon-us-en.txt",
            "lexicon-zh.txt",
            "date-zh.fst",
            "number-zh.fst",
            "phone-zh.fst",
          ],
        },
      },
    },
    {
      id: "asr-whisper-turbo",
      scope: "asr",
      engine: "whisper",
      label: "Whisper Turbo int8(本地听写·推荐桌面,约 1GB)",
      license: "MIT",
      licenseUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2",
      sampleRate: 16000,
      approxBytes: 1_000_000_000,
      sources: [
        {
          kind: "modelscope-files",
          repo: "pengzhendong/sherpa-onnx-whisper-turbo",
          revision: "master",
          include: ["turbo-encoder.int8.onnx", "turbo-decoder.int8.onnx", "turbo-tokens.txt"],
        },
        {
          kind: "github-archive",
          url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2",
          sizeBytes: 563_790_207,
          stripTopDir: true,
          proxies: ["https://gh-proxy.com/", "https://ghproxy.net/", "https://ghfast.top/"],
        },
      ],
      variants: {
        int8: {
          files: ["turbo-encoder.int8.onnx", "turbo-decoder.int8.onnx", "turbo-tokens.txt"],
        },
      },
    },
    {
      id: "asr-whisper-small",
      scope: "asr",
      engine: "whisper",
      label: "Whisper Small int8(本地听写·轻量,约 360MB)",
      license: "MIT",
      licenseUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2",
      sampleRate: 16000,
      approxBytes: 360_000_000,
      sources: [
        {
          kind: "modelscope-files",
          repo: "pengzhendong/sherpa-onnx-whisper-small",
          revision: "master",
          include: ["small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"],
        },
        {
          kind: "modelscope-files",
          repo: "pengzhendong/sherpa-onnx-whisper-small",
          revision: "master",
          include: ["small-encoder.onnx", "small-decoder.onnx", "small-tokens.txt"],
        },
        {
          kind: "github-archive",
          url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2",
          sizeBytes: 639_387_718,
          stripTopDir: true,
          proxies: ["https://gh-proxy.com/", "https://ghproxy.net/", "https://ghfast.top/"],
        },
      ],
      variants: {
        // 键序即偏好序:int8 优先(体积/速度),fp32 兜底(同仓库第二源)
        int8: {
          files: ["small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"],
        },
        fp32: {
          files: ["small-encoder.onnx", "small-decoder.onnx", "small-tokens.txt"],
        },
      },
    },
  ],
};
