/**
 * v0.11 桌宠模式:应用外的透明置顶常驻窗。
 *
 * 桌面伴学的"离开应用也要在"形态:无边框透明全屏(工作区)窗,永远置顶
 * (screen-saver 级)、不进任务栏、不可聚焦(绝不抢主窗焦点)。默认整体点击
 * 穿透(setIgnoreMouseEvents + forward,穿透态下仍收 pointermove 供热区
 * 检测),宠物渲染层发现指针进入生物热区时经 companionPet:setClickThrough
 * 关穿透换交互,离开热区即恢复——桌面上其余区域的点击全部落回原窗口。
 *
 * 窗口生命周期由设置 companion_pet_mode 驱动(settings:set 钩子 →
 * syncPetWindow)。Electron 壳专属,serve(手机/浏览器)没有这个窗。
 */
import { BrowserWindow, app, screen } from "electron";
import { join, resolve } from "node:path";

declare const __dirname: string;

let petWin: BrowserWindow | null = null;

const PROJECT_ROOT = resolve(__dirname, "../..");
const DEV_SERVER_URL = "http://localhost:5173";

/** 开/关桌宠窗(幂等;关 = 销毁)。 */
export function syncPetWindow(enabled: boolean): void {
  if (!enabled) {
    if (petWin && !petWin.isDestroyed()) petWin.destroy();
    petWin = null;
    return;
  }
  if (petWin && !petWin.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  petWin = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    title: "LookatStudy Pet",
    webPreferences: {
      // 与主窗同一个 preload:桌宠窗内 window.api 全可用(轮询 XP/设置)
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      sandbox: false,
    },
  });
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.once("ready-to-show", () => {
    if (!petWin || petWin.isDestroyed()) return;
    petWin.showInactive();
    // 默认全窗穿透;渲染层热区检测后按需关(交互)/开(离开)
    petWin.setIgnoreMouseEvents(true, { forward: true });
  });
  petWin.on("closed", () => {
    petWin = null;
  });
  if (!app.isPackaged) petWin.loadURL(`${DEV_SERVER_URL}/pet.html`);
  else petWin.loadFile(join(PROJECT_ROOT, "dist/renderer/pet.html"));
}

/** 渲染层热区检测回调:true=恢复穿透(桌面可点),false=可交互(戳/拖生物)。 */
export function setPetClickThrough(passThrough: boolean): void {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.setIgnoreMouseEvents(passThrough, { forward: passThrough });
}
