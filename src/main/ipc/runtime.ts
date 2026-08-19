/**
 * 跨运行时抽象 —— Electron 主进程与无头 serve(手机/Termux)共享同一套 handler。
 *
 * ipc/index.ts 的全部 handler 只依赖这三个注入物,不 import electron:
 * - emitter: main→客户端事件推送(Electron=webContents.send,serve=WS 广播)
 * - dataDir: 用户数据目录(Electron=userData,serve=~/.lookatstudy)
 * - dialog: 文件选择/保存(Electron=原生对话框,web=由渲染层配合完成)
 *
 * 通道名 domain:action 就是协议的 method 命名空间 —— Electron ipcMain 和
 * serve 的 WS 分发表消费同一张 handler 表,两个运行时不会漂移。
 */

/** main→客户端推送。与 webContents.send(channel, ...args) 同形。 */
export interface ClientEmitter {
  send(channel: string, ...args: unknown[]): void;
}

/** 文件交互的运行时分叉。web 模式下 import:localFolder/importPack 接受
 *  显式参数(路径/内容),对话框方法不会被走到;exportPack 走 savePack。 */
export interface RuntimeDialog {
  /** 选服务器侧文件夹,返回绝对路径;null = 用户取消 */
  pickFolder(title: string): Promise<string | null>;
  /** 选课程包 json 文件,返回文件名+内容;null = 用户取消 */
  openPack(): Promise<{ fileName: string; content: string } | null>;
  /** 保存课程包文本。返回给用户看的结果(路径或下载提示);null = 取消 */
  savePack(defaultName: string, content: string): Promise<string | null>;
  /** 选一个内容文件(epub 等),返回文件名+原始字节;null = 用户取消。
   *  web 模式不用它——渲染层 <input type=file> 读内容传 base64。 */
  pickContentFile(filters: { name: string; extensions: string[] }[]): Promise<{ fileName: string; bytes: Uint8Array } | null>;
}

export interface RuntimeDeps {
  emitter: ClientEmitter;
  /** 用户数据根目录(import-plans/、assets/、attachments/ 都挂在下面) */
  dataDir: string;
  dialog: RuntimeDialog;
  /** 运行时形态:electron=桌面(原生对话框),web=serve(浏览器端配合文件交互) */
  ui: "electron" | "web";
}

/** handler 表的值:与 ipcMain.handle 的 (event, ...args) 形状一致。
 *  serve 分发时传一个哑 event(所有 handler 都不用 event 参数);
 *  args 用 any[](同 preload 的事件签名先例)以容纳各 handler 的精确参数类型。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcHandlerFn = (event: unknown, ...args: any[]) => unknown;
