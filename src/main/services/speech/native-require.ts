/**
 * 原生/CJS 模块加载的运行时兼容器。
 *
 * - 生产 Electron 主进程(CJS):直接 require。
 * - tsx/ESM 上下文(live-test 脚本):require 未定义 → createRequire 以入口脚本为锚
 *   (锚点在仓库内,node_modules 向上可达)。
 */

import { createRequire } from "node:module";

export function nativeRequire<T = unknown>(id: string): T {
  if (typeof require === "function") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id) as T;
  }
  const anchor = process.argv[1] ?? process.cwd();
  return createRequire(anchor)(id) as T;
}
