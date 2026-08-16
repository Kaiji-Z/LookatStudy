/**
 * serve 服务端核心 —— 无头运行时(手机 Termux / 桌面浏览器)。
 *
 * 同一个端口上伺服两样东西:
 *   HTTP  静态渲染层(vite build 产物,SPA 回退到 index.html)
 *   WS    控制面(shared/ws-protocol: req/res + event 帧,channel=桌面 IPC 通道名)
 *
 * 与 Electron 共享 collectHandlers() 的同一张 handler 表 —— API 面零漂移。
 * 安全:默认只绑回环地址;WS 连接需 ?token= 校验(dataDir/serve-token,首启生成)。
 */
import { createServer, type Server as HttpServer } from "node:http";
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientFrame, WS_PROTOCOL_VERSION, type WsServerFrame } from "@shared/ws-protocol";
import { collectHandlers } from "../ipc/index.js";
import type { ClientEmitter, RuntimeDialog } from "../ipc/runtime.js";
import { initDb, getDb, markDirty, flushDb } from "../db/index.js";
import { setAssetsRoot } from "../services/asset-service.js";
import { setAttachmentsRoot } from "../services/attachment-store.js";
import { ensureSeedCourse } from "../services/seed.js";
import { seedBuiltinSouls } from "../services/souls/soul-service.js";
import { ensureExamNodesForExistingCourses } from "../services/course-generator.js";
import { setStateEmitter } from "../lib/state-emitter.js";

export interface ServeOptions {
  /** 数据目录(DB/assets/attachments/import-plans/serve-token 都在下面) */
  dataDir: string;
  /** 渲染层静态文件目录(vite build 产物) */
  webDir: string;
  /** 0 = 随机端口(测试用) */
  port: number;
  /** 默认 127.0.0.1;显式传 0.0.0.0 走 LAN(自己负责安全) */
  host?: string;
  /** 跳过 token(仅 verify 测试) */
  skipAuth?: boolean;
}

export interface ServeInstance {
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

/** 哑对话框:web 模式下 localFolder/importPack 走显式参数,不该走到这 */
const stubDialog: RuntimeDialog = {
  async pickFolder() {
    throw new Error("serve 模式不支持原生文件夹选择对话框(传入路径参数)");
  },
  async openPack() {
    throw new Error("serve 模式不支持原生文件选择对话框(传入课程包内容参数)");
  },
  async savePack() {
    throw new Error("serve 模式不支持原生保存对话框(内容会回传给浏览器下载)");
  },
};

function loadOrCreateToken(dataDir: string): string {
  const tokenPath = join(dataDir, "serve-token");
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* 首启没有 token 文件 */
  }
  const token = randomBytes(24).toString("hex");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(tokenPath, token, "utf8");
  return token;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

export async function startServe(opts: ServeOptions): Promise<ServeInstance> {
  // ── 1. 数据层初始化(与 electron whenReady 序列等价,目录注入版) ──
  mkdirSync(opts.dataDir, { recursive: true });
  setAssetsRoot(join(opts.dataDir, "assets"));
  setAttachmentsRoot(join(opts.dataDir, "attachments"));
  await initDb({ dataDir: opts.dataDir });
  ensureSeedCourse();
  const { patched } = ensureExamNodesForExistingCourses(getDb());
  if (patched > 0) markDirty();
  seedBuiltinSouls(getDb());
  const { ensurePrefLang } = await import("../services/lang-pref.js");
  ensurePrefLang(getDb(), Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN");

  const token = opts.skipAuth ? "" : loadOrCreateToken(opts.dataDir);
  const webRoot = resolve(opts.webDir);

  // ── 2. WS 广播发射器(所有已认证连接都收到同样的 event 流) ──
  const clients = new Set<WebSocket>();
  const emitter: ClientEmitter = {
    send(channel, ...args) {
      const frame: WsServerFrame = { v: WS_PROTOCOL_VERSION, type: "event", channel, args };
      const raw = JSON.stringify(frame);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(raw);
      }
    },
  };
  setStateEmitter((kind) => emitter.send("state:changed", kind));

  // ── 3. handler 表(与 electron 同一张) + WS 分发 ──
  const handlers = collectHandlers({ ui: "web", dataDir: opts.dataDir, emitter, dialog: stubDialog });
  const dummyEvent = { sender: null };

  const httpServer: HttpServer = createServer((req, res) => {
    // 静态文件 + SPA 回退。token 不用于静态资源(渲染层不是秘密,API 面全在 WS)
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let filePath = normalize(join(webRoot, urlPath));
    if (!filePath.startsWith(webRoot)) {
      res.writeHead(403).end();
      return;
    }
    if (urlPath === "/" || !existsSync(filePath) || !filePath.includes(".")) {
      filePath = join(webRoot, "index.html"); // SPA:任何未知路径回 index.html
    }
    const mime = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime, "cache-control": "no-cache" });
    createReadStream(filePath).pipe(res);
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!opts.skipAuth && url.searchParams.get("token") !== token) {
      ws.close(4001, "invalid token");
      return;
    }
    clients.add(ws);
    ws.on("message", (data) => {
      let frame: ReturnType<typeof parseClientFrame>;
      try {
        frame = parseClientFrame(data.toString());
      } catch {
        frame = null;
      }
      if (!frame) {
        ws.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "res", id: "", ok: false, error: "bad frame" }));
        return;
      }
      const handler = handlers.get(frame.channel);
      if (!handler) {
        const miss: WsServerFrame = { v: WS_PROTOCOL_VERSION, type: "res", id: frame.id, ok: false, error: `未知通道: ${frame.channel}` };
        ws.send(JSON.stringify(miss));
        return;
      }
      void Promise.resolve()
        .then(() => handler(dummyEvent, ...frame.args))
        .then((result) => {
          const ok: WsServerFrame = { v: WS_PROTOCOL_VERSION, type: "res", id: frame!.id, ok: true, result: result === undefined ? null : result };
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ok));
        })
        .catch((e: unknown) => {
          const err: WsServerFrame = {
            v: WS_PROTOCOL_VERSION, type: "res", id: frame!.id, ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(err));
        });
    });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  // ── 4. 监听 + 关闭协议 ──
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolveListen) => {
    httpServer.listen(opts.port, host, resolveListen);
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;

  async function close(): Promise<void> {
    flushDb();
    for (const c of clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
  }

  return {
    port,
    token,
    url: `http://${host}:${port}/`,
    close,
  };
}
