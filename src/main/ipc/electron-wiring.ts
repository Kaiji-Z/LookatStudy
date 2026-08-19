/**
 * Electron 壳 —— 把共享 handler 表接到 ipcMain,并提供原生对话框实现。
 * serve(无头手机端)不走这里;两个壳消费 collectHandlers() 的同一张表。
 */
import { ipcMain, dialog, app, type BrowserWindow } from "electron";
import { collectHandlers } from "./index.js";
import type { IpcHandlerFn } from "./runtime.js";

export function setupIpc(mainWindow: BrowserWindow | null): void {
  const table = collectHandlers({
    ui: "electron",
    dataDir: app.getPath("userData"),
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
    },
  });

  for (const [channel, fn] of table) {
    ipcMain.handle(channel, fn as IpcHandlerFn);
  }
}
