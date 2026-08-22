/**
 * Electron 主进程入口。
 *
 * 职责：
 * 1. 创建 BrowserWindow
 * 2. 初始化 SQLite（initDb）
 * 3. 注册 IPC handlers
 * 4. 加载种子课程（ensureSeedCourse）
 * 5. dev 模式从 vite dev server 加载，生产从打包文件加载
 */
import { app, BrowserWindow, session, shell } from "electron";
import { join, resolve } from "node:path";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { initDb, getDb, markDirty } from "./db/index.js";
import { setupIpc } from "./ipc/electron-wiring.js";
import { setupContextMenu } from "./context-menu.js";
import { ensureSeedCourse } from "./services/seed.js";
import { ensureExamNodesForExistingCourses } from "./services/course-generator.js";
import { loadEnv, getZaiConfig } from "./services/env.js";
import { seedBuiltinSouls } from "./services/souls/soul-service.js";
import { createProposal } from "./services/proposal-service.js";
import { setStateEmitter } from "./lib/state-emitter.js";
import { syncPetWindow } from "./pet-window.js";
import { setExamStatusSender } from "./services/exam-generation-store.js";
import { courses, contentNodes, streaks, settings as settingsTable, customProviders, srsItems, canvasItems, progress as progressTable, chatMessages, threads as threadsTable, exercises as exercisesTable, examAttempts } from "./db/schema.js";
import { and, eq, like as like_ } from "drizzle-orm";

// 主进程以 CJS 打包（见 vite.config.ts），__dirname 天然可用。
// 这里的声明只为 TypeScript 类型检查；运行时被 CJS 全局覆盖。
declare const __dirname: string;

const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;

