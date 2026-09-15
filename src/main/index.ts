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
import { zipSync, strToU8 } from "fflate";
import { join, resolve } from "node:path";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { initDb, getDb, markDirty } from "./db/index.js";
import { setupIpc } from "./ipc/electron-wiring.js";
import { setupContextMenu } from "./context-menu.js";
import { isAllowedExternalUrl } from "./lib/external-url.js";
import { ensureSeedCourse } from "./services/seed.js";
import { ensureExamNodesForExistingCourses } from "./services/course-generator.js";
import { loadEnv, getZaiConfig } from "./services/env.js";
import { seedBuiltinSouls } from "./services/souls/soul-service.js";
import { createProposal } from "./services/proposal-service.js";
import { setStateEmitter } from "./lib/state-emitter.js";
import { syncPetWindow } from "./pet-window.js";
import { setExamStatusSender } from "./services/exam-generation-store.js";
import { courses, contentNodes, streaks, settings as settingsTable, customProviders, srsItems, canvasItems, progress as progressTable, chatMessages, threads as threadsTable, exercises as exercisesTable, examAttempts, proposals } from "./db/schema.js";
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

// Electron 44/Windows(v0.35 升级实测):Chromium 的原生窗口遮挡计算会把透明窗/
// 挪屏外窗/被遮窗标成 visibilityState=hidden —— 页面级 rAF 全停(伴学动画冻结,
// ui-test 插桩 rafTicks=0 + visState=hidden 实锤;33 无此行为)。桌宠透明窗与
// ui-test 隐身窗都依赖"show 着但视觉不可见仍产帧",关掉该遮挡计算。
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

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

  // 外链走系统浏览器:window.open / target=_blank。
  // 协议白名单(2026-09-13 审计修复):渲染层展示不可信课程内容,ms-msdt:/search-ms:
  // 等系统协议处理器是本地 RCE 历史入口——非 http(s)/mailto 一律拒绝交 OS 处理。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    else console.warn(`[security] 拒绝外部打开非白名单协议链接: ${url}`);
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
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      else console.warn(`[security] 拒绝外部打开非白名单协议链接: ${url}`);
    }
  });

  // 右键菜单:复制文字 / 复制图片 / 保存图片(像操作网页一样)
  setupContextMenu(mainWindow);

  if (isDev && process.env["NODE_ENV"] === "development") {
    // Electron 44(2026-09-14 实测):dev 启动竞态——应用侧 DB/seed 让 loadURL 晚于
    // 探针数秒,撞上 vite 模块图未就绪/network service 崩溃重启窗口时,首次加载
    // 永不 settle(did-finish-load 不触发,窗口停在 backgroundColor=黑屏)。看门狗:
    // 5s 未完成即重试,至多 6 次;did-fail-load 也立即重试。
    let loadSettled = false;
    let retries = 0;
    mainWindow.webContents.on("did-finish-load", () => { loadSettled = true; });
    mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
      console.error(`[dev] did-fail-load code=${code} ${desc} main=${isMain} ${url}`);
    });
    const reloadWatchdog = setInterval(() => {
      if (loadSettled || retries >= 6) {
        clearInterval(reloadWatchdog);
        if (!loadSettled) console.error("[dev] 加载看门狗耗尽:页面仍未完成加载");
        return;
      }
      retries++;
      console.error(`[dev] 加载看门狗第 ${retries} 次重试(loadURL 未在 5s 内 settle)`);
      void mainWindow?.webContents.loadURL(DEV_SERVER_URL).catch(() => {});
    }, 5000);
    void mainWindow.loadURL(DEV_SERVER_URL).catch((e) =>
      console.error("[dev] loadURL rejected:", String(e).slice(0, 120)),
    );
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
    // Electron 44:经历 hide/show 解卡的半隐窗后 app.quit() 的优雅退出链可能挂起
    // (33 无此问题;run5 实测写完结果 40 分钟不退)。ui-test 用一次性临时 DB,
    // 无需优雅落盘——直接硬退出,stdio 也随之冲刷。
    app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
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
    jsTimeout(win.webContents, code).catch(() => null);
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
/**
 * Electron 44(2026-09-14 Windows 实测):连续 setBounds 后 native 窗口已变,但合成器
 * 视口(innerWidth / resize 事件)可能停更——直到窗口经历一次 hide/show 才恢复;
 * re-setBounds / setSize / setContentSize / setOpacity 均救不回(TIERDBG-NUDGE 逐项
 * 实测,33 无此问题)。所有 ui-test 窗口改宽统一走本等待器:轮询视口到位,超时用
 * hide/show 解卡再等一轮;真用户窗口(opacity=1、用户手动 resize)不受影响。
 */

/**
 * Electron 44 半隐窗(ui-test 的 opacity≈0 窗口)上 executeJavaScript 偶发永不
 * settle——run10/11/12 同点冻死(页面已加载、无报错,Promise 就是不回来;33 无此
 * 问题)。统一 30s 竞速兜底:超时回 null,断言按失败计,进程绝不挂死。
 */
const jsTimeout = (wc: Electron.WebContents, code: string, timeoutMs = 30_000): Promise<any> =>
  Promise.race([
    wc.executeJavaScript(code).catch(() => null),
    new Promise((r) => setTimeout(r, timeoutMs, null)),
  ]);

