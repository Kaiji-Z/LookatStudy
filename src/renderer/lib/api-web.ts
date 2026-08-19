/**
 * web 传输层 —— 浏览器/serve 模式下替代 preload 的 window.api。
 *
 * 与 preload 同源:方法面来自 shared/api-channels(从 preload 生成的唯一映射表),
 * invoke 走 WS req/res 帧(shared/ws-protocol),事件走 event 帧。
 * 启动:main.tsx 检测 window.api 缺失时动态 import installWebApi() ——
 * Electron 路径零成本(此模块根本不会被加载进桌面包的执行路径)。
 *
 * token:首次经 ?token= 链接进入(serve 启动时打印),存 localStorage 后续免带。
 */
import { API_CHANNELS } from "@shared/api-channels";
import { WS_PROTOCOL_VERSION, type WsServerFrame } from "@shared/ws-protocol";
import type { LookatStudyApi } from "../../preload/index.js";

const TOKEN_KEY = "ls-serve-token";

function readToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (fromUrl) {
    try {
      window.localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* 隐私模式 localStorage 可能禁用 —— URL 里还有,本次会话可用 */
    }
    return fromUrl;
  }
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: number;
}

/** 已连接的 WS 客户端 + invoke/on 两类调用面 */
class WebTransport {
  private ws: WebSocket | null = null;
  private everOpened = false;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private connectPromise: Promise<WebSocket> | null = null;

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolveConnect, rejectConnect) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = readToken();
      const url = `${proto}//${window.location.host}/?token=${encodeURIComponent(token)}`;
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const openTimer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          rejectConnect(new Error("连接学习服务超时(serve 未启动?)"));
        }
      }, 5000);
      ws.addEventListener("open", () => {
        this.everOpened = true;
        window.clearTimeout(openTimer);
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          resolveConnect(ws);
        }
        // 断线自动重连(指数退避);重连成功后不补发错过的 event(v1:刷新页面兜底)
      });
      ws.addEventListener("message", (ev) => {
        let frame: WsServerFrame | null = null;
        try {
          frame = JSON.parse(String(ev.data)) as WsServerFrame;
        } catch {
          return;
        }
        if (!frame || frame.v !== WS_PROTOCOL_VERSION) return;
        if (frame.type === "res") {
          const p = this.pending.get(frame.id);
          if (!p) return;
          this.pending.delete(frame.id);
          window.clearTimeout(p.timer);
          if (frame.ok) p.resolve(frame.result);
          else p.reject(new Error(frame.error));
        } else if (frame.type === "event") {
          const set = this.listeners.get(frame.channel);
          if (set) for (const fn of set) fn(...frame.args);
        }
      });
      ws.addEventListener("close", (ev) => {
        this.connectPromise = null;
        if (this.ws === ws) this.ws = null;
        if (!settled) {
          settled = true;
          window.clearTimeout(openTimer);
          rejectConnect(new Error(evidence(ev)));
          return;
        }
        // 连接过又断开:拒绝所有在飞请求(让 UI 报错),按需安排重连。
        // 4001 = token 被拒(token 轮换/输错)——给出具体指引且不再自动重连(重连也一样被拒)
        const msg = ev.code === 4001
          ? "学习服务拒绝了连接(token 无效)——请用启动时打印的带 token 链接打开"
          : "与服务端的连接已断开";
        for (const [, p] of this.pending) {
          window.clearTimeout(p.timer);
          p.reject(new Error(msg));
        }
        if (ev.code === 4001) this.everOpened = false;
        this.pending.clear();
        if (ev.code === 4001) {
          window.dispatchEvent(new CustomEvent(TOKEN_REJECTED_EVENT));
          return; // 不重连:token 不对重连也一样被拒,等用户在令牌门重输
        }
        if (this.everOpened) window.setTimeout(() => void this.connect().catch(() => {}), 2000);
      });
      ws.addEventListener("error", () => {
        /* close 会跟着来,统一在 close 处理 */
      });
    });
    return this.connectPromise;
  }


  // v0.13 语音:听写 WAV 上行过 JSON 河转 base64(服务端 speech:asrTranscribe 解包)
  private static bytesToB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const ws = await this.connect();
    const id = (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`调用 ${channel} 超时`));
      }, 300_000); // 长任务(导入/出题/本地 whisper 转录)允许 5 分钟
      this.pending.set(id, { resolve, reject, timer });
      // 听写 WAV 上行:ArrayBuffer 无法过 JSON —— base64 包装(服务端解包)
      const wireArgs =
        channel === "speech:asrTranscribe" && args[0] instanceof ArrayBuffer
          ? [WebTransport.bytesToB64(args[0]), ...args.slice(1)]
          : args;
      ws.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "req", id, channel, args: wireArgs }));
    });
  }

  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    // 语音音频帧经 WS 时是 base64(JSON 信道装不下 ArrayBuffer)——分派前还原
    const effective =
      channel === "speech:ttsAudio"
        ? (...args: unknown[]) => {
            const first = args[0] as { wavBase64?: string } | undefined;
            if (first && typeof first.wavBase64 === "string") {
              const bin = atob(first.wavBase64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const { wavBase64: _drop, ...rest } = first;
              listener({ ...rest, wavBytes: bytes.buffer });
            } else {
              listener(...args);
            }
          }
        : listener;
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(effective);
    // 事件由服务端广播,连接保持即订阅;懒建连接保证首屏事件不丢
    void this.connect().catch(() => {});
    return () => {
      set!.delete(effective);
    };
  }
}

/** web 模式是否已有可用 token(URL 带 token 或 localStorage 存过) —— main.tsx 据此决定先令牌门还是直接进应用 */
export function hasWebToken(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("token")) return true;
  try {
    return !!window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

/** 令牌门提交:存 localStorage 并清掉 URL 参数(避免留在地址栏历史里) */
export function setWebToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 隐私模式存不了:带参刷新,本次会话仍可用 */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("token", token);
  window.location.replace(url.toString());
}

/** token 被拒(4001)时广播 —— main.tsx 监听后切回令牌门让用户重输 */
export const TOKEN_REJECTED_EVENT = "ls-web-token-rejected";

function evidence(ev: CloseEvent): string {
  if (ev.code === 4001) return "学习服务拒绝了连接(token 无效)——请用启动时打印的带 token 链接打开";
  return "无法连接学习服务(serve 未启动?)";
}

let installed = false;

/** main.tsx 启动时调用:构建 web 版 api 并挂到 window.api(preload 缺位时) */
export async function installWebApi(): Promise<void> {
  if (installed || (window as { api?: unknown }).api) return;
  installed = true;
  const transport = new WebTransport();
  const api = {} as Record<string, unknown>;
  for (const [method, channel] of Object.entries(API_CHANNELS)) {
    api[method] = (...args: unknown[]) => transport.invoke(channel, ...args);
  }
  api.on = (channel: string, listener: (...args: unknown[]) => void) => transport.on(channel, listener);
  (window as { api?: unknown }).api = api as unknown as LookatStudyApi;
}

/** 测试用:直接拿传输层(不经 window) */
export function createWebTransportForTest(): WebTransport {
  return new WebTransport();
}

export type { WebTransport };
