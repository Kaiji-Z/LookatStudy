/**
 * 纯 JS 流式解压依赖的最小类型声明(两包均不带 .d.ts)。
 * 用法见 speech-model-service.ts 的 extractTarBz2。
 */

declare module "unbzip2-stream";

declare module "tar-stream" {
  import type { Writable } from "node:stream";

  export interface Headers {
    name: string;
    size: number;
    type: string;
    mode?: number;
    mtime?: Date;
  }

  export interface ExtractStream extends Writable {
    on(event: "entry", listener: (header: Headers, stream: NodeJS.ReadableStream, next: () => void) => void): this;
    on(event: "finish", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export function extract(): ExtractStream;
}
