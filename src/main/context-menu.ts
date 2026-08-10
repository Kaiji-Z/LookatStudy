/**
 * Electron 原生右键菜单 —— 让用户像操作网页一样复制文字、复制/保存图片。
 *
 * 架构:main 进程的 webContents.on('context-menu') handler。
 * 根据右键位置的 DOM 上下文(选中文字 / <img> / 输入框)弹不同菜单:
 *   - 选中文字 → 复制
 *   - <img>(有 data-asset-id)→ 复制图片 / 保存图片
 *   - 输入框 → 撤销/重做/剪切/复制/粘贴/全选(Electron 内建 role)
 *
 * 图片操作走 IPC(asset:saveToFile / asset:copyToClipboard),
 * 因为图片文件在 userData/assets/,需要 main 进程读。
 */
import { Menu, BrowserWindow, clipboard, nativeImage, dialog } from "electron";
import { getAssetById, getAssetFilePath } from "./services/asset-service.js";
import { getDb } from "./db/index.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * 注册右键菜单 handler。
 * 在 BrowserWindow 创建后调用。
 */
export function setupContextMenu(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on("context-menu", async (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // 1. 选中文字 → 复制
    if (params.selectionText && params.selectionText.trim().length > 0) {
      menuItems.push({
        label: "复制",
        role: "copy",
        accelerator: "CmdOrCtrl+C",
      });
    }

    // 2. 图片元素(有 src)→ 复制图片 / 保存图片
    const assetId = await getAssetIdFromDOM(mainWindow, params);
    if (assetId) {
      if (menuItems.length > 0) menuItems.push({ type: "separator" });
      menuItems.push({
        label: "复制图片",
        click: () => copyImageToClipboard(assetId).catch(() => {}),
      });
      menuItems.push({
        label: "保存图片…",
        click: () => saveImageToFile(mainWindow, assetId).catch(() => {}),
      });
    }
    // 没有选中文字也不是图片 → 看是否在可编辑区域
    else if (params.isEditable) {
      menuItems.push({ role: "undo" });
      menuItems.push({ role: "redo" });
      menuItems.push({ type: "separator" });
      menuItems.push({ role: "cut" });
      menuItems.push({ role: "copy" });
      menuItems.push({ role: "paste" });
      menuItems.push({ role: "selectAll" });
    }

    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup({ window: mainWindow });
    }
  });
}

/**
 * 从 DOM 读取右键位置最近的 <img> 的 data-asset-id。
 * 用 executeJavaScript 在 renderer 上下文执行(只读 DOM,不修改状态)。
 */
async function getAssetIdFromDOM(
  win: BrowserWindow,
  params: Electron.ContextMenuParams,
): Promise<string | null> {
  try {
    // params.x/y 是屏幕坐标;用 elementFromPoint 找 DOM 元素
    const result = await win.webContents.executeJavaScript(`
      (function() {
        var el = document.elementFromPoint(${params.x}, ${params.y});
        if (el && el.tagName === 'IMG' && el.dataset.assetId) return el.dataset.assetId;
        if (el) {
          var img = el.querySelector('img[data-asset-id]');
          if (img) return img.dataset.assetId;
        }
        return null;
      })()
    `);
    return typeof result === "string" && result ? result : null;
  } catch {
    return null;
  }
}

/** 复制图片到剪贴板(读 asset 文件 → nativeImage → clipboard) */
async function copyImageToClipboard(assetId: string): Promise<void> {
  const asset = getAssetById(getDb(), assetId);
  if (!asset) return;
  const filePath = getAssetFilePath(asset.courseId, asset.filename);
  if (!existsSync(filePath)) return;
  const buf = await readFile(filePath);
  const img = nativeImage.createFromBuffer(buf);
  clipboard.writeImage(img);
}

/** 保存图片到文件(系统保存对话框) */
async function saveImageToFile(win: BrowserWindow, assetId: string): Promise<void> {
  const asset = getAssetById(getDb(), assetId);
  if (!asset) return;
  const filePath = getAssetFilePath(asset.courseId, asset.filename);
  if (!existsSync(filePath)) return;

  const result = await dialog.showSaveDialog(win, {
    title: "保存图片",
    defaultPath: asset.filename,
    filters: [
      { name: "图片", extensions: [asset.filename.split(".").pop() ?? "png"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) return;

  const buf = await readFile(filePath);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(result.filePath, buf);
}
