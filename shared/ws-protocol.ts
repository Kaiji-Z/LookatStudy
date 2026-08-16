/**
 * serve WebSocket 协议 —— 桌面 Electron IPC 的 web 镜像。
 *
 * 帧形状(文本 JSON,字段缩写省流量):
 *   客户端→服务端  { v:1, type:"req",   id, channel, args }
 *   服务端→客户端  { v:1, type:"res",   id, ok:true, result }
 *                   { v:1, type:"res",   id, ok:false, error }
 *   服务端→客户端  { v:1, type:"event", channel, args }
 *
 * channel 就是桌面 IPC 的 domain:action 通道名 —— 两个运行时同一命名空间,
 * ApiExpose 契约即协议。鉴权:连接 URL 带 ?token=(首帧之前由服务端校验)。
 */

export const WS_PROTOCOL_VERSION = 1;

export interface WsReqFrame {
  v: typeof WS_PROTOCOL_VERSION;
  type: "req";
  /** 客户端自生成的请求 id,res 原样带回配对 */
  id: string;
  channel: string;
  args: unknown[];
}

export interface WsResFrame {
  v: typeof WS_PROTOCOL_VERSION;
  type: "res";
  id: string;
  ok: true;
  result: unknown;
}

export interface WsResErrorFrame {
  v: typeof WS_PROTOCOL_VERSION;
  type: "res";
  id: string;
  ok: false;
  error: string;
}

export interface WsEventFrame {
  v: typeof WS_PROTOCOL_VERSION;
  type: "event";
  channel: string;
  args: unknown[];
}

export type WsServerFrame = WsResFrame | WsResErrorFrame | WsEventFrame;
export type WsClientFrame = WsReqFrame;

/** 客户端帧解析:坏形状返回 null(服务端/客户端都用于入口守卫) */
export function parseClientFrame(raw: string): WsClientFrame | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const f = obj as Partial<WsClientFrame>;
  if (f.type !== "req" || typeof f.id !== "string" || typeof f.channel !== "string") return null;
  if (!Array.isArray(f.args)) return null;
  return { v: WS_PROTOCOL_VERSION, type: "req", id: f.id, channel: f.channel, args: f.args };
}
