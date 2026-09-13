/**
 * Electron 壳 —— 把共享 handler 表接到 ipcMain,并提供原生对话框实现。
 * serve(无头手机端)不走这里;两个壳消费 collectHandlers() 的同一张表。
 */
import { ipcMain, dialog, app, type BrowserWindow } from "electron";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { collectHandlers } from "./index.js";
import { syncPetWindow, setPetClickThrough } from "../pet-window.js";
import type { IpcHandlerFn } from "./runtime.js";

/** 测试模式文件目录隔离(2026-09-12 事故修复):--ui-test 的 DB 用临时库,但
    dataDir(shimeji-packs/companion-packs/attachments 等文件根)曾直接用真实
    userData——ui-test 清理块"删除全部 shimeji 包"曾把用户 dev 导入的包当
    测试残留全量误删。与 initDb 的临时库条件对齐:测试模式文件也走 tmp。
    注意语音模型在 userData 下另建,不受此影响(voice 测试依赖它做双分支)。 */
function resolveDataDir(): string {
  if (process.argv.includes("--ui-test") || process.argv.includes("--shots") || process.argv.includes("--shots-en")) {
    const dir = join(tmpdir(), "lookatstudy-uitest-files");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* 已存在 */
    }
    return dir;
  }
  return app.getPath("userData");
}

export function setupIpc(mainWindow: BrowserWindow | null): void {
  const table = collectHandlers({
    pet: { sync: syncPetWindow, setClickThrough: setPetClickThrough },
    ui: "electron",
    dataDir: resolveDataDir(),
    emitter: {
      send(channel, ...args) {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send(channel, ...args);
      },
    },
    dialog: {
      async pickFolder(title) {
        const result = await dialog.showOpenDialog(mainWindow!, {
          properties: ["openDirectory"],
          title,
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      async openPack() {
        const picked = await dialog.showOpenDialog(mainWindow!, {
          properties: ["openFile"],
          title: "选择课程包文件",
          filters: [{ name: "LookatStudy 课程包", extensions: ["json"] }],
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        const { readFileSync } = await import("node:fs");
        const filePath = picked.filePaths[0];
        return {
          fileName: filePath.split(/[\\/]/).pop() ?? "pack.json",
          content: readFileSync(filePath, "utf8"),
        };
      },
      async savePack(defaultName, content) {
        const target = await dialog.showSaveDialog(mainWindow!, {
          title: "导出课程包",
          defaultPath: defaultName,
          filters: [{ name: "LookatStudy 课程包", extensions: ["json"] }],
        });
        if (target.canceled || !target.filePath) return null;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(target.filePath, content, "utf8");
        return target.filePath;
      },
      async pickContentFile(filters) {
        const picked = await dialog.showOpenDialog(mainWindow!, {
          properties: ["openFile"],
          title: "选择要导入的文件",
          filters,
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        const { readFileSync } = await import("node:fs");
        const filePath = picked.filePaths[0];
        return {
          fileName: filePath.split(/[\\/]/).pop() ?? "file",
          bytes: new Uint8Array(readFileSync(filePath)),
        };
      },
      async pickContentFiles(filters) {
        const picked = await dialog.showOpenDialog(mainWindow!, {
          properties: ["openFile", "multiSelections"],
          title: "选择要导入的文件(可多选)",
          filters,
        });
        if (picked.canceled) return [];
        const { readFileSync } = await import("node:fs");
        return picked.filePaths.map((filePath) => ({
          fileName: filePath.split(/[/]/).pop() ?? "file",
          bytes: new Uint8Array(readFileSync(filePath)),
        }));
      },
    },
  });

  for (const [channel, fn] of table) {
    ipcMain.handle(channel, fn as IpcHandlerFn);
  }
}
