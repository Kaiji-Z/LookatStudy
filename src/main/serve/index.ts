/**
 * serve CLI 入口 —— `node server.cjs [--port 17890] [--data ~/.lookatstudy] [--web ./web]`
 *
 * 桌面开发:npm run serve(用仓库 dist 渲染层 + %APPDATA% 之外的开发数据目录)
 * 手机 Termux:install-termux.sh 启动(数据目录 ~/.lookatstudy,自带 web/)
 * 进程信号:SIGINT/SIGTERM → flushDb 落盘后退出(sql.js 内存库必须显式冲)
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startServe } from "./server.js";

function arg(name: string, fallback: string): string {
  const argv = process.argv;
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  return fallback;
}

function argvHas(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const dataDir = resolve(arg("data", join(homedir(), ".lookatstudy")));
  // 默认 web/ 与 server.cjs 同级(dist/mobile 布局);仓库 dev 场景显式传 dist/renderer
  const webDir = resolve(arg("web", join(__dirname, "web")));
  const port = Number(arg("port", "17890"));
  // LAN 语音需要安全上下文:http://192.168.x.x 拿不到 getUserMedia。
  // --tls-cert/--tls-key(成对,PEM)升级 https,浏览器侧 WS 自动走 wss。
  const tlsCert = argvHas("tls-cert") ? resolve(arg("tls-cert", "")) : undefined;
  const tlsKey = argvHas("tls-key") ? resolve(arg("tls-key", "")) : undefined;
  if ((tlsCert !== undefined) !== (tlsKey !== undefined)) {
    throw new Error("--tls-cert 与 --tls-key 必须成对提供(PEM 文件路径)");
  }

  const inst = await startServe({ dataDir, webDir, port, tlsCert, tlsKey });
  process.stderr.write(
    [
      `[lookatstudy-serve] listening on ${inst.url}`,
      `[lookatstudy-serve] data dir: ${dataDir}`,
      `[lookatstudy-serve] open (with token): ${inst.url}?token=${inst.token}`,
      ``,
    ].join("\n"),
  );

  const shutdown = async () => {
    process.stderr.write("[lookatstudy-serve] shutting down…\n");
    await inst.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((e) => {
  process.stderr.write(`[lookatstudy-serve] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
