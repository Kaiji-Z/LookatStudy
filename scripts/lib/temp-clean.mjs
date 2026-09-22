/**
 * 测试临时目录登记 + 进程退出统一清理 —— verify/live-test 脚本的 fixture teardown。
 *
 * 用法:mkdtempSync 的返回值包一层即可:
 *   import { trackTempDir } from "./lib/temp-clean.mjs";
 *   const store = createPlanStore(trackTempDir(mkdtempSync(join(tmpdir(), "ls-xxx-"))));
 *
 * 脚本正常结束、断言置 exitCode=1、乃至未捕获异常退出,exit 钩子都会递归删除。
 * rmSync 带重试:Windows 上进程刚放句柄偶发 EBUSY/ENOTEMPTY(与 verify-serve
 * 的 rmRetry 同配方,同步版);重试仍失败则留给系统 tmp 回收,不阻塞退出。
 */
import { rmSync } from "node:fs";

const dirs = new Set();

/** 登记一个临时目录,进程退出时统一递归删除;返回入参,方便包住 mkdtempSync */
export function trackTempDir(dir) {
  if (dir) dirs.add(dir);
  return dir;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function cleanupTempDirs() {
  for (const dir of dirs) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch (e) {
        if (attempt === 2) console.warn(`[temp-clean] 删除失败(留给系统 tmp 回收) ${dir}: ${e.message}`);
        else sleepSync(120);
      }
    }
  }
  dirs.clear();
}

process.on("exit", cleanupTempDirs);