// 把 main process 的 console.error 重定向到日志文件,方便调试导入管线。
const LOG_FILE = join(app?.getPath?.("userData") ?? process.env.APPDATA ?? ".", "lookatstudy-import.log");
try {
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    origError(...args);
    try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`); } catch { /* ignore */ }
  };
  // 启动时清空旧日志
  try { writeFileSync(LOG_FILE, `[${new Date().toISOString()}] === electron started ===\n`); } catch { /* ignore */ }
} catch { /* ignore */ }

// 项目根目录：从 dist-electron/main/ 退两级到项目根
const PROJECT_ROOT = resolve(__dirname, "../..");

// 关闭硬件加速。
// 原因：Windows 上 Electron GPU 磁盘缓存创建经常因权限失败
// （`Gpu Cache Creation failed: -2` / `Unable to move the cache: 拒绝访问`），
// 导致渲染层 DOM 正常但合成失败 → 黑屏窗口。
// 软件合成对本应用（无 3D / 无视频）完全够用，且更稳定。
// 必须在 app.whenReady() 之前调用。
// --shots/--shots-en(README 截图模式)例外:capturePage 需要真实 GPU 合成,禁用后可能抓到空帧。
const isShotsRun = process.argv.includes("--shots") || process.argv.includes("--shots-en");
if (!isShotsRun) {
  app.disableHardwareAcceleration();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // v0.12 语音输入:允许渲染层请求麦克风(默认 handler 会拒,getUserMedia 直接失败)。
  // 只放行 media(麦克风),其余权限仍走默认询问/拒绝。
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media");
    });
  } catch {
    /* 测试模式等无 session 场景 */
  }

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 832,
    // minWidth=560 = 单栏档(T3)对话的舒适下限。三档布局(T1≥1240 三栏 / T2≥920 双栏 /
    // T3 单栏+按钮组)由渲染层 paneTiers.ts 决定,窗口可自由缩放跨档。
    // 低于此值三栏 flex 布局会溢出(右栏 min-w 被挤)。改宽度规则时同步算这个。
    minWidth: 560,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "LookatStudy",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // preload 与 main 平级：dist-electron/preload/index.js
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 用到部分 Node API（ipcRenderer）
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // 外链走系统浏览器:window.open / target=_blank
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 外链同窗口导航拦截:点击 <a href="https://...">(ReactMarkdown 渲染的链接)
  // 默认会让当前窗口导航到该 URL → 整个 app 被网页覆盖,丢失所有 UI。
  // 拦截所有非内部(file:// / dev server)的导航,转给系统浏览器。
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isInternal =
      url.startsWith("file://") ||
      url.startsWith(DEV_SERVER_URL) ||
      url.startsWith("about:");
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // 右键菜单:复制文字 / 复制图片 / 保存图片(像操作网页一样)
  setupContextMenu(mainWindow);

  if (isDev && process.env["NODE_ENV"] === "development") {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // 渲染层产物：dist/renderer/index.html
    mainWindow.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));
  }
}

// (seedDevProviderFromEnv 逻辑已内联到 app.whenReady 的 isDev 块,避免 esbuild chunk splitting)

// 单实例锁:防止用户开多个主窗口(Windows 双击图标多次 / dev 叠加)。
// 测试模式(--self-test / --ui-test)是独立 headless 实例,绕过锁,不和主窗口互斥。
// dev 模式也绕过:dev 频繁重启,旧实例被 concurrently -k SIGTERM 后可能 zombie 持锁,
// 导致重启时新实例 requestSingleInstanceLock() 拿不到锁立即 quit(表现:重启 dev 打不开、
// electron exit 0 无任何日志)。production 打包后才需要锁(防用户双击多次开多窗口)。
const isTestMode = process.argv.includes("--self-test") || process.argv.includes("--ui-test") || isShotsRun;
// ui-test 需要真麦克风流来验证语音输入链:用 Chromium 假设备(正弦音)换真硬件。
if (process.argv.includes("--ui-test")) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
if (!isTestMode && !isDev) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    // 自己是第二个实例,立即退出
    app.quit();
  } else {
    app.on("second-instance", () => {
      // 有人试图开第二个实例 → 把已有窗口提到前台
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

app.whenReady().then(async () => {
  try {
    // 加载 .env(可选,已 gitignore)。读不到静默跳过。
    loadEnv();
    await initDb();
    console.error("[lookatstudy] DB initialized");
    ensureSeedCourse();
    console.error("[lookatstudy] seed course ensured");
    // 给老库(本功能上线前导入的课程)补章节考试节点。幂等,已含 exam 的 section 跳过。
    const { patched } = ensureExamNodesForExistingCourses(getDb());
    if (patched > 0) {
      console.error(`[lookatstudy] 补了 ${patched} 个章节考试节点`);
      markDirty();
    }
    // 幂等 seed 3 个内置教学人设(direct/guide/practice)
    seedBuiltinSouls(getDb());
    console.error("[lookatstudy] builtin souls ensured");
    // 语言偏好: 首次启动按系统语言写默认值 (用户可在 Settings 改)
    const { ensurePrefLang } = await import("./services/lang-pref.js");
    ensurePrefLang(getDb(), app.getLocale());
    console.error(`[lookatstudy] pref_lang ensured (system locale: ${app.getLocale()})`);
    // dev 模式:从 .env seed provider(内联到 whenReady,避免 esbuild chunk splitting 拆函数致 not defined)
    if (isDev) {
      const zai = getZaiConfig();
      if (!zai) {
        console.error("[lookatstudy] dev: .env 无 Z_AI_API_KEY,跳过 provider seed(在 Settings 手动配)");
      } else {
        try {
          const PID = "custom-dev-env";
          const ex = getDb().select().from(customProviders).where(eq(customProviders.id, PID)).get();
          if (!ex) {
            getDb().insert(customProviders).values({ id: PID, label: "ZAI (.env dev)", baseUrl: zai.baseUrl, apiKey: zai.apiKey, defaultModel: zai.model }).run();
          } else {
            getDb().update(customProviders).set({ apiKey: zai.apiKey, baseUrl: zai.baseUrl, defaultModel: zai.model }).where(eq(customProviders.id, PID)).run();
          }
          const active = getDb().select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
          if (!active) {
            getDb().insert(settingsTable).values({ key: "active_provider", value: PID }).run();
          }
          markDirty();
          console.error(`[lookatstudy] dev: .env provider seeded (ZAI ${zai.apiKey.slice(0, 4)}…${zai.apiKey.slice(-4)}, model ${zai.model})`);
        } catch (e) {
          console.error("[lookatstudy] dev provider seed failed:", e);
        }
      }
    }
  } catch (e) {
    console.error("[lookatstudy] FATAL during init:", e);
    app.quit();
    return;
  }

  // 自检模式：npm run self-test，跑完即退，不开窗
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    app.quit();
    return;
  }

  // UI 验证模式：npm run ui-test，开一个 headless 窗口，加载渲染层，
  // 跑 DOM 断言（真 GUI：真 preload / 真 IPC roundtrip / 真 React 渲染），写结果文件后退出。
  // 这是 §8.2 UI 改造的闭环验证方式（纯 Node 测试无法断言 UI 布局）。
  if (process.argv.includes("--ui-test")) {
    const screenshot = process.argv.includes("--screenshot");
    await runUiTest(screenshot);
    app.quit();
    return;
  }

  // 截图模式:npm run shots → 先中文(--shots)后英文(--shots-en)各跑一遍,
  // 产出 docs/screenshots/(zh,README.zh-CN 用)与 docs/screenshots/en/(en,README 用)。
  if (process.argv.includes("--shots") || process.argv.includes("--shots-en")) {
    const shotsMode = process.argv.includes("--shots-en") ? "en" : "zh";
    // runShots 内部任何未捕获异常都不能悬挂进程(UI 自动化偶发),保证退出
    try {
      await runShots(shotsMode);
    } catch (e) {
      console.error("SHOTS_CRASH=" + (e instanceof Error ? e.message : String(e)));
      console.error("SHOTS_RESULT=" + JSON.stringify({ ok: false, saved: [] }));
    }
    app.quit();
    return;
  }

  // 画线往返测试:npm run test:highlight,验证 rangeToOffsets→offsetsToRange→applyPersistentMarks
  // 在各种 DOM 结构(标题/列表/代码块/嵌套 span/空白)下的精度。真 Chromium DOM。
  if (process.argv.includes("--test-highlight")) {
    await runHighlightTest();
    app.quit();
    return;
  }

  if (mainWindow) {
    setupIpc(mainWindow);
  } else {
    createWindow();
    if (mainWindow) setupIpc(mainWindow);
  }
  // Phase 0: 注入状态变化 emitter。service 内 emitStateChange → 推 "state:changed" 给 renderer。
  setStateEmitter((kind) => mainWindow?.webContents.send("state:changed", kind));
  // 考试生成进度:exam-generation-store → 推 "exam:status" 给 renderer(实时进度/完成/失败)。
  setExamStatusSender((payload) => mainWindow?.webContents.send("exam:status", payload));
  console.error("[lookatstudy] window created, IPC registered");

  // v0.11 桌宠:设置开着就常驻(主窗 Creature 在 petMode 下隐身,避免双影)
  const petModeRow = getDb().select().from(settingsTable).where(eq(settingsTable.key, "companion_pet_mode")).get();
  if (petModeRow?.value === "1") syncPetWindow(true);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * 主进程自检：直接查 DB 验证种子数据写入成功 + schema 正确。
 * 不经过 IPC，纯验证主进程逻辑层。
 */
async function runSelfTest(): Promise<void> {
  const db = getDb();
  const results: Array<{ name: string; ok: boolean; detail?: unknown; knownFail?: boolean; knownFailReason?: string }> = [];

  // 1. 种子课程存在（现在从内置 JSON 加载，不再依赖网络，应为确定性通过）
  const seedCourse = db
    .select()
    .from(courses)
    .where(eq(courses.id, "seed-lookatstudy-guide"))
    .get();
  results.push({
    name: "seed course exists",
    ok: !!seedCourse,
    detail: seedCourse?.title ?? "(种子未灌入)",
  });

  // 2. 课程树有 sections + lessons
  const tree = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, "seed-lookatstudy-guide"))
    .all();
  const sections = tree.filter((n) => n.type === "section");
  const lessons = tree.filter((n) => n.type === "lesson");
  results.push({
    name: "course tree has sections + lessons",
    ok: sections.length >= 3 && lessons.length >= sections.length * 2,
    detail: { sections: sections.length, lessons: lessons.length },
  });

  // 3. streak singleton 存在
  const streakRow = db
    .select()
    .from(streaks)
    .where(eq(streaks.id, "singleton"))
    .get();
  results.push({
    name: "streak singleton exists",
    ok: !!streakRow,
    detail: streakRow,
  });

  // allOk: 所有测试通过 OR 仅 knownFail 测试未通过（如种子课程网络拉取失败）
  const realFails = results.filter((r) => !r.ok && !r.knownFail);
  const knownFails = results.filter((r) => !r.ok && r.knownFail);
  const allOk = realFails.length === 0;
  const report = { overall: allOk, results, knownFailCount: knownFails.length, timestamp: new Date().toISOString() };
  // 写到 cwd，让外部脚本读取
  writeFileSync(join(process.cwd(), ".self-test-result.json"), JSON.stringify(report, null, 2));
  // 也打到 stderr（某些环境可见）
  console.error("SELF_TEST_RESULT=" + JSON.stringify(report));

  if (!allOk) process.exitCode = 1;
}

/**
 * 截图模式（npm run shots）：为 README 产出真实界面截图 → docs/screenshots/。
 *
 * 独立临时 DB + .env 真 provider（LLM 开场是真实对话）;进度/待复习/XP/streak
 * seed 出"学过一阵"的地图观感(皇冠/进度环/锁/复习角标/能量条)。
 * 两套图各跑一遍(独立临时 DB,考试题库/对话按当次界面语言产生,互不污染):
 *   --shots    → docs/screenshots/(中文,README.zh-CN 用)
 *   --shots-en → docs/screenshots/en/(英文,README 用;启动即英文:界面语言
 *                localStorage + 课程 🌐 en 翻译)
 * 每遍序列:选课 → 点首课球 → 01-overview;开始学习 → 猜一轮等揭晓 → 02-ai-tutor;
 * 第一章 Boss 考试(后台分批生成 → 开考计时答一题)→ 03-exam-boss。
 * GPU 合成保持开启(whenReady 前的 disable 对 --shots 跳过),capturePage 才有真实帧。
 */
async function runShots(mode: "zh" | "en"): Promise<void> {
  const outDir = mode === "en" ? join(PROJECT_ROOT, "docs", "screenshots", "en") : join(PROJECT_ROOT, "docs", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const saved: string[] = [];
  const failed: string[] = [];

  // provider:同 ui-test——.env 真 key → 真实 LLM 开场;无 key 用占位(只截界面)
  try {
    const zai = getZaiConfig();
    const PROVIDER_ID = "custom-shots-provider";
    if (getDb().select().from(customProviders).all().length === 0) {
      getDb().insert(customProviders).values({
        id: PROVIDER_ID,
        label: zai ? "ZAI (env)" : "Shots Provider",
        baseUrl: zai?.baseUrl ?? "https://example.com/v1",
        apiKey: zai?.apiKey ?? "test-key",
        defaultModel: zai?.model ?? "test-model",
      }).run();
    }
    const activeRow = getDb().select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
    if (!activeRow) getDb().insert(settingsTable).values({ key: "active_provider", value: PROVIDER_ID }).run();
  } catch (e) {
    console.error("[lookatstudy] shots provider seed failed:", e);
  }

  // 造"学过一阵"的状态:1 课毕业(皇冠) / 2 课进行中(进度环) / 3 课可点 / 其余锁;
  // 首课一条到期复习(地图复习角标) + streak 5 天 + 今日 XP 40。
  try {
    const seeds: Array<{ nodeId: string; status: "mastered" | "in_progress" | "available"; mastery: number; crownLevel: number }> = [
      { nodeId: "guide-les-1-1", status: "mastered", mastery: 0.95, crownLevel: 1 },
      { nodeId: "guide-les-1-2", status: "in_progress", mastery: 0.6, crownLevel: 0 },
      // 第一章三课全部 ≥0.5,让 exam-node 解锁(Boss 考试可进,第 3 张截图用)
      { nodeId: "guide-les-1-3", status: "in_progress", mastery: 0.55, crownLevel: 0 },
    ];
    for (const p of seeds) {
      getDb()
        .insert(progressTable)
        .values({ nodeId: p.nodeId, status: p.status, mastery: p.mastery, crownLevel: p.crownLevel, lastAttemptAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: progressTable.nodeId, set: { status: p.status, mastery: p.mastery, crownLevel: p.crownLevel } })
        .run();
    }
    getDb()
      .insert(srsItems)
      .values({ id: "shot-due-1", nodeId: "guide-les-1-1", easeFactor: 250, intervalDays: 1, repetitions: 3, dueAt: "2020-01-01T00:00:00.000Z", lastReviewedAt: "2020-01-01T00:00:00.000Z" })
      .onConflictDoUpdate({ target: srsItems.id, set: { dueAt: "2020-01-01T00:00:00.000Z" } })
      .run();
    getDb().update(streaks).set({ currentStreak: 5, longestStreak: 12 }).where(eq(streaks.id, "singleton")).run();
    const today = new Date().toISOString().slice(0, 10);
    for (const kv of [{ key: `daily_xp_${today}`, value: "40" }, { key: "total_xp", value: "1240" }]) {
      const ex = getDb().select().from(settingsTable).where(eq(settingsTable.key, kv.key)).get();
      if (!ex) getDb().insert(settingsTable).values(kv).run();
    }
    markDirty();
  } catch (e) {
    console.error("[lookatstudy] shots state seed failed:", e);
  }

  // en 模式:课程 🌐 预置英文翻译(settings 行直写 DB,渲染层启动即读到)
  if (mode === "en") {
    try {
      const k = "course:seed-lookatstudy-guide:locale";
      const ex = getDb().select().from(settingsTable).where(eq(settingsTable.key, k)).get();
      if (ex) getDb().update(settingsTable).set({ value: "en" }).where(eq(settingsTable.key, k)).run();
      else getDb().insert(settingsTable).values({ key: k, value: "en" }).run();
    } catch (e) {
      console.error("[lookatstudy] shots en locale seed failed:", e);
    }
  }

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: true,
    webPreferences: {
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  setupIpc(win);
  setStateEmitter((kind) => win.webContents.send("state:changed", kind));
  setExamStatusSender((payload) => win.webContents.send("exam:status", payload));
  await win.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));

  const js = (code: string): Promise<unknown> =>
    win.webContents.executeJavaScript(code).catch(() => null);
  const sizes: Record<string, number> = {};
  const capture = async (): Promise<Buffer> => {
    try {
      return (await win.webContents.capturePage()).toPNG();
    } catch {
      return Buffer.alloc(0);
    }
  };
  const shot = async (name: string): Promise<void> => {
    // 强制重合成 + DOM 语言探针:loadFile 二次加载后偶发"文档已新、窗口像素仍旧"
    // (en 遍实测:DOM/DB 全英文,截图像素却是中文)。hide/show 走一遍完整合成管线,
    // 探针日志与截图对照,再遇到不同步能立刻定位。
    try { win.hide(); } catch {}
    await new Promise((r) => setTimeout(r, 150));
    try { win.show(); } catch {}
    await new Promise((r) => setTimeout(r, 400));
    const probe = await js(`(function(){
      var ta = document.querySelector('[data-testid="composer"] textarea, textarea');
      var a = document.querySelector('[data-testid="msg-assistant"]');
      return JSON.stringify({
        ph: ta ? String(ta.placeholder || "").slice(0, 20) : null,
        a: a ? String(a.textContent || "").slice(0, 20) : null
      });
    })()`);
    console.error(`[lookatstudy] dom-probe ${name}: ${String(probe)}`);
    await new Promise((r) => setTimeout(r, 800)); // 等入场动画/合成稳定
    let png = await capture();
    for (let i = 0; i < 5 && png.length === 0; i++) {
      // 偶发 0 字节(合成/显示表面丢失,长 LLM 等待后窗口闲置相关):唤起窗口再试
      try {
        win.show();
        win.focus();
      } catch {}
      await new Promise((r) => setTimeout(r, 2500));
      png = await capture();
    }
    const prev = join(outDir, name);
    if (png.length === 0 && existsSync(prev) && statSync(prev).size > 0) {
      // 宁可保留旧图也不用 0 字节覆盖好图;本次标记失败,结果里如实报告
      failed.push(name);
      console.error(`[lookatstudy] shot FAILED (0 bytes, kept old file): ${name}`);
      return;
    }
    writeFileSync(join(outDir, name), png);
    saved.push(name);
    sizes[name] = png.length;
    console.error(`[lookatstudy] shot saved: ${name} (${png.length} bytes)`);
  };
  // localStorage 在共享 userData 里(只有 DB 是临时的),英文模式写进去后必须还原,
  // 否则正常启动的 app 会残留英文界面语言
  const restoreLang = (): Promise<unknown> =>
    js(`(function(){ try { localStorage.removeItem("lookatstudy-lang"); } catch (e) {} return true; })()`);

  if (mode === "en") {
    // 界面语言在渲染层 localStorage:首次加载(默认中文)后写入,再 loadFile 一次。
    // 用 loadFile 而非 reload():后者会以 "display surface not available" reject 后悬挂
    await js(`(function(){ try { localStorage.setItem("lookatstudy-lang", "en"); } catch (e) {} return true; })()`);
    await win.webContents
      .loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"))
      .catch((e) => console.error("[lookatstudy] shots en reload failed:", e instanceof Error ? e.message : e));
  }

  // 渲染层挂载
  await js(`(async function(){
    for (var i = 0; i < 60; i++) {
      await new Promise(function(r){ setTimeout(r, 250); });
      if (document.querySelector('[data-testid="course-list"]')) return true;
    }
    return false;
  })()`);

  // 选课 → 等地图节点
  await js(`(async function(){
    var row = document.querySelector('[data-testid="course-list"] button');
    if (!row) return false;
    row.click();
    for (var i = 0; i < 40; i++) {
      await new Promise(function(r){ setTimeout(r, 250); });
      if (document.querySelectorAll('[data-testid^="map-node-"]').length >= 1) return true;
    }
    return false;
  })()`);

  // 点首个可点的球(mastered 课) → 选中环 + 讲解内容
  await js(`(async function(){
    var btns = document.querySelectorAll('[data-testid^="map-node-"]');
    for (const b of btns) { if (!b.disabled) { b.click(); break; } }
    for (var i = 0; i < 40; i++) {
      await new Promise(function(r){ setTimeout(r, 250); });
      if (document.querySelector('[data-testid="notebook-panel"]')) return true;
    }
    return false;
  })()`);
  // 语言门:开始学习按钮必须是当次语言文案。宁可失败退出也不存错语言的图
  // (js() 吞错曾把切换失败变成"成功",存出过中文图)。
  const wantLabel = mode === "en" ? "start learning" : "开始学习";
  const langOk = await js(`(async function(){
    for (var i = 0; i < 40; i++) {
      var btn = document.querySelector('[data-testid="start-learning-btn"]');
      var t = btn ? String(btn.textContent || "").toLowerCase() : "";
      if (t.indexOf("${wantLabel}") !== -1) return true;
      await new Promise(function(r){ setTimeout(r, 250); });
    }
    return false;
  })()`);
  if (langOk !== true) {
    console.error(`SHOTS_LANG_GATE_FAILED=1 (mode=${mode}, button label mismatch)`);
    if (mode === "en") await restoreLang();
    console.error("SHOTS_RESULT=" + JSON.stringify({ ok: false, mode, saved, failed }));
    return;
  }

  await shot("01-overview.png");

  // 开始学习 → 等 LLM 第一轮(hook + 二选一卡) → 点一个选项 → 等第二轮揭晓
  const WAIT_REPLY = `(async function(){
    // 等 assistant 出现且流式结束(chat-stop 消失),文本长度 1.2s 不再增长才算稳
    var lastLen = -1, stableSince = -1;
    var start = Date.now();
    while (Date.now() - start < 90000) {
      await new Promise(function(r){ setTimeout(r, 400); });
      var streaming = document.querySelector('[data-testid="chat-stop"]');
      var msgs = document.querySelectorAll('[data-testid="msg-assistant"]');
      var len = 0; for (const m of msgs) len += (m.textContent || "").length;
      var now = Date.now();
      if (!streaming && msgs.length > 0) {
        if (len === lastLen) {
          if (stableSince < 0) stableSince = now;
          else if (now - stableSince > 1200) return true;
        } else stableSince = -1;
      }
      lastLen = len;
    }
    return false;
  })()`;
  const started = await js(`(async function(){
    var btn = document.querySelector('[data-testid="start-learning-btn"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (started === true) {
    await js(WAIT_REPLY);
    const picked = await js(`(async function(){
      // 有二选一卡就点第一个选项,再等一轮揭晓;没有就算了(直接截第一轮)
      var opts = document.querySelectorAll('[data-testid^="guess-option-"]');
      if (opts.length === 0) return false;
      opts[0].click();
      return true;
    })()`);
    if (picked === true) await js(WAIT_REPLY);
  }
  await shot("02-ai-tutor.png");

  // 第一章 Boss 考试:点考试球(map testid 用 id 前 8 位,六个考试球同为 guide-ex,取第一个可点的)
  // → 后台按知识点分批生成(种子课无 KC,走课时标题伪 KC)→ 就绪 → 开考 → 截答题界面。
  await js(`(async function(){
    var nodes = document.querySelectorAll('[data-testid="exam-node-guide-ex"]');
    for (const n of nodes) { if (!n.disabled) { n.click(); break; } }
    for (var i = 0; i < 960; i++) { // 最多 240s 等生成分批出题
      await new Promise(function(r){ setTimeout(r, 250); });
      var ready = document.querySelector('[data-testid="exam-start-btn"]');
      var err = document.querySelector('[data-testid="exam-error"]');
      if (ready || err) return true;
    }
    return false;
  })()`);
  await js(`(async function(){
    var btn = document.querySelector('[data-testid="exam-start-btn"]');
    if (!btn) return false;
    btn.click();
    for (var i = 0; i < 80; i++) {
      await new Promise(function(r){ setTimeout(r, 250); });
      if (document.querySelector('[data-testid="exam-answering"]') && document.querySelector('[data-testid="exam-timer"]')) return true;
    }
    return false;
  })()`);
  await js(`(async function(){
    var opt = document.querySelector('[data-testid="exam-option-0"]');
    if (opt) opt.click();
    // 选完停 8 秒:倒计时环走掉一段(看得出是限时),选中态也稳了
    await new Promise(function(r){ setTimeout(r, 8000); });
    return true;
  })()`);
  await shot("03-exam-boss.png");

  if (mode === "en") await restoreLang();

  const ok = saved.length === 3 && failed.length === 0 && saved.every((s) => (sizes[s] ?? 0) > 0);
  console.error("SHOTS_RESULT=" + JSON.stringify({ ok, mode, saved, failed, sizes }));
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * UI 验证：开 headless 窗口，加载构建产物（dist/renderer），等渲染层跑完
 * IPC 拉数据 + React 渲染，然后在渲染层执行 DOM 断言。
 *
 * 真 GUI 闭环：preload 注入的 window.api → IPC → DB → 回渲染层 → DOM。
 * 断言用 data-testid 锚点（与 App.tsx 里写的 testid 对齐）。
 *
 * 与 self-test 互补：self-test 只测主进程 DB；本函数测渲染层 + IPC + UI 结构。
 * 需要 npm run build 先跑（加载 dist/renderer/index.html）。
 */
async function runUiTest(screenshot = false): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: unknown; knownFail?: boolean; knownFailReason?: string }> = [];

  // headless 窗口（show:false）。screenshot 模式下临时 show 以便抓图。
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    show: screenshot,
    webPreferences: {
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 隐藏窗口默认后台节流会暂停 rAF——伴学位置探针会读到冻死的 transform(v9 实测
      // 假红:坐标分钟级不变但零错误)。关掉节流,隐藏窗口里动画循环照跑。
      backgroundThrottling: false,
    },
  });
  setupIpc(win);

  // M2 测试造数：造一条 pending proposal，让 T8 能测 listPending→reject→空 的回路
  // （渲染层没暴露 createProposal IPC——create 是 AI 发起的，学习者只 list/apply/reject）
  try {
    createProposal(getDb(), {
      operations: [{ type: "update_mastery", nodeId: "test-seed-node", correct: true }],
      rationale: "UI test seed proposal",
    });
  } catch (e) {
    console.error("[lookatstudy] ui-test proposal seed failed:", e);
  }
  // 造一个 custom provider + active 设置(让 agentReady=true,ChatComposer 渲染 soul-picker)。
  // 优先用 .env 里的真实 ZAI key(让 ui-test 能真实出题/答题);没有则用占位假 key(只验证渲染)。
  try {
    // schema 已在顶部 static import(消除 rollup 混合 static+dynamic 导入警告)
    const zai = getZaiConfig();
    const PROVIDER_ID = "custom-ui-test-provider";
    const existingProvider = getDb().select().from(customProviders).all();
    if (existingProvider.length === 0) {
      getDb().insert(customProviders).values({
        id: PROVIDER_ID,
        label: zai ? "ZAI (env)" : "UI Test Provider",
        baseUrl: zai?.baseUrl ?? "https://example.com/v1",
        apiKey: zai?.apiKey ?? "test-key",
        defaultModel: zai?.model ?? "test-model",
      }).run();
    }
    // active_provider 用 upsert(确保指向存在的 provider id)。用户已配置则保留。
    const activeRow = getDb().select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
    const desiredValue = PROVIDER_ID;
    if (!activeRow) {
      getDb().insert(settingsTable).values({ key: "active_provider", value: desiredValue }).run();
    } else if (activeRow.value !== desiredValue && !activeRow.value.startsWith("custom-")) {
      getDb().update(settingsTable).set({ value: desiredValue }).where(eq(settingsTable.key, "active_provider")).run();
    }
  } catch (e) {
    console.error("[lookatstudy] ui-test provider seed failed:", e);
  }

  // P2.3: 播一条已到期 srs 项,验证"待复习"在地图上浮现(map-review-badge)。
  // 幂等:onConflictDoUpdate —— 持久 DB 下重复运行不再 UNIQUE 冲突,到期项始终就位。
  try {
    getDb()
      .insert(srsItems)
      .values({
        id: "ui-due-seed",
        nodeId: "guide-les-1-1",
        easeFactor: 250,
        intervalDays: 1,
        repetitions: 1,
        dueAt: "2020-01-01T00:00:00.000Z",
        lastReviewedAt: "2020-01-01T00:00:00.000Z",
      })
      .onConflictDoUpdate({
        target: srsItems.id,
        set: {
          dueAt: "2020-01-01T00:00:00.000Z",
          lastReviewedAt: "2020-01-01T00:00:00.000Z",
          repetitions: 1,
          intervalDays: 1,
        },
      })
      .run();
  } catch (e) {
    console.error("[lookatstudy] ui-test srs seed failed:", e);
  }

  // P2.4 前置:首课标 in_progress → 复习抽屉"交错复习"按钮(startedLessons>0 才渲染)。
  // 幂等 onConflictDoUpdate;不改 mastery(不动解锁状态,不影响 enabledCount 断言)。
  try {
    getDb()
      .insert(progressTable)
      .values({
        nodeId: "guide-les-1-1",
        status: "in_progress",
        crownLevel: 0,
        lastAttemptAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: progressTable.nodeId,
        set: { status: "in_progress" },
      })
      .run();
  } catch (e) {
    console.error("[lookatstudy] ui-test progress seed failed:", e);
  }

  // 笔记三区:为种子首课播一条 canvas_item。否则 notes tab 命中 total===0 空态、三区不渲染
  // (此前 T15/T19 误标 knownFail 为"canvas 异步时序",实为 seed 无 canvas_item → 空态)。
  try {
    getDb()
      .insert(canvasItems)
      .values({
        id: "ui-canvas-seed",
        nodeId: "guide-les-1-1",
        courseId: "seed-lookatstudy-guide",
        artifactType: "concept_map",
        title: "UI test seed",
        data: "{}",
      })
      .run();
  } catch (e) {
    console.error("[lookatstudy] ui-test canvas seed failed:", e);
  }

  // v0.21 shiki:给种子首课讲解注入一个 ts 代码围栏(断言讲解区语法高亮)。
  // 保存原文,断言后恢复(共享现场纪律:不留测试残留)。
  let shikiSeedOriginal: string | null = null;
  try {
    const row = getDb()
      .select({ content: contentNodes.content })
      .from(contentNodes)
      .where(eq(contentNodes.id, "guide-les-1-1"))
      .get();
    if (row?.content && !row.content.includes("SHIKI_UI_TEST_FENCE")) {
      shikiSeedOriginal = row.content;
      getDb()
        .update(contentNodes)
        .set({
          content:
            row.content +
            "\n\n```ts\n// SHIKI_UI_TEST_FENCE\nconst answer: number = 42;\n```",
        })
        .where(eq(contentNodes.id, "guide-les-1-1"))
        .run();
    }
  } catch (e) {
    console.error("[lookatstudy] ui-test shiki seed failed:", e);
  }

  // v0.21 mermaid ELK:笔记理解区种一张 flowchart 图卡(ELK 生效断言的载体)。
  // 语法必须合法——否则触发修复回路(LLM 假 key,静默失败走源码 fallback)。
  try {
    getDb()
      .insert(canvasItems)
      .values({
        id: "ui-diagram-seed",
        nodeId: "guide-les-1-1",
        courseId: "seed-lookatstudy-guide",
        artifactType: "diagram",
        title: "UI test flowchart",
        data: JSON.stringify({
          artifactType: "diagram",
          title: "学习闭环",
          mermaid: "flowchart TD\n  学[学习] --> 练[练习]\n  练 --> 测[测验]\n  测 --> 复[复习]",
          diagramType: "flowchart",
        }),
      })
      .onConflictDoNothing()
      .run();
  } catch (e) {
    console.error("[lookatstudy] ui-test diagram seed failed:", e);
  }

  // 加载构建产物（不依赖 vite dev server，CI 友好）
  // v0.11 三档布局:ui-test 断言主体跑在 T1(三栏)——窗口默认 800 落在 T3 单栏,
  // 先拉宽再加载(渲染层初始化即测得 1280);末尾有专门的跨档行为测试。
  await win.setBounds({ width: 1280, height: 800 });
  await win.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));

  // 等渲染层拉完数据 + React 渲染完。轮询所有关键 testid 都出现——
  // 不能只等容器，因为 souls/courses 是异步并行拉的，容器早出、内容晚出，会 race。
  // 课程空选启动:map-node-* 要等手动选课后才出现,初始等待只等三栏 + 课程列表(导入面板)。
  const waitRender = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    const checkAll = () =>
      win.webContents.executeJavaScript(`
        document.querySelector('[data-testid="map-rail"]') !== null &&
        document.querySelector('[data-testid="chat-panel"]') !== null &&
        document.querySelector('[data-testid="notebook-panel"]') !== null &&
        document.querySelector('[data-testid="course-list"]') !== null
      `);
    while (Date.now() < deadline) {
      try {
        const ready = await checkAll();
        if (ready) return true;
      } catch {
        // 页面跳转中，忽略
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  /** 模拟用户手动选课(空选启动后):点课程列表第一行 → 等地图节点渲染。reload 后复用。 */
  const selectFirstCourse = (): Promise<boolean> =>
    win.webContents.executeJavaScript(`
      (async function() {
        var row = document.querySelector('[data-testid="course-list"] button');
        if (!row) return false;
        row.click();
        for (var i = 0; i < 40; i++) {
          await new Promise(function(r){ setTimeout(r, 250); });
          if (document.querySelectorAll('[data-testid^="map-node-"]').length >= 1) return true;
        }
        return false;
      })()
    `).catch(() => false);

  const rendered = await waitRender();
  results.push({
    name: "renderer mounted (map-rail + chat-panel + notebook-panel + course-list)",
    ok: rendered,
    detail: rendered ? "DOM testids present" : "timeout waiting for render",
  });

  if (!rendered) {
    // 渲染失败就早退，写文件让人看到原因
    const allOk = false;
    const report = { overall: allOk, results, timestamp: new Date().toISOString() };
    writeFileSync(join(process.cwd(), ".ui-test-result.json"), JSON.stringify(report, null, 2));
    console.error("UI_TEST_RESULT=" + JSON.stringify(report));
    process.exitCode = 1;
    return;
  }

  // T0 (课程空选启动): 不自动选课 —— 中栏选课引导空态 + 地图零节点 + 导入面板课程列表可见。
  const emptyStart = await win.webContents.executeJavaScript(`
    (function() {
      var noCourse = document.querySelector('[data-testid="chat-no-course"]');
      var mapNodes = document.querySelectorAll('[data-testid^="map-node-"]').length;
      var courseList = document.querySelectorAll('[data-testid="course-list"] > *').length;
      return { noCourse: !!noCourse, mapNodes: mapNodes, courseRows: courseList };
    })()
  `);
  results.push({
    name: "startup: no course pre-selected (empty-state + zero map nodes + course list)",
    ok: emptyStart?.noCourse === true && emptyStart?.mapNodes === 0 && emptyStart?.courseRows >= 1,
    detail: emptyStart,
  });

  // T0a (伴学 v9 常驻): 无课程空态 creature 已在场且 rAF 循环活着——
  // transform 由 rAF 写入(左上角卡死 bug 的回归探针:effect 首跑时 ref 未挂,
  // deps 不变则 rAF 永不启动,creature 停在 DOM 默认 0,0)。
  const emptyCreature = await win.webContents.executeJavaScript(`
    (async function() {
      window.__cpErr = [];
      window.addEventListener("error", function(e) { window.__cpErr.push(String(e.message).slice(0, 200)); });
      function sample() {
        var el = document.querySelector('[data-testid="companion-creature"]');
        if (!el) return null;
        var t = el.style.transform || "";
        if (t.indexOf("translate3d(") !== 0) return null;
        var body = t.slice(12);
        var xs = body.slice(0, body.indexOf("px"));
        var rest = body.slice(body.indexOf("px") + 3);
        var ys = rest.slice(0, rest.indexOf("px"));
        var x = parseFloat(xs), y = parseFloat(ys);
        return (isNaN(x) || isNaN(y)) ? null : { x: x, y: y };
      }
      var a = sample();
      await new Promise(function(r){ setTimeout(r, 1200); });
      var b = sample();
      return { a: a, b: b, moved: !!(a && b && (Math.abs(a.x-b.x) > 2 || Math.abs(a.y-b.y) > 2)) };
    })()
  `).catch(() => null);
  results.push({
    name: "companion v9: always-on at empty state (rAF loop alive, not stuck at 0,0)",
    // 首采样为 null 合法(设置异步加载完 creature 才首次渲染);判据=终态在场+不在原点+在动
    ok: !!emptyCreature?.b && (emptyCreature.moved || Math.abs(emptyCreature.b.y) > 60),
    detail: emptyCreature,
  });

  // T0b (手动选课): 点课程行 → 不跳界面地加载该课,自动切地图面板 + 节点渲染。
  const picked = await selectFirstCourse();
  results.push({
    name: "manual course select: course row click → map nodes rendered",
    ok: picked === true,
    detail: picked ? "map nodes present after click" : "map nodes never appeared",
  });

  // T1: soul-picker(教学人设药丸行)里应有 3 个内置 soul(direct/guide/practice)
  const optionCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="soul-pill-"]').length`,
  );
  results.push({
    name: "soul-picker has 3 builtin souls (direct/guide/practice)",
    ok: typeof optionCount === "number" && optionCount === 3,
    detail: { optionCount },
  });

  // T2: map-rail 至少有 1 个视图切换项 + path overview 有节点
  const navNodeCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="map-node-"]').length`,
  );
  results.push({
    name: "map-rail path overview has ≥1 node",
    ok: typeof navNodeCount === "number" && navNodeCount >= 1,
    detail: { navNodeCount },
  });

  // T2c (companion v3): 选课 + 默认开 → 单生物在场且在左栏原生物理世界(zone=rail)
  const railCompanion = await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('[data-testid="companion-creature"]'); return el ? el.dataset.zone : null; })()`,
  );
  const railPos = await win.webContents.executeJavaScript(`
    (function() {
      var el = document.querySelector('[data-testid="companion-creature"]');
      if (!el) return null;
      var t = el.style.transform || "";
      if (t.indexOf("translate3d(") !== 0) return null;
      var body = t.slice(12);
      var xs = body.slice(0, body.indexOf("px"));
      var rest = body.slice(body.indexOf("px") + 3);
      var ys = rest.slice(0, rest.indexOf("px"));
      var x = parseFloat(xs), y = parseFloat(ys);
      return (isNaN(x) || isNaN(y)) ? null : { x: x, y: y };
    })()
  `).catch(() => null);
  const railErrors = await win.webContents
    .executeJavaScript(`(window.__cpErr && window.__cpErr.slice(0, 5)) || []`)
    .catch(() => []);
  results.push({
    name: "companion v10: creature alive at course pick (roam pane, position written)",
    // v10 闲时=roam 跨栏游走:栖身栏由时间桶决定(任意栏都合法),只要求在场+位置已写
    ok: ["rail", "chat", "notebook"].includes(railCompanion) && !!railPos && railPos.y > 60,
    detail: { zone: railCompanion, pos: railPos, errors: railErrors },
  });

  // T3: 三栏都在(chat-panel + notebook-panel + map-rail)
  const threePane = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="map-rail"]') !== null &&
    document.querySelector('[data-testid="chat-panel"]') !== null &&
    document.querySelector('[data-testid="notebook-panel"]') !== null
  `);
  results.push({
    name: "three-pane layout rendered (nav + chat + artifact)",
    ok: threePane === true,
  });

  // T4: streak badge 渲染（说明 getStreak IPC roundtrip 成功）
  const streakPresent = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="streak-badge"]') !== null`,
  );
  results.push({
    name: "streak badge rendered (getStreak IPC OK)",
    ok: streakPresent === true,
  });

  // T4a (P4 能力感): 等级徽章 + freeze 徽章(庆祝粒子层 CelebrationLayer 由 motion-infra 套件覆盖)
  const competenceBadges = await win.webContents.executeJavaScript(`
    (function() {
      var lvl = document.querySelector('[data-testid="level-badge"]');
      var frz = document.querySelector('[data-testid="freeze-badge"]');
      return {
        levelBadge: !!lvl,
        levelText: lvl ? (lvl.textContent || "").trim() : null,
        freezeBadge: !!frz,
      };
    })()
  `);
  results.push({
    name: "level badge + freeze badge rendered (P4 competence)",
    ok: competenceBadges?.levelBadge === true && competenceBadges?.freezeBadge === true,
    detail: competenceBadges,
  });

  // T4b (P2.3 待复习顶出): 播的逾期 srs 项 → map-review-badge 显示待复习数。
  // 等 due 数据 + panel 切换(courseId useEffect → setPanel("map"))异步完成。
  await new Promise((r) => setTimeout(r, 800));
  const dueBadge = await win.webContents.executeJavaScript(`
    (function() {
      var b = document.querySelector('[data-testid="map-review-badge"]');
      return { present: !!b, text: b ? (b.textContent || "").trim() : null };
    })()
  `);
  results.push({
    name: "due-review surfacing: overdue item → map-review badge (P2.3)",
    ok: dueBadge?.present === true,
    detail: dueBadge,
  });

  // T4c (P2.4 交错复习): 打开复习抽屉 → 交错复习按钮在;然后关掉抽屉不影响后续。
  const interleave = await win.webContents.executeJavaScript(`
    (async function() {
      var badge = document.querySelector('[data-testid="map-review-badge"]');
      if (!badge) return { ok: false, reason: "no badge" };
      badge.click();
      await new Promise(function(r){ setTimeout(r, 400); });
      var panel = document.querySelector('[data-testid="review-panel"]');
      var interleaveBtn = document.querySelector('[data-testid="review-interleave"]');
      var close = document.querySelector('[data-testid="review-close"]');
      if (close) close.click();
      await new Promise(function(r){ setTimeout(r, 150); });
      return { ok: !!panel && !!interleaveBtn, panel: !!panel, interleave: !!interleaveBtn };
    })()
  `);
  results.push({
    name: "interleaved review: drawer opens + interleave entry present (P2.4)",
    ok: interleave?.ok === true,
    detail: interleave,
  });

  // T_nextlabel: 节点名牌仅选中态显示(干净地图原则);首可学不再常显 label,
  // 节点名靠 hover GlobalTooltip(data-tooltip)。验证 map-next-label 不存在。
  const nextLabel = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="map-next-label"]') !== null`,
  );
  results.push({
    name: "node label only on selected; first-available does NOT pin a label (clean map)",
    ok: nextLabel === false,
  });

  // T5: 点击一个未锁的 map-node → 触发 markNodeAttempted → 联动右栏
  let clickResult: { clicked?: boolean; totalBtns?: number; enabledCount?: number; error?: string } = {};
  try {
    clickResult = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var btns = document.querySelectorAll('[data-testid^="map-node-"]');
          var arr = [];
          for (var i = 0; i < btns.length; i++) arr.push(btns[i]);
          var enabled = arr.filter(function(b){ return !b.disabled; });
          for (var j = 0; j < enabled.length; j++) {
            enabled[j].click();
            return { clicked: true, totalBtns: btns.length, enabledCount: enabled.length };
          }
          return { clicked: false, totalBtns: btns.length, enabledCount: enabled.length };
        } catch (e) {
          return { error: String(e) };
        }
      })()
    `);
  } catch (e) {
    clickResult = { error: String(e) };
  }
  results.push({
    name: "clicked an unlocked map-node (markNodeAttempted IPC)",
    ok: clickResult?.clicked === true,
    detail: clickResult,
  });

  // T6: 点 soul 药丸 → setActiveSoul IPC roundtrip(点按钮触发 onClick)
  const soulSelect = await win.webContents.executeJavaScript(`
    (function() {
      const pill = document.querySelector('[data-testid="soul-pill-direct"]');
      if (!pill) return { ok: false, reason: "soul-pill not found" };
      pill.click();
      return { ok: true, value: "direct" };
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));
  results.push({
    name: "soul select change triggers setActiveSoul",
    ok: soulSelect?.ok === true && soulSelect?.value === "direct",
    detail: soulSelect,
  });

  // T7 (M2): isAgentReady 在未配 key 时返回 ready:false（渲染层只见布尔，不见 key）
  const readyState = await win.webContents.executeJavaScript(
    `window.api.isAgentReady()`,
  );
  results.push({
    name: "isAgentReady returns valid state (ready boolean + provider + model)",
    ok: typeof readyState?.ready === "boolean" && typeof readyState?.provider === "string",
    detail: readyState,
  });

  // T8 (M2): proposal IPC 完整回路 —— listPending（应含 1 条 seed）
  //   → reject → listPending（应空）。验证 M2 接线 + proposal-service 真生效。
  const proposalRoundtrip = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const before = await window.api.listPendingProposals();
        if (before.length === 0) return { ok: false, reason: "no seed proposal found" };
        // 拒绝所有 pending proposals（测试环境可能有之前运行残留的）
        for (const p of before) {
          await window.api.rejectProposal(p.id);
        }
        const after = await window.api.listPendingProposals();
        return {
          ok: after.length === 0,
          beforeCount: before.length,
          afterCount: after.length,
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "proposal list→reject→empty roundtrip (M2 wiring)",
    ok: proposalRoundtrip?.ok === true,
    detail: proposalRoundtrip,
  });

  // T8a (v0.2 三栏): chat-stream + composer 都在(中栏完整)
  const midPane = await win.webContents.executeJavaScript(`
    (function() {
      const stream = document.querySelector('[data-testid="chat-stream"]');
      const composer = document.querySelector('[data-testid="composer"], [data-testid="composer-nokey"]');
      return {
        chatStream: !!stream,
        composer: !!composer,
      };
    })()
  `);
  results.push({
    name: "mid-pane: chat-stream + composer rendered",
    ok: midPane?.chatStream && midPane?.composer,
    detail: midPane,
  });

  // T8b (v0.4 联动): map-node 点击 → ThreadSwitcher 焦点节点 + thread 创建/切换
  const linkage = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btns = document.querySelectorAll('[data-testid^="map-node-"]');
        let clicked = null;
        for (const b of btns) {
          if (!b.disabled) { b.click(); clicked = b.getAttribute('data-testid'); break; }
        }
        if (!clicked) return { ok: false, reason: "no enabled map-node" };
        await new Promise(r => setTimeout(r, 600));
        // v0.4: ThreadSwitcher 存在(有 thread 显示 tabs,无 thread 显示 empty 提示)
        const switcherEl = document.querySelector('[data-testid="thread-switcher"], [data-testid="thread-switcher-empty"]');
        const tabCount = document.querySelectorAll('[data-testid^="thread-tab-"]').length;
        return {
          ok: !!switcherEl,
          clicked,
          tabCount,
          hasEmpty: !!document.querySelector('[data-testid="thread-switcher-empty"]'),
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "map-node click → ThreadSwitcher shows focus node (联动)",
    ok: linkage?.ok === true,
    detail: linkage,
  });

  // T8c2 (companion v3): 聚焦输入框 → 单生物飞来中栏(data-zone=chat)
  // + 逐键反应(Bongo Cat 式):合成 keydown → 机体进入 cp-pose-typing。
  // 必须在 keyless 冷启动之前跑(keyless 时 composer 是无 key 卡,没有 textarea)。
  // headless 窗口可能没有 OS 焦点:Chromium 对失焦文档不派发真实 focus 事件
  // (element.focus() 只改 activeElement)——先 win.focus() 给焦点,真实链路才走得到。
  win.focus();
  win.webContents.focus();
  const chatZoneTyping = await win.webContents
    .executeJavaScript(
      `
    (async function() {
      var input = document.querySelector('[data-testid="chat-input"]');
      if (!input) return { ok: false, err: "no-input" };
      var dis = input.disabled;
      input.focus();
      var ae = document.activeElement === input;
      var hf = document.hasFocus();
      var samples = [];
      for (var i = 0; i < 12; i++) {
        await new Promise(function(r) { setTimeout(r, 100); });
        var c = document.querySelector('[data-testid="companion-creature"]');
        samples.push(c ? c.dataset.zone : "none");
        if (c && c.dataset.zone === "chat") break;
      }
      var c = document.querySelector('[data-testid="companion-creature"]');
      var zone = c ? c.dataset.zone : null;
      // 等跨栏飞行姿势窗(~950ms)结束再敲键:cp-pose-flying 压过 typing;
      // v10 roam 时间桶可能恰好又起一段跨栏飞行(2026-08-22 实测 3/3 偶发),
      // 重试敲键直到姿势窗落地(上限 ~5s,防死等,仍要求真实观察到 typing)
      var cls = '';
      for (var k = 0; k < 10; k++) {
        await new Promise(function(r) { setTimeout(r, 300); });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
        await new Promise(function(r) { setTimeout(r, 200); });
        var m = document.querySelector('[data-testid="companion-mascot"]');
        cls = m ? String(m.getAttribute('class')) : '';
        if (cls.indexOf('cp-pose-typing') >= 0) break;
      }
      // 释放聚焦闩(blur 事件在无 OS 焦点的 headless 下可能不派发,事件兜底)
      input.blur();
      window.dispatchEvent(new CustomEvent("companion-zone-focus", { detail: false }));
      return { ok: zone === "chat" && cls.indexOf('cp-pose-typing') >= 0, zone: zone, disabled: dis, focused: ae, hasFocus: hf, samples: samples.join(","), cls: cls.slice(0, 90) };
    })()
  `,
    )
    .catch(() => null);
  results.push({
    name: "companion v3: composer focus flies creature to chat zone + Bongo-Cat typing reaction",
    ok: chatZoneTyping?.ok === true,
    detail: chatZoneTyping,
  });

  // T8d (P1 启动沉浸): 选中节点后,空会话显示问候 + 开始学习按钮(agentReady=true 路径)
  const startState = await win.webContents.executeJavaScript(`
    (function() {
      var empty = document.querySelector('[data-testid="chat-empty-state"]');
      var txt = empty ? (empty.textContent || "") : "";
      return {
        hasEmpty: !!empty,
        hasGreeting: /👋/.test(txt),
        hasStartBtn: document.querySelector('[data-testid="start-learning-btn"]') !== null,
      };
    })()
  `);
  results.push({
    name: "empty state shows greeting + start-learning button (P1.2/P1.4)",
    ok: startState?.hasEmpty === true && startState?.hasStartBtn === true,
    detail: startState,
  });

  // T8f (companion v3): 学习中(节点已选中) → 单生物仍在场(单例连续体,不论在哪
  // 个世界都不消失;此刻默认在左栏老家)
  const notebookCompanion = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="companion-creature"]') !== null`,
  );
  results.push({
    name: "companion v3: single creature persists while node selected",
    ok: notebookCompanion === true,
  });

  // T8e (按钮消息展示): 点「开始学习」→ 乐观 user 气泡立刻出现且只显示短动作标签,
  // 发给 LLM 的完整开场提示词不出现在 DOM(防"按钮 prompt 裸奔"回归)。
  // 断言完立即停流(chat-stop),避免 LLM 流式阻塞后续测试的节点切换。
  const actionDisplay = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        var btn = document.querySelector('[data-testid="start-learning-btn"]');
        if (!btn) return { btn: false };
        btn.click();
        var userMsg = null;
        for (var i = 0; i < 20; i++) {
          await new Promise(function(r){ setTimeout(r, 100); });
          userMsg = document.querySelector('[data-testid="msg-user"]');
          if (userMsg) break;
        }
        if (!userMsg) return { btn: true, error: "no-user-bubble" };
        var txt = userMsg.textContent || "";
        var hasLabel = txt.indexOf("开始学习") !== -1 && txt.length < 60;
        var leakedPrompt = document.body.textContent.indexOf("把我勾住是唯一目标") !== -1;
        var stop = document.querySelector('[data-testid="chat-stop"]');
        if (stop) stop.click();
        for (var j = 0; j < 30; j++) {
          await new Promise(function(r){ setTimeout(r, 200); });
          if (!document.querySelector('[data-testid="chat-stop"]')) break;
        }
        return { btn: true, bubbleText: txt.slice(0, 40), hasLabel: hasLabel, leakedPrompt: leakedPrompt, stopped: !document.querySelector('[data-testid="chat-stop"]') };
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  results.push({
    name: "start-learning click: bubble shows short action label, full prompt never rendered",
    ok: actionDisplay?.btn === true && actionDisplay?.hasLabel === true && actionDisplay?.leakedPrompt === false,
    detail: actionDisplay,
  });

  // T8e 留下了带消息的 thread,而后段 T20(keyless 冷启动)依赖"空会话空态"才能见
  // keyless-card。清掉全部 threads + messages 还原现场(临时测试库,无真数据风险)。
  try {
    const db = getDb();
    db.delete(chatMessages).run();
    db.delete(threadsTable).run();
  } catch {
    /* 尽力而为:清理失败不阻塞后续测试 */
  }

  // T-SHIKI (v0.21): 讲解区代码围栏 → shiki 高亮节点(.shiki)+ 双主题 CSS 翻转
  // (同一 DOM 切 html.light 只换 computed color——零重渲染零闪烁的机制证明)。
  // 断言后恢复注入前的原文(共享现场纪律)。
  let shikiRes: { ok?: boolean; [k: string]: unknown } = {};
  try {
    shikiRes = await win.webContents.executeJavaScript(`
      (async function() {
        var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
        // 讲解 tab 是第一个 tab 按钮(前面步骤可能把面板停在其他 tab)
        var tabs = document.querySelectorAll('[data-testid="notebook-tabs"] button');
        if (tabs.length && tabs[0]) tabs[0].click();
        for (var i = 0; i < 60; i++) {
          await sleep(250);
          if (document.querySelector('[data-testid="notebook-panel"] .md-shiki pre.shiki')) break;
        }
        var pre = document.querySelector('[data-testid="notebook-panel"] .md-shiki pre.shiki');
        if (!pre) return { ok: false, why: "no shiki node" };
        // 挑一个双主题不同色的 token(github 系注释灰两主题同值,不能用它验翻转)
        var span = null, inlineC = "", lightC = "";
        var spans = pre.querySelectorAll('span[style*="color"]');
        for (var s = 0; s < spans.length; s++) {
          var m = /color:\\s*(#[0-9a-fA-F]{6}).*--shiki-light:\\s*(#[0-9a-fA-F]{6})/.exec(spans[s].getAttribute('style') || "");
          if (m && m[1].toLowerCase() !== m[2].toLowerCase()) { span = spans[s]; inlineC = m[1]; lightC = m[2]; break; }
        }
        if (!span) return { ok: false, why: "no dual-color token span" };
        // headless 默认亮色主题(app auto→light):先读亮色,摘类测暗色,再还原
        var hadLight = document.documentElement.classList.contains('light');
        var light = getComputedStyle(span).color;
        document.documentElement.classList.remove('light');
        window.dispatchEvent(new CustomEvent('theme-changed'));
        await sleep(200);
        var dark = getComputedStyle(span).color;
        if (hadLight) {
          document.documentElement.classList.add('light');
          window.dispatchEvent(new CustomEvent('theme-changed'));
        }
        return { ok: dark !== light, dark: dark, light: light, inline: inlineC, lightVar: lightC };
      })()
    `).catch(() => ({}));
  } catch (e) {
    shikiRes = { ok: false, error: String(e) };
  }
  try {
    if (shikiSeedOriginal != null) {
      getDb()
        .update(contentNodes)
        .set({ content: shikiSeedOriginal })
        .where(eq(contentNodes.id, "guide-les-1-1"))
        .run();
      shikiSeedOriginal = null;
    }
  } catch {
    /* 尽力而为 */
  }
  results.push({
    name: "shiki: notebook code fence highlighted + dual-theme CSS flip",
    ok: shikiRes?.ok === true,
    detail: shikiRes,
  });

  // T-MERMAID-ELK (v0.21): 笔记理解区的 flowchart 图卡 → 渲染成 SVG + ELK 布局
  // 真实生效。生效判据 = mermaid 的兜底 warn 缺席:flowchart-elk 请求 'elk' 布局
  // 而注册表没有时,mermaid 会 console.warn("flowchart-elk was moved…") 并退
  // dagre——挂 warn 探针再开笔记 tab,探针没捕到该 warn 即 ELK 真接管。
  let mermaidElkRes: { ok?: boolean; [k: string]: unknown } = {};
  try {
    mermaidElkRes = await win.webContents.executeJavaScript(`
      (async function() {
        var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
        // 先挂 warn 探针(渲染发生在图卡 mount,必须先于 tab 点击)
        var warned = [];
        var ow = console.warn;
        console.warn = function() {
          for (var i = 0; i < arguments.length; i++) warned.push(String(arguments[i]));
          return ow.apply(console, arguments);
        };
        try {
          var tabs = document.querySelectorAll('[data-testid="notebook-tabs"] button');
          if (tabs.length > 1 && tabs[1]) tabs[1].click(); // 笔记 tab(理解区所在)
          var svg = null;
          for (var i = 0; i < 60; i++) {
            await sleep(250);
            svg = document.querySelector('[data-testid="notebook-panel"] [data-testid="mermaid-svg"]');
            if (svg) break;
          }
          if (!svg) return { ok: false, why: "mermaid svg 未渲染" };
          var fallbackPre = document.querySelector('[data-testid="artifact-mermaid"] pre');
          var elkWarn = warned.filter(function(w){ return w.indexOf("flowchart-elk was moved") >= 0; });
          return { ok: elkWarn.length === 0 && !fallbackPre, elkFallbackWarn: elkWarn.length, warnedCount: warned.length, hasFallback: !!fallbackPre };
        } finally {
          console.warn = ow;
          var back = document.querySelectorAll('[data-testid="notebook-tabs"] button');
          if (back.length && back[0]) back[0].click(); // 回讲解 tab,还原现场
        }
      })()
    `).catch(() => ({}));
  } catch (e) {
    mermaidElkRes = { ok: false, error: String(e) };
  }
  results.push({
    name: "mermaid ELK: flowchart card renders + elk layout engaged (no dagre-fallback warn)",
    ok: mermaidElkRes?.ok === true,
    detail: mermaidElkRes,
  });

  // T-ASR (v0.14 听写,飞书式): mic 点击切语音模式 → 按住说话(dispatch 原生
  // pointerdown/up,React 根委托可收到)→ 录音浮层 → 松开 → 转录 → 复查浮层
  // (可编辑 textarea)/错误浮层。双分支:本机已下 Whisper → 复查浮层出现(假设备
  // 蜂鸣,文本内容不校验,可能为空或触发 no-speech 错误浮层);无模型环境(CI)
  // → model-missing → 错误浮层出现(降级断言)。收尾:切回键盘并断言输入框复位。
  let asrInput: { branch?: string; ok?: boolean; error?: string; [k: string]: unknown } = {};
  try {
    asrInput = await win.webContents.executeJavaScript(`
      (async function() {
        var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
        function q(sel){ return document.querySelector(sel); }
        function dispatch(el, type) {
          el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
        }
        async function backToKeyboard() {
          var kb = q('[data-testid="voice-keyboard-toggle"]');
          if (kb) kb.click();
          await sleep(300);
          return !!q('[data-testid="chat-input"]');
        }
        try {
          var mic = q('[data-testid="composer-mic"]');
          if (!mic) return { ok: false, error: "no mic button" };
          var status = await window.api.getSpeechModelStatus();
          var whisper = (status || []).filter(function(s){ return s.id === "asr-whisper-turbo" || s.id === "asr-whisper-small"; });
          var modelReady = whisper.some(function(s){ return s.state === "ready"; });
          mic.click(); // → 语音模式:整卡换成「按住说话」大按钮
          var hold = null;
          for (var j = 0; j < 20; j++) { await sleep(250); hold = q('[data-testid="voice-hold-btn"]'); if (hold) break; }
          if (!hold) return { ok: false, error: "voice mode never appeared" };
          dispatch(hold, "pointerdown"); // 按住 → 起录
          var rec = null;
          for (var j2 = 0; j2 < 24; j2++) { await sleep(250); rec = q('[data-testid="voice-panel-recording"]'); if (rec) break; }
          if (!rec) {
            var err0 = q('[data-testid="voice-panel-error"]');
            dispatch(hold, "pointerup");
            if (err0) return { ok: true, branch: "mic-unavailable", back: await backToKeyboard() };
            return { ok: false, error: "recording panel never appeared" };
          }
          await sleep(700); // 让假设备音频攒一小段
          var active = q('[data-testid="voice-hold-btn-active"]') || hold;
          dispatch(active, "pointerup"); // 松开 → 停录转录
          if (!modelReady) {
            for (var i = 0; i < 40; i++) {
              await sleep(250);
              if (q('[data-testid="voice-panel-error"]')) {
                return { ok: true, branch: "model-missing", back: await backToKeyboard() };
              }
            }
            return { ok: false, error: "error panel never appeared after model-missing transcribe" };
          }
          // 有模型:等复查浮层(假设备蜂鸣内容不校验)或错误浮层(no-speech 判空等仍是有效闭环)
          for (var m = 0; m < 120; m++) {
            await sleep(500);
            var panel = q('[data-testid="voice-panel-review"]');
            if (panel) {
              var ta = q('[data-testid="voice-result-text"]');
              return { ok: true, branch: "ready", len: ta && ta.value ? ta.value.length : 0, back: await backToKeyboard() };
            }
            if (q('[data-testid="voice-panel-error"]')) {
              return { ok: true, branch: "ready-error", back: await backToKeyboard() };
            }
          }
          return { ok: false, error: "review panel never settled", branch: "ready" };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `);
  } catch (e) {
    asrInput = { error: String(e) };
  }
  results.push({
    name: "asr dictation: voice mode → hold → release → review/error panel → back to keyboard (fake device)",
    ok: asrInput?.ok === true,
    detail: asrInput,
  });

  // T-VOICE-SETTINGS (v0.15): 语音模型区 —— 按钮组(朗读 Edge/本地/自定义,听写 本地/自定义)+
  // whisper 模型下拉 + 讲解 tab 🔊(provider 下拉已退役;新库无 azure/groq 旧值 pill)。
  let voiceSettings: { ok?: boolean; error?: string; [k: string]: unknown } = {};
  try {
    voiceSettings = await win.webContents.executeJavaScript(`
      (async function() {
        var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
        function q(sel){ return document.querySelector(sel); }
        function qAll(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
        try {
          // 讲解 🔊(笔记本默认在讲解 tab;宽窗三栏在位)
          var speakBtn = null;
          for (var w = 0; w < 10; w++) { speakBtn = q('[data-testid="node-content-speak"]'); if (speakBtn) break; await sleep(300); }
          var notebookSpeak = !!speakBtn;
          // 打开设置(header 齿轮,与 T8c 同入口)
          var gearBtn = q('[data-testid="header-settings"]');
          if (!gearBtn) return { ok: false, error: "no header-settings button", notebookSpeak: notebookSpeak };
          gearBtn.click();
          var speech = null;
          for (var i = 0; i < 20; i++) { await sleep(300); speech = q('[data-testid="settings-speech"]'); if (speech) break; }
          if (!speech) return { ok: false, error: "settings speech group missing", notebookSpeak: notebookSpeak };
          speech.scrollIntoView({ block: "center" });
          await sleep(200);
          var has = function(id){ var el = q('[data-testid="' + id + '"]'); return !!el; };
          var r = {
            notebookSpeak: notebookSpeak,
            ttsEdge: has("tts-engine-edge"), ttsLocal: has("tts-engine-local"), ttsCustom: has("tts-engine-custom"), ttsSystem: has("tts-engine-system"),
            asrLocal: has("asr-engine-local"), asrCustom: has("asr-engine-custom"),
            asrModelSelect: has("asr-model-select"),
            selectGone: !q('[data-testid="tts-engine-select"]'),
            legacyGone: !q('[data-testid="tts-engine-azure"]') && !q('[data-testid="asr-engine-groq"]'),
          };
          r.ok = r.notebookSpeak && r.ttsEdge && r.ttsLocal && r.ttsCustom && r.ttsSystem && r.asrLocal && r.asrCustom && r.asrModelSelect && r.selectGone && r.legacyGone;
          // 关设置(别污染后续步骤的界面状态)
          var closeBtn = q('[data-testid="settings-close"]');
          if (closeBtn) closeBtn.click();
          return r;
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `);
  } catch (e) {
    voiceSettings = { error: String(e) };
  }
  results.push({
    name: "voice settings: engine pill groups + custom pills + whisper model select + notebook read-aloud",
    ok: voiceSettings?.ok === true,
    detail: voiceSettings,
  });

  // T-SPEECH (v0.12 语音朗读): 种一条 assistant 消息 → 点朗读按钮。
  // 双分支(可移植):本机 userData 已有 tts 模型 → 完整环(speak→stop→复原);
  // 无模型环境(CI/新机)→ toast 引导下载(模型缺失路径)。语音模型在 userData(非临时 DB),
  // 与 --ui-test 的临时库互不影响。
  let speechLoop: { branch?: string; ok?: boolean; error?: string; [k: string]: unknown } = {};
  try {
    // 1) 点第一个可用课时球,拿 nodeId
    const pick = await win.webContents.executeJavaScript(`
      (async function() {
        var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
        var balls = Array.prototype.slice.call(document.querySelectorAll('button[data-testid^="map-node-"]:enabled'))
          .filter(function(b){ return !/exam/.test(b.getAttribute('data-testid') || ''); });
        if (balls.length < 2) return { error: 'need 2 lesson balls, got ' + balls.length };
        balls[0].click();
        await sleep(700);
        return { nodeId: (balls[0].getAttribute('data-testid') || '').replace('map-node-', '') };
      })()
    `);
    if (pick?.nodeId) {
      // 2) testid 是 id 前 8 位(map-node-{id.slice(0,8)}),先解析成完整节点 id
      let fullNodeId = "";
      try {
        const like = `${pick.nodeId}%`;
        const rows = getDb().select({ id: contentNodes.id }).from(contentNodes)
          .where(and(eq(contentNodes.courseId, "seed-lookatstudy-guide"), like_(contentNodes.id, like)))
          .all();
        fullNodeId = rows[0]?.id ?? "";
      } catch (e) {
        console.error("[lookatstudy] ui-test speech node resolve failed:", e);
      }
      try {
        getDb().insert(threadsTable).values({
          id: "ui-speech-thread",
          courseId: "seed-lookatstudy-guide",
          focusNodeId: fullNodeId,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).onConflictDoNothing().run();
        getDb().insert(chatMessages).values({
          id: "ui-speech-msg",
          threadId: "ui-speech-thread",
          role: "assistant",
          content: "你好。递归就像俄罗斯套娃,一层套一层。理解它之后,编程会变得轻松许多。",
          partsJson: JSON.stringify([{ type: "text", text: "你好。递归就像俄罗斯套娃,一层套一层。理解它之后,编程会变得轻松许多。" }]),
          createdAt: new Date().toISOString(),
        }).onConflictDoNothing().run();
        markDirty();
        if (!fullNodeId) throw new Error("node id prefix unresolved: " + pick.nodeId);
      } catch (e) {
        console.error("[lookatstudy] ui-test speech seed failed:", e);
      }
      // 3) 换节点再换回(强制 useThreads reload)→ 断言朗读环
      speechLoop = await win.webContents.executeJavaScript(`
        (async function() {
          var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
          function q(sel){ return document.querySelector(sel); }
          try {
            var balls = Array.prototype.slice.call(document.querySelectorAll('button[data-testid^="map-node-"]:enabled'))
              .filter(function(b){ return !/exam/.test(b.getAttribute('data-testid') || ''); });
            balls[1].click(); await sleep(600);
            balls[0].click(); await sleep(800);
            if (!q('[data-testid="msg-assistant"]')) {
              var diag = { tabs: document.querySelectorAll('[data-testid^="thread-tab-"]').length };
              try {
                var th = await window.api.threadList("seed-lookatstudy-guide", "active");
                diag.threads = (th || []).map(function(t){ return { id: t.id, f: t.focusNodeId, mc: t.messageCount }; });
              } catch (e2) { diag.threadsErr = String(e2); }
              try {
                var msgs = await window.api.threadGetMessages("ui-speech-thread");
                diag.msgCount = (msgs || []).length;
              } catch (e3) { diag.msgsErr = String(e3); }
              diag.hasEmpty = !!q('[data-testid="thread-switcher-empty"]');
              return { ok: false, error: "no assistant msg after nav", diag: diag };
            }
            var speakBtn = q('[data-testid="speech-speak-btn"]');
            if (!speakBtn) return { ok: false, error: "no speak button" };
            // 探针:陷阱监听 app 自身发出的 talking 事件(隔离 ContentTab 接线 vs 总线)
            var talkingSeen = [];
            window.addEventListener("companion-talking", function(ev) { talkingSeen.push(String(ev.detail)); });
            var status = await window.api.getSpeechModelStatus();
            var tts = (status || []).filter(function(s){ return s.id === "tts-kokoro"; })[0];
            if (!tts || tts.state !== "ready") {
              speakBtn.click();
              var toastSeen = false;
              for (var i = 0; i < 30; i++) { await sleep(200); if (q('[data-testid^="toast-"]')) { toastSeen = true; break; } }
              return { ok: toastSeen, branch: "model-missing", toastSeen: toastSeen };
            }
            speakBtn.click();
            var stopBtn = null;
            for (var j = 0; j < 240; j++) { await sleep(250); stopBtn = q('[data-testid="speech-stop-btn"]'); if (stopBtn) break; }
            // companion v3:朗读中(talking)→ 单生物飞去右栏助教世界(zone=notebook)。
            // 先等一拍(tick 500ms + 飞行),读 zone + 表情类(cp-expr-talking 证 talking 标志);
            // 真实链路没走通时手动派发同款事件隔离断点(总线 vs ContentTab 接线)。
            await sleep(900);
            var nbZone = null;
            var cc = document.querySelector('[data-testid="companion-creature"]');
            if (cc) nbZone = cc.dataset.zone;
            var mm = document.querySelector('[data-testid="companion-mascot"]');
            var exprTalking = mm ? String(mm.getAttribute('class')).indexOf('cp-expr-talking') >= 0 : null;
            var manualZone = null;
            if (nbZone !== "notebook") {
              window.dispatchEvent(new CustomEvent("companion-talking", { detail: true }));
              await sleep(700);
              var cc2 = document.querySelector('[data-testid="companion-creature"]');
              manualZone = cc2 ? cc2.dataset.zone : null;
            }
            if (!stopBtn) {
              try { await window.api.ttsStop(); } catch (e) {}
              return { ok: false, error: "stop button never appeared (60s)", branch: "ready", nbZone: nbZone };
            }
            stopBtn.click();
            var back = false;
            for (var k = 0; k < 40; k++) { await sleep(250); if (q('[data-testid="speech-speak-btn"]')) { back = true; break; } }
            return { ok: back, branch: "ready", stoppedBack: back, nbZone: nbZone, exprTalking: exprTalking, manualZone: manualZone, talkingEvents: talkingSeen.join(",") };
          } catch (e) { return { ok: false, error: String(e) }; }
        })()
      `);
    } else {
      speechLoop = { ok: false, error: String(pick?.error ?? "no nodeId") };
    }
  } catch (e) {
    speechLoop = { error: String(e) };
  } finally {
    // 现场清理(ui-test 状态卫生):thread + 消息直删,防污染后续步骤
    try {
      getDb().delete(chatMessages).where(eq(chatMessages.threadId, "ui-speech-thread")).run();
      getDb().delete(threadsTable).where(eq(threadsTable.id, "ui-speech-thread")).run();
      markDirty();
    } catch { /* 非关键 */ }
  }
  results.push({
    name: "speech: read-aloud button full loop (speak→stop→restore) or model-missing toast",
    ok: speechLoop?.ok === true,
    detail: speechLoop,
  });
  // companion v3:ready 分支(真朗读)时,朗读中单生物必须在右栏助教世界
  if (speechLoop?.branch === "ready") {
    results.push({
      name: "companion v3: talking sends creature to notebook zone (TA world)",
      ok: speechLoop.nbZone === "notebook",
      detail: { nbZone: speechLoop.nbZone },
    });
  }

  // T-MATH (v0.19 数学渲染): 把当前课时的正文临时换成含 $..$/$$..$$ 的片段,
  // 切走再切回(强制重渲染)→ 断言 KaTeX 双层结构在场(视觉层+MathML annotation)。
  // 现场清理:恢复原 content(状态卫生,不污染后续步骤)。
  let mathRender: { ok?: boolean; error?: string; [k: string]: unknown } = {};
  try {
    const pick = await win.webContents.executeJavaScript(`
      (async function() {
        var balls = Array.prototype.slice.call(document.querySelectorAll('button[data-testid^="map-node-"]:enabled'))
          .filter(function(b){ return !/exam/.test(b.getAttribute('data-testid') || ''); });
        return { nodeId: balls.length ? (balls[0].getAttribute('data-testid') || '').replace('map-node-', '') : null };
      })()
    `);
    let fullNodeId = "";
    if (pick?.nodeId) {
      const rows = getDb().select({ id: contentNodes.id, content: contentNodes.content }).from(contentNodes)
        .where(and(eq(contentNodes.courseId, "seed-lookatstudy-guide"), like_(contentNodes.id, `${pick.nodeId}%`)))
        .all();
      fullNodeId = rows[0]?.id ?? "";
      if (fullNodeId) {
        const orig = rows[0]!.content ?? "";
        getDb().update(contentNodes).set({
          content: "质能方程 $E=mc^2$ 很有名。\n\n行间公式:$$\\\\frac{a}{b}$$\n\n这是正文结尾。",
        }).where(eq(contentNodes.id, fullNodeId)).run();
        markDirty();
        try {
          mathRender = await win.webContents.executeJavaScript(`
            (async function() {
              var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
              try {
                var balls = Array.prototype.slice.call(document.querySelectorAll('button[data-testid^="map-node-"]:enabled'))
                  .filter(function(b){ return !/exam/.test(b.getAttribute('data-testid') || ''); });
                if (balls.length < 2) return { ok: false, error: 'need 2 balls' };
                balls[1].click(); await sleep(500);
                balls[0].click(); await sleep(900);
                var katex = document.querySelectorAll('.katex').length;
                var vis = document.querySelectorAll('.katex .katex-html').length;
                var ann = document.querySelectorAll('.katex .katex-mathml annotation').length;
                return { ok: katex >= 2 && vis >= 2 && ann >= 2, katex: katex, vis: vis, ann: ann };
              } catch (e) { return { ok: false, error: String(e) }; }
            })()
          `);
        } finally {
          getDb().update(contentNodes).set({ content: orig }).where(eq(contentNodes.id, fullNodeId)).run();
          markDirty();
          // 恢复后再切一次,让界面回到原正文
          await win.webContents.executeJavaScript(`
            (async function() {
              var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
              var balls = Array.prototype.slice.call(document.querySelectorAll('button[data-testid^="map-node-"]:enabled'))
                .filter(function(b){ return !/exam/.test(b.getAttribute('data-testid') || ''); });
              if (balls.length >= 2) { balls[1].click(); await sleep(300); balls[0].click(); }
            })()
          `);
        }
      } else {
        mathRender = { ok: false, error: "node unresolved" };
      }
    } else {
      mathRender = { ok: false, error: "no lesson ball" };
    }
  } catch (e) {
    mathRender = { error: String(e) };
  }
  results.push({
    name: "math render: lesson content with $..$/$$..$$ renders KaTeX (visual + MathML annotation)",
    ok: mathRender?.ok === true,
    detail: mathRender,
  });


  // 原 🤔 卡点 toggle+表单已撤(friction 折进"我没太懂"巩固选择)。
  // 巩固选择的"内容"由 verify-starter-prompts 覆盖;"语境前不出现"由 App 的 prop 门控(tsc 保证)。

  // T8c (v0.2 设置抽屉): 点 header settings → settings-drawer 出现
  const settingsDrawer = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btn = document.querySelector('[data-testid="header-settings"]');
        if (!btn) return { ok: false, reason: "settings btn not found" };
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        const drawer = document.querySelector('[data-testid="settings-drawer"]');
        const closeBtn = document.querySelector('[data-testid="settings-close"]');
        // 关回去
        if (closeBtn) { closeBtn.click(); await new Promise(r => setTimeout(r, 200)); }
        return { ok: !!drawer };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "header settings → settings-drawer opens (设置抽屉)",
    ok: settingsDrawer?.ok === true,
    detail: settingsDrawer,
  });

  // T9 (M3): 切到 dashboard 视图 → 仪表盘渲染（3 stat 卡 + 热力图行）
  const dashboardOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // 点 map-tab-map 切到地图视图
        const tab = document.querySelector('[data-testid="map-tab-map"]');
        if (!tab) return { ok: false, reason: "map-tab-map not found" };
        tab.click();
        await new Promise(r => setTimeout(r, 300));
        // v0.3:地图路径渲染——map-path 存在 + 至少 1 个 section + 节点
        const mapPath = document.querySelector('[data-testid="map-path"]');
        const sections = document.querySelectorAll('[data-testid^="map-section-"]').length;
        const nodes = document.querySelectorAll('[data-testid^="map-node-"]').length;
        return { ok: !!mapPath && sections >= 1 && nodes >= 1, sections, nodes };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "map-view-map renders path + sections + nodes",
    ok: dashboardOk?.ok === true,
    detail: dashboardOk,
  });

  // T9b (种子双语): 种子课程自带 en 翻译 → 🌐 切换器可见,切到 English 后按钮标签跟随。
  // 翻译内容的正确性由 verify-seed-bilingual.mjs 在 DB 层断言,这里测渲染链路(IPC→状态→DOM)。
  const langSwitch = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btn = document.querySelector('[data-testid="lang-switcher-btn"]');
        if (!btn) return { ok: false, reason: "lang-switcher-btn not found (seed bilingual broken?)" };
        btn.click();
        await new Promise(r => setTimeout(r, 250));
        const enOpt = document.querySelector('[data-testid="lang-option-en"]');
        if (!enOpt) return { ok: false, reason: "lang-option-en not found" };
        enOpt.click();
        await new Promise(r => setTimeout(r, 500));
        const labelAfter = (btn.textContent || "").trim();
        // 切回原文,不污染后续断言
        btn.click();
        await new Promise(r => setTimeout(r, 250));
        const origOpt = document.querySelector('[data-testid="lang-option-original"]');
        if (origOpt) { origOpt.click(); await new Promise(r => setTimeout(r, 400)); }
        return { ok: labelAfter.indexOf("English") !== -1, labelAfter };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "seed bilingual: 🌐 switcher offers English, label follows selection",
    ok: langSwitch?.ok === true,
    detail: langSwitch,
  });

  // T10 (release): getProviderPresets IPC 返回 ≥5 个 provider
  const presetsCheck = await win.webContents.executeJavaScript(
    `window.api.getProviderPresets().then(p => ({count: p.length})).catch(e => ({count: 0, error: String(e)}))`,
  );
  results.push({
    name: "getProviderPresets IPC returns ≥5 providers",
    ok: presetsCheck?.count >= 5,
    detail: presetsCheck,
  });

  // T11 (release): 导入课程视图渲染 URL 输入 + markdown 切换 + 课程列表
  // v0.7: 导入改左栏 tab → 点 map-tab-import 切面板 → 点"导入新课程"展开表单
  const importOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        document.querySelector('[data-testid="map-tab-import"]').click();
        await new Promise(r => setTimeout(r, 400));
        document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('导入新课程')) b.click(); });
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('[data-testid="import-url-section"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const urlSection = !!document.querySelector('[data-testid="import-url-section"]');
        const urlInput = !!document.querySelector('[data-testid="repo-url-input"]');
        const importBtn = !!document.querySelector('[data-testid="import-url-btn"]');
        document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('MD')) b.click(); });
        await new Promise(r => setTimeout(r, 200));
        const mdSection = !!document.querySelector('[data-testid="import-md-section"]');
        const courseList = document.querySelectorAll('[data-testid="course-list"] > *').length;
        return { ok: urlSection && urlInput && importBtn && mdSection, urlSection, urlInput, mdSection, courseList };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "import view: URL import + markdown paste + course list",
    ok: importOk?.ok === true,
    detail: importOk,
  });

  // T12 (v0.2): 设置移到 Header 齿轮 + 左栏导航三视图 + 中栏 chat-stream
  const layoutOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        document.querySelector('[data-testid="map-tab-map"]').click();
        await new Promise(r => setTimeout(r, 300));
        const headerSettings = !!document.querySelector('[data-testid="header-settings"]');
        const navTree = !!document.querySelector('[data-testid="map-tab-map"]');
        const navImport = !!document.querySelector('[data-testid="map-tab-import"]');
        return { ok: headerSettings && navTree && navImport, headerSettings, navTree, navImport };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "v0.2 layout: header settings + nav 3-views + chat-stream",
    ok: layoutOk?.ok === true,
    detail: layoutOk,
  });

  // T13 (M2): Cmd+K 命令面板能打开 + 命令列表渲染
  const cmdPalette = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // 切回地图视图(确保命令面板能用)
        document.querySelector('[data-testid="map-tab-map"]').click();
        await new Promise(r => setTimeout(r, 200));
        // 派发 Ctrl+K
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const palette = document.querySelector('[data-testid="command-palette"]');
        const input = document.querySelector('[data-testid="command-input"]');
        const cmds = document.querySelectorAll('[data-testid^="command-"]').length;
        // 关掉
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: !!palette && !!input && cmds > 0, palette: !!palette, input: !!input, cmds };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "Cmd+K command palette opens with commands (M2)",
    ok: cmdPalette?.ok === true,
    detail: cmdPalette,
  });

  // T14 (M2): notebook tabs 容器存在(讲解/笔记 两标签结构在)
  const artifactTabs = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="notebook-tabs"]') !== null &&
    document.querySelector('[data-testid="tab-notes"]') !== null
  `);
  results.push({
    name: "notebook panel tabs rendered (content/notes)",
    ok: artifactTabs === true,
  });

  // T15 (v0.3.4): 切到笔记 tab → 三区(理解/记录/练习)toggle 存在且初始折叠
  // 验证:defaultOpen=false 生效(箭头带 -rotate-90 表示折叠态)
  let zoneCollapse: { switched?: boolean; zones?: number; collapsed?: number; titles?: string[]; error?: string } = {};
  try {
    zoneCollapse = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var tabBtn = document.querySelector('[data-testid="tab-notes"]');
          if (tabBtn) tabBtn.click();
          return { switched: true };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    // 等 React 渲染后,检查三区 toggle 的折叠状态
    const zoneDetail = await win.webContents.executeJavaScript(`
      (function() {
        var ids = ["zone-understand-toggle", "zone-note-toggle", "zone-practice-toggle"];
        var toggles = ids.map(function(id){ return document.querySelector('[data-testid="' + id + '"]'); });
        var found = toggles.filter(Boolean);
        // 折叠态:ChevronDown 带 -rotate-90 class;初始应全部折叠
        var collapsed = toggles.filter(function(t){
          return t && t.querySelector('svg.lucide-chevron-down, svg[class*="chevron-down"]');
        }).filter(function(t){
          var svg = t.querySelector('svg');
          return svg && svg.className && svg.className.baseVal && svg.className.baseVal.indexOf('-rotate-90') >= 0;
        }).length;
        var titles = toggles.map(function(t){ return t ? t.textContent : null; });
        return { zones: found.length, collapsed: collapsed, titles: titles };
      })()
    `);
    zoneCollapse = { ...zoneCollapse, ...zoneDetail };
  } catch (e) {
    zoneCollapse = { error: String(e) };
  }
  results.push({
    name: "three zones (理解/记录/练习) collapsed by default after switching to notes tab",
    ok: zoneCollapse?.switched === true && zoneCollapse?.zones === 3 && zoneCollapse?.collapsed === 3,
    detail: zoneCollapse,
  });

  // T16 (v0.8 a11y): 设置抽屉打开后具备 role=dialog + aria-modal(焦点管理语义)
  let drawerA11y: { opened?: boolean; roleDialog?: boolean; ariaModal?: boolean; error?: string } = {};
  try {
    drawerA11y = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          var gear = document.querySelector('[data-testid="header-settings"]');
          if (gear) gear.click();
          await new Promise(function(r){ setTimeout(r, 200); });
          var panel = document.querySelector('[data-testid="settings-drawer"] [role="dialog"]');
          return {
            opened: document.querySelector('[data-testid="settings-drawer"]') !== null,
            roleDialog: panel !== null,
            ariaModal: panel ? panel.getAttribute('aria-modal') === 'true' : false,
          };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
  } catch (e) { drawerA11y = { error: String(e) }; }
  results.push({
    name: "settings drawer exposes role=dialog + aria-modal (a11y focus semantics)",
    ok: drawerA11y?.roleDialog === true && drawerA11y?.ariaModal === true,
    detail: drawerA11y,
  });

  // T17 (v0.8 a11y): notebook 标签具备 role=tablist + role=tab(键盘语义)
  const tabRoles = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="notebook-tabs"] [role="tablist"]') !== null &&
    document.querySelector('[data-testid="tab-content"][role="tab"]') !== null
  `);
  results.push({
    name: "notebook tabs expose role=tablist + role=tab",
    ok: tabRoles === true,
  });

  // T18 (v0.8 i18n): 切到 en 后 map-tab-map 文本变 "Course Map"(响应式 store + en 字典 + 组件订阅)
  let enI18n: { switched?: boolean; mapTabText?: string; error?: string } = {};
  try {
    enI18n = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          // 设置抽屉应已由 T16 打开;点 en 语言按钮
          var enBtn = document.querySelector('[data-testid="lang-en"]');
          if (enBtn) enBtn.click();
          await new Promise(function(r){ setTimeout(r, 250); });
          var mt = document.querySelector('[data-testid="map-tab-map"]');
          return { switched: true, mapTabText: mt ? mt.textContent.trim() : null };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
  } catch (e) { enI18n = { error: String(e) }; }
  results.push({
    name: "switching to en reactively updates chrome (map-tab → 'Course Map')",
    ok: enI18n?.mapTabText === "Course Map",
    detail: enI18n,
  });
  // 切回 zh-CN 恢复默认语言(不污染后续会话)
  try {
    await win.webContents.executeJavaScript(`
      (async function(){
        var z = document.querySelector('[data-testid="lang-zh-CN"]');
        if (z) z.click();
      })()
    `);
  } catch { /* 非关键 */ }

  // T19 (v0.8 a11y): zone toggle 具备 aria-expanded(屏幕阅读器可读折叠状态)
  let zoneAria: { found?: number; withAriaExpanded?: number; error?: string } = {};
  try {
    zoneAria = await win.webContents.executeJavaScript(`
      (function() {
        var ids = ["zone-understand-toggle", "zone-note-toggle", "zone-practice-toggle"];
        var toggles = ids.map(function(id){ return document.querySelector('[data-testid="' + id + '"]'); }).filter(Boolean);
        var withAttr = toggles.filter(function(t){ return t.hasAttribute('aria-expanded'); }).length;
        return { found: toggles.length, withAriaExpanded: withAttr };
      })()
    `);
  } catch (e) { zoneAria = { error: String(e) }; }
  results.push({
    name: "zone toggles expose aria-expanded (collapsible state for screen readers)",
    ok: zoneAria?.found === 3 && zoneAria?.withAriaExpanded === 3,
    detail: zoneAria,
  });

  // T20 (P1.1/P1.3 冷启动门控闭环): 删除 provider + active_provider → 重载 → 手动选课 → 选节点
  // → 应见 keyless-card,不见 start-learning-btn。证明"无 key 点🚀 → 死胡同"已修复。
  // 放后段:需 reload,会破坏后续 DOM 断言所需的页面状态。
  let keyless: { reloaded?: boolean; reselected?: boolean; nodeClicked?: boolean; ready?: boolean; keylessCard?: boolean; startBtn?: boolean; error?: string } = {};
  try {
    const db = getDb();
    db.delete(customProviders).run();
    const apRow = db.select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
    if (apRow) db.delete(settingsTable).where(eq(settingsTable.key, "active_provider")).run();
    win.webContents.reload();
    const reloaded = await waitRender();
    // reload 后回到空选初始态(选择不持久化) → 重新手动选课,再点节点
    const reselected = await selectFirstCourse();
    const clicked = await win.webContents.executeJavaScript(`
      (function() {
        var btns = document.querySelectorAll('[data-testid^="map-node-"]');
        for (var i = 0; i < btns.length; i++) { if (!btns[i].disabled) { btns[i].click(); return true; } }
        return false;
      })()
    `);
    await new Promise((r) => setTimeout(r, 700));
    const dom = await win.webContents.executeJavaScript(`
      (async function() {
        var ready = await window.api.isAgentReady();
        return {
          ready: !!ready.ready,
          keylessCard: document.querySelector('[data-testid="keyless-card"]') !== null,
          startBtn: document.querySelector('[data-testid="start-learning-btn"]') !== null,
        };
      })()
    `);
    keyless = { reloaded, reselected, nodeClicked: clicked === true, ready: dom?.ready, keylessCard: dom?.keylessCard, startBtn: dom?.startBtn };
  } catch (e) {
    keyless = { error: String(e) };
  }
  results.push({
    name: "keyless cold-start: no provider → keyless-card shown & start-learning-btn hidden (P1.1/P1.3)",
    ok: keyless?.ready === false && keyless?.keylessCard === true && keyless?.startBtn === false,
    detail: keyless,
  });

  // T22 (课程搜索): 搜索药丸 → 全栏面板(树状导航,锁定行 disabled)→ 标题过滤
  // → 点行跳转(面板收起 + 地图球选中环)。种子课 guide-les-1-1「欢迎使用
  // LookatStudy」含"欢迎"且必定可点(首课初始 available)。
  let courseSearch: { btn?: boolean; panel?: boolean; allRows?: number; lockedRow?: boolean; filteredRows?: number; jumped?: boolean; ring?: boolean; closed?: boolean; error?: string } = {};
  try {
    courseSearch = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          var btn = document.querySelector('[data-testid="map-search-btn"]');
          if (!btn) return { btn: false };
          btn.click();
          var panel = null;
          for (var i = 0; i < 20; i++) {
            await new Promise(function(r){ setTimeout(r, 100); });
            panel = document.querySelector('[data-testid="course-search-panel"]');
            if (panel) break;
          }
          if (!panel) return { btn: true, panel: false };
          var input = document.querySelector('[data-testid="course-search-input"]');
          if (!input) return { btn: true, panel: true, error: "input-missing" };
          var allRows = document.querySelectorAll('[data-testid^="search-row-"]').length;
          var lockedRow = Array.prototype.some.call(
            document.querySelectorAll('[data-testid^="search-row-"]'),
            function(el) { return el.disabled; }
          );
          // 过滤:"欢迎" 应只剩 guide-les-1-1 一行
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(input, "欢迎");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          var filtered = null;
          for (var j = 0; j < 30; j++) {
            await new Promise(function(r){ setTimeout(r, 100); });
            filtered = document.querySelectorAll('[data-testid^="search-row-"]').length;
            if (filtered < allRows) break;
          }
          if (!filtered) return { btn: true, panel: true, allRows: allRows, lockedRow: lockedRow, error: "filter-timeout" };
          var row = document.querySelector('[data-testid^="search-row-"]');
          if (!row || row.disabled) return { btn: true, panel: true, allRows: allRows, filteredRows: filtered, error: "row-unavailable" };
          row.click();
          var jumped = false;
          for (var k = 0; k < 20; k++) {
            await new Promise(function(r){ setTimeout(r, 100); });
            if (!document.querySelector('[data-testid="course-search-panel"]')) { jumped = true; break; }
          }
          // 选中环:guide-les-1-1 的地图球应带 ring-accent(选中态)
          var bubble = document.querySelector('[data-testid^="map-node-"][class*="ring-accent"]');
          return {
            btn: true,
            panel: true,
            allRows: allRows,
            lockedRow: lockedRow,
            filteredRows: filtered,
            jumped: jumped,
            ring: !!bubble,
          };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
  } catch (e) {
    courseSearch = { error: String(e) };
  }
  results.push({
    name: "course search: pill → panel tree (locked rows disabled) → title filter → row click jumps & selects",
    ok: courseSearch?.btn === true && courseSearch?.panel === true
      && typeof courseSearch?.allRows === "number" && courseSearch.allRows > 1
      && courseSearch?.lockedRow === true
      && courseSearch?.filteredRows === 1
      && courseSearch?.jumped === true
      && courseSearch?.ring === true,
    detail: courseSearch,
  });

  // T8b2 (物理地图指针路径): 真实 PointerEvent 序列(非合成 click)覆盖
  // setPointerCapture 重定向 click 的场景 —— pointerup 自路由必须仍能进课;
  // 锁定球是 static 刚体,指针拖拽后 transform 必须分毫不动。
  const pointerProbe = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        function fire(el, type, x, y) {
          el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true,
            clientX: x, clientY: y, pointerId: 7, pointerType: "mouse",
            button: 0, buttons: 1, isPrimary: true,
          }));
        }
        const wrappers = Array.from(document.querySelectorAll('[data-node-id]'));
        if (wrappers.length === 0) return { ok: false, reason: "no balls" };
        // 当前已选中的球(带 ring-4 选中环)——探针必须选"另一个"解锁球,
        // 盯选中环移动,否则会被前一条测试的残留状态污染(实测踩过)。
        const ringEl = document.querySelector('[data-node-id] button[class*="ring-4"]');
        const ringedId = ringEl ? ringEl.closest('[data-node-id]').getAttribute('data-node-id') : null;
        let unlockedW = null, lockedW = null;
        for (const w of wrappers) {
          const id = w.getAttribute('data-node-id');
          const btn = w.querySelector('button');
          if (btn && !btn.disabled && !unlockedW && id !== ringedId) unlockedW = w;
          if (btn && btn.disabled && !lockedW) lockedW = w;
        }
        if (!unlockedW) return { ok: false, reason: "no second unlocked ball" };
        const targetId = unlockedW.getAttribute('data-node-id');
        // 1) 解锁球:真实指针按+抬(位移 1px)→ 进课 = 选中环移到它
        const r1 = unlockedW.getBoundingClientRect();
        const cx = r1.left + r1.width / 2, cy = r1.top + r1.height / 2;
        fire(unlockedW, "pointerdown", cx, cy);
        fire(unlockedW, "pointerup", cx + 1, cy + 1);
        await new Promise(function(r2){ setTimeout(r2, 700); });
        const ringAfter = document.querySelector('[data-node-id] button[class*="ring-4"]');
        const ringAfterId = ringAfter ? ringAfter.closest('[data-node-id]').getAttribute('data-node-id') : null;
        const clickWorks = ringAfterId === targetId;
        // 2) 锁定球:指针按住拖 80px → static 刚体,transform 不变
        let lockedImmovable = null;
        if (lockedW) {
          const r3 = lockedW.getBoundingClientRect();
          const lx = r3.left + r3.width / 2, ly = r3.top + r3.height / 2;
          const t0 = lockedW.style.transform || "";
          fire(lockedW, "pointerdown", lx, ly);
          for (var i = 1; i <= 8; i++) fire(lockedW, "pointermove", lx + i * 10, ly + i * 5);
          await new Promise(function(r2){ setTimeout(r2, 150); });
          fire(lockedW, "pointerup", lx + 80, ly + 40);
          await new Promise(function(r2){ setTimeout(r2, 250); });
          const t1 = lockedW.style.transform || "";
          lockedImmovable = t1 === t0;
        }
        // 还原选中态(点回原球),不污染下游测试的节点上下文
        if (ringedId) {
          const prev = document.querySelector('[data-node-id="' + ringedId + '"] button');
          if (prev && !prev.disabled) prev.click();
          await new Promise(function(r2){ setTimeout(r2, 400); });
        }
        return { ok: clickWorks === true && lockedImmovable !== false, clickWorks: clickWorks, lockedImmovable: lockedImmovable };
      } catch (e) { return { ok: false, error: String(e) }; }
    })()
  `);
  results.push({
    name: "physics map: real-pointer click opens lesson + locked ball immovable",
    ok: pointerProbe?.ok === true,
    detail: pointerProbe,
  });

  // T20c (三档响应式布局): resize 跨档 → 自动收/互斥/单栏按钮组/拉宽弹回
  const tierSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const paneState = () =>
    win.webContents.executeJavaScript(`
      (function() {
        var rail = document.querySelector('[data-testid="map-rail"]');
        var chat = document.querySelector('[data-testid="chat-panel"]');
        var nb = document.querySelector('[data-testid="notebook-panel"]');
        return {
          rail: !!rail,
          railW: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
          chat: !!chat,
          nb: !!nb,
          switcher: !!document.querySelector('[data-testid="t3-pane-switcher"]'),
        };
      })()
    `).catch(() => null);
  try {
    // 轮询等档位渲染到位(跨档 = resize 事件 + React 重渲染 + 物理岛重建,
    // 固定睡眠会跟提交竞速 —— 实测偶发超时,改成谓词轮询)
    const waitForPane = async (pred: (st: NonNullable<Awaited<ReturnType<typeof paneState>>>) => boolean, timeoutMs = 3000) => {
      const t0 = Date.now();
      for (;;) {
        const st = await paneState();
        if (st && pred(st)) return st;
        if (Date.now() - t0 > timeoutMs) return st;
        await tierSleep(120);
      }
    };
    // → T2 (1000px):左栏自动隐,中+右双栏,无按钮组
    await win.setBounds({ width: 1000, height: 800 });
    const t2Default = await waitForPane((st) => !st.rail && st.chat && st.nb && !st.switcher);
    // T2 互斥:点"显示左栏" → 左栏出、右栏隐
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="layout-toggle-left"]').click()`);
    const t2Left = await waitForPane((st) => st.rail && st.chat && !st.nb);
    // → T3 (800px):单栏(对话)+ 按钮组;点地图按钮 → 地图全宽单栏
    await win.setBounds({ width: 800, height: 800 });
    const t3Chat = await waitForPane((st) => !st.rail && st.chat && !st.nb && st.switcher);
    // 切换组必须常驻 header(居中槽,非 fixed 浮层)——否则 T3 切到左栏时 header 连带消失,回不来
    const t3SwitcherDocked = await win.webContents.executeJavaScript(`
      (function() {
        var el = document.querySelector('[data-testid="t3-pane-switcher"]');
        if (!el) return false;
        var hdr = el.closest("header");
        if (!hdr || getComputedStyle(el).position === "fixed" || el.getBoundingClientRect().bottom > hdr.getBoundingClientRect().bottom + 1) return false;
        // 居中槽:三列网格里切换组必须真居中(h1 隐藏后自动放置会把它丢进第一列)
        var r = el.getBoundingClientRect();
        return Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) <= 2;
      })()
    `).catch(() => false);
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="t3-btn-rail"]').click()`);
    const t3Rail = await waitForPane((st) => st.rail && !st.chat && st.railW >= 700);
    // T3 极窄(600px):三 pane 逐一切换,各自都不许横向溢出窗口。
    // (回归:chat pane 曾被 composer 工具栏固有宽度顶出 ~633px 下限;左栏曾被
    //  物理球 wrapper 顶出横向滚动条 —— min-w-0 / overflow-x-hidden 修)
    await win.setBounds({ width: 600, height: 800 });
    const overflowState = (sel: string) =>
      win.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('${sel}');
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return {
            w: Math.round(r.width),
            overRight: Math.round(r.right - window.innerWidth),
            selfOver: Math.round(el.scrollWidth - el.clientWidth),
            overflowX: getComputedStyle(el).overflowX,
            docOver: Math.round(document.documentElement.scrollWidth - window.innerWidth),
          };
        })()
      `).catch(() => null);
    const waitFits = async (sel: string) => {
      const t0 = Date.now();
      for (;;) {
        const st = await overflowState(sel);
        if (st && st.overRight <= 1 && st.docOver <= 1 && (st.overflowX === "hidden" || st.selfOver <= 1)) return true;
        if (Date.now() - t0 > 8000) return false;
        await tierSleep(120);
      }
    };
    // rail 查 .map-path 自身:横向滚动条是它内部的(外层 nav overflow-hidden 裁不到文档级)
    const narrowRail = await waitFits('[data-testid="map-rail"] .map-path');
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="t3-btn-notebook"]').click()`);
    await waitForPane((st) => !st.rail && !st.chat && st.nb);
    const narrowNb = await waitFits('[data-testid="notebook-panel"]');
    await win.webContents.executeJavaScript(`document.querySelector('[data-testid="t3-btn-chat"]').click()`);
    await waitForPane((st) => !st.rail && st.chat && !st.nb);
    const narrowChat = await waitFits('[data-testid="chat-panel"]');
    // T20d (companion v3): T3 单栏切换 = 单生物连续体不消失(组件仍在场,
    // 随栏可见性自适应显隐);zone+typing 的行为断言在 keyless 之前已覆盖
    const t3Typing = await win.webContents
      .executeJavaScript(`document.querySelector('[data-testid="companion-creature"]') !== null`)
      .catch(() => null);
    results.push({
      name: "companion v3: single creature persists across T3 pane switching",
      ok: t3Typing === true,
      detail: { present: t3Typing },
    });
    // T20e (companion v3): 形象切换 — 写 companion_form=frost + 广播 → 机体 data-form
    // 即时变 frost;断言后切回 ember(状态卫生:不污染下游与真实用户首选项)
    const formSwitch = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        await window.api.setSetting("companion_form", "frost");
        window.dispatchEvent(new Event("companion-config-changed"));
        var frost = false;
        for (var i = 0; i < 30; i++) {
          await new Promise(function(r) { setTimeout(r, 100); });
          var el = document.querySelector('[data-testid="companion-mascot"]');
          if (el && el.getAttribute("data-form") === "frost") { frost = true; break; }
        }
        await window.api.setSetting("companion_form", "ember");
        window.dispatchEvent(new Event("companion-config-changed"));
        return { frost: frost };
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "companion v3: form switch live-swaps creature mascot (frost) via settings event",
      ok: formSwitch?.frost === true,
      detail: formSwitch,
    });
    {
      const dbg = await win.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('[data-testid="notebook-panel"]');
          if (!el) return "nb不存在";
          var r = el.getBoundingClientRect();
          var offenders = [];
          var walk = function(node, depth) {
            if (depth > 12 || offenders.length >= 5) return;
            for (var i = 0; i < node.children.length; i++) {
              var c = node.children[i];
              var cr = c.getBoundingClientRect();
              if (cr.width > 30 && cr.right > r.right + 2) {
                offenders.push({ tag: c.tagName, cls: String(c.className).slice(0, 50), w: Math.round(cr.width), overR: Math.round(cr.right - r.right) });
              } else { walk(c, depth + 1); }
            }
          };
          walk(el, 0);
          return { nbW: Math.round(r.width), nbRight: Math.round(r.right), innerW: window.innerWidth, docOver: Math.round(document.documentElement.scrollWidth - window.innerWidth), offenders: offenders };
        })()
      `).catch(() => null);
      console.error("NB_DEBUG=" + JSON.stringify(dbg));
    }
    // 拉宽弹回 → T1 (1300px):三栏全恢复、按钮组消失、左栏回 300
    await win.setBounds({ width: 1300, height: 800 });
    const t1Back = await waitForPane((st) => st.rail && st.chat && st.nb && !st.switcher);
    // T1 回来后左栏回到 284px 内容盒。球被拖到墙边时 wrapper(110px,> 球 56px)会伸出
    // 内容盒 → 溢出依赖拖球行为,headless 无法确定性复现,直接守修复本身:
    // map-path 必须裁掉横向溢出(computed overflowX=hidden;未修时为 auto → 出滚动条)
    const railClip = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('[data-testid="map-rail"] .map-path')).overflowX`,
    ).catch(() => "");
    const t1RailFits = await waitFits('[data-testid="map-rail"] .map-path');
    results.push({
      name: "responsive tiers: T2 auto-collapse + exclusive side, T3 single-pane switcher, widen restores T1",
      ok: t2Default?.rail === false && t2Default?.chat === true && t2Default?.nb === true && t2Default?.switcher === false
        && t2Left?.rail === true && t2Left?.nb === false && t2Left?.chat === true
        && t3Chat?.rail === false && t3Chat?.chat === true && t3Chat?.nb === false && t3Chat?.switcher === true
        && t3SwitcherDocked === true
        && t3Rail?.rail === true && t3Rail?.chat === false && t3Rail?.railW >= 700
        && narrowRail && narrowNb && narrowChat
        && t1Back?.rail === true && t1Back?.railW <= 320 && t1RailFits && railClip === "hidden" && t1Back?.chat === true && t1Back?.nb === true && t1Back?.switcher === false && t1Back?.railW <= 320,
      detail: { t2Default, t2Left, t3Chat, t3SwitcherDocked, t3Rail, narrowRail, narrowNb, narrowChat, t1Back, t1RailFits, railClip },
    });
  } catch (e) {
    results.push({ name: "responsive tiers", ok: false, detail: String(e) });
  }

  // T-exam (考试答题正确性): 答题 UI 的选项显示序必须与判分端的 perm 映射配对
  // (v0.12 真实事故:渲染按自然序、判分按显示位穿置换 → 点对的选项被判成另一个)。
  // 造数:解锁第一个考试球(章节课时全部 mastery≥0.5)+ 注入 3 道已知答案的题
  // (E2E-长题干 兼测超长题干溢出)。点"正确选项的文本"答题 → 断言 3/3 + 零溢出。
  const UITEST_EXAM_QS = [
    {
      id: "uitest-exam-q1",
      prompt: "E2E-选择题一:LookatStudy 的学习数据存储在哪里?",
      options: ["本地 SQLite 数据库", "云端服务器", "浏览器 localStorage", "别人的电脑"],
    },
    {
      id: "uitest-exam-q2",
      prompt:
        "E2E-长题干:" +
        "这是一段很长的题干内容,用来测试超长题目在窄屏上是否会溢出屏幕边界,需要注意各种极端情况下的布局表现。".repeat(8) +
        "\n```js\nconst veryLongIdentifierName = someFunction(with, many, arguments, that, never, ends);\n```\n" +
        "另一个不可断行的超长字符串:" +
        "x".repeat(160),
      options: [
        "长题干的正确答案是本地优先架构,数据归属明确且离线可用",
        "错误选项二" + "重复填充文本".repeat(12),
        "错误选项三" + "重复填充文本".repeat(12),
        "错误选项四",
      ],
    },
    {
      id: "uitest-exam-q3",
      prompt: "E2E-选择题三:以下哪一个是间隔重复算法?",
      options: ["SM-2", "HTTP", "CSS", "JSON"],
    },
  ];
  const examSetup: { examId?: string; injectedLessonProgress: string[] } = { injectedLessonProgress: [] };
  let examIntegrity: { ok?: boolean; scoreOk?: boolean; reason?: string; error?: string; overflow?: unknown; botPerch?: { near?: boolean; botTop?: number; timerBottom?: number; botLeft?: number; timerRight?: number } } = {};
  try {
    const examNode = getDb().select().from(contentNodes).all().find((n) => n.type === "exam");
    if (!examNode) {
      examIntegrity = { reason: "no exam node in seed course" };
    } else {
      examSetup.examId = examNode.id;
      // 解锁:同章课时全部 mastery≥0.5(无行的插入并记为注入,有行的抬高不还原——T21 会删整门课)
      const sectionLessons = getDb()
        .select()
        .from(contentNodes)
        .all()
        .filter((n) => n.parentId === examNode.parentId && n.type === "lesson");
      for (const l of sectionLessons) {
        const has = getDb().select().from(progressTable).where(eq(progressTable.nodeId, l.id)).get();
        if (!has) {
          getDb().insert(progressTable).values({ nodeId: l.id, status: "mastered", mastery: 0.95 }).run();
          examSetup.injectedLessonProgress.push(l.id);
        } else if ((has.mastery ?? 0) < 0.5) {
          getDb().update(progressTable).set({ mastery: 0.95 }).where(eq(progressTable.nodeId, l.id)).run();
        }
      }
      for (const x of UITEST_EXAM_QS) {
        getDb()
          .insert(exercisesTable)
          .values({
            id: x.id,
            nodeId: examNode.id,
            type: "mcq",
            prompt: x.prompt,
            answer: "0",
            optionsJson: JSON.stringify(x.options),
            aiGenerated: true,
            kcTitle: "UI测试知识点",
          })
          .run();
      }
      markDirty();
      // DB 直写不发 state:changed → 已渲染的地图还认为考试球锁定;reload 让进度重拉
      await win.webContents.loadURL(win.webContents.getURL());
      examIntegrity = await win.webContents.executeJavaScript(`
        (async function() {
          try {
            var q = function(s) { return document.querySelector(s); };
            var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
            var waitFor = async function(sel, timeout) {
              for (var t = 0; t < timeout; t += 250) {
                var el = q(sel);
                if (el) return el;
                await sleep(250);
              }
              return null;
            };
            var row = await waitFor('[data-testid="course-row"]', 20000);
            if (!row) return { ok: false, reason: "no course row after reload" };
            // 选课处理器在行内第一个 button 上(行 div 本身无 onClick)
            var rowBtn = row.querySelector("button");
            if (!rowBtn) return { ok: false, reason: "course row has no select button" };
            rowBtn.click();
            var ball = null;
            for (var t = 0; t < 20000; t += 300) {
              ball = q('button[data-testid^="exam-node-"]:enabled');
              if (ball) break;
              await sleep(300);
            }
            if (!ball) {
              var dump = { examBtns: [], rail: !!q('[data-testid="map-rail"]'), path: !!q(".map-path"), wrappers: document.querySelectorAll("[data-node-id]").length, noCourse: !!q('[data-testid="chat-no-course"]'), progress: {} };
              document.querySelectorAll('button[data-testid^="exam-node-"]').forEach(function(b) {
                dump.examBtns.push({ id: b.getAttribute("data-testid"), disabled: b.disabled });
              });
              try {
                var courseRows = document.querySelectorAll('[data-testid="course-row"]');
                if (courseRows.length > 0) {
                  var cid = courseRows[0].getAttribute("data-course-id");
                  if (cid) {
                    var nodes = await window.api.getCourseTree(cid);
                    var examN = nodes.filter(function(n) { return n.type === "exam"; })[0];
                    var secLessons = nodes.filter(function(n) { return n.parentId === examN.parentId && n.type === "lesson"; });
                    dump.progress.examId = examN.id;
                    dump.progress.exam = await window.api.getProgress(examN.id);
                    for (var li = 0; li < secLessons.length; li++) {
                      dump.progress[secLessons[li].id] = await window.api.getProgress(secLessons[li].id);
                    }
                  }
                }
              } catch (e2) { dump.progress.error = String(e2); }
              return { ok: false, reason: "exam ball not unlocked/found", dump: dump };
            }
            ball.click();
            var entered = null;
            for (var t2 = 0; t2 < 15000; t2 += 300) {
              if (q('[data-testid="exam-start-btn"]')) { entered = "ready"; break; }
              if (q('[data-testid="exam-result"]')) { entered = "result"; break; }
              await sleep(300);
            }
            if (!entered) return { ok: false, reason: "exam view did not mount" };
            if (entered === "result") {
              var retry = q('[data-testid="exam-retry-btn"]');
              if (!retry) return { ok: false, reason: "result page without retry btn" };
              retry.click();
            } else {
              q('[data-testid="exam-start-btn"]').click();
            }
            if (!(await waitFor('[data-testid="exam-answering"]', 10000))) return { ok: false, reason: "answering not shown" };
            // 答题会话 active 时提前退出会拦住后续步骤的导航/删除 —— 失败路径先走离开确认终止
            var bail = async function(payload) {
              try {
                if (!q('[data-testid="exam-answering"]')) return payload;
                var anyBall = q('button[data-testid^="map-node-"]:enabled');
                if (!anyBall) return payload;
                anyBall.click();
                await sleep(500);
                var leaveConfirm = q('[data-testid="exam-leave-confirm"]');
                if (leaveConfirm) { leaveConfirm.click(); await sleep(700); }
              } catch (e3) { /* 尽力而为 */ }
              return payload;
            };
            var FPS = [
              ["E2E-选择题一", "本地 SQLite 数据库"],
              ["E2E-长题干", "长题干的正确答案是本地优先架构,数据归属明确且离线可用"],
              ["E2E-选择题三", "SM-2"],
            ];
            var overflow = null, answered = 0;
            var botPerch = null; // v0.19 考试静栖:首题时量一次伴学是否钉在计时条带
            for (var k = 0; k < 6; k++) {
              if (q('[data-testid="exam-result"]')) break; // 最后一题提交后 answering 卸载,先查结算页
              var root = q('[data-testid="exam-answering"]');
              if (!root) return await bail({ ok: false, reason: "answering vanished at q" + k, overflow: overflow });
              if (k === 0 && !botPerch) {
                // v0.19 考试静栖:轮询落位(无头窗口 rAF 被节流,跨栏滑翔可能要
                // 数秒);到位即收,最多 8 秒。
                for (var p0 = 0; p0 < 20 && !botPerch; p0++) {
                  await sleep(500);
                  var tmE = q('[data-testid="exam-timer"]');
                  var boE = q(".cp-creature");
                  if (tmE && boE) {
                    var tmR = tmE.getBoundingClientRect();
                    var bR = boE.getBoundingClientRect();
                    var nearNow = Math.abs(bR.top - tmR.bottom) < 160 && Math.abs(bR.left - tmR.right) < 300;
                    if (nearNow || p0 === 19) {
                      botPerch = {
                        near: nearNow,
                        botTop: Math.round(bR.top), timerBottom: Math.round(tmR.bottom),
                        botLeft: Math.round(bR.left), timerRight: Math.round(tmR.right),
                      };
                    }
                  }
                }
                var tmEl = q('[data-testid="exam-timer"]');
                var botEl = q(".cp-creature");
                if (!botPerch && tmEl && botEl) {
                  var tmr = tmEl.getBoundingClientRect();
                  var br = botEl.getBoundingClientRect();
                  botPerch = {
                    near: Math.abs(br.top - tmr.bottom) < 160 && Math.abs(br.left - tmr.right) < 220,
                    botTop: Math.round(br.top), timerBottom: Math.round(tmr.bottom),
                    botLeft: Math.round(br.left), timerRight: Math.round(tmr.right),
                  };
                }
              }
              var body = root.innerText || "";
              var fp = null;
              for (var i = 0; i < FPS.length; i++) if (body.indexOf(FPS[i][0]) >= 0) { fp = FPS[i]; break; }
              if (!fp) return await bail({ ok: false, reason: "unknown prompt: " + body.slice(0, 40) });
              if (fp[0] === "E2E-长题干" && !overflow) {
                var rb = root.getBoundingClientRect();
                var pr = root.querySelector(".whitespace-pre-wrap");
                var sc = null;
                var divs = root.querySelectorAll("div");
                for (var j = 0; j < divs.length; j++) {
                  var st = getComputedStyle(divs[j]);
                  if (st.overflowY === "auto" || st.overflowY === "scroll") { sc = divs[j]; break; }
                }
                overflow = {
                  rootFits: rb.bottom <= window.innerHeight + 1,
                  promptNoX: pr ? pr.scrollWidth <= pr.clientWidth + 1 : null,
                  scroller: !!sc,
                  scrollable: sc ? sc.scrollHeight >= sc.clientHeight : false,
                };
              }
              var btns = root.querySelectorAll('button[data-testid^="exam-option-"]');
              var hit = null;
              for (var b = 0; b < btns.length; b++) if ((btns[b].innerText || "").trim() === fp[1]) { hit = btns[b]; break; }
              if (!hit) return await bail({ ok: false, reason: "correct option not found for " + fp[0], overflow: overflow });
              hit.click();
              // React 状态更新异步落地:点击后等渲染再读按钮态
              await sleep(300);
              var next = q('[data-testid="exam-next-btn"]');
              if (!next || next.disabled) return await bail({ ok: false, reason: "next btn disabled after select", overflow: overflow });
              next.click();
              answered++;
              await sleep(400);
            }
            var res = await waitFor('[data-testid="exam-result"]', 20000);
            if (!res) return await bail({ ok: false, reason: "result page never shown", overflow: overflow });
            var txt = res.innerText || "";
            var scoreOk = txt.indexOf("3 / 3") >= 0;
            // 离开守卫链路(v0.12 用户报告):结算页再开一场 → 中途切节点弹警告 → 确认终止
            // → 连续再切节点【不应】再弹警告(会话已被消费;卸载时无清理则 ref 残留 active)
            var leave = { shown: false, cleared: null, error: null };
            try {
              var retry2 = q('[data-testid="exam-retry-btn"]');
              if (!retry2) {
                leave.error = "no retry btn on result page";
              } else {
                retry2.click();
                if (!(await waitFor('[data-testid="exam-answering"]', 10000))) {
                  leave.error = "retry did not enter answering";
                } else {
                  var balls = document.querySelectorAll('button[data-testid^="map-node-"]:enabled');
                  if (balls.length < 2) {
                    leave.error = "need 2 enabled lesson balls, got " + balls.length;
                  } else {
                    balls[0].click();
                    for (var lt = 0; lt < 5000 && !q('[data-testid="exam-leave-modal"]'); lt += 250) await sleep(250);
                    leave.shown = !!q('[data-testid="exam-leave-modal"]');
                    var leaveConfirm = q('[data-testid="exam-leave-confirm"]');
                    if (leave.shown && leaveConfirm) {
                      leaveConfirm.click();
                      await sleep(1200); // terminate(await)+导航
                      // 切另一个节点:守卫不得再拦(会话应已清)
                      balls[1].click();
                      await sleep(900);
                      leave.cleared = !q('[data-testid="exam-leave-modal"]');
                    } else if (!leave.shown) {
                      leave.error = "leave modal did not appear on node switch during exam";
                    }
                  }
                }
              }
            } catch (e4) { leave.error = String(e4); }
            var leaveOk = leave.error === null && leave.shown === true && leave.cleared === true;
            return {
              ok: scoreOk && !!overflow && overflow.rootFits && overflow.promptNoX && overflow.scroller && overflow.scrollable && leaveOk,
              scoreOk: scoreOk,
              answered: answered,
              overflow: overflow,
              leave: leave,
              botPerch: botPerch,
            };
          } catch (e) { return { ok: false, error: String(e) }; }
        })()
      `);
    }
  } catch (e) {
    examIntegrity = { error: String(e) };
  } finally {
    // 清理注入( attempt/考试进度/题目/注入的课时进度),不污染后续步骤与下次运行
    try {
      if (examSetup.examId) {
        getDb().delete(examAttempts).where(eq(examAttempts.examNodeId, examSetup.examId)).run();
        getDb().delete(progressTable).where(eq(progressTable.nodeId, examSetup.examId)).run();
      }
      for (const x of UITEST_EXAM_QS) {
        getDb().delete(exercisesTable).where(eq(exercisesTable.id, x.id)).run();
      }
      for (const lid of examSetup.injectedLessonProgress) {
        getDb().delete(progressTable).where(eq(progressTable.nodeId, lid)).run();
      }
      markDirty();
    } catch (e) {
      console.error("[lookatstudy] ui-test exam cleanup failed:", e);
    }
  }

  results.push({
    name: "exam answering: option display order matches grading (click correct text → 3/3) + long prompt stays in viewport",
    ok: examIntegrity?.ok === true,
    detail: examIntegrity,
  });
  results.push({
    name: "companion v0.19: exam quiet perch — bot parked beside timer during answering",
    ok: examIntegrity?.botPerch?.near === true,
    detail: examIntegrity?.botPerch ?? { note: "capture missed" },
  });

  // T21 (课程删除闭环): 地图头"删除当前课程"按钮 → ConfirmCard 确认 → 课程删除,
  // 中栏回到未选课空态 + 课程列表少一门。ui-test 用临时 DB,删种子课不影响下次运行。
  let courseDelete: { trash?: boolean; card?: boolean; noCourse?: boolean; before?: number; after?: number; importPanel?: boolean; error?: string } = {};
  try {
    courseDelete = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          var trash = document.querySelector('[data-testid="course-delete-btn"]');
          if (!trash) return { trash: false };
          var before = document.querySelectorAll('[data-testid="course-list"] > *').length;
          trash.click();
          await new Promise(function(r){ setTimeout(r, 300); });
          var card = document.querySelector('[data-testid="course-delete-confirm"]');
          if (!card) return { trash: true, card: false, before: before };
          var confirmBtn = card.querySelector('[data-testid="course-delete-confirm-confirm"]');
          if (confirmBtn) confirmBtn.click();
          // 等删除 IPC + refreshAll + 重渲染(空态出现为完成信号)
          for (var i = 0; i < 40; i++) {
            await new Promise(function(r){ setTimeout(r, 250); });
            if (document.querySelector('[data-testid="chat-no-course"]')) break;
          }
          var after = document.querySelectorAll('[data-testid="course-list"] > *').length;
          return {
            trash: true,
            card: true,
            noCourse: document.querySelector('[data-testid="chat-no-course"]') !== null,
            before: before,
            after: after,
          };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
  } catch (e) {
    courseDelete = { error: String(e) };
  }
  results.push({
    name: "course delete: header trash → confirm card → deleted & back to empty-selection state",
    ok: courseDelete?.trash === true && courseDelete?.card === true && courseDelete?.noCourse === true
      && typeof courseDelete?.after === "number" && typeof courseDelete?.before === "number"
      && courseDelete.after < courseDelete.before,
    detail: courseDelete,
  });

  // allOk: 所有测试通过 OR 仅 knownFail 测试未通过
  const realFails = results.filter((r) => !r.ok && !r.knownFail);
  const knownFails = results.filter((r) => !r.ok && r.knownFail);
  const allOk = realFails.length === 0;
  const report = { overall: allOk, results, knownFailCount: knownFails.length, timestamp: new Date().toISOString() };
  writeFileSync(join(process.cwd(), ".ui-test-result.json"), JSON.stringify(report, null, 2));
  console.error("UI_TEST_RESULT=" + JSON.stringify(report));
  if (knownFails.length > 0) {
    console.error(`[lookatstudy] ${knownFails.length} known-fail(s) (not blocking):`);
    for (const r of knownFails) console.error(`  [KNOWN-FAIL] ${r.name}: ${r.knownFailReason ?? "(no reason)"}`);
  }

  // 截图作为视觉证据（可选，--screenshot 触发）。落 cwd/ui-screenshot.png。
  // 注意:本环境 disableHardwareAcceleration 下 capturePage 可能返回 0x0,
  // 截图功能在某些机器上不可用;用 DOM 断言作为主验证手段。
  if (screenshot) {
    try {
      const img = await win.webContents.capturePage();
      writeFileSync(join(process.cwd(), "ui-screenshot.png"), img.toPNG());
      console.error("[lookatstudy] screenshot saved to ui-screenshot.png");
    } catch (e) {
      console.error("[lookatstudy] screenshot failed:", e);
    }
  }

  if (!allOk) process.exitCode = 1;
}