async function resizeViewport(win: BrowserWindow, width: number, height: number): Promise<boolean> {
  const iw = (): Promise<number> =>
    jsTimeout(win.webContents, "window.innerWidth").catch(() => -1);
  const ok = async () => Math.abs((await iw()) - width) <= 60;
  // 全形 bounds(含 x/y):部分形 {width,height} 在 44 上疑似更容易触发停滞
  const cur = win.getBounds();
  win.setBounds({ x: cur.x, y: cur.y, width, height });
  for (let i = 0; i < 12; i++) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  win.hide();
  win.show();
  for (let i = 0; i < 12; i++) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

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
  // 渲染层 console 转发(默认不进主进程日志;bail/FATAL 行对排障关键——
  // 2026-09-14 Electron 44 适配期靠它抓到 rAF 停摆的实锤)
  win.webContents.on("console-message", (_e, _lvl, msg) => {
    const s = String(msg);
    if (s.includes("bail") || s.includes("[FATAL")) console.error("[renderer] " + s.slice(0, 300));
  });
  if (!screenshot) {
    // 透明 show:从未 show 的窗口拿不到合成器 begin-frame,rAF 被降到 ~1s/帧
    // 甚至完全停摆(2026-08-23 实测:frame16@16.1s 后全停,伴学冻死在 roam
    // 半路,exam-perch 断言假红)。backgroundThrottling:false 只救定时器救不了
    // 合成器。show 让合成器全速。
    win.show();
    // Electron 44(2026-09-14 定谳):setOpacity(0.01) 的近零透明窗在页面重载后
    // 会被 Chromium 标记 visibilityState=hidden —— rAF 全停(伴学冻 0,0/roam 停摆/
    // 依赖动画的断言全线假红,插桩 rafTicks=0+visState=hidden 实锤)。33 时代用
    // opacity≈0 隐身;44 改为挪屏外:窗口保持可见性与 begin-frame,桌面上也不可见。
    win.setPosition(-3000, 0);
  }

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
  // 加载前只能用裸 setBounds——resizeViewport 要 executeJavaScript 轮询视口,
  // 对未加载任何页面的 webContents 在 44 上会永不 settle(run5/6/7 同点冻死)。
  win.setBounds({ width: 1280, height: 800 });
  await win.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));

  // 等渲染层拉完数据 + React 渲染完。轮询所有关键 testid 都出现——
  // 不能只等容器，因为 souls/courses 是异步并行拉的，容器早出、内容晚出，会 race。
  // 课程空选启动:map-node-* 要等手动选课后才出现,初始等待只等三栏 + 课程列表(导入面板)。
  const waitRender = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    const checkAll = () =>
      jsTimeout(win.webContents, `
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
    jsTimeout(win.webContents, `
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
  const emptyStart = await jsTimeout(win.webContents, `
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
  // v13 空态的家=标题栏栖息地(左缘停靠退役):判据=在场+栖身标题栏带内。
  const emptyCreature = await jsTimeout(win.webContents, `
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
      var hdr = document.querySelector("header.app-header");
      var hdrR = hdr ? hdr.getBoundingClientRect() : null;
      var zone = document.querySelector('[data-testid="companion-creature"]');
      var a = sample();
      await new Promise(function(r){ setTimeout(r, 1200); });
      var b = sample();
      return {
        a: a, b: b,
        moved: !!(a && b && (Math.abs(a.x-b.x) > 2 || Math.abs(a.y-b.y) > 2)),
        hdr: hdrR ? { top: Math.round(hdrR.top), bottom: Math.round(hdrR.bottom) } : null,
        zone: zone ? zone.dataset.zone : null,
      };
    })()
  `).catch(() => null);
  results.push({
    name: "companion v9: always-on at empty state (titlebar habitat, rAF loop alive)",
    // 首采样为 null 合法(设置异步加载完 creature 才首次渲染);
    // v13 判据=终态在场+栖身标题栏带内(zone=titlebar,y 在 header 带内)
    ok:
      !!emptyCreature?.b &&
      emptyCreature.hdr != null &&
      emptyCreature.b.y + 44 >= (emptyCreature.hdr.top ?? 0) - 8 &&
      emptyCreature.b.y <= (emptyCreature.hdr.bottom ?? 9999) + 8,
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
  const optionCount = await jsTimeout(win.webContents, 
    `document.querySelectorAll('[data-testid^="soul-pill-"]').length`,
  );
  results.push({
    name: "soul-picker has 3 builtin souls (direct/guide/practice)",
    ok: typeof optionCount === "number" && optionCount === 3,
    detail: { optionCount },
  });

  // T2: map-rail 至少有 1 个视图切换项 + path overview 有节点
  const navNodeCount = await jsTimeout(win.webContents, 
    `document.querySelectorAll('[data-testid^="map-node-"]').length`,
  );
  results.push({
    name: "map-rail path overview has ≥1 node",
    ok: typeof navNodeCount === "number" && navNodeCount >= 1,
    detail: { navNodeCount },
  });

  // T2c (companion v3): 选课 + 默认开 → 单生物在场且在左栏原生物理世界(zone=rail)
  // v13 轮询:v12 召回制家=左栏,但岛注册/可见性到位前会短暂栖标题栏——
  // 轮询最多 4s 等他飞进左栏,容忍瞬态不误报
  const railProbe = await jsTimeout(win.webContents, `
    (async function() {
      function readPos() {
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
      for (var i = 0; i < 40; i++) {
        var el = document.querySelector('[data-testid="companion-creature"]');
        var zone = el ? el.dataset.zone : null;
        var pos = readPos();
        if ((zone === "rail" || zone === "chat" || zone === "notebook") && pos && pos.y > 60) {
          return { zone: zone, pos: pos };
        }
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      var el2 = document.querySelector('[data-testid="companion-creature"]');
      return { zone: el2 ? el2.dataset.zone : null, pos: readPos() };
    })()
  `).catch(() => null);
  const railErrors = await win.webContents
    .executeJavaScript(`(window.__cpErr && window.__cpErr.slice(0, 5)) || []`)
    .catch(() => []);
  results.push({
    name: "companion v10: creature alive at course pick (roam pane, position written)",
    // v10 闲时=roam:栖身栏由时间桶决定(任意栏都合法),只要求在场+位置已写
    ok:
      !!railProbe?.pos &&
      railProbe.pos.y > 60 &&
      ["rail", "chat", "notebook"].includes(railProbe.zone ?? ""),
    detail: { zone: railProbe?.zone, pos: railProbe?.pos, errors: railErrors },
  });

  // T3: 三栏都在(chat-panel + notebook-panel + map-rail)
  const threePane = await jsTimeout(win.webContents, `
    document.querySelector('[data-testid="map-rail"]') !== null &&
    document.querySelector('[data-testid="chat-panel"]') !== null &&
    document.querySelector('[data-testid="notebook-panel"]') !== null
  `);
  results.push({
    name: "three-pane layout rendered (nav + chat + artifact)",
    ok: threePane === true,
  });

  // T4: streak badge 渲染（说明 getStreak IPC roundtrip 成功）
  const streakPresent = await jsTimeout(win.webContents, 
    `document.querySelector('[data-testid="streak-badge"]') !== null`,
  );
  results.push({
    name: "streak badge rendered (getStreak IPC OK)",
    ok: streakPresent === true,
  });

  // T4a (P4 能力感): 等级徽章 + freeze 徽章(庆祝粒子层 CelebrationLayer 由 motion-infra 套件覆盖)
  const competenceBadges = await jsTimeout(win.webContents, `
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
  const dueBadge = await jsTimeout(win.webContents, `
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
  const interleave = await jsTimeout(win.webContents, `
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
  const nextLabel = await jsTimeout(win.webContents, 
    `document.querySelector('[data-testid="map-next-label"]') !== null`,
  );
  results.push({
    name: "node label only on selected; first-available does NOT pin a label (clean map)",
    ok: nextLabel === false,
  });

  // T5: 点击一个未锁的 map-node → 触发 markNodeAttempted → 联动右栏
  let clickResult: { clicked?: boolean; totalBtns?: number; enabledCount?: number; error?: string } = {};
  try {
    clickResult = await jsTimeout(win.webContents, `
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
  const soulSelect = await jsTimeout(win.webContents, `
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
  const readyState = await jsTimeout(win.webContents, 
    `window.api.isAgentReady()`,
  );
  results.push({
    name: "isAgentReady returns valid state (ready boolean + provider + model)",
    ok: typeof readyState?.ready === "boolean" && typeof readyState?.provider === "string",
    detail: readyState,
  });

  // T8 (M2): proposal IPC 完整回路 —— listPending（应含 1 条 seed）
  //   → reject → listPending（应空）。验证 M2 接线 + proposal-service 真生效。
  const proposalRoundtrip = await jsTimeout(win.webContents, `
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
  const midPane = await jsTimeout(win.webContents, `
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
  const linkage = await jsTimeout(win.webContents, `
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
  const startState = await jsTimeout(win.webContents, `
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
  const notebookCompanion = await jsTimeout(win.webContents, 
    `document.querySelector('[data-testid="companion-creature"]') !== null`,
  );
  results.push({
    name: "companion v3: single creature persists while node selected",
    ok: notebookCompanion === true,
  });

  // ---- M0 spike(CompanionBot Lab,.goal/SPEC.md):外部角色包三档对照实验页 ----
  // hash 门控懒挂载 + 三 bot 渲染 + 键击切帧(sticker src 变化)+ 庆祝总线驱动 happy。
  // 结束时退出 lab(fixed 覆盖层不挡后续断言的点击)。与 CompanionCreature 零耦合:
  // 既有 companion v* 断言(含上面这条)全部照常通过即零回归的证据。
  const botLab = await jsTimeout(win.webContents, `
    (async function() {
      try {
        location.hash = "#companion-bot-lab";
        var root = null;
        for (var i = 0; i < 40; i++) {
          await new Promise(function(r){ setTimeout(r, 100); });
          root = document.querySelector('[data-companion-bot-lab]');
          if (root) break;
        }
        if (!root) return { mounted: false };
        // 异步样例 art 就绪前 lab 只渲染空壳(buildSampleArt rAF/异步)——轮询等 bots,
        // 防启动期 IPC 抖动把"root 先于 art"的竞态翻成假红
        var bots0 = root.querySelectorAll('[data-companion-bot]');
        for (var w = 0; w < 50 && bots0.length < 3; w++) {
          await new Promise(function(r) { setTimeout(r, 100); });
          bots0 = root.querySelectorAll('[data-companion-bot]');
        }
        var bots = root.querySelectorAll('[data-companion-bot]');
        var stickerBox = root.querySelector('[data-companion-bot="bongo"]');
        var sticker = stickerBox ? stickerBox.querySelector('img') : null;
        if (!sticker) return { mounted: true, bots: bots.length, error: "no-sticker-img" };
        var before = sticker.getAttribute('src');
        // 轮询等状态机切帧:期间持续补发键击(重置 180ms 驻留窗),慢时钟下必可捕获
        var mid = before, midState = 'idle', midBox = stickerBox;
        for (var k = 0; k < 12; k++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
          await new Promise(function(r){ setTimeout(r, 100); });
          midBox = root.querySelector('[data-companion-bot="bongo"]');
          mid = midBox.querySelector('img').getAttribute('src');
          midState = midBox.getAttribute('data-bot-state');
          if (midState !== 'idle' && mid !== before) break;
        }
        var celebrateBtn = document.querySelector('[data-testid="bot-lab-celebrate"]');
        if (celebrateBtn) celebrateBtn.click();
        await new Promise(function(r){ setTimeout(r, 150); });
        var happyState = root.querySelector('[data-companion-bot="bongo"]').getAttribute('data-bot-state');
        var unmounted = false;
        location.hash = "";
        for (var j = 0; j < 20; j++) {
          await new Promise(function(r){ setTimeout(r, 100); });
          if (!document.querySelector('[data-companion-bot-lab]')) { unmounted = true; break; }
        }
        return { mounted: true, bots: bots.length, changed: before !== mid, midState: midState, happyState: happyState, unmounted: unmounted };
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  results.push({
    name: "companion-bot M0: lab mounts (3 tiers) + keystroke swaps frame",
    ok: botLab?.mounted === true && botLab?.bots === 3 && botLab?.changed === true,
    detail: botLab,
  });
  results.push({
    name: "companion-bot M0: celebration bus drives happy + lab closes clean",
    ok: botLab?.happyState === "happy" && botLab?.unmounted === true,
    detail: botLab,
  });

  // T8e (按钮消息展示): 点「开始学习」→ 乐观 user 气泡立刻出现且只显示短动作标签,
  // 发给 LLM 的完整开场提示词不出现在 DOM(防"按钮 prompt 裸奔"回归)。
  // 断言完立即停流(chat-stop),避免 LLM 流式阻塞后续测试的节点切换。
  const actionDisplay = await jsTimeout(win.webContents, `
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
    shikiRes = await jsTimeout(win.webContents, `
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

  // T-MINDMAP:v0.26 已整体移除 markmap(产物系统的 LLM 概念图覆盖其场景)——
  // 守卫:Brain 按钮与脑图视图都不再存在(接线删干净,误留入口会打到死组件)。
  const brainGone = await win.webContents
    .executeJavaScript(
      `document.querySelector('[data-testid="node-content-mindmap"]') === null && document.querySelector('[data-testid="mindmap-view"]') === null`,
    )
    .catch(() => null);
  results.push({
    name: "markmap removed: brain button + mindmap view absent",
    ok: brainGone === true,
    detail: { gone: brainGone },
  });

  // T-MERMAID-ELK (v0.21): 笔记理解区的 flowchart 图卡 → 渲染成 SVG + ELK 布局
  // 真实生效。生效判据 = mermaid 的兜底 warn 缺席:flowchart-elk 请求 'elk' 布局
  // 而注册表没有时,mermaid 会 console.warn("flowchart-elk was moved…") 并退
  // dagre——挂 warn 探针再开笔记 tab,探针没捕到该 warn 即 ELK 真接管。
  let mermaidElkRes: { ok?: boolean; [k: string]: unknown } = {};
  try {
    mermaidElkRes = await jsTimeout(win.webContents, `
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
    asrInput = await jsTimeout(win.webContents, `
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
    voiceSettings = await jsTimeout(win.webContents, `
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
    const pick = await jsTimeout(win.webContents, `
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
      speechLoop = await jsTimeout(win.webContents, `
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
    const pick = await jsTimeout(win.webContents, `
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
          mathRender = await jsTimeout(win.webContents, `
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
          await jsTimeout(win.webContents, `
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
  const settingsDrawer = await jsTimeout(win.webContents, `
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

  // v0.26 抽屉手机最小宽适配:窗口压到 420px(手机浏览器视口,不受桌面 minWidth
  // 560 保护)分别开设置/复习抽屉,断言抽屉滚动容器零水平溢出(布局在手机端
  // 不破);测完立即恢复 1280 宽,不污染后续断言。
  {
    await resizeViewport(win, 420, 800);
    await new Promise((r) => setTimeout(r, 400));
    const narrowDrawers = await jsTimeout(win.webContents, `
      (async function() {
        function overflowOf(sel) {
          var root = document.querySelector(sel);
          if (!root) return { present: false };
          var panel = root.querySelector('[role="dialog"]') || root;
          var scroller = panel.querySelector(".overflow-y-auto") || panel;
          return {
            present: true,
            sw: scroller.scrollWidth, cw: scroller.clientWidth,
            pw: panel.getBoundingClientRect().width,
            docSw: document.documentElement.scrollWidth, vw: window.innerWidth,
          };
        }
        function open(sel) {
          var btn = document.querySelector(sel);
          if (btn) btn.click();
        }
        var out = {};
        try {
          open('[data-testid="header-settings"]');
          await new Promise(function(r){ setTimeout(r, 500); });
          out.settings = overflowOf('[data-testid="settings-drawer"]');
          var close = document.querySelector('[data-testid="settings-close"]');
          if (close) { close.click(); await new Promise(function(r){ setTimeout(r, 300); }); }
          // 复习抽屉:420px 已是 T3 单栏,先切到地图栏再点复习徽章(徽章在 MapRail);
          // 入口不在就跳过该半场,只测设置半场
          var railBtn = document.querySelector('[data-testid="t3-btn-rail"]');
          if (railBtn) { railBtn.click(); await new Promise(function(r){ setTimeout(r, 500); }); }
          var revBtn = document.querySelector('[data-testid="map-review-badge"]');
          if (revBtn) {
            revBtn.click();
            await new Promise(function(r){ setTimeout(r, 500); });
            out.review = overflowOf('[data-testid="review-drawer"]');
            var rclose = document.querySelector('[data-testid="review-close"]');
            if (rclose) { rclose.click(); await new Promise(function(r){ setTimeout(r, 300); }); }
          }
        } catch (e) { out.error = String(e); }
        return out;
      })()
    `).catch(() => null);
    await resizeViewport(win, 1280, 800);
    await new Promise((r) => setTimeout(r, 400));
    const sOk = narrowDrawers?.settings?.present === true
      && narrowDrawers.settings.sw <= narrowDrawers.settings.cw + 1
      && narrowDrawers.settings.docSw <= narrowDrawers.settings.vw + 1;
    const rOk = !narrowDrawers?.review || (narrowDrawers.review.present === true
      && narrowDrawers.review.sw <= narrowDrawers.review.cw + 1
      && narrowDrawers.review.docSw <= narrowDrawers.review.vw + 1);
    results.push({
      name: "drawers: no horizontal overflow at 420px phone viewport (settings + review)",
      ok: sOk && rOk,
      detail: narrowDrawers,
    });
  }

  // T9 (M3): 切到 dashboard 视图 → 仪表盘渲染（3 stat 卡 + 热力图行）
  const dashboardOk = await jsTimeout(win.webContents, `
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
  const langSwitch = await jsTimeout(win.webContents, `
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
  const presetsCheck = await jsTimeout(win.webContents, 
    `window.api.getProviderPresets().then(p => ({count: p.length})).catch(e => ({count: 0, error: String(e)}))`,
  );
  results.push({
    name: "getProviderPresets IPC returns ≥5 providers",
    ok: presetsCheck?.count >= 5,
    detail: presetsCheck,
  });

  // T11 (release): 导入课程视图渲染 URL 输入 + markdown 切换 + 课程列表
  // v0.7: 导入改左栏 tab → 点 map-tab-import 切面板 → 点"导入新课程"展开表单
  const importOk = await jsTimeout(win.webContents, `
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
  const layoutOk = await jsTimeout(win.webContents, `
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
  const cmdPalette = await jsTimeout(win.webContents, `
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
  const artifactTabs = await jsTimeout(win.webContents, `
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
    zoneCollapse = await jsTimeout(win.webContents, `
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
    const zoneDetail = await jsTimeout(win.webContents, `
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
    drawerA11y = await jsTimeout(win.webContents, `
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
  const tabRoles = await jsTimeout(win.webContents, `
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
    enI18n = await jsTimeout(win.webContents, `
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
    await jsTimeout(win.webContents, `
      (async function(){
        var z = document.querySelector('[data-testid="lang-zh-CN"]');
        if (z) z.click();
      })()
    `);
  } catch { /* 非关键 */ }

  // T19 (v0.8 a11y): zone toggle 具备 aria-expanded(屏幕阅读器可读折叠状态)
  let zoneAria: { found?: number; withAriaExpanded?: number; error?: string } = {};
  try {
    zoneAria = await jsTimeout(win.webContents, `
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
    const clicked = await jsTimeout(win.webContents, `
      (function() {
        var btns = document.querySelectorAll('[data-testid^="map-node-"]');
        for (var i = 0; i < btns.length; i++) { if (!btns[i].disabled) { btns[i].click(); return true; } }
        return false;
      })()
    `);
    await new Promise((r) => setTimeout(r, 700));
    const dom = await jsTimeout(win.webContents, `
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
    courseSearch = await jsTimeout(win.webContents, `
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
  const pointerProbe = await jsTimeout(win.webContents, `
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
    jsTimeout(win.webContents, `
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
    const waitForPane = async (pred: (st: NonNullable<Awaited<ReturnType<typeof paneState>>>) => boolean, timeoutMs = 8000) => {
      const t0 = Date.now();
      for (;;) {
        const st = await paneState();
        if (st && pred(st)) return st;
        if (Date.now() - t0 > timeoutMs) return st;
        await tierSleep(120);
      }
    };
    // → T2 (1000px):左栏自动隐,中+右双栏,无按钮组
    await resizeViewport(win, 1000, 800);
    const t2Default = await waitForPane((st) => !st.rail && st.chat && st.nb && !st.switcher);
    // T2 互斥:点"显示左栏" → 左栏出、右栏隐
    await jsTimeout(win.webContents, `document.querySelector('[data-testid="layout-toggle-left"]').click()`);
    const t2Left = await waitForPane((st) => st.rail && st.chat && !st.nb);
    // → T3 (800px):单栏(对话)+ 按钮组;点地图按钮 → 地图全宽单栏
    await resizeViewport(win, 800, 800);
    const t3Chat = await waitForPane((st) => !st.rail && st.chat && !st.nb && st.switcher);
    // 切换组必须常驻 header(居中槽,非 fixed 浮层)——否则 T3 切到左栏时 header 连带消失,回不来
    const t3SwitcherDocked = await jsTimeout(win.webContents, `
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
    await jsTimeout(win.webContents, `document.querySelector('[data-testid="t3-btn-rail"]').click()`);
    const t3Rail = await waitForPane((st) => st.rail && !st.chat && st.railW >= 700);
    // T3 极窄(600px):三 pane 逐一切换,各自都不许横向溢出窗口。
    // (回归:chat pane 曾被 composer 工具栏固有宽度顶出 ~633px 下限;左栏曾被
    //  物理球 wrapper 顶出横向滚动条 —— min-w-0 / overflow-x-hidden 修)
    await resizeViewport(win, 600, 800);
    const overflowState = (sel: string) =>
      jsTimeout(win.webContents, `
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
    await jsTimeout(win.webContents, `document.querySelector('[data-testid="t3-btn-notebook"]').click()`);
    await waitForPane((st) => !st.rail && !st.chat && st.nb);
    const narrowNb = await waitFits('[data-testid="notebook-panel"]');
    await jsTimeout(win.webContents, `document.querySelector('[data-testid="t3-btn-chat"]').click()`);
    await waitForPane((st) => !st.rail && st.chat && !st.nb);
    const narrowChat = await waitFits('[data-testid="chat-panel"]');
    // T20d (companion v3): T3 单栏切换 = 单生物连续体不消失(组件仍在场,
    // 随栏可见性自适应显隐);v13 加断言:左栏卸载后家=标题栏栖息地
    // (zone=titlebar 且栖身 header 带内,滑翔在途时轮询等待)
    const t3Creature = await jsTimeout(win.webContents, `
      (async function() {
        for (var i = 0; i < 30; i++) {
          var el = document.querySelector('[data-testid="companion-creature"]');
          if (!el) return { present: false };
          var zone = el.dataset.zone;
          var r = el.getBoundingClientRect();
          var hdr = document.querySelector("header.app-header");
          var hr = hdr ? hdr.getBoundingClientRect() : null;
          if (zone === "titlebar" && hr && r.top >= hr.top - 6 && r.bottom <= hr.bottom + 6) {
            return { present: true, zone: zone, inHeader: true, top: Math.round(r.top), hdrBottom: Math.round(hr.bottom) };
          }
          await new Promise(function(f){ setTimeout(f, 100); });
        }
        var el2 = document.querySelector('[data-testid="companion-creature"]');
        var r2 = el2 ? el2.getBoundingClientRect() : null;
        var hdr2 = document.querySelector("header.app-header");
        return { present: !!el2, zone: el2 ? el2.dataset.zone : null, top: r2 ? Math.round(r2.top) : null, hdrBottom: hdr2 ? Math.round(hdr2.getBoundingClientRect().bottom) : null };
      })()
    `).catch(() => null);
    results.push({
      name: "companion v3: single creature persists across T3 pane switching (titlebar habitat when rail off)",
      ok: t3Creature?.present === true && t3Creature.zone === "titlebar" && t3Creature.inHeader === true,
      detail: t3Creature,
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
      const dbg = await jsTimeout(win.webContents, `
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
    await resizeViewport(win, 1300, 800);
    const t1Back = await waitForPane((st) => st.rail && st.chat && st.nb && !st.switcher);
    // T1 回来后左栏回到 284px 内容盒。球被拖到墙边时 wrapper(110px,> 球 56px)会伸出
    // 内容盒 → 溢出依赖拖球行为,headless 无法确定性复现,直接守修复本身:
    // map-path 必须裁掉横向溢出(computed overflowX=hidden;未修时为 auto → 出滚动条)
    const railClip = await jsTimeout(win.webContents, 
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

  // pane-resize (issue #14 三栏拖拽调宽): 合成 PointerEvent 序列真 GUI 拖拽 →
  // 区间/视口钳制 → 双击重置回默认 → settings 持久化(IPC 落库)→ loadFile
  // 重载后启动读回 → T3 无手柄。拖拽事件必须异步分段派发:pointerdown 后要
  // 等 React commit,window 级 move/up 监听才挂上(同步连发=监听未挂全丢)。
  {
    const resizeOk: Record<string, unknown> = {};
    try {
      await resizeViewport(win, 1920, 800);
      await new Promise((r) => setTimeout(r, 600));
      const paneWidth = (sel: string): Promise<number> =>
        jsTimeout(win.webContents, `
          (function() {
            var el = document.querySelector('${sel}');
            return el ? Math.round(el.getBoundingClientRect().width) : -1;
          })()
        `).catch(() => -1);
      const docOverflow = (): Promise<number> =>
        jsTimeout(win.webContents, 
          `Math.round(document.documentElement.scrollWidth - window.innerWidth)`,
        ).catch(() => 999);
      const dragHandle = (side: "rail" | "mid", dx: number): Promise<{ ok: boolean; reason?: string }> =>
        jsTimeout(win.webContents, `
          (async function() {
            var dx = ${dx};
            var h = document.querySelector('[data-testid="pane-handle-${side}"]');
            if (!h) return { ok: false, reason: "handle not found" };
            var r = h.getBoundingClientRect();
            var x0 = r.left + r.width / 2;
            var fire = function(type, x) {
              h.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                clientX: x, clientY: r.top + r.height / 2,
                pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, isPrimary: true,
              }));
            };
            fire("pointerdown", x0);
            await new Promise(function(r2){ setTimeout(r2, 130); }); // React commit → window 监听挂上
            fire("pointermove", x0 + dx / 2);
            await new Promise(function(r2){ setTimeout(r2, 130); }); // 跨 100ms 应用节流窗
            fire("pointermove", x0 + dx);
            await new Promise(function(r2){ setTimeout(r2, 60); });
            fire("pointerup", x0 + dx);
            await new Promise(function(r2){ setTimeout(r2, 300); }); // 提交 + 持久化 IPC
            return { ok: true };
          })()
        `).catch((e: unknown) => ({ ok: false, error: String(e) }));
      const dblClickHandle = (side: "rail" | "mid"): Promise<boolean> =>
        jsTimeout(win.webContents, `
          (async function() {
            var h = document.querySelector('[data-testid="pane-handle-${side}"]');
            if (!h) return false;
            h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
            await new Promise(function(r2){ setTimeout(r2, 350); }); // 重置提交 + transition 恢复
            return true;
          })()
        `).catch(() => false);

      // 0) T1 双柄在场
      resizeOk.handles = await jsTimeout(win.webContents, `
        !!document.querySelector('[data-testid="pane-handle-rail"]') &&
        !!document.querySelector('[data-testid="pane-handle-mid"]')
      `).catch(() => false);

      // 1) 左柄 +300:300→600 → 区间上限 480(预算 1920-440-691=789 放行)
      await dragHandle("rail", 300);
      resizeOk.railClampedHigh = await paneWidth('[data-testid="map-rail"]');
      // 2) 左柄 -1000:480→-520 → 区间下限 240
      await dragHandle("rail", -1000);
      resizeOk.railClampedLow = await paneWidth('[data-testid="map-rail"]');
      // 3) 双击左柄 → 回默认 300
      await dblClickHandle("rail");
      resizeOk.railReset = await paneWidth('[data-testid="map-rail"]');
      // 4) 中柄 +700:默认 691(36vw@1920)→1391 → 区间上限 1100(预算 1180 放行)
      await dragHandle("mid", 700);
      resizeOk.midClampedHigh = await paneWidth('[data-testid="chat-panel"]');
      // 5) 中柄 -1000 → 区间下限 480
      await dragHandle("mid", -1000);
      resizeOk.midClampedLow = await paneWidth('[data-testid="chat-panel"]');
      // 6) 双击中柄 → 回响应式默认 clamp(36vw)。期望值取 computed style 解析值:
      //    经典滚动条下 vw 按 clientWidth 解析(≈innerWidth-滚动条),不能按 innerWidth 硬算
      await dblClickHandle("mid");
      resizeOk.midReset = await paneWidth('[data-testid="chat-panel"]');
      resizeOk.midResetCss = await jsTimeout(win.webContents, `
        (function() {
          var el = document.querySelector('[data-testid="chat-panel"]');
          var w = el ? getComputedStyle(el).width : "";
          return w && w.endsWith("px") ? Math.round(parseFloat(w)) : -1;
        })()
      `).catch(() => -1);
      resizeOk.overAfterClamps = await docOverflow();

      // 7) 持久化:左柄拖到 420 → settings 落库 "420" → loadFile 重载 → 启动读回 420
      await dragHandle("rail", 120);
      resizeOk.persistWidth = await paneWidth('[data-testid="map-rail"]');
      resizeOk.settingValue = await jsTimeout(win.webContents, 
        `window.api.getSetting("pane_width_left")`,
      ).catch(() => null);
      await Promise.race([
        win.webContents.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html")).catch(() => {}),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      resizeOk.renderAfterReload = await waitRender();
      resizeOk.railAfterReload = await paneWidth('[data-testid="map-rail"]');
      // 重载后空选启动:选回课程,不污染后续考试/删除测试的课程上下文
      resizeOk.courseResel = await selectFirstCourse();
      // 清场:双击回默认 + settings 清空(下一轮 ui-test 零残留)
      await dblClickHandle("rail");
      resizeOk.railClean = await paneWidth('[data-testid="map-rail"]');
      resizeOk.settingClean = await jsTimeout(win.webContents, 
        `window.api.getSetting("pane_width_left")`,
      ).catch(() => null);

      // 8) T3(800px)无手柄(档位翻转在 44 上滞后,轮询 8s);然后恢复 T1@1300
      await resizeViewport(win, 800, 800);
      for (let i = 0; i < 40; i++) {
        const gone = await jsTimeout(win.webContents, `
          !document.querySelector('[data-testid="pane-handle-rail"]') &&
          !document.querySelector('[data-testid="pane-handle-mid"]')
        `).catch(() => false);
        if (gone) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      resizeOk.t3NoHandles = await jsTimeout(win.webContents, `
        !document.querySelector('[data-testid="pane-handle-rail"]') &&
        !document.querySelector('[data-testid="pane-handle-mid"]')
      `).catch(() => false);
      await resizeViewport(win, 1300, 800);
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      resizeOk.error = String(e);
    }
    const near = (v: unknown, target: number, tol = 4) =>
      typeof v === "number" && Math.abs(v - target) <= tol;
    results.push({
      name: "pane-resize: drag clamps [240,480]/[480,1100], dblclick resets, widths persist across reload, T3 hides handles",
      ok:
        resizeOk.handles === true
        && near(resizeOk.railClampedHigh, 480) && near(resizeOk.railClampedLow, 240)
        && near(resizeOk.railReset, 300)
        && near(resizeOk.midClampedHigh, 1100) && near(resizeOk.midClampedLow, 480)
        && near(resizeOk.midReset, resizeOk.midResetCss as number, 2)
        && typeof resizeOk.midReset === "number" && (resizeOk.midReset as number) >= 480 && (resizeOk.midReset as number) <= 800
        && typeof resizeOk.overAfterClamps === "number" && (resizeOk.overAfterClamps as number) <= 1
        && near(resizeOk.persistWidth, 420) && resizeOk.settingValue === "420"
        && resizeOk.renderAfterReload === true && near(resizeOk.railAfterReload, 420)
        && resizeOk.courseResel === true
        && near(resizeOk.railClean, 300) && resizeOk.settingClean === ""
        && resizeOk.t3NoHandles === true,
      detail: resizeOk,
    });
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
      // 44:半隐窗的 loadURL promise 偶发不 settle(run10/11 同点冻死)——竞速 5s
      // 后继续,页面重载本身通常已完成,只是事件没回来。
      await Promise.race([
        win.webContents.loadURL(win.webContents.getURL()),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      examIntegrity = await jsTimeout(win.webContents, `
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
      `, 150_000); // 脚本内部就有 20s+10s 轮询+逐题作答循环,默认 30s 不够
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
    courseDelete = await jsTimeout(win.webContents, `
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

  // dsh-import (设置页插件数据迁移): 真 IPC 通道端到端 —— importFromText(全平台通用路)
  // 导入小 fixture → 断言结果摘要 + 课程真落库(listCourses 可见)+ 重导幂等(refresh)。
  // 设置页 UI 三路入口由 verify-dsh-import 源级守卫覆盖,这里测主进程行为链。
  {
    const dshFixture = {
      version: 2,
      courses: [
        {
          id: "uitest-dsh",
          title: "UI 测试 dsh 迁移课",
          sections: [
            {
              title: "第一章",
              lessons: [
                { id: "uitest-dsh:0:0", title: "课一", kind: "study", status: "in_progress", mastery: 0.4, body: "# 一", concepts: [{ title: "概念A" }], conceptMastery: { "0": 0.4 }, memory: "课一的记忆", summary: "课一摘要", friction: [{ category: "confused", summary: "卡了", at: "2026-09-08T10:00:00Z" }], notes: [{ id: "n1", zone: "record", title: "", text: "笔记正文", quote: "画线的原文", source: "content", at: "2026-09-08T10:01:00Z", pinned: false }] },
                { id: "uitest-dsh:0:1", title: "课二", kind: "study", status: "mastered", mastery: 0.95, body: "# 二", sm2: { easeFactor: 2.5, intervalDays: 3, repetitions: 1 }, dueAt: "2026-01-01T00:00:00Z" },
              ],
            },
          ],
        },
      ],
      xp: { total: 33, todayKey: new Date().toISOString().slice(0, 10), todayXp: 33 },
      streak: { currentStreak: 2, longestStreak: 4, lastActiveDate: new Date().toISOString().slice(0, 10), freezeCount: 2 },
      memoryGlobal: "全局记忆",
      memoryPatterns: { "uitest-dsh": "课级模式" },
      artifacts: { "uitest-dsh:0:0": [{ id: "a1", artifactType: "concept_map", title: "概念图", createdAt: "2026-09-08T09:00:00Z", hash: "h", data: { nodes: [] } }] },
    };
    const dsh = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          var fixture = ${JSON.stringify(JSON.stringify(dshFixture))};
          var r1 = await window.api.dshImportFromText(fixture);
          var list1 = await window.api.listCourses();
          var r2 = await window.api.dshImportFromText(fixture);
          var list2 = await window.api.listCourses();
          var bad = await window.api.dshImportFromText("{broken");
          var detected = await window.api.dshImportDetect();
          return {
            r1: r1, r2: r2, bad: bad,
            detectedFound: typeof detected.found === "boolean",
            inList1: list1.some(function(c){ return c.title === "UI 测试 dsh 迁移课"; }),
            listCount2: list2.length,
          };
        } catch (e) { return { error: String(e) }; }
      })()
    `,
      )
      .catch((e: unknown) => ({ error: String(e) }));
    results.push({
      name: "dsh-import: importFromText imports course end-to-end (IPC), re-import refreshes, bad JSON rejected",
      ok:
        dsh?.r1?.ok === true && dsh?.r1?.coursesCreated === 1 && dsh?.r1?.progressRows === 2 && dsh?.r1?.srsRows === 1
        && dsh?.r1?.xpDelta === 33
        && dsh?.r1?.noteRows === 1 && dsh?.r1?.artifactRows === 1 && dsh?.r1?.memoryRows === 3 && dsh?.r1?.frictionRows === 1
        && dsh?.inList1 === true
        && dsh?.r2?.ok === true && dsh?.r2?.coursesCreated === 0 && dsh?.r2?.coursesRefreshed === 1 && dsh?.r2?.xpDelta === 0
        && dsh?.listCount2 === 1
        && dsh?.bad?.ok === false
        && dsh?.detectedFound === true,
      detail: dsh,
    });
  }

  /* ---------- M2(CompanionPack,SPEC §16):导入流 + 纸偶形态 + 行为复跑 + 持久/删除 ----------
     判据 4:注入合成 fixture 直调 IPC(绕原生 dialog)→ cut→apply→getActive → 形态切
     custom → 判据 1 的行为断言同款复跑(composer fly / talking→notebook / T3 标题栏,
     断言体与既有 v3 块逐字同源)→ 重载持久 → 删除回落 ember。 */
  {
    // ① 程序化合成 A-pose 立绘(绿幕,几何链可切;与 verify-companion-cut fixture 同风格)
    let m2Fixture = "";
    try {
      const napi = await import("@napi-rs/canvas");
    // ── 地图切课(2026-09-12 用户拍板):点地图顶部课程名 → 课程列表 → 切换 ──
    // 此刻流程已把唯一 seed 课删除,先造第二门课(dsh 通道,两门课 state,确定性无 LLM),
    // 再走导入面板选课 → 地图头部课程名 → 菜单 → 切到另一门。
    const mapSwitch = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          var q = function(s) { return document.querySelector(s); };
          var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
          var dclose = q('[data-testid="settings-close"]');
          if (dclose) { dclose.click(); await sleep(400); }
          // ① 造第二/三门课(最小 dsh state,两门)
          var courses0 = (await window.api.listCourses()).length;
          if (courses0 < 2) {
            var mk = function(id, title) {
              return { id: id, title: title, sections: [{ title: "第一章", lessons: [
                { id: id + ":0:0", title: "课一", kind: "study", status: "in_progress", mastery: 0.4, body: "# 一" },
                { id: id + ":0:1", title: "课二", kind: "study", status: "mastered", mastery: 0.9, body: "# 二" }
              ] }] };
            };
            var state = { version: 2, courses: [mk("uitest-sw-a", "切课测试甲"), mk("uitest-sw-b", "切课测试乙")], xp: { total: 0, todayKey: new Date().toISOString().slice(0, 10), todayXp: 0 }, streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: new Date().toISOString().slice(0, 10), freezeCount: 0 } };
            await window.api.dshImportFromText(JSON.stringify(state));
            for (var w = 0; w < 30; w++) {
              await sleep(300);
              if ((await window.api.listCourses()).length >= 2) break;
            }
          }
          var count = (await window.api.listCourses()).length;
          if (count < 2) return { ok: false, reason: "still single course", count: count };
          // ② 导入面板点第一行选课(未选课时地图头部无切换按钮;ImportPanel 选课自动切回地图)
          var tabImport = q('[data-testid="map-tab-import"]');
          if (tabImport) tabImport.click();
          await sleep(400);
          var row = q('[data-testid="course-list"] button');
          if (!row) {
            var rows = document.querySelectorAll('[data-testid="course-list"] button, [data-testid="import-panel"] button');
            row = rows[0] || null;
          }
          if (!row) return { ok: false, reason: "no course row", count: count };
          row.click();
          var btn = null;
          for (var i = 0; i < 20; i++) {
            await sleep(250);
            btn = q('[data-testid="map-course-switch"]');
            if (btn) break;
          }
          if (!btn) return { ok: false, reason: "no map-course-switch", count: count };
          var before = btn.textContent.trim();
          btn.click();
          var menu = null;
          for (var j = 0; j < 20; j++) {
            await sleep(200);
            menu = q('[data-testid="map-course-menu"]');
            if (menu) break;
          }
          if (!menu) return { ok: false, reason: "no menu", before: before };
          var opts = menu.querySelectorAll('button[data-testid^="map-course-option-"]');
          var target = null;
          for (var j2 = 0; j2 < opts.length; j2++) {
            if (opts[j2].textContent.trim() !== before) { target = opts[j2]; break; }
          }
          if (!target) return { ok: false, reason: "no other course option", before: before, count: opts.length };
          var targetName = target.textContent.trim();
          target.click();
          var after = "";
          for (var k = 0; k < 20; k++) {
            await sleep(250);
            var b2 = q('[data-testid="map-course-switch"]');
            after = b2 ? b2.textContent.trim() : "";
            if (after === targetName) break;
          }
          return { ok: after === targetName && after !== before, before: before, after: after, count: opts.length };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "map: 点击地图课程名弹出列表并切换课程",
      ok: mapSwitch?.ok === true,
      detail: mapSwitch,
    });

    const cv = napi.createCanvas(400, 600);
      const c = cv.getContext("2d");
      c.fillStyle = "#00b140";
      c.fillRect(0, 0, 400, 600);
      c.fillStyle = "#e8b04a";
      c.beginPath();
      c.arc(200, 130, 95, 0, Math.PI * 2);
      c.fill(); // 头(底 y=225 直坐躯干,行宽有颈缩)
      c.fillRect(140, 225, 120, 170); // 躯干
      // 臂=肩块(与躯干重叠 2px,保证单连通块)+臂板(留 10px 腋缝→3-run 行)
      c.fillRect(120, 228, 30, 22);
      c.fillRect(82, 248, 46, 118);
      c.fillRect(250, 228, 30, 22);
      c.fillRect(272, 248, 46, 118);
      c.fillRect(152, 395, 38, 118);
      c.fillRect(210, 395, 38, 118);
      m2Fixture = (await cv.encode("png")).toString("base64");
    } catch (e) {
      results.push({ name: "companion-pack M2: fixture 绘制", ok: false, detail: String(e) });
    }

    // ② 导入流:cut → apply → getActive(直调 IPC,ui-test 假 provider 下识图快速失败落几何链)
    if (m2Fixture) {
      const m2Import = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          try {
            var png = ${JSON.stringify(m2Fixture)};
            var cut = await window.api.companionPackCutFromImage({ pngBase64: png });
            if (!cut || !cut.parts || cut.parts.length < 3) return { ok: false, stage: "cut", route: cut && cut.route, n: cut && cut.parts ? cut.parts.length : 0, failure: cut && cut.failure };
            var app = await window.api.companionPackApplyPack({ name: "UI Test Puppet", manifest: cut.manifest, parts: cut.parts.map(function(p) { return { name: p.name, pngBase64: p.pngBase64 }; }) });
            if (!app || !app.id) return { ok: false, stage: "apply" };
            var act = await window.api.companionPackGetActive();
            return { ok: !!act && act.id === app.id, stage: "done", route: cut.route, parts: cut.parts.length, id: app.id, srcs: act ? Object.keys(act.srcs).length : 0 };
          } catch (e) { return { ok: false, error: String(e) }; }
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: cut→apply→getActive roundtrip (fixture inject, no dialog)",
        ok: m2Import?.ok === true && (m2Import.parts ?? 0) >= 3,
        detail: m2Import,
      });

      // ③ 形态切 custom:外层 data/class 契约不变 + 盘在场 + 部件 image 分层
      const m2Render = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          await window.api.setSetting("companion_form", "custom");
          window.dispatchEvent(new Event("companion-config-changed"));
          var cls = "", disc = 0, imgs = 0, vehArms = 0, pngArms = 0;
          for (var i = 0; i < 40; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var m = document.querySelector('[data-testid="companion-mascot"]');
            cls = m ? String(m.getAttribute("class")) : "";
            disc = document.querySelectorAll(".cp-disc").length;
            imgs = document.querySelectorAll('[data-testid="companion-mascot"] image').length;
            vehArms = document.querySelectorAll('[data-testid="companion-mascot"] .cp-veh-arm').length;
            pngArms = document.querySelectorAll('[data-testid="companion-mascot"] .cp-armL, [data-testid="companion-mascot"] .cp-armR').length;
            if (cls.indexOf("cp-form-custom") >= 0 && imgs >= 3) break;
          }
          // L1 兜底制(2026-09-12):M2 fixture 多件切分带臂件 → PNG 臂在场吃姿势、机械臂不渲染
          return { ok: cls.indexOf("cp-form-custom") >= 0 && disc >= 1 && imgs >= 3 && pngArms >= 2 && vehArms === 0, cls: cls.slice(0, 90), disc: disc, imgs: imgs, pngArms: pngArms, vehArms: vehArms };
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: form=custom renders puppet (class contract + disc + part images)",
        ok: m2Render?.ok === true,
        detail: m2Render,
      });

      // ④ 行为断言同款复跑(form=custom;断言体与既有 companion v3 块同源)
      // ④a 选课进节点(dsh 迁移课在场),composer 聚焦飞中栏 + typing——与 T8c2 同款。
      // 先在主进程重建 provider(keyless 冷启动块把 provider 行删了,keyless 卡会替换
      // composer)+ 重载:保证干净主视图与可聚焦的 chat-input
      try {
        const db = getDb();
        const provs = db.select().from(customProviders).all();
        if (!provs.some((p) => p.id === "custom-ui-test-provider")) {
          db.insert(customProviders).values({
            id: "custom-ui-test-provider",
            label: "UI Test Provider",
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            defaultModel: "test-model",
          }).run();
        }
        const apRow = db.select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
        if (apRow) {
          db.update(settingsTable).set({ value: "custom-ui-test-provider" }).where(eq(settingsTable.key, "active_provider")).run();
        } else {
          db.insert(settingsTable).values({ key: "active_provider", value: "custom-ui-test-provider" }).run();
        }
        markDirty();
      } catch {
        /* 非关键:provider 恢复失败只影响本组断言 */
      }
      try {
        await win.webContents.reload();
      } catch {
        /* 同⑤:headless 时序 reject 不影响实际重载 */
      }
      await new Promise((r) => setTimeout(r, 2500));
      win.focus();
      win.webContents.focus();
      await win.webContents
        .executeJavaScript(
          `
        (async function() {
          var row = document.querySelector('[data-testid="course-list"] button');
          if (row) { row.click(); await new Promise(function(r) { setTimeout(r, 800); }); }
          var btns = document.querySelectorAll('[data-testid^="map-node-"]');
          for (var i = 0; i < btns.length; i++) { if (!btns[i].disabled) { btns[i].click(); break; } }
          await new Promise(function(r) { setTimeout(r, 600); });
          return true;
        })()
      `,
        )
        .catch(() => null);
      const m2Fly = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          var input = document.querySelector('[data-testid="chat-input"]');
          if (!input) return { ok: false, err: "no-input" };
          input.focus();
          var samples = [];
          for (var i = 0; i < 12; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var c = document.querySelector('[data-testid="companion-creature"]');
            samples.push(c ? c.dataset.zone : "none");
            if (c && c.dataset.zone === "chat") break;
          }
          var c = document.querySelector('[data-testid="companion-creature"]');
          var zone = c ? c.dataset.zone : null;
          var cls = "";
          for (var k = 0; k < 10; k++) {
            await new Promise(function(r) { setTimeout(r, 300); });
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
            await new Promise(function(r) { setTimeout(r, 200); });
            var m = document.querySelector('[data-testid="companion-mascot"]');
            cls = m ? String(m.getAttribute('class')) : '';
            if (cls.indexOf('cp-pose-typing') >= 0) break;
          }
          input.blur();
          window.dispatchEvent(new CustomEvent("companion-zone-focus", { detail: false }));
          return { ok: zone === "chat" && cls.indexOf('cp-pose-typing') >= 0, zone: zone, cls: cls.slice(0, 90) };
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: [custom] composer focus flies to chat + typing (same assertion, rerun)",
        ok: m2Fly?.ok === true,
        detail: m2Fly,
      });

      // ④b 朗读(talking)→ 右栏助教世界——与 v3 块的 manual 事件探针同款
      const m2Talk = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          window.dispatchEvent(new CustomEvent("companion-talking", { detail: true }));
          var zone = null;
          for (var i = 0; i < 30; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var c = document.querySelector('[data-testid="companion-creature"]');
            zone = c ? c.dataset.zone : null;
            if (zone === "notebook") break;
          }
          window.dispatchEvent(new CustomEvent("companion-talking", { detail: false }));
          await new Promise(function(r) { setTimeout(r, 4500); }); // ZONE_RETURN 防抖(3.5s)+飞行窗落定
          return { ok: zone === "notebook", zone: zone };
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: [custom] talking sends creature to notebook zone (same probe, rerun)",
        ok: m2Talk?.ok === true,
        detail: m2Talk,
      });

      // ④c T3 换栏持久:左栏卸载 → 标题栏栖息——与 T20d 块逐字同款探针
      await resizeViewport(win, 600, 800);
      const m2T3 = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          for (var i = 0; i < 30; i++) {
            var el = document.querySelector('[data-testid="companion-creature"]');
            if (!el) return { present: false };
            var zone = el.dataset.zone;
            var r = el.getBoundingClientRect();
            var hdr = document.querySelector("header.app-header");
            var hr = hdr ? hdr.getBoundingClientRect() : null;
            if (zone === "titlebar" && hr && r.top >= hr.top - 6 && r.bottom <= hr.bottom + 6) {
              return { present: true, zone: zone, inHeader: true, top: Math.round(r.top), hdrBottom: Math.round(hr.bottom) };
            }
            await new Promise(function(f) { setTimeout(f, 100); });
          }
          var el2 = document.querySelector('[data-testid="companion-creature"]');
          var r2 = el2 ? el2.getBoundingClientRect() : null;
          var hdr2 = document.querySelector("header.app-header");
          return { present: !!el2, zone: el2 ? el2.dataset.zone : null, top: r2 ? Math.round(r2.top) : null, hdrBottom: hdr2 ? Math.round(hdr2.getBoundingClientRect().bottom) : null };
        })()
      `,
        )
        .catch(() => null);
      await resizeViewport(win, 1280, 800);
      results.push({
        name: "companion-pack M2: [custom] T3 pane switch → titlebar habitat (same assertion, rerun)",
        ok: m2T3?.present === true && m2T3.zone === "titlebar" && m2T3.inHeader === true,
        detail: m2T3,
      });

      // ④d 考试陪考位复跑(v0.19 同探针):dsh 课程上重建考试流(DB 直插考试节点+题目
      // +解锁,独立 id 不与种子考试冲突)→ 进答题 → 纸偶+盘须同样钉在计时条带旁。
      let m2Perch: { near?: boolean; botTop?: number; timerBottom?: number; botLeft?: number; timerRight?: number; reason?: string; error?: string } = {};
      try {
        const db = getDb();
        const m2Course = db.select().from(courses).all().find((c) => c.id.startsWith("dsh-"));
        if (!m2Course) throw new Error("no dsh course");
        const m2Section = db.select().from(contentNodes).all().find((n) => n.courseId === m2Course.id && n.type === "section");
        if (!m2Section) throw new Error("no section in dsh course");
        const examId = "uitest-m2-exam";
        if (!db.select().from(contentNodes).where(eq(contentNodes.id, examId)).get()) {
          db.insert(contentNodes).values({
            id: examId,
            courseId: m2Course.id,
            parentId: m2Section.id,
            type: "exam",
            title: "M2 陪考位复跑考试",
            sourcePath: null,
            orderIdx: 99,
            world: m2Section.world,
            summary: null,
            content: "",
          }).run();
        }
        const M2_QS: Array<[string, string, string[]]> = [
          ["uitest-m2-q1", "M2-选择题一", ["本地 SQLite 数据库", "云端数据库", "内存变量", "随手记文件"]],
          ["uitest-m2-q2", "M2-选择题二", ["SM-2", "番茄钟", "手抄日历", "随机复习"]],
          ["uitest-m2-q3", "M2-选择题三", ["BKT 掌握度", "冥想", "咖啡因", "熬夜"]],
        ];
        for (const [qid, prompt, options] of M2_QS) {
          if (!db.select().from(exercisesTable).where(eq(exercisesTable.id, qid)).get()) {
            db.insert(exercisesTable).values({
              id: qid,
              nodeId: examId,
              type: "mcq",
              prompt,
              answer: "0",
              optionsJson: JSON.stringify(options),
              aiGenerated: true,
              kcTitle: "M2 陪考",
            }).run();
          }
        }
        for (const l of db.select().from(contentNodes).all().filter((n) => n.parentId === m2Section.id && n.type === "lesson")) {
          const has = db.select().from(progressTable).where(eq(progressTable.nodeId, l.id)).get();
          if (!has) db.insert(progressTable).values({ nodeId: l.id, status: "mastered", mastery: 0.95 }).run();
          else if ((has.mastery ?? 0) < 0.5) db.update(progressTable).set({ mastery: 0.95 }).where(eq(progressTable.nodeId, l.id)).run();
        }
        markDirty();
        // DB 直写不发 state:changed → reload 让地图重拉(与既有考试块同款)
        try {
          await win.webContents.reload();
        } catch {
          /* headless 时序 */
        }
        await new Promise((r) => setTimeout(r, 2500));
        m2Perch = await win.webContents
          .executeJavaScript(
            `
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
            if (!row) return { reason: "no course row after reload" };
            var rowBtn = row.querySelector("button");
            if (!rowBtn) return { reason: "course row has no select button" };
            rowBtn.click();
            var ball = null;
            for (var t = 0; t < 20000; t += 300) {
              ball = q('button[data-testid^="exam-node-"]:enabled');
              if (ball) break;
              await sleep(300);
            }
            if (!ball) return { reason: "exam ball not unlocked/found" };
            ball.click();
            var entered = null;
            for (var t2 = 0; t2 < 15000; t2 += 300) {
              if (q('[data-testid="exam-start-btn"]')) { entered = "ready"; break; }
              if (q('[data-testid="exam-result"]')) { entered = "result"; break; }
              await sleep(300);
            }
            if (!entered) return { reason: "exam view did not mount" };
            if (entered === "result") {
              var retry = q('[data-testid="exam-retry-btn"]');
              if (!retry) return { reason: "result page without retry btn" };
              retry.click();
            } else {
              q('[data-testid="exam-start-btn"]').click();
            }
            if (!(await waitFor('[data-testid="exam-answering"]', 10000))) return { reason: "answering not shown" };
            // v0.19 考试静栖探针(逐字同款):首题时轮询伴学是否钉在计时条带旁
            var botPerch = null;
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
            // 现场清理:答题会话 active 时提前退出(走离开确认终止)
            try {
              var anyBall = q('button[data-testid^="map-node-"]:enabled');
              if (anyBall && q('[data-testid="exam-answering"]')) {
                anyBall.click();
                await sleep(500);
                var leaveConfirm = q('[data-testid="exam-leave-confirm"]');
                if (leaveConfirm) { leaveConfirm.click(); await sleep(700); }
              }
            } catch (e3) { /* 尽力而为 */ }
            return botPerch ?? { reason: "perch probe never sampled" };
          } catch (e) { return { error: String(e) }; }
        })()
      `,
          )
          .catch(() => null);
      } catch (e) {
        m2Perch = { error: String(e) };
      }
      results.push({
        name: "companion-pack M2: [custom] exam quiet perch — puppet+disc parked beside timer (same probe, rerun)",
        ok: m2Perch?.near === true,
        detail: m2Perch,
      });

      // ④e 拖拽复跑(v4 同契约):合成 pointer 抓取 → cp-grabbed 在场;松手后解除。
      // 纸偶 <image> 命中=矩形(§16.5 备案),探针取 mascot 中心点恰好覆盖该语义。
      const m2Drag = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          var m = document.querySelector('[data-testid="companion-mascot"]');
          if (!m) return { ok: false, err: "no-mascot" };
          var r = m.getBoundingClientRect();
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: cx, clientY: cy, isPrimary: true }));
          var grabbed = false;
          for (var i = 0; i < 15; i++) {
            await new Promise(function(r2) { setTimeout(r2, 100); });
            var c = document.querySelector('[data-testid="companion-creature"]');
            grabbed = c ? String(c.getAttribute("class")).indexOf("cp-grabbed") >= 0 : false;
            if (grabbed) break;
          }
          for (var s = 1; s <= 5; s++) {
            window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, buttons: 1, clientX: cx + s * 30, clientY: cy - s * 10 }));
            await new Promise(function(r2) { setTimeout(r2, 60); });
          }
          window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0, clientX: cx + 150, clientY: cy - 50 }));
          var released = false;
          for (var j = 0; j < 15; j++) {
            await new Promise(function(r2) { setTimeout(r2, 100); });
            var c2 = document.querySelector('[data-testid="companion-creature"]');
            released = c2 ? String(c2.getAttribute("class")).indexOf("cp-grabbed") < 0 : false;
            if (released) break;
          }
          return { ok: grabbed === true && released === true, grabbed: grabbed, released: released };
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: [custom] drag grab/release via synthetic pointer (same contract)",
        ok: m2Drag?.ok === true,
        detail: m2Drag,
      });

      // ⑤ 持久化:重载后包与形态都还在(settings 行 + 盘上文件)
      try {
        await win.webContents.reload();
      } catch {
        /* reload 在部分 headless 时序下 reject,重载本身仍会发生 */
      }
      await new Promise((r) => setTimeout(r, 2500));
      const m2Persist = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          var act = await window.api.companionPackGetActive();
          var cls = "";
          for (var i = 0; i < 30; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var m = document.querySelector('[data-testid="companion-mascot"]');
            cls = m ? String(m.getAttribute("class")) : "";
            if (cls.indexOf("cp-form-custom") >= 0) break;
          }
          return { ok: !!act && cls.indexOf("cp-form-custom") >= 0, id: act ? act.id : null, cls: cls.slice(0, 90) };
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: pack + form persist across reload",
        ok: m2Persist?.ok === true,
        detail: m2Persist,
      });

      // ⑥ 删除回落:按 id 删(deleteActive 已被多 bot 协议取代)→ formReset(custom→ember)→ 纸偶退场
      const m2Delete = await win.webContents
        .executeJavaScript(
          `
        (async function() {
          try {
            var r = await window.api.companionPackDelete({ id: ${JSON.stringify(m2Import?.id)} });
            if (r.formReset) window.dispatchEvent(new Event("companion-config-changed"));
            var cls = "";
            for (var i = 0; i < 30; i++) {
              await new Promise(function(r2) { setTimeout(r2, 100); });
              var m = document.querySelector('[data-testid="companion-mascot"]');
              cls = m ? String(m.getAttribute("class")) : "";
              if (cls.indexOf("cp-form-custom") < 0) break;
            }
            var act = await window.api.companionPackGetActive();
            var lst = await window.api.companionPackList();
            var gone = (lst.packs || []).every(function(p) { return p.id !== ${JSON.stringify(m2Import?.id)}; });
            return { ok: r.ok === true && r.formReset === true && !act && gone && cls.indexOf("cp-form-custom") < 0, formReset: r.formReset, cls: cls.slice(0, 90), activeLeft: !!act, packsLeft: (lst.packs || []).length };
          } catch (e) { return { ok: false, error: String(e) }; }
        })()
      `,
        )
        .catch(() => null);
      results.push({
        name: "companion-pack M2: delete → form resets to builtin, pack gone",
        ok: m2Delete?.ok === true,
        detail: m2Delete,
      });
    }
  }

  // ── Shimeji 桌宠(第七形态,SPEC-shimeji.md 判据③):协议全流程 + 第七形态选择项 + 帧渲染器挂载 ──
  // 合成迷你包(自包含布局,ee 格式):icon.png 不计帧,shime1/2 两帧(与 verify-shimeji T4 同构)
  const shimejiUiPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const shimejiUiActionsXml = `<?xml version="1.0" encoding="UTF-8" ?>
<Mascot xmlns="http://www.group-finity.com/Mascot">
  <ActionList>
    <Action Name="Look" Type="Embedded" Class="com.group_finity.mascot.action.Look" />
    <Action Name="Stand" Type="Stay" BorderType="Floor">
      <Animation>
        <Pose Image="/shime1.png" ImageAnchor="1,1" Velocity="0,0" Duration="150" />
        <Pose Image="/shime2.png" ImageAnchor="1,1" Velocity="0,0" Duration="4" />
      </Animation>
    </Action>
    <Action Name="Walk" Type="Move" BorderType="Floor">
      <Animation>
        <Pose Image="/shime1.png" ImageAnchor="1,1" Velocity="2,0" Duration="6" />
      </Animation>
    </Action>
    <Action Name="Sit" Type="Stay" BorderType="Floor">
      <Animation>
        <Pose Image="/shime2.png" ImageAnchor="1,1" Velocity="0,0" Duration="8" />
      </Animation>
    </Action>
    <Action Name="Dragged" Type="Embedded" Class="com.group_finity.mascot.action.Dragged">
      <Animation>
        <Pose Image="/shime1.png" ImageAnchor="1,1" Velocity="0,0" Duration="2" />
        <Pose Image="/shime2.png" ImageAnchor="1,1" Velocity="0,0" Duration="2" />
      </Animation>
    </Action>
    <Action Name="Fall" Type="Embedded" Class="com.group_finity.mascot.action.Fall">
      <Animation>
        <Pose Image="/shime2.png" ImageAnchor="1,1" Velocity="0,0" Duration="3" />
      </Animation>
    </Action>
  </ActionList>
</Mascot>`;
  const shimejiUiBehaviorsXml = `<?xml version="1.0" encoding="UTF-8" ?>
<マスコット>
  <行動リスト>
    <行動 名前="歩く" 頻度="40">
      <次の行動リスト 追加="false">
        <行動参照 名前="立つ" 頻度="100" />
      </次の行動リスト>
    </行動>
  </行動リスト>
</マスコット>`;
  const shimejiZipB64 = Buffer.from(
    zipSync({
      "UiTestJi/conf/actions.xml": strToU8(shimejiUiActionsXml),
      "UiTestJi/conf/behaviors.xml": strToU8(shimejiUiBehaviorsXml),
      "UiTestJi/img/icon.png": new Uint8Array(shimejiUiPng),
      "UiTestJi/img/shime1.png": new Uint8Array(shimejiUiPng),
      "UiTestJi/img/shime2.png": new Uint8Array(shimejiUiPng),
    }),
  ).toString("base64");

  // ① 协议全流程:importZip→角色清单→confirmImport→list→activate→getFrame
  const shimejiFlow = await win.webContents
    .executeJavaScript(
      `
    (async function() {
      try {
        var prev = await window.api.shimejiImportZip({ zipBase64: ${JSON.stringify(shimejiZipB64)} });
        if (!prev || !prev.importId || !prev.characters || prev.characters.length !== 1)
          return { ok: false, stage: "import", n: prev && prev.characters ? prev.characters.length : -1 };
        var ch = prev.characters[0];
        if (ch.frameCount !== 2 || ch.format !== "ee") return { ok: false, stage: "discover", frameCount: ch.frameCount, fmt: ch.format };
        var conf = await window.api.shimejiConfirmImport({ importId: prev.importId, characterRefs: [ch.ref] });
        var pk = conf && conf.packs && conf.packs[0];
        if (!pk || !pk.id) return { ok: false, stage: "confirm" };
        var lst = await window.api.shimejiList();
        var found = (lst.packs || []).filter(function(p) { return p.id === pk.id; })[0];
        if (!found || found.frameCount !== 2 || found.actionCount < 2) return { ok: false, stage: "list", found: found };
        var act = await window.api.shimejiActivate({ id: pk.id });
        var ga = await window.api.shimejiGetActive();
        var fr = await window.api.shimejiGetFrame({ packId: pk.id, frame: "shime1.png" });
        return {
          ok: act.ok === true && !!ga && ga.id === pk.id && typeof fr === "string" && fr.length > 60,
          id: pk.id, name: pk.name, format: pk.format, actions: pk.actionCount, frames: ga && ga.frames ? ga.frames.join(",") : null
        };
      } catch (e) { return { ok: false, error: String(e) }; }
    })()
  `,
    )
    .catch(() => null);
  results.push({
    name: "shimeji: importZip→角色清单→confirmImport→list→activate→getFrame 协议全流程",
    ok: shimejiFlow?.ok === true,
    detail: shimejiFlow,
  });

  if (shimejiFlow?.ok === true) {
    // ② 设置页 DOM:第七形态选择项 + Shimeji 区块 + 导入卡(开抽屉直查,零对话框)
    const shimejiDom = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          var q = function(s) { return document.querySelector(s); };
          var gear = q('[data-testid="header-settings"]');
          if (!gear) return { ok: false, reason: "no header-settings" };
          gear.click();
          var drawer = null;
          for (var i = 0; i < 20; i++) {
            await new Promise(function(r) { setTimeout(r, 250); });
            drawer = q('[data-testid="settings-drawer"]');
            if (drawer) break;
          }
          if (!drawer) return { ok: false, reason: "no settings drawer" };
          // SettingsView 是 React.lazy(v0.22 入口包瘦身),抽屉壳先出现、内容 chunk 后到——轮询等伴学区渲染。
          // 2026-09-12 固定卡排版:5 原形 + Shimeji 卡 + 自制卡 + 加号卡;入口 + → 选择 → 导入;
          // 点 Shimeji 卡 → 包列表弹窗(含协议导入的包)→ 点包项 = 激活+切形态持久化
          var out = { formBtn: false, addCard: false, selfOpt: false, shimejiOpt: false, importCard: false, links: false, shimejiList: false, listHasPack: false, picked: false, ok: false };
          for (var j = 0; j < 30; j++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            out.formBtn = !!q('[data-testid="companion-card-shimeji"]') && !!q('[data-testid="companion-card-custom"]');
            out.addCard = !!q('[data-testid="companion-form-add"]');
            if (out.formBtn && out.addCard) break;
          }
          var add = q('[data-testid="companion-form-add"]');
          if (add) add.click();
          for (var k = 0; k < 20; k++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            out.selfOpt = !!q('[data-testid="companion-create-self"]');
            out.shimejiOpt = !!q('[data-testid="companion-create-shimeji"]');
            if (out.shimejiOpt) break;
          }
          var opt = q('[data-testid="companion-create-shimeji"]');
          if (opt) {
            opt.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
            opt.click();
          }
          for (var m = 0; m < 20; m++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            out.importCard = !!q('[data-testid="shimeji-import"]');
            if (out.importCard) break;
          }
          // 下载站点外链排:4 站点(shimeji.org/shimejis.xyz/Cachomon/DeviantArt 搜索),href 必须真站外链
          var linkRows = document.querySelectorAll('[data-testid="shimeji-download-links"] a');
          out.links = linkRows.length === 4
            && !!q('[data-testid="shimeji-link-cachomon"]')
            && linkRows[0].getAttribute("href") === "https://shimeji.org/"
            && linkRows[3].getAttribute("href") === "https://www.deviantart.com/search?q=shimeji";
          var dclose = q('[data-testid="shimeji-dialog-close"]');
          if (dclose) dclose.click();
          await new Promise(function(r) { setTimeout(r, 300); });
          // 固定卡排版:点 Shimeji 来源卡 → 包列表弹窗(协议已导入的包在列)→ 点包项持久化
          var scard = q('[data-testid="companion-card-shimeji"]');
          if (scard) scard.click();
          for (var n = 0; n < 20; n++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            out.shimejiList = !!q('[data-testid="shimeji-pack-list"]');
            if (out.shimejiList) break;
          }
          var opt2 = q('[data-testid="shimeji-pack-list"] button[data-testid^="shimeji-pack-option-"]');
          if (opt2) {
            out.listHasPack = true;
            opt2.click();
            for (var p2 = 0; p2 < 20; p2++) {
              await new Promise(function(r) { setTimeout(r, 200); });
              var st = await window.api.getSetting("companion_form");
              if (st === "shimeji") { out.picked = true; break; }
            }
          }
          // 换载具(机械臂同链):重开列表 → 色点 → 色板选 astro → manifest.vehicle 持久化
          var scard2 = q('[data-testid="companion-card-shimeji"]');
          if (scard2) scard2.click();
          for (var n2 = 0; n2 < 20; n2++) {
            await new Promise(function(r) { setTimeout(r, 200); });
            if (q('[data-testid="shimeji-pack-list"]')) break;
          }
          var dot = q('[data-testid="shimeji-pack-list"] [data-testid^="shimeji-pack-veh-"]');
          if (dot) {
            dot.click();
            var astro = null;
            for (var n3 = 0; n3 < 10; n3++) {
              astro = q('[data-testid="shimeji-veh-pick-astro"]');
              if (astro) break;
              await new Promise(function(r) { setTimeout(r, 200); });
            }
            if (astro) {
              astro.click();
              for (var n4 = 0; n4 < 20; n4++) {
                await new Promise(function(r) { setTimeout(r, 200); });
                var ga2 = await window.api.shimejiGetActive();
                if (ga2 && ga2.vehicle === "astro") { out.rethemed = true; break; }
              }
            }
          }
          var close = q('[data-testid="settings-close"]');
          if (close) close.click();
          await new Promise(function(r) { setTimeout(r, 400); });
          out.ok = out.formBtn && out.addCard && out.selfOpt && out.shimejiOpt && out.importCard && out.links && out.shimejiList && out.listHasPack && out.picked && out.rethemed;
          return out;
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "shimeji: 固定卡排版(Shimeji/自制卡)+ 新建流程 + 包列表选择持久化",
      ok: shimejiDom?.ok === true,
      detail: shimejiDom,
    });

    // ③ 帧渲染器挂载:形态切 shimeji → cp-form-shimeji 外壳 + shimeji-art(挂载拉包→帧 image 在位)
    const shimejiRender = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          await window.api.setSetting("companion_form", "shimeji");
          window.dispatchEvent(new Event("companion-config-changed"));
          var cls = "", art = false, imgs = 0;
          var veh = function() { return document.querySelector('[data-testid="shimeji-veh"]'); };
          for (var i = 0; i < 60; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var m = document.querySelector('[data-testid="companion-mascot"]');
            cls = m ? String(m.getAttribute("class")) : "";
            art = !!document.querySelector('[data-testid="shimeji-art"]');
            imgs = document.querySelectorAll('[data-testid="shimeji-art"] image').length;
            if (cls.indexOf("cp-form-shimeji") >= 0 && art && imgs >= 1) break;
          }
          var mountVisible = veh() ? parseFloat(getComputedStyle(veh()).opacity) > 0.8 : false;
          var arms = document.querySelectorAll('[data-testid="shimeji-art"] .cp-veh-arm').length;
          // 值勤姿势(打字)→ 载具浮现:走真实打字链(chat-input 聚焦→keydown)
          var input = document.querySelector('[data-testid="chat-input"]');
          if (input) input.focus();
          var mountShown = false;
          for (var j = 0; j < 40; j++) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
            await new Promise(function(r) { setTimeout(r, 250); });
            var mm = document.querySelector('[data-testid="companion-mascot"]');
            if (String(mm ? mm.getAttribute("class") : "").indexOf("cp-pose-typing") >= 0 && veh() && parseFloat(getComputedStyle(veh()).opacity) > 0.8) { mountShown = true; break; }
          }
          if (input) input.blur();
          window.dispatchEvent(new CustomEvent("companion-zone-focus", { detail: false }));
          return { ok: cls.indexOf("cp-form-shimeji") >= 0 && art && imgs >= 1 && mountVisible && arms >= 2 && mountShown, cls: cls.slice(0, 90), art: art, images: imgs, mountVisible: mountVisible, arms: arms, mountShown: mountShown };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "shimeji: 形态切 shimeji → cp-form-shimeji + 帧渲染器挂载(image≥1)",
      ok: shimejiRender?.ok === true,
      detail: shimejiRender,
    });

    // ③b 抓/放/扔语义(companion-grab 总线 → 调度器):抓=dragged 挣扎、轻放=settle 回地面、
    // 快扔(≥2.5 与壳 throwDizzy 同阈)=air 坠落后回地面;包里合成 Dragged/Fall/Sit 动作
    const shimejiGrab = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
          var art = function() { return document.querySelector('[data-testid="shimeji-art"]'); };
          var mode = function() { return art() ? art().dataset.mode : null; };
          var fire = function(on, speed) {
            window.dispatchEvent(new CustomEvent("companion-grab", { detail: { on: on, speed: speed } }));
          };
          var out = { ground0: mode() };
          // 抓 → dragged(挣扎)
          fire(true);
          await sleep(300);
          out.dragged = mode();
          // 轻放 → settle/ground
          fire(false, 0.5);
          await sleep(200);
          out.lightRelease = mode();
          for (var i = 0; i < 60 && mode() !== "ground"; i++) await sleep(100);
          out.lightBack = mode();
          // 快扔 → air →(重力)→ settle → ground
          fire(true);
          await sleep(200);
          fire(false, 5);
          await sleep(150);
          out.thrown = mode();
          for (var j = 0; j < 80 && mode() !== "ground"; j++) await sleep(100);
          out.thrownBack = mode();
          out.ok = out.dragged === "dragged" && out.lightBack === "ground" && out.thrown === "air" && out.thrownBack === "ground";
          return out;
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "shimeji: 抓=dragged 挣扎 / 轻放回地面 / 快扔=air 坠落回地面",
      ok: shimejiGrab?.ok === true,
      detail: shimejiGrab,
    });

    // ④ 清理回落:删包 + 形态回 ember(不留测试包污染 userData)
    const shimejiCleanup = await win.webContents
      .executeJavaScript(
        `
      (async function() {
        try {
          // 清场:删除全部 shimeji 包(ui-test DB 跨轮共享,历史轮次有残留)
          var lst0 = await window.api.shimejiList();
          for (var q = 0; q < (lst0.packs || []).length; q++) {
            await window.api.shimejiDelete({ id: lst0.packs[q].id });
          }
          var del = { ok: true };
          await window.api.setSetting("companion_form", "ember");
          window.dispatchEvent(new Event("companion-config-changed"));
          var cls = "";
          for (var i = 0; i < 30; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            var m = document.querySelector('[data-testid="companion-mascot"]');
            cls = m ? String(m.getAttribute("class")) : "";
            if (cls.indexOf("cp-form-shimeji") < 0) break;
          }
          var lst = await window.api.shimejiList();
          var gone = (lst.packs || []).length === 0;
          var ga = await window.api.shimejiGetActive();
          return { ok: del.ok === true && gone && !ga && cls.indexOf("cp-form-shimeji") < 0, packsLeft: (lst.packs || []).length };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
      )
      .catch(() => null);
    results.push({
      name: "shimeji: delete → 包消失 + 激活清空 + 形态回落 ember",
      ok: shimejiCleanup?.ok === true,
      detail: shimejiCleanup,
    });
  }
  // ── v0.36 开屏导师(boot guide)──────────────────────────────────────
  // T-b1 引导屏出现:先重置 boot 状态(套件前段已选过课→boot_done=1/last_session 有值),
  // 清 boot_done/learner_profile/last_session 后 reload,回到"第一次打开"的向导态。
  const bootReset = await jsTimeout(win.webContents, `
    (async function() {
      try {
        await window.api.setSetting("boot_done", "");
        await window.api.setSetting("learner_profile", "");
        await window.api.setSetting("last_session", "");
        location.reload();
        return "reloading";
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  await new Promise((r) => setTimeout(r, 4000));
  const bootAppear = await jsTimeout(win.webContents, `
    (async function() {
      for (var i = 0; i < 40; i++) {
        var el = document.querySelector('[data-testid="boot-guide"]');
        if (el && el.getAttribute("data-scene")) return { scene: el.getAttribute("data-scene"), bootDone: el.getAttribute("data-boot-done") };
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      return { scene: null };
    })()
  `);
  results.push({
    name: "boot: guide panel appears (welcome_intro on fresh DB)",
    ok: bootAppear?.scene === "welcome_intro" && bootAppear?.bootDone === "0",
    detail: { bootReset, bootAppear },
  });

  // T-b2 三问卡流走完:欢迎→跳过 key→填称呼+选 MBTI→选目标→试玩题→完成;
  // 经 window.api 断言画像入库 + boot_done 置位(DB 真值,非仅 UI)。
  const wizardRun = await jsTimeout(win.webContents, `
    (async function() {
      var q = function(sel){ return document.querySelector(sel); };
      var waitFor = async function(sel, tries){
        for (var i = 0; i < (tries || 60); i++) {
          var el = q(sel);
          if (el) return el;
          await new Promise(function(r){ setTimeout(r, 150); });
        }
        return null;
      };
      var click = async function(sel){ var b = await waitFor(sel); if (b) { b.click(); return true; } return false; };
      var type = async function(sel, text){
        var inp = await waitFor(sel);
        if (!inp) return false;
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(inp, text);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      };
      try {
        await click('[data-testid="boot-action-wizard_next"]');            // 欢迎下一步 → key
        await click('[data-testid="boot-action-wizard_next"]');            // key 先跳过 → 三问
        await type('[data-testid="boot-wizard-name"]', "ui测试员");
        await click('[data-testid="boot-mbti-ENTP"]');
        await new Promise(function(r){ setTimeout(r, 300); });       // MBTI 翻转反馈
        await click('[data-testid="boot-wizard-next1"]');                  // → 动机卡
        await click('[data-testid="boot-wizard-motive-intrinsic"]');
        await new Promise(function(r){ setTimeout(r, 300); });       // 动机翻卡反馈
        await click('[data-testid="boot-wizard-next2"]');                  // → 试玩题
        await click('[data-testid="boot-wizard-quiz-a"]');
        await new Promise(function(r){ setTimeout(r, 300); });       // 揭晓
        await click('[data-testid="boot-wizard-finish"]');                 // 完成 → course_pick
        await new Promise(function(r){ setTimeout(r, 400); });
        var el = q('[data-testid="boot-guide"]');
        var profile = await window.api.profileGet();
        var bootDone = await window.api.getSetting("boot_done");
        return { scene: el ? el.getAttribute("data-scene") : null, name: profile && profile.name, mbti: profile && profile.mbti, motiveStage: profile && profile.motiveStage, pacing: profile && profile.style && profile.style.pacing, bootDone: bootDone };
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  results.push({
    name: "boot: wizard walkthrough persists profile + boot_done (ENTP expanded)",
    ok: wizardRun?.scene === "course_pick" && wizardRun?.name === "ui测试员" &&
        wizardRun?.mbti === "ENTP" && wizardRun?.motiveStage === "intrinsic" &&
        wizardRun?.pacing === "exploratory" && wizardRun?.bootDone === "1",
    detail: wizardRun,
  });

  // T-b3 不重播:reload 后 boot_done=1 → 不再回到向导(ready_room:有课无进度默认态)。
  const noReplay = await jsTimeout(win.webContents, `
    (async function() {
      location.reload();
      return "reloading";
    })()
  `);
  await new Promise((r) => setTimeout(r, 4000));
  const afterReload = await jsTimeout(win.webContents, `
    (async function() {
      for (var i = 0; i < 60; i++) {
        var el = document.querySelector('[data-testid="boot-guide"]');
        if (el && el.getAttribute("data-scene")) {
          return { scene: el.getAttribute("data-scene"), bootDone: el.getAttribute("data-boot-done") };
        }
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      return { scene: null };
    })()
  `);
  results.push({
    name: "boot: boot_done never replays wizard (no welcome_intro after reload)",
    ok: afterReload?.scene !== "welcome_intro" && afterReload?.bootDone === "1",
    detail: { noReplay, afterReload },
  });

  // T-b4 resume_last:写 last_session 指向真实课程+节点 → reload → 一键恢复进课程。
  const resumeRun = await jsTimeout(win.webContents, `
    (async function() {
      try {
        var courses = await window.api.listCourses();
        if (!courses.length) return { error: "no course" };
        var courseId = courses[0].id;
        var tree = await window.api.getCourseTree(courseId);
        var lesson = tree.find(function(n){ return n.type === "lesson"; });
        await window.api.setSetting("last_session", JSON.stringify({ courseId: courseId, nodeId: lesson ? lesson.id : null }));
        location.reload();
        return "reloading";
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  await new Promise((r) => setTimeout(r, 4000));
  const resumeScene = await jsTimeout(win.webContents, `
    (async function() {
      for (var i = 0; i < 60; i++) {
        var el = document.querySelector('[data-testid="boot-guide"]');
        if (el && el.getAttribute("data-scene") === "resume_last") return { scene: "resume_last" };
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      return { scene: document.querySelector('[data-testid="boot-guide"]') ? document.querySelector('[data-testid="boot-guide"]').getAttribute("data-scene") : null };
    })()
  `);
  const resumeClicked = await jsTimeout(win.webContents, `
    (async function() {
      var btn = document.querySelector('[data-testid="boot-action-resume"]');
      if (!btn) return { clicked: false };
      btn.click();
      for (var i = 0; i < 80; i++) {
        await new Promise(function(r){ setTimeout(r, 250); });
        if (document.querySelector('[data-testid="chat-panel"]') && !document.querySelector('[data-testid="chat-no-course"]')) {
          return { clicked: true, restored: true };
        }
      }
      return { clicked: true, restored: false };
    })()
  `);
  results.push({
    name: "boot: resume_last one-click restores course session",
    ok: resumeScene?.scene === "resume_last" && resumeClicked?.restored === true,
    detail: { resumeRun, resumeScene, resumeClicked },
  });

  // T-b5 右栏学习回顾两态:清 total_xp/进度后 reload = tips 兜底;写 total_xp = recap 卡。
  // (resume 后处于选课态,右栏是 NotebookPanel —— 回退未选课态再测)
  const recapRun = await jsTimeout(win.webContents, `
    (async function() {
      try {
        await window.api.deleteCourse((await window.api.listCourses())[0].id);
        await window.api.setSetting("total_xp", "860");
        location.reload();
        return "reloading";
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  await new Promise((r) => setTimeout(r, 4000));
  const recapState = await jsTimeout(win.webContents, `
    (async function() {
      for (var i = 0; i < 60; i++) {
        var el = document.querySelector('[data-testid="boot-recap"]');
        if (el && el.getAttribute("data-mode")) {
          var xpEl = document.querySelector('[data-testid="boot-recap-xp"]');
          var tipEl = document.querySelector('[data-testid="boot-tip-text"]');
          return { mode: el.getAttribute("data-mode"), xpText: xpEl ? xpEl.textContent : null, tipText: tipEl ? tipEl.textContent.slice(0, 40) : null };
        }
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      return { mode: null };
    })()
  `);
  // ── v0.36 个人资料窗口(profile window)──────────────────────────
  // 主进程直插 DB 造一条 pending 画像提议(mbti INTP),页面侧走完整 apply 链。
  const seedProfileProposal = getDb().insert(proposals).values({
    id: "uitest-profile-prop",
    nodeId: null,
    operationsJson: JSON.stringify([
      { type: "update_learner_profile", nodeId: null, profilePatch: { mbti: "INTP" } },
    ]),
    status: "pending",
    rationale: "ui-test 造数:观察到两次与画像不符的行为",
    createdAt: new Date().toISOString(),
  }).onConflictDoNothing().run();
  void seedProfileProposal;

  const profileUi = await jsTimeout(win.webContents, `
    (async function() {
      var waitFor = async function(sel, tries) {
        for (var i = 0; i < (tries || 40); i++) {
          var el = document.querySelector(sel);
          if (el) return el;
          await new Promise(function(r){ setTimeout(r, 150); });
        }
        return null;
      };
      try {
        var btn = await waitFor('[data-testid="header-profile"]');
        if (!btn) return { step: "header-btn", ok: false };
        btn.click();
        var modal = await waitFor('[data-testid="profile-modal"]');
        if (!modal) return { step: "modal", ok: false };
        var s1 = await waitFor('[data-testid="profile-section-declared"]');
        var s2 = await waitFor('[data-testid="profile-section-suggestions"]');
        var s3 = await waitFor('[data-testid="profile-section-memory"]');
        var card = await waitFor('[data-testid="profile-suggest-card"]');
        var cardText = card ? card.textContent : "";
        var memOff = !!(await waitFor('[data-testid="profile-memory-off"]', 8));
        var before = await window.api.profileGet();
        if (card) {
          var apply = card.querySelector('[data-testid="profile-suggest-apply"]');
          if (apply) apply.click();
        }
        var after = null;
        for (var i = 0; i < 40; i++) {
          await new Promise(function(r){ setTimeout(r, 250); });
          after = await window.api.profileGet();
          if (after && after.mbti === "INTP") break;
        }
        return {
          step: "done",
          ok: !!s1 && !!s2 && !!s3 && !!card && memOff && after && after.mbti === "INTP",
          sections: [!!s1, !!s2, !!s3],
          cardHasINTP: cardText.indexOf("INTP") >= 0,
          cardHasReason: cardText.indexOf("ui-test") >= 0 || cardText.indexOf("观察到") >= 0,
          memOff: memOff,
          mbtiBefore: before ? before.mbti : null,
          mbtiAfter: after ? after.mbti : null,
        };
      } catch (e) { return { error: String(e) }; }
    })()
  `);
  results.push({
    name: "profile window: header avatar → modal 3 sections → suggestion card apply (INTP)",
    ok: profileUi?.ok === true && profileUi?.cardHasINTP === true,
    detail: profileUi,
  });

  results.push({
    // 两态分层验证:recap 态在污染库(套件尾部 streak/掌握数非零)活断言;
    // tips 兜底态是"全新用户"边界,由 verify-learner-profile T26 源级锁分支,
    // ui-test 临时库无法在尾部还原全零状态(streak 无重置 API)。
    name: "boot: right-pane recap card (recap mode live; tips branch locked in verify-learner-profile)",
    ok: recapState?.mode === "recap" && /860/.test(recapState?.xpText ?? ""),
    detail: { recapRun, recapState },
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
    // iife 注入页没有模块系统:esbuild 会把源里的 import 转成
    // `var import_x = require("@shared/...")`,页面无 require → 整个 iife 抛错、
    // HL 挂载失败(v0.28 引入 @shared import 起本 harness 就没绿过——双重既有坏)。
    // 剥掉 require 行;被测面(rangeToOffsets/画线通道)不引用这些模块
    // (markReadingSentence 内部的 displayGroupSpanAround 在本页不被调用)。
    jsSrc = jsSrc.replace(/^\s*var\s+import_\w+\s*=\s*require\([^)]*\)\s*;\s*$/gm, "");
  } catch (e) {
    const errResult = { overall: false, results: [{ name: "esbuild compile", ok: false, detail: String(e) }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  await win.loadURL("about:blank");
  // 先注入编译好的函数,验证 HL 全局挂载成功
  await jsTimeout(win.webContents, jsSrc);
  const hlReady = await jsTimeout(win.webContents, "typeof window.HL === 'object' && typeof window.HL.getTextModel === 'function'");
  if (!hlReady) {
    const errResult = { overall: false, results: [{ name: "HL global mounted", ok: false, detail: "window.HL.getTextModel not a function" }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  const runCase = async (name: string, html: string, selections: { desc: string; startText: string; len: number }[]) => {
    for (const sel of selections) {
      const result = await jsTimeout(win.webContents, `(function() {
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
          // 跨元素选区会被拆成多个克隆 <mark>(首元素只含首段文字),断言比联合文本
          const markText = Array.from(container.querySelectorAll("mark.lookatstudy-underline"))
            .map((m) => m.textContent).join("");
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

  // v0.35.1 持久画线 Highlight API 通道(16:23 DOMException 根修的行为闭环):
  // 核心断言 = 画完线 DOM 零改动(无 mark 元素、文本节点不拆分)——这正是
  // "React 重渲染永不冲突"的构造性证明;另验 Range 命中文字、注册表、
  // 重渲染后重放、溯源查询与兜底通道共存。
  {
    const hlCase = await jsTimeout(win.webContents, `(async function() {
      const out = {};
      try {
        const HTML = '<p>前文 <a href="https://example.com">链接文字</a> 中段,然后是可画线正文。</p>';
        const container = document.body;
        // ── 1. 主通道:画线后 DOM 必须零改动 ──
        container.innerHTML = HTML;
        const domBefore = container.innerHTML;
        const notes = [{ noteId: "n1", text: "链接文字" }, { noteId: "n2", text: "可画线正文" }];
        const ranges = window.HL.applyPersistentMarksHighlight(container, notes);
        out.zeroDomChange = container.innerHTML === domBefore;
        out.noMarkElements = container.querySelectorAll("mark.lookatstudy-underline").length === 0;
        out.rangeCount = ranges.size;
        out.n1Text = ranges.get("n1") ? ranges.get("n1").toString() : null;
        // 注册表:Highlight 已登记,包含两条 Range
        const hl = (window.CSS && window.CSS.highlights) ? window.CSS.highlights.get("cp-user-note") : null;
        out.registered = !!hl;
        out.registeredSize = hl ? hl.size : -1;
        // ── 2. 溯源查询 ──
        out.hasN1 = window.HL.hasNoteMark("n1");
        out.hasGhost = window.HL.hasNoteMark("ghost");
        // ── 3. 模拟 React 重渲染(整树重建)后重放:无异常、注册表更新 ──
        container.innerHTML = HTML; // 旧 Range 全部悬空
        const ranges2 = window.HL.applyPersistentMarksHighlight(container, [{ noteId: "n1", text: "链接文字" }]);
        out.reapplyOk = ranges2.size === 1 && ranges2.get("n1").toString() === "链接文字";
        out.prunedGhost = !window.HL.hasNoteMark("n2"); // n2 不在新 notes 里,应被摘除
        // ── 4. 双容器共存(讲解区+对话流同屏):互不冲掉 ──
        const box2 = document.createElement("div");
        container.appendChild(box2);
        box2.innerHTML = '<p>对话流里的画线目标文本。</p>';
        window.HL.applyPersistentMarksHighlight(box2, [{ noteId: "n3", text: "画线目标文本" }]);
        const hl2 = window.CSS.highlights.get("cp-user-note");
        out.coexistSize = hl2 ? hl2.size : -1;
        // ── 5. 兜底通道仍在(DOM 包裹,无 API 环境用)──
        container.innerHTML = HTML;
        const marks = window.HL.applyPersistentMarksByText(container, notes);
        out.fallbackMarks = container.querySelectorAll("mark.lookatstudy-underline").length;
        out.fallbackMap = marks.size;
        out.fallbackText = marks.get("n1") ? marks.get("n1").textContent : null;
        // 清场
        window.CSS.highlights.delete("cp-user-note");
        window.CSS.highlights.delete("cp-user-note-flash");
        container.innerHTML = "";
      } catch (e) {
        out.exception = String(e && e.message || e);
      }
      return out;
    })()`);
    const o = (hlCase || {}) as Record<string, unknown>;
    results.push({ name: "note-highlight: 主通道画线后 DOM 零改动", ok: o.zeroDomChange === true && o.noMarkElements === true, detail: o });
    results.push({ name: "note-highlight: Range 命中 + 注册表登记", ok: o.rangeCount === 2 && o.n1Text === "链接文字" && o.registered === true && o.registeredSize === 2, detail: { rangeCount: o.rangeCount, n1Text: o.n1Text, registered: o.registered, registeredSize: o.registeredSize } });
    results.push({ name: "note-highlight: 溯源查询 + 幽灵 id 拒绝", ok: o.hasN1 === true && o.hasGhost === false, detail: { hasN1: o.hasN1, hasGhost: o.hasGhost } });
    results.push({ name: "note-highlight: 重渲染后重放 + 死 Range 修剪", ok: o.reapplyOk === true && o.prunedGhost === true, detail: { reapplyOk: o.reapplyOk, prunedGhost: o.prunedGhost } });
    results.push({ name: "note-highlight: 双容器共存不互冲", ok: o.coexistSize === 2, detail: { coexistSize: o.coexistSize } });
    results.push({ name: "note-highlight: DOM 兜底通道仍工作", ok: o.fallbackMarks === 2 && o.fallbackMap === 2 && o.fallbackText === "链接文字", detail: { fallbackMarks: o.fallbackMarks, fallbackMap: o.fallbackMap, fallbackText: o.fallbackText, exception: o.exception } });
  }

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
