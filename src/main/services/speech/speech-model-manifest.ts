/**
 * 语音模型清单 —— 单一事实源(数据即代码:tsx verify 与 vite 主进程打包都能直接 import)。
 *
 * 全部 URL 于 2026-08-17 实测:
 * - ModelScope 逐文件 resolve(直 200,免解压,CN 快):tokens.txt/voices.bin 字节级与
 *   官方归档一致;kokoro fp32 无官方 MS 镜像,journey0ad 为全量 sherpa 布局镜像。
 * - GitHub Release 归档(资产名经 gh api 确认)只作兜底:经代理链下载 tar.bz2 流式解压。
 *
 * 许可:kokoro 权重 Apache-2.0;zipformer(bilingual-zh-en-2023-02-20)Apache-2.0。
 * 无 NC/ND 条款(选型红线见 dev-docs/DESIGN-PLAN-voice-v1.md)。
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
      id: "asr-zipformer",
      scope: "asr",
      engine: "zipformer-transducer",
      label: "流式 Zipformer 双语识别 zh-en(int8)",
      license: "Apache-2.0",
      licenseUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2",
      sampleRate: 16000,
      approxBytes: 200_000_000,
      sources: [
        {
          kind: "modelscope-files",
          repo: "pengzhendong/sherpa-onnx-streaming-zipformer-bilingual-zh-en",
          revision: "master",
          include: [
            "encoder-epoch-99-avg-1.int8.onnx",
            "decoder-epoch-99-avg-1.int8.onnx",
            "joiner-epoch-99-avg-1.int8.onnx",
            "tokens.txt",
          ],
        },
        {
          kind: "github-archive",
          url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2",
          sizeBytes: 511_274_346,
          stripTopDir: true,
          proxies: ["https://gh-proxy.com/", "https://ghproxy.net/", "https://ghfast.top/"],
        },
      ],
      variants: {
        // int8 优先(RTF 0.07-0.1);GitHub 归档只含 fp32 → 兜底变体
        int8: {
          files: [
            "encoder-epoch-99-avg-1.int8.onnx",
            "decoder-epoch-99-avg-1.int8.onnx",
            "joiner-epoch-99-avg-1.int8.onnx",
            "tokens.txt",
          ],
        },
        fp32: {
          files: [
            "encoder-epoch-99-avg-1.onnx",
            "decoder-epoch-99-avg-1.onnx",
            "joiner-epoch-99-avg-1.onnx",
            "tokens.txt",
          ],
        },
      },
    },
  ],
};