/**
 * 画线往返测试:npm run test:highlight
 *
 * 验证 getTextModel → rangeToOffsets → offsetsToRange → applyPersistentMarks 在各种
 * DOM 结构下的精度。真 Chromium DOM(不是 jsdom 模拟)。
 *
 * 测试方法:注入带边界情况的 HTML(标题/列表/代码块/嵌套 span/空白/emoji),
 * 模拟"用户选中第 N 个字 → 保存 offset → 清空选区 → 用 offset 还原 Range → 画 mark
 * → 检查 mark 的 textContent 是否等于原选区文字"。
 *
 * 每个测试用例覆盖一种 DOM 结构的若干选区位置(开头/中间/结尾/跨节点)。
 */
async function runHighlightTest(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false },
  });

  // 用 esbuild 把 highlightText.ts 编译成纯 JS(比正则去类型可靠),注入测试页。
  // format:iife + globalName:HL → 函数挂到 window.HL,测试代码通过 HL.fn 访问。
  const tsPath = join(PROJECT_ROOT, "src/renderer/lib/highlightText.ts");
  let jsSrc = "";
  try {
    const { build } = await import("esbuild");
    const out = await build({
      entryPoints: [tsPath],
      bundle: false,
      write: false,
      format: "iife",
      globalName: "HL",
      target: "es2020",
    });
    jsSrc = new TextDecoder().decode(out.outputFiles[0].contents);
  } catch (e) {
    const errResult = { overall: false, results: [{ name: "esbuild compile", ok: false, detail: String(e) }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  await win.loadURL("about:blank");
  // 先注入编译好的函数,验证 HL 全局挂载成功
  await win.webContents.executeJavaScript(jsSrc);
  const hlReady = await win.webContents.executeJavaScript("typeof window.HL === 'object' && typeof window.HL.getTextModel === 'function'");
  if (!hlReady) {
    const errResult = { overall: false, results: [{ name: "HL global mounted", ok: false, detail: "window.HL.getTextModel not a function" }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  const runCase = async (name: string, html: string, selections: { desc: string; startText: string; len: number }[]) => {
    for (const sel of selections) {
      const result = await win.webContents.executeJavaScript(`(function() {
        try {
          const container = document.body;
          container.innerHTML = ${JSON.stringify(html)};
          container.normalize();
          const fullText = container.textContent || "";
          const idx = fullText.indexOf(${JSON.stringify(sel.startText)});
          if (idx < 0) return { ok: false, reason: "startText not found: " + ${JSON.stringify(sel.startText)} };
          const range = document.createRange();
          let acc = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent || "";
            if (!startNode && idx >= acc && idx < acc + t.length) { startNode = n; startOff = idx - acc; }
            if (!endNode && idx + ${sel.len} > acc && idx + ${sel.len} <= acc + t.length) { endNode = n; endOff = idx + ${sel.len} - acc; }
            acc += t.length;
          }
          if (!startNode || !endNode) return { ok: false, reason: "cannot map idx to text node", idx };
          range.setStart(startNode, startOff);
          range.setEnd(endNode, endOff);
          const expectedText = range.toString();
          const model = window.HL.getTextModel(container);
          const offsets = window.HL.rangeToOffsets(range, model);
          if (!offsets) return { ok: false, reason: "rangeToOffsets null", expected: expectedText };
          window.getSelection().removeAllRanges();
          const backRange = window.HL.offsetsToRange(model, offsets.start, offsets.end);
          if (!backRange) return { ok: false, reason: "offsetsToRange null", offsets };
          const actualText = backRange.toString();
          if (actualText !== expectedText) {
            return { ok: false, reason: "text mismatch", expected: expectedText, actual: actualText, offsets };
          }
          const marks = window.HL.applyPersistentMarks(container, [{ noteId: "n1", startOffset: offsets.start, endOffset: offsets.end }]);
          const markEl = marks.get("n1");
          if (!markEl) return { ok: false, reason: "no mark", offsets };
          const markText = markEl.textContent;
          if (markText !== expectedText) {
            return { ok: false, reason: "mark text mismatch", expected: expectedText, actual: markText };
          }
          return { ok: true, expected: expectedText };
        } catch (e) {
          return { ok: false, reason: "exception: " + (e && e.message || String(e)) };
        }
      })()`);
      results.push({ name: `${name} — ${sel.desc}`, ok: result.ok, detail: result });
    }
  };

  await runCase("simple paragraph", '<p>Deploying GPT-4 in production systems.</p>', [
    { desc: "开头 deploying", startText: "Deploying", len: 9 },
    { desc: "中间 GPT-4", startText: "GPT-4", len: 5 },
    { desc: "结尾 production", startText: "production", len: 10 },
    { desc: "跨空格 GPT-4 in", startText: "GPT-4 in", len: 8 },
  ]);
  await runCase("nested spans", '<div><span>AI</span><p>The <strong>quick brown</strong> fox jumps.</p></div>', [
    { desc: "The quick", startText: "The quick", len: 9 },
    { desc: "quick brown", startText: "quick brown", len: 11 },
    { desc: "fox jumps", startText: "fox jumps", len: 9 },
  ]);
  await runCase("list items", '<ul><li>First item here</li><li>Second item there</li></ul>', [
    { desc: "First", startText: "First", len: 5 },
    { desc: "Second", startText: "Second", len: 6 },
    { desc: "跨 li item there", startText: "item there", len: 10 },
  ]);
  await runCase("code block", '<pre><code>const x = 42;\nconst y = x + 1;</code></pre>', [
    { desc: "const x", startText: "const x", len: 7 },
    { desc: "跨行 x + 1", startText: "x + 1", len: 5 },
  ]);
  await runCase("heading + paragraph", '<h2>Section Title</h2><p>Some body text follows.</p>', [
    { desc: "Section", startText: "Section", len: 7 },
    { desc: "body text", startText: "body text", len: 9 },
    { desc: "跨元素 Title Some", startText: "Title", len: 10 },
  ]);
  await runCase("whitespace nodes", '<div>\n  <p>Hello world</p>\n</div>', [
    { desc: "Hello", startText: "Hello", len: 5 },
    { desc: "world", startText: "world", len: 5 },
  ]);
  await runCase("chinese text", '<p>大语言模型通过注意力机制处理序列数据。</p>', [
    { desc: "大语言", startText: "大语言", len: 3 },
    { desc: "注意力机制", startText: "注意力机制", len: 5 },
    { desc: "序列数据", startText: "序列数据", len: 4 },
  ]);
  await runCase("emoji mixed", '<p>✅ Correct! The answer is 42.</p>', [
    { desc: "Correct", startText: "Correct", len: 7 },
    { desc: "answer is", startText: "answer is", len: 9 },
  ]);
  await runCase("blockquote", '<blockquote><p>Quoted text inside.</p></blockquote>', [
    { desc: "Quoted", startText: "Quoted", len: 6 },
    { desc: "inside", startText: "inside", len: 6 },
  ]);

  win.close();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : " — " + JSON.stringify(r.detail)}`);
  }
  console.log(`\n=== highlight roundtrip: ${passed}/${results.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
  writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify({ overall: failed === 0, results }, null, 2));
  console.error("HIGHLIGHT_TEST_RESULT=" + JSON.stringify({ overall: failed === 0, passed, total: results.length }));
  if (failed > 0) process.exitCode = 1;
}
